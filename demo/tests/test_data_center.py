"""D-Data Center V1 后端测试。

覆盖任务书 §10 后端最低覆盖：
  - 总览计数及只读/可写状态
  - 手动备份、manifest、SHA-256、下载
  - 备份排除 PDF、缓存、素材、密钥
  - 恢复前备份、合法恢复、恢复不删除额外记录
  - 损坏 ZIP、hash 不匹配、路径穿越、绝对路径拒绝
  - 只读状态拒绝写操作
  - 健康检查对缺 PDF、无裁框、重复 ID、stale 的报告
  - 健康检查零写入
  - 冻结包与展示导出边界
  - images.json、annotation、aiDraft、reviewEvents 不被数据中心非预期修改

全部在临时目录+合成数据上运行，禁止触碰真实工作数据。

运行：  python -m pytest tests/test_data_center.py -v
"""
import hashlib
import json
import zipfile
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


@pytest.fixture
def iso(tmp_path, monkeypatch):
    """把 bridge 的所有数据路径重定向到临时目录，返回 (client, paths)。"""
    data = tmp_path / "data"
    books = data / "books"
    data_backup = data / "_data_backups"
    backups_auto = data / "backups" / "auto"
    pre_write = data / "backups" / "pre_write"
    for d in (data, books, data_backup, backups_auto, pre_write):
        d.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(bridge, "DATA_DIR", data)
    monkeypatch.setattr(bridge, "BOOKS_DIR", books)
    monkeypatch.setattr(bridge, "GLOBAL_PATH", data / "global.json")
    monkeypatch.setattr(bridge, "IMAGES_DIR", data / "images")
    monkeypatch.setattr(bridge, "PDFS_DIR", data / "pdfs")
    monkeypatch.setattr(bridge, "SESSION_PATH", data / "session.json")
    monkeypatch.setattr(bridge, "SESSION_BACKUP_PATH", data / "session.json.bak")
    monkeypatch.setattr(bridge, "AUTO_BACKUP_DIR", backups_auto)
    monkeypatch.setattr(bridge, "PRE_WRITE_BACKUP_DIR", pre_write)
    monkeypatch.setattr(bridge, "DATA_BACKUP_DIR", data_backup)
    monkeypatch.setattr(bridge, "ASSET_ROOT", None)
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", False)
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "test-dataset")
    monkeypatch.setattr(bridge, "DATA_SOURCE_LABEL", "测试库")
    monkeypatch.setattr(bridge, "DATA_SOURCE_MODE", "isolated")

    bridge.app.config.update(TESTING=True)
    client = bridge.app.test_client()
    return client, {
        "data": data, "books": books, "data_backup": data_backup,
        "global": data / "global.json",
    }


def _write_book(data_dir, book_id, book_meta=None, images=None, with_pdf=False, with_pages=False):
    """在临时 data 目录写一本合成书。"""
    bdir = data_dir / "books" / book_id
    bdir.mkdir(parents=True, exist_ok=True)
    book = {"id": book_id, "title": f"测试书 {book_id}", "pageCount": 3}
    book.update(book_meta or {})
    (bdir / "book.json").write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
    (bdir / "images.json").write_text(json.dumps(images or [], ensure_ascii=False), encoding="utf-8")
    (bdir / "meta.json").write_text(json.dumps({"note": "测试"}, ensure_ascii=False), encoding="utf-8")
    if with_pdf:
        (bdir / "book.pdf").write_bytes(b"%PDF-1.4 fake")
    if with_pages:
        ph = bdir / "pages_hires"
        ph.mkdir(exist_ok=True)
        (ph / "p0001.jpg").write_bytes(b"fake-jpg")
    return bdir


def _write_asset_links(data_dir, sources):
    """写 asset-links.json：sources = {sid: {"packages": [{"package_id":..,"status":..}]}}。"""
    payload = {
        "schema_version": "asset-links-v1",
        "sources": sources,
        "updated_at": "2026-07-22T00:00:00+08:00",
    }
    (data_dir / "asset-links.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _rewrite_zip_without(zip_path, drop_rel):
    """重写 ZIP，去掉指定 rel 条目（模拟缺失文件）。"""
    keep = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            if info.filename == drop_rel:
                continue
            keep.append((info.filename, zf.read(info)))
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in keep:
            zf.writestr(name, data)


def _rewrite_zip_with_extra(zip_path, extra_rel, extra_data=b"extra"):
    """重写 ZIP，追加一个 manifest 外的额外文件（模拟额外文件）。"""
    keep = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            keep.append((info.filename, zf.read(info)))
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in keep:
            zf.writestr(name, data)
        zf.writestr(extra_rel, extra_data)


# ── 1. 总览计数及只读/可写状态 ──────────────────────────────────────────────

def test_summary_counts_and_readonly_state(iso):
    """总览计数正确；只读状态正确反映。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "b1_p001", "status": "ok", "pdfSource": {"bookId": "b1", "pageNum": 1}},
        {"id": "b1_p002", "status": "pending", "pdfSource": {"bookId": "b1", "pageNum": 2}},
        {"id": "b1_p003", "status": "", "pdfSource": {"bookId": "b1", "pageNum": 3}},
    ])
    r = client.get("/api/data-center/summary").get_json()
    assert r["ok"] is True
    s = r["summary"]
    assert s["counts"]["books"] == 1
    assert s["counts"]["illustrations"] == 3
    assert s["status_counts"]["confirmed"] == 1
    assert s["status_counts"]["pending_review"] == 1
    assert s["status_counts"]["pending_annotate"] == 1
    assert s["dataset"]["read_only"] is False
    assert s["dataset"]["label"] == "测试库"


def test_summary_readonly_flag(iso, monkeypatch):
    """只读库的 summary 正确反映 read_only=True。"""
    client, paths = iso
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    r = client.get("/api/data-center/summary").get_json()
    assert r["summary"]["dataset"]["read_only"] is True


# ── 2. 手动备份、manifest、SHA-256、下载 ────────────────────────────────────

def test_manual_backup_manifest_sha256_download(iso):
    """手动备份生成 ZIP + manifest，含 SHA-256，可下载。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "b1_p001", "status": "ok"}
    ])
    paths["global"].write_text(json.dumps({"project": "测试", "images": []}, ensure_ascii=False), encoding="utf-8")

    r = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    assert r["ok"] is True
    b = r["backup"]
    assert b["backup_id"].startswith("backup_")
    assert b["summary"]["book_count"] == 1
    assert b["summary"]["file_count"] > 0

    # manifest 含 SHA-256
    mf = b["manifest"]
    for f in mf["files"]:
        assert "sha256" in f and len(f["sha256"]) == 64
        assert "size" in f

    # ZIP 文件存在
    zip_path = paths["data_backup"] / f"{b['backup_id']}.zip"
    assert zip_path.exists()

    # 下载
    dl = client.get(f"/api/data-center/backups/{b['backup_id']}/download")
    assert dl.status_code == 200

    # 列表
    lst = client.get("/api/data-center/backups").get_json()
    assert lst["ok"] is True
    assert any(x["backup_id"] == b["backup_id"] for x in lst["backups"])


# ── 3. 备份排除 PDF、缓存、素材、密钥 ──────────────────────────────────────

def test_backup_excludes_pdf_cache_assets_secrets(iso):
    """备份 ZIP 不含 PDF、pages_hires、config.json、session.json。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}], with_pdf=True, with_pages=True)
    (paths["data"] / "config.json").write_text(json.dumps({"api_key": "secret"}), encoding="utf-8")
    (paths["data"] / "session.json").write_text("{}", encoding="utf-8")

    r = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    assert r["ok"] is True
    zip_path = paths["data_backup"] / f"{r['backup']['backup_id']}.zip"
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
    # 排除项不得出现
    assert not any("book.pdf" in n for n in names), f"PDF 不应纳入备份: {names}"
    assert not any("pages_hires" in n for n in names), f"pages_hires 不应纳入备份: {names}"
    assert not any("config.json" in n for n in names), f"config.json 不应纳入备份: {names}"
    assert not any("session.json" in n for n in names), f"session.json 不应纳入备份: {names}"
    # 白名单项应出现
    assert any("book.json" in n for n in names)
    assert any("images.json" in n for n in names)
    assert any("meta.json" in n for n in names)


# ── 4. 恢复前备份、合法恢复、恢复不删除额外记录 ─────────────────────────────

def test_restore_creates_before_restore_backup(iso):
    """恢复前自动创建 before_restore 备份。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001", "status": "ok"}])
    # 创建一份备份
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 恢复
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is True
    assert r2["before_restore_backup"]["backup_id"].startswith("backup_")
    assert "before_restore" in r2["before_restore_backup"]["backup_id"]


def test_restore_legal(iso):
    """合法恢复：白名单文件被原子替换。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001", "status": "ok"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 修改 images.json
    bdir = paths["books"] / "b1"
    (bdir / "images.json").write_text(json.dumps([{"id": "modified"}], ensure_ascii=False), encoding="utf-8")
    # 恢复
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is True
    assert r2["restored"]["count"] > 0
    # images.json 应恢复为原始内容
    restored = json.loads((bdir / "images.json").read_text(encoding="utf-8"))
    assert restored == [{"id": "b1_p001", "status": "ok"}]


def test_restore_does_not_delete_extra_records(iso):
    """恢复不删除备份中不存在的额外书籍或记录。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 新增第二本书（备份中不存在）
    _write_book(paths["data"], "b2", images=[{"id": "b2_p001"}])
    b2dir = paths["books"] / "b2"
    assert b2dir.exists()
    # 恢复
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is True
    # b2 应仍然存在
    assert b2dir.exists(), "恢复不得删除额外书籍"


def test_restore_requires_confirm_text(iso):
    """恢复必须输入「恢复」二次确认。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "wrong"}).get_json()
    assert r2["ok"] is False
    assert r2["code"] == "CONFIRM_REQUIRED"


# ── 5. 损坏 ZIP、hash 不匹配、路径穿越、绝对路径拒绝 ───────────────────────

def test_restore_corrupt_zip_rejected(iso, monkeypatch):
    """损坏 ZIP 被拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 破坏 ZIP
    zip_path = paths["data_backup"] / f"{bid}.zip"
    zip_path.write_bytes(b"not a zip")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False


def test_restore_hash_mismatch_rejected(iso):
    """SHA-256 不匹配被拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 篡改 manifest 中的 hash
    mf_path = paths["data_backup"] / f"{bid}.manifest.json"
    mf = json.loads(mf_path.read_text(encoding="utf-8"))
    mf["files"][0]["sha256"] = "0" * 64
    mf_path.write_text(json.dumps(mf, ensure_ascii=False), encoding="utf-8")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False
    assert r2["code"] in ("ZIP_HASH_MISMATCH", "MANIFEST_MISSING")


def test_restore_path_traversal_rejected(iso):
    """Zip Slip / 路径穿越被拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 构造含穿越路径的 ZIP + 匹配 manifest
    zip_path = paths["data_backup"] / f"{bid}.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("../../evil.txt", b"evil")
        # 仍需白名单文件以通过 manifest 校验
        zf.writestr("books/b1/book.json", json.dumps({"id": "b1"}))
    mf_path = paths["data_backup"] / f"{bid}.manifest.json"
    mf = json.loads(mf_path.read_text(encoding="utf-8"))
    # 添加 evil 文件到 manifest（模拟攻击者伪造）
    mf["files"].append({"rel": "../../evil.txt", "size": 4,
                        "sha256": hashlib.sha256(b"evil").hexdigest()})
    mf_path.write_text(json.dumps(mf, ensure_ascii=False), encoding="utf-8")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False


def test_restore_absolute_path_rejected(iso):
    """绝对/盘符路径被拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    zip_path = paths["data_backup"] / f"{bid}.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("/absolute/evil.txt", b"evil")
        zf.writestr("books/b1/book.json", json.dumps({"id": "b1"}))
    mf_path = paths["data_backup"] / f"{bid}.manifest.json"
    mf = json.loads(mf_path.read_text(encoding="utf-8"))
    mf["files"].append({"rel": "/absolute/evil.txt", "size": 4,
                        "sha256": hashlib.sha256(b"evil").hexdigest()})
    mf_path.write_text(json.dumps(mf, ensure_ascii=False), encoding="utf-8")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False


# ── 6. 只读状态拒绝写操作 ────────────────────────────────────────────────────

def test_readonly_rejects_restore(iso, monkeypatch):
    """只读库恢复被拒绝（423）。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"})
    assert r2.status_code == 423


def test_readonly_allows_backup(iso, monkeypatch):
    """只读库允许备份（只读主数据+写备份目录，不修改主数据）。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    r = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    assert r["ok"] is True


# ── 7. 健康检查对缺 PDF、无裁框、重复 ID、stale 的报告 ─────────────────────

def test_health_reports_missing_pdf(iso):
    """健康检查报告缺 PDF。"""
    client, paths = iso
    _write_book(paths["data"], "b1",
                book_meta={"pdfSource": {"bookId": "b1"}},
                images=[{"id": "b1_p001"}], with_pdf=False)
    r = client.get("/api/data-center/health").get_json()
    assert r["ok"] is True
    problems = r["health"]["problems"]
    assert any(p["item"] == "pdf_missing" for p in problems)


def test_health_reports_confirmed_no_crop(iso):
    """健康检查报告已确认插图缺裁框。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "b1_p001", "status": "ok"},  # 无 crop
    ])
    r = client.get("/api/data-center/health").get_json()
    problems = r["health"]["problems"]
    assert any(p["item"] == "confirmed_no_crop" for p in problems)


def test_health_reports_duplicate_id(iso):
    """健康检查报告重复插图 ID。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "dup", "status": "ok"},
        {"id": "dup", "status": "ok"},
    ])
    r = client.get("/api/data-center/health").get_json()
    problems = r["health"]["problems"]
    assert any(p["item"] == "duplicate_illus_id" for p in problems)


# ── 8. 健康检查零写入 ────────────────────────────────────────────────────────

def test_health_check_zero_writes(iso):
    """健康检查不修改任何标注文件。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001", "status": "ok"}])
    # 记录所有白名单文件的 mtime + 内容 hash
    targets = [
        paths["books"] / "b1" / "book.json",
        paths["books"] / "b1" / "images.json",
        paths["books"] / "b1" / "meta.json",
    ]
    before = {p: (p.stat().st_mtime, hashlib.sha256(p.read_bytes()).hexdigest()) for p in targets}
    client.get("/api/data-center/health")
    after = {p: (p.stat().st_mtime, hashlib.sha256(p.read_bytes()).hexdigest()) for p in targets}
    for p in targets:
        assert before[p] == after[p], f"健康检查修改了 {p}"


# ── 9. 冻结包与展示导出边界 ──────────────────────────────────────────────────

def test_paper_freeze_export_only_confirmed(iso):
    """论文冻结包只含已确认记录。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "b1_p001", "status": "ok", "annotation": {"type": "PLANT"}, "versionContext": {}},
        {"id": "b1_p002", "status": "pending", "annotation": {"type": "ANIMAL"}},
    ])
    r = client.post("/api/data-center/exports/paper-freeze").get_json()
    assert r["ok"] is True
    assert r["export"]["record_count"] == 1
    # 冻结包含 notice
    assert "仅供论文复算" in r["export"]["manifest"]["notice"]


def test_showcase_export_excludes_raw_and_secrets(iso):
    """展示导出不含模型原始响应、超长 _rawText、密钥。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "b1_p001", "status": "ok", "annotation": {"type": "PLANT"},
         "_rawText": "x" * 10000, "modelRawResponse": {"secret": "key"}},
    ])
    r = client.post("/api/data-center/exports/showcase").get_json()
    assert r["ok"] is True
    assert r["export"]["record_count"] == 1
    # 读取导出文件验证剥离
    export_files = list(paths["data_backup"].glob("showcase_*.json"))
    assert export_files
    data = json.loads(export_files[0].read_text(encoding="utf-8"))
    rec = data["records"][0]
    assert "_rawText" not in rec
    assert "modelRawResponse" not in rec


# ── 10. 标注字段不被数据中心非预期修改 ──────────────────────────────────────

def test_annotation_fields_not_modified_by_data_center(iso):
    """数据中心操作不修改 annotation/aiDraft/reviewDiff/status/reviewEvents。"""
    client, paths = iso
    img = {
        "id": "b1_p001", "status": "ok",
        "annotation": {"type": "PLANT", "subject": "甘草"},
        "aiDraft": {"type": "PLANT"},
        "reviewDiff": [{"field": "type", "before": "ANIMAL", "after": "PLANT"}],
        "reviewEvents": [{"type": "confirm", "ts": "2026-07-22"}],
    }
    _write_book(paths["data"], "b1", images=[img])
    # 备份 + 健康检查 + 导出
    client.post("/api/data-center/backups", json={"reason": "manual"})
    client.get("/api/data-center/health")
    client.post("/api/data-center/exports/paper-freeze")
    client.post("/api/data-center/exports/showcase")
    # 验证原文件未被修改
    after = json.loads((paths["books"] / "b1" / "images.json").read_text(encoding="utf-8"))
    assert after[0]["annotation"] == img["annotation"]
    assert after[0]["aiDraft"] == img["aiDraft"]
    assert after[0]["reviewDiff"] == img["reviewDiff"]
    assert after[0]["status"] == img["status"]
    assert after[0]["reviewEvents"] == img["reviewEvents"]


def test_legacy_backup_endpoint_now_writes_unified_manifest_zip(iso):
    """旧 /api/backup-now 兼容端点不再创建 JSON 快照，统一写 v1 ZIP。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    bridge._last_auto_backup_ts = 0.0
    r = client.post("/api/backup-now")
    assert r.status_code == 200
    body = r.get_json()
    assert body["format"] == "data-center-backup-v1"
    assert body["file"].endswith(".zip")
    assert (paths["data_backup"] / body["file"]).exists()
    manifests = list(paths["data_backup"].glob("backup_*.manifest.json"))
    assert len(manifests) == 1
    manifest = json.loads(manifests[0].read_text(encoding="utf-8"))
    assert manifest["schema"] == "data-center-backup-v1"
    assert manifest["reason"] == "automatic"


def test_health_report_includes_aggregated_problem_summary(iso):
    """维护报告按问题类型聚合，日常 UI 无需逐条展开数百张卡片。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "b1_p001", "status": "ok"},
        {"id": "b1_p002", "status": "ok"},
    ])
    body = client.get("/api/data-center/health").get_json()
    summary = body["health"]["problem_summary"]
    crop = next(item for item in summary if item["item"] == "confirmed_no_crop")
    assert crop["severity"] == "warning"
    assert crop["count"] == 2
    assert crop["book_count"] == 1


# ── 11. 闭合项 1+2：restore 删除绕过 + manifest.schema + ZIP 集合一致性 ──────

def test_restore_rejects_cross_dataset_hard(iso, monkeypatch):
    """跨数据集备份恢复被硬拒绝 409；skip_dataset_check 绕过已删除。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    # 在 dataset-A 下创建备份
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "dataset-A")
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    # 切换到 dataset-B 后恢复，且尝试用 skip_dataset_check 绕过
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "dataset-B")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复", "skip_dataset_check": True}).get_json()
    assert r2["ok"] is False
    assert r2["code"] == "DATASET_MISMATCH"
    # 确认恢复端点返回 409
    r2b = client.post(f"/api/data-center/backups/{bid}/restore",
                      json={"confirm_text": "恢复", "skip_dataset_check": True})
    assert r2b.status_code == 409


def test_restore_rejects_manifest_schema_mismatch(iso):
    """manifest.schema != data-center-backup-v1 被拒绝 400。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    mf_path = paths["data_backup"] / f"{bid}.manifest.json"
    mf = json.loads(mf_path.read_text(encoding="utf-8"))
    mf["schema"] = "old-unknown-schema"
    mf_path.write_text(json.dumps(mf, ensure_ascii=False), encoding="utf-8")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False
    assert r2["code"] == "MANIFEST_SCHEMA_MISMATCH"


def test_restore_rejects_zip_missing_file(iso):
    """ZIP 缺失 manifest 中声明的文件 → 拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    mf = json.loads((paths["data_backup"] / f"{bid}.manifest.json").read_text(encoding="utf-8"))
    # 选一个真实存在的白名单文件移除
    drop_rel = next((f["rel"] for f in mf["files"] if f["rel"].endswith("meta.json")), mf["files"][0]["rel"])
    _rewrite_zip_without(paths["data_backup"] / f"{bid}.zip", drop_rel)
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False
    assert r2["code"] == "ZIP_SET_MISMATCH"


def test_restore_rejects_zip_extra_file(iso):
    """ZIP 含 manifest 外的额外文件 → 拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    _rewrite_zip_with_extra(paths["data_backup"] / f"{bid}.zip", "books/b1/extra.json",
                            b"extra")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False
    assert r2["code"] == "ZIP_EXTRA_FILE"


def test_restore_rejects_manifest_duplicate_entry(iso):
    """manifest.files 含重复条目 → 拒绝。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r1 = client.post("/api/data-center/backups", json={"reason": "manual"}).get_json()
    bid = r1["backup"]["backup_id"]
    mf_path = paths["data_backup"] / f"{bid}.manifest.json"
    mf = json.loads(mf_path.read_text(encoding="utf-8"))
    # 复制第一个条目造成重复
    mf["files"].append(dict(mf["files"][0]))
    mf_path.write_text(json.dumps(mf, ensure_ascii=False), encoding="utf-8")
    r2 = client.post(f"/api/data-center/backups/{bid}/restore",
                     json={"confirm_text": "恢复"}).get_json()
    assert r2["ok"] is False
    assert r2["code"] == "MANIFEST_DUPLICATE_ENTRY"


# ── 12. 闭合项 3：自动备份接入批量端点（每类触发独立测试） ──────────────────

def test_auto_backup_before_bulk_ocr(iso):
    """before_bulk_ocr 触发自动备份，backup_id 与 manifest.reason 含触发来源。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r = client.post("/api/data-center/auto-backup",
                    json={"reason_key": "before_bulk_ocr"}).get_json()
    assert r["ok"] is True
    assert r["skipped"] is False
    bid = r["backup"]["backup_id"]
    assert "before_bulk_ocr" in bid
    mf = json.loads((paths["data_backup"] / f"{bid}.manifest.json").read_text(encoding="utf-8"))
    assert mf["reason"] == "before_bulk_ocr"


def test_auto_backup_before_bulk_annotate(iso):
    """before_bulk_annotate 触发自动备份。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r = client.post("/api/data-center/auto-backup",
                    json={"reason_key": "before_bulk_annotate"}).get_json()
    assert r["ok"] is True
    assert r["skipped"] is False
    bid = r["backup"]["backup_id"]
    assert "before_bulk_annotate" in bid
    mf = json.loads((paths["data_backup"] / f"{bid}.manifest.json").read_text(encoding="utf-8"))
    assert mf["reason"] == "before_bulk_annotate"


def test_auto_backup_before_bulk_confirm(iso):
    """before_bulk_confirm 触发自动备份。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r = client.post("/api/data-center/auto-backup",
                    json={"reason_key": "before_bulk_confirm"}).get_json()
    assert r["ok"] is True
    assert r["skipped"] is False
    bid = r["backup"]["backup_id"]
    assert "before_bulk_confirm" in bid
    mf = json.loads((paths["data_backup"] / f"{bid}.manifest.json").read_text(encoding="utf-8"))
    assert mf["reason"] == "before_bulk_confirm"


def test_merge_books_triggers_before_bulk_merge_split_backup(iso):
    """/api/merge-books 触发 before_bulk_merge_split 自动备份。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}], with_pdf=True)
    _write_book(paths["data"], "b2", images=[{"id": "b2_p001"}], with_pdf=True)
    before = set(p.name for p in paths["data_backup"].glob("backup_*.manifest.json"))
    r = client.post("/api/merge-books", json={"bookIds": ["b1", "b2"], "title": "合并测试"})
    assert r.status_code == 200
    after = set(p.name for p in paths["data_backup"].glob("backup_*.manifest.json"))
    new = after - before
    assert len(new) == 1, f"合并应触发一次自动备份，实际新增：{new}"
    bid = list(new)[0][:-len(".manifest.json")]
    mf = json.loads((paths["data_backup"] / list(new)[0]).read_text(encoding="utf-8"))
    assert mf["reason"] == "before_bulk_merge_split"
    assert "before_bulk_merge_split" in bid


def test_auto_backup_invalid_reason_rejected(iso):
    """非法 reason_key 被拒绝 400。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r = client.post("/api/data-center/auto-backup",
                    json={"reason_key": "before_bulk_evil"}).get_json()
    assert r["ok"] is False
    assert r["code"] == "INVALID_REASON_KEY"


def test_auto_backup_readonly_skipped(iso, monkeypatch):
    """只读库自动备份被跳过（skipped=true），不阻塞主操作。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    r = client.post("/api/data-center/auto-backup",
                    json={"reason_key": "before_bulk_ocr"}).get_json()
    assert r["ok"] is True
    assert r["skipped"] is True
    assert r["backup"] is None


# ── 13. 闭合项 4：stale 读 asset-links.json + merge_residual 实际检测 ───────

def test_summary_stale_reads_asset_links(iso):
    """总览 stale 计数读 asset-links.json 的 package status，而非源索引。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    _write_asset_links(paths["data"], {
        "src_a": {"packages": [
            {"package_id": "pkg1", "status": "stale"},
            {"package_id": "pkg2", "status": "approved"},
        ]},
        "src_b": {"packages": [
            {"package_id": "pkg3", "status": "stale"},
        ]},
    })
    r = client.get("/api/data-center/summary").get_json()
    assert r["summary"]["counts"]["asset_stale"] == 2


def test_summary_stale_zero_when_no_asset_links(iso):
    """无 asset-links.json 时 stale 计数为 0（容错）。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    r = client.get("/api/data-center/summary").get_json()
    assert r["summary"]["counts"]["asset_stale"] == 0


def test_health_reports_stale_from_asset_links(iso):
    """健康检查报告 asset_stale，来源是 asset-links.json 的 stale 包。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[{"id": "b1_p001"}])
    _write_asset_links(paths["data"], {
        "src_a": {"packages": [
            {"package_id": "pkg_stale", "status": "stale"},
        ]},
    })
    r = client.get("/api/data-center/health").get_json()
    problems = r["health"]["problems"]
    stale_problems = [p for p in problems if p["item"] == "asset_stale"]
    assert len(stale_problems) == 1
    assert "src_a" in stale_problems[0]["cause"]
    assert "pkg_stale" in stale_problems[0]["cause"]


def test_health_reports_merge_residual_child_without_mergedinto(iso):
    """主记录声明 imageMerge.items，但子图未标 mergedInto（仍可独立标注）→ 报告残留。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "main_001", "status": "ok", "imageMerge": {"items": ["child_001", "child_002"]}},
        {"id": "child_001", "mergedInto": "main_001"},  # 已正确标记
        {"id": "child_002"},  # 未标 mergedInto → 残留
    ])
    r = client.get("/api/data-center/health").get_json()
    problems = r["health"]["problems"]
    residuals = [p for p in problems if p["item"] == "merge_residual"]
    assert any("child_002" in (p.get("illustration_id") or "") for p in residuals), \
        f"应报告 child_002 为合并残留：{residuals}"


def test_health_reports_merge_residual_orphan_child(iso):
    """子图标 mergedInto 但主记录不存在 → 报告孤儿残留。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "orphan_child", "mergedInto": "ghost_owner"},
    ])
    r = client.get("/api/data-center/health").get_json()
    problems = r["health"]["problems"]
    residuals = [p for p in problems if p["item"] == "merge_residual"]
    assert any(p.get("illustration_id") == "orphan_child" for p in residuals), \
        f"应报告 orphan_child 为孤儿残留：{residuals}"


def test_health_no_merge_residual_when_consistent(iso):
    """合并字段一致时不报告 merge_residual。"""
    client, paths = iso
    _write_book(paths["data"], "b1", images=[
        {"id": "main_001", "status": "ok", "imageMerge": {"items": ["child_001"]}},
        {"id": "child_001", "mergedInto": "main_001"},
    ])
    r = client.get("/api/data-center/health").get_json()
    problems = r["health"]["problems"]
    residuals = [p for p in problems if p["item"] == "merge_residual"]
    assert residuals == [], f"一致合并不应报告残留：{residuals}"
