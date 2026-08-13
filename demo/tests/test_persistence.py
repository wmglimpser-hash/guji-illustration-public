"""bridge.py 持久化层回归测试。

覆盖：按书读写往返、空覆盖硬护栏、跌幅安全快照、平迁哨兵只跑一次、
_existing_image_count 边界。全部在 tmp 目录隔离运行，不触碰真实 data/。

运行：  python -m pytest tests/test_persistence.py -v
"""
import json
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


@pytest.fixture
def iso(tmp_path, monkeypatch):
    """把 bridge 的所有数据路径重定向到临时目录，返回 (client, paths)。"""
    data    = tmp_path / "data"
    books   = data / "books"
    backups_auto = data / "backups" / "auto"
    data_backups = data / "_data_backups"
    pre_write    = data / "backups" / "pre_write"
    for d in (data, books, backups_auto, data_backups, pre_write):
        d.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(bridge, "DATA_DIR", data)
    monkeypatch.setattr(bridge, "BOOKS_DIR", books)
    monkeypatch.setattr(bridge, "GLOBAL_PATH", data / "global.json")
    monkeypatch.setattr(bridge, "SESSION_PATH", data / "session.json")
    monkeypatch.setattr(bridge, "SESSION_BACKUP_PATH", data / "session.json.bak")
    monkeypatch.setattr(bridge, "AUTO_BACKUP_DIR", backups_auto)
    monkeypatch.setattr(bridge, "DATA_BACKUP_DIR", data_backups)
    monkeypatch.setattr(bridge, "PRE_WRITE_BACKUP_DIR", pre_write)
    monkeypatch.setattr(bridge, "RECONCILE_SENTINEL", data / ".session_reconciled")
    monkeypatch.setattr(bridge, "CONFIG_PATH", data / "config.json")
    monkeypatch.setattr(bridge, "_last_auto_backup_ts", 0.0)
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", False)
    # 本文件验证按书读写；避免每条写入都开启跨测试生命周期的后台 ZIP 线程。
    monkeypatch.setattr(bridge, "schedule_auto_backup",
                        lambda force=False: {"scheduled": False, "reason": "test"})

    bridge.app.config.update(TESTING=True)
    client = bridge.app.test_client()
    return client, {"data": data, "books": books, "pre_write": pre_write,
                    "global": data / "global.json"}


def _imgs(n):
    return [{"id": f"i{k}", "status": "ok"} for k in range(n)]


def test_status_exposes_data_source_identity(iso, monkeypatch):
    client, paths = iso
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "reannotation-v1")
    monkeypatch.setattr(bridge, "DATA_SOURCE_LABEL", "新版重标库")
    monkeypatch.setattr(bridge, "DATA_SOURCE_MODE", "isolated")
    for book_id in ("book_a", "book_b"):
        book_dir = paths["books"] / book_id
        book_dir.mkdir()
        (book_dir / "book.json").write_text("{}", encoding="utf-8")
    status = client.get("/api/status").get_json()
    assert status["data_source"] == {
        "id": "reannotation-v1",
        "label": "新版重标库",
        "mode": "isolated",
        "read_only": False,
        "path": str(paths["data"]),
        "book_count": 2,
    }


def test_scan_configuration_roundtrip(iso):
    """扫描模型、并行和上下文设置必须由 bridge 持久化，不能只留在浏览器。"""
    client, p = iso
    payload = {
        "provider": "qwen",
        "scanProvider": "qwen",
        "scanModel": "qwen3-vl-flash",
        "scanConcurrency": 10,
        "batchConcurrency": 5,
        "contextRadius": 5,
        "scanContextRadius": 3,
    }
    saved = client.post("/api/save-config", json=payload)
    assert saved.status_code == 200
    loaded = client.get("/api/config").get_json()
    for field, expected in payload.items():
        assert loaded[field] == expected
    disk = json.loads((p["data"] / "config.json").read_text(encoding="utf-8"))
    assert disk["scanConcurrency"] == 10
    assert disk["contextRadius"] == 5


def test_read_only_source_blocks_dataset_write_but_allows_backup(iso, monkeypatch):
    client, _ = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "book.json", {"id": "bookA", "title": "测试书"})
    bridge.atomic_write_json(bdir / "images.json", _imgs(1))
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    blocked = client.post("/api/session/book/bookA", json={"images": _imgs(1)})
    assert blocked.status_code == 423
    assert blocked.get_json()["code"] == "DATA_SOURCE_READ_ONLY"
    # 立即备份是保护操作，在只读模式下仍允许调用。
    backup = client.post("/api/backup-now")
    assert backup.status_code == 200


# ── 往返 ──────────────────────────────────────────────────────────────────
def test_book_roundtrip(iso):
    client, p = iso
    book = {"id": "bookA", "title": "测试书"}
    imgs = [{"id": "x", "pdfSource": {"bookId": "bookA"}},
            {"id": "y", "pdfSource": {"bookId": "bookA"}}]
    r = client.post("/api/session/book/bookA", json={"book": book, "images": imgs})
    assert r.status_code == 200
    state = client.get("/api/session").get_json()["state"]
    assert any(b["id"] == "bookA" for b in state["books"])
    assert {i["id"] for i in state["images"]} == {"x", "y"}


def test_background_auto_backup_does_not_block_book_save_schedule(monkeypatch):
    """大 ZIP 备份运行时，调度函数必须立即返回且不重复起线程。"""
    started = threading.Event()
    release = threading.Event()

    def slow_backup():
        started.set()
        assert release.wait(2), "测试未释放后台备份线程"
        return "backup_test_automatic.zip"

    monkeypatch.setattr(bridge, "_write_automatic_backup", slow_backup)
    monkeypatch.setattr(bridge, "_last_auto_backup_ts", 0.0)
    monkeypatch.setattr(bridge, "_auto_backup_running", False)

    began = time.monotonic()
    first = bridge.schedule_auto_backup(force=True)
    elapsed = time.monotonic() - began
    assert first == {"scheduled": True, "reason": "started"}
    assert elapsed < 0.5
    assert started.wait(0.5)
    assert bridge.schedule_auto_backup() == {"scheduled": False, "reason": "already_running"}

    release.set()
    deadline = time.monotonic() + 1
    while bridge._auto_backup_running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert bridge._auto_backup_running is False


# ── 空覆盖硬护栏 ───────────────────────────────────────────────────────────
def test_empty_overwrite_blocked_book(iso):
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "images.json", _imgs(3))
    r = client.post("/api/session/book/bookA", json={"images": []})
    assert r.status_code == 409
    assert r.get_json()["reason"] == "empty_overwrite_blocked"
    # 旧数据不动 + 落 .rejected
    assert len(json.loads((bdir / "images.json").read_text(encoding="utf-8"))) == 3
    assert (bdir / "images.json.rejected").exists()


def test_empty_overwrite_blocked_global(iso):
    client, p = iso
    bridge.atomic_write_json(p["global"], {"project": "t", "images": _imgs(2)})
    r = client.post("/api/session/global", json={"project": "t", "images": []})
    assert r.status_code == 409
    assert len(json.loads(p["global"].read_text(encoding="utf-8"))["images"]) == 2


def test_new_book_empty_allowed(iso):
    """全新书（文件不存在）写空不应被拦截。"""
    client, p = iso
    r = client.post("/api/session/book/fresh", json={"images": []})
    assert r.status_code == 200


# ── 跌幅安全快照 ───────────────────────────────────────────────────────────
def test_delta_guard_snapshots_on_big_drop(iso):
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "images.json", _imgs(10))
    # 10 -> 3：丢失 70% > 40%，应写入成功且留下 pre_write 快照
    r = client.post("/api/session/book/bookA", json={"images": _imgs(3)})
    assert r.status_code == 200
    assert len(json.loads((bdir / "images.json").read_text(encoding="utf-8"))) == 3
    snaps = list(p["pre_write"].glob("*.json"))
    assert len(snaps) == 1
    # 快照里是被覆盖前的 10 条，可回滚
    assert len(json.loads(snaps[0].read_text(encoding="utf-8"))) == 10


def test_delta_guard_skips_small_set(iso):
    """现有记录数 < 阈值（5）时不触发快照。"""
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "images.json", _imgs(2))
    r = client.post("/api/session/book/bookA", json={"images": _imgs(1)})
    assert r.status_code == 200
    assert list(p["pre_write"].glob("*.json")) == []


def test_delta_guard_skips_mild_drop(iso):
    """跌幅未超 40% 不触发快照。"""
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "images.json", _imgs(10))
    r = client.post("/api/session/book/bookA", json={"images": _imgs(8)})  # -20%
    assert r.status_code == 200
    assert list(p["pre_write"].glob("*.json")) == []


# ── split_and_save_session 也走护栏（#2 修复）────────────────────────────────
def test_split_and_save_session_guarded(iso):
    """legacy POST /api/session → split_and_save_session 不得用空数组覆盖已有书。"""
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "book.json", {"id": "bookA", "title": "T"})
    bridge.atomic_write_json(bdir / "images.json", _imgs(3))
    # 传入的 state 里 bookA 没有任何图片（images 全空）→ 不应清空磁盘上的 3 条
    r = client.post("/api/session", json={"project": "t", "books": [{"id": "bookA"}], "images": []})
    after = json.loads((bdir / "images.json").read_text(encoding="utf-8"))
    assert len(after) == 3
    assert (bdir / "images.json.rejected").exists()
    # 拦截结果透出：200 + blocked.books 含 bookA（不硬失败）
    j = r.get_json()
    assert r.status_code == 200 and j["ok"] is True
    assert j["blocked"]["books"] == ["bookA"]


def test_split_and_save_session_no_block_field_when_clean(iso):
    """正常保存（无拦截）时响应不带 blocked 字段，保持 {"ok": true}。"""
    client, p = iso
    r = client.post("/api/session", json={
        "project": "t",
        "books": [{"id": "bookA"}],
        "images": [{"id": "x", "pdfSource": {"bookId": "bookA"}}],
    })
    j = r.get_json()
    assert j == {"ok": True}


# ── global.json 缺失/损坏不致丢书（健壮性加固）─────────────────────────────
def test_load_survives_missing_global(iso):
    """global.json 不存在但 books/ 有书时，仍能组装出 state（不返回空）。"""
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "book.json", {"id": "bookA", "title": "T"})
    bridge.atomic_write_json(bdir / "images.json",
                             [{"id": "x", "pdfSource": {"bookId": "bookA"}}])
    assert not p["global"].exists()
    state = client.get("/api/session").get_json()["state"]
    assert any(b["id"] == "bookA" for b in state["books"])
    assert any(i["id"] == "x" for i in state["images"])


def test_load_survives_corrupt_global(iso):
    """global.json 损坏时按空全局处理，books/ 数据照常返回。"""
    client, p = iso
    p["global"].write_text("{broken json", encoding="utf-8")
    bdir = bridge.get_book_dir("bookB")
    bridge.atomic_write_json(bdir / "book.json", {"id": "bookB", "title": "T2"})
    bridge.atomic_write_json(bdir / "images.json", [{"id": "y"}])
    state = client.get("/api/session").get_json()["state"]
    assert any(b["id"] == "bookB" for b in state["books"])


# ── 平迁哨兵只跑一次 ───────────────────────────────────────────────────────
def test_reconcile_runs_once(iso):
    client, p = iso
    # session.json 里某 id 为 ok；per-book 里同 id 为 review
    bridge.atomic_write_json(p["data"] / "session.json",
                             {"images": [{"id": "z", "status": "ok"}]})
    bridge.atomic_write_json(p["global"], {"project": "t", "images": []})
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "images.json", [{"id": "z", "status": "review"}])

    bridge.reconcile_session_into_per_book()
    after = json.loads((bdir / "images.json").read_text(encoding="utf-8"))
    assert after[0]["status"] == "ok"          # 平迁了一次
    assert bridge.RECONCILE_SENTINEL.exists()  # 写了哨兵

    # 第二次：即使把 per-book 改回 review，也不再被回滚（哨兵生效）
    bridge.atomic_write_json(bdir / "images.json", [{"id": "z", "status": "review"}])
    bridge.reconcile_session_into_per_book()
    again = json.loads((bdir / "images.json").read_text(encoding="utf-8"))
    assert again[0]["status"] == "review"


# ── _existing_image_count 边界 ─────────────────────────────────────────────
def test_existing_image_count_edges(iso, tmp_path):
    missing = tmp_path / "nope.json"
    assert bridge._existing_image_count(missing) == -1                     # 不存在

    lst = tmp_path / "list.json"
    bridge.atomic_write_json(lst, _imgs(4))
    assert bridge._existing_image_count(lst) == 4                          # 裸数组

    g = tmp_path / "g.json"
    bridge.atomic_write_json(g, {"images": _imgs(2)})
    assert bridge._existing_image_count(g, key="images") == 2              # 取字段

    corrupt = tmp_path / "bad.json"
    corrupt.write_text("{not json", encoding="utf-8")
    assert bridge._existing_image_count(corrupt) == -1                     # 损坏


# ── Phase 2：图片端点化的保存护栏 + 下发轻量化 ─────────────────────────────
_B64 = "data:image/jpeg;base64,/9j/AAAQSkZJRgABAQAAAQABAAD"  # 仅需以 data: 开头

def test_phase2_save_restores_base64(iso):
    """前端持有 /api/img 占位 url，保存往返后磁盘必须恢复成 base64（只恢复不删除）。"""
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "images.json",
        [{"id": "x", "url": _B64, "pdfSource": {"bookId": "bookA"}}])
    # 模拟前端：用占位 url 保存回去
    r = client.post("/api/session/book/bookA", json={"images": [
        {"id": "x", "url": "/api/img/bookA/x", "pdfSource": {"bookId": "bookA"}}]})
    assert r.status_code == 200
    disk = json.loads((bdir / "images.json").read_text(encoding="utf-8"))
    assert disk[0]["url"] == _B64          # base64 已恢复，未被占位符抹掉


def test_phase2_save_new_book_keeps_placeholder(iso):
    """新书（磁盘无文件）保存占位 url 时不报错，占位原样保留（无可恢复来源）。"""
    client, p = iso
    r = client.post("/api/session/book/fresh", json={"images": [
        {"id": "x", "url": "/api/img/fresh/x", "pdfSource": {"bookId": "fresh"}}]})
    assert r.status_code == 200
    disk = json.loads((bridge.get_book_dir("fresh") / "images.json").read_text(encoding="utf-8"))
    assert disk[0]["url"] == "/api/img/fresh/x"


def test_phase2_session_lightens_base64(iso):
    """GET /api/session 下发时，带 pdfSource.bookId 的 base64 应全部换成 /api/img 占位，响应里 0 条 base64。"""
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    bridge.atomic_write_json(bdir / "book.json", {"id": "bookA", "title": "T"})
    bridge.atomic_write_json(bdir / "images.json",
        [{"id": "x", "url": _B64, "pdfSource": {"bookId": "bookA"}}])
    imgs = client.get("/api/session").get_json()["state"]["images"]
    assert sum(1 for i in imgs if (i.get("url") or "").startswith("data:")) == 0
    assert any((i.get("url") or "").startswith("/api/img/bookA/x") for i in imgs)
    # 磁盘真源仍是 base64（轻量化只在响应层）
    disk = json.loads((bdir / "images.json").read_text(encoding="utf-8"))
    assert disk[0]["url"] == _B64


def test_phase2_serve_embedded_image_and_cache(iso):
    """/api/img 解码出图 + 404 + 按 mtime 失效缓存（文件变了不吃旧缓存）。"""
    import os
    client, p = iso
    bdir = bridge.get_book_dir("bookA")
    png = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
           "AAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    bridge.atomic_write_json(bdir / "images.json", [{"id": "x", "url": png}])
    r = client.get("/api/img/bookA/x")
    assert r.status_code == 200 and r.mimetype == "image/png"
    assert r.data[:8] == b"\x89PNG\r\n\x1a\n"           # 真实 PNG 头
    assert client.get("/api/img/bookA/none").status_code == 404   # 不存在的图
    # 改文件 + 推进 mtime → 缓存应失效，返回新内容（不吃旧缓存）
    bridge.atomic_write_json(bdir / "images.json", [{"id": "x", "url": "data:image/jpeg;base64,/9j/AAAA"}])
    st = (bdir / "images.json").stat()
    os.utime(bdir / "images.json", (st.st_atime, st.st_mtime + 10))
    assert client.get("/api/img/bookA/x").mimetype == "image/jpeg"


def test_isolated_data_dir_reads_production_pdf_without_writing_back(tmp_path, monkeypatch):
    """隔离审核目录可复用不可变原书 PDF；隔离目录中的同名 PDF 仍优先。"""
    trial_books = tmp_path / "trial" / "books"
    production_data = tmp_path / "production"
    production_book = production_data / "books" / "bookA"
    trial_book = trial_books / "bookA"
    production_book.mkdir(parents=True)
    trial_book.mkdir(parents=True)
    production_pdf = production_book / "book.pdf"
    production_pdf.write_bytes(b"production-pdf")

    monkeypatch.setattr(bridge, "BOOKS_DIR", trial_books)
    monkeypatch.setattr(bridge, "PRODUCTION_DATA_DIR", production_data)
    assert bridge._book_pdf_path("bookA") == production_pdf
    assert not (trial_book / "book.pdf").exists()

    trial_pdf = trial_book / "book.pdf"
    trial_pdf.write_bytes(b"trial-pdf")
    assert bridge._book_pdf_path("bookA") == trial_pdf
