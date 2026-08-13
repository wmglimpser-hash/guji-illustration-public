#!/usr/bin/env python3
"""
migrate_to_book_dirs.py — 将平铺数据迁移到 data/books/<book_id>/ 目录

用法：
    cd guji-illustration/demo
    python migrate_to_book_dirs.py --dry-run        # 只打印计划，不实际操作
    python migrate_to_book_dirs.py                  # 执行迁移（会先强制备份）
    python migrate_to_book_dirs.py --rollback data_backup_20260523_150000/  # 回滚

依赖：Python 3.9+，无第三方库。
"""

import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# ─── 路径常量 ────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / "data"
IMAGES_DIR = DATA_DIR / "images"
PDFS_DIR   = DATA_DIR / "pdfs"
MODEL_RUNS = DATA_DIR / "model_runs"
SESSION    = DATA_DIR / "session.json"
BOOKS_DIR  = DATA_DIR / "books"

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")


# ─── 工具函数 ─────────────────────────────────────────────────────────────────

def safe_seg(v: str) -> str:
    """把任意字符串转成可用作目录名的安全段（同 bridge.py safe_segment）。"""
    cleaned = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in str(v))
    return cleaned[:120] or "unknown"


def atomic_write(path: Path, obj: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def url_to_filename(url: str) -> str:
    """从完整 URL 里提取文件名部分。"""
    return Path(urlparse(url).path).name


def log(msg: str, dry: bool = False) -> None:
    prefix = "[DRY-RUN] " if dry else ""
    print(f"{prefix}{msg}")


# ─── 备份 ─────────────────────────────────────────────────────────────────────

def backup_data(dry: bool = False) -> Path:
    """把 data/ 完整复制到 data_backup_<timestamp>/，返回备份目录路径。"""
    backup_dir = BASE_DIR / f"data_backup_{TIMESTAMP}"
    if dry:
        log(f"[备份] 跳过（dry-run），实际运行会备份到: {backup_dir}", dry=True)
        return backup_dir
    log(f"[备份] 正在复制 data/ → {backup_dir.name} ...")
    shutil.copytree(str(DATA_DIR), str(backup_dir))
    log(f"[备份] 完成：{backup_dir}")
    return backup_dir


# ─── 迁移主逻辑 ───────────────────────────────────────────────────────────────

def migrate(dry: bool = False) -> dict:
    """
    执行迁移。返回迁移报告 dict。
    干运行时不写入任何文件，只统计并打印计划。
    """
    assert SESSION.exists(), (
        f"找不到 {SESSION}，请先通过前端创建数据，或确认路径正确。"
    )

    state = json.loads(SESSION.read_text(encoding="utf-8"))
    books  = state.get("books", [])
    images = state.get("images", [])
    pages  = state.get("pages", [])

    if not books:
        log("session.json 中没有书籍记录，无需迁移。")
        return {"books_processed": 0, "books": []}

    if not dry:
        BOOKS_DIR.mkdir(parents=True, exist_ok=True)

    report_books: list[dict] = []
    library_entries: list[dict] = []
    now_iso = datetime.now().isoformat()

    for book in books:
        raw_id = str(book.get("id") or "")
        bid    = safe_seg(raw_id)
        title  = book.get("title", "")
        bdir   = BOOKS_DIR / bid
        img_dir = bdir / "images"

        log(f"\n{'='*60}")
        log(f"📚 [{bid}]  {title}")

        errors: list[str] = []

        # ── 创建目录 ──────────────────────────────────────────────────────────
        if not dry:
            bdir.mkdir(parents=True, exist_ok=True)
            img_dir.mkdir(exist_ok=True)
        else:
            log(f"  → 创建目录: {bdir.relative_to(BASE_DIR)}", dry=True)
            log(f"  → 创建目录: {img_dir.relative_to(BASE_DIR)}", dry=True)

        # ── meta.json ─────────────────────────────────────────────────────────
        meta = {
            "book_id":    raw_id,
            "title":      title,
            "dynasty":    book.get("dynasty", ""),
            "version":    book.get("version", ""),
            "page_count": book.get("page_count", 0),
            "illustration_page_count": 0,
            "created_at": book.get("created_at", now_iso),
            "updated_at": now_iso,
            "pdf_path":   "book.pdf",
        }
        if not dry:
            atomic_write(bdir / "meta.json", meta)
            log(f"  ✓ meta.json 写入")
        else:
            log(f"  → 写入 meta.json: {json.dumps(meta, ensure_ascii=False)[:80]}...", dry=True)

        # ── per-book session.json ─────────────────────────────────────────────
        book_imgs  = [i for i in images if i.get("bookId") == raw_id]
        book_pages = [p for p in pages  if p.get("bookId") == raw_id]
        meta["illustration_page_count"] = len(book_imgs)

        book_session = {
            "_version":    2,
            "_book_id":    raw_id,
            "_updated_at": now_iso,
            "books":       [book],
            "pages":       book_pages,
            "images":      book_imgs,
        }
        if not dry:
            atomic_write(bdir / "session.json", book_session)
            log(f"  ✓ session.json: {len(book_imgs)} 插图, {len(book_pages)} 页面")
        else:
            log(f"  → 写入 session.json: {len(book_imgs)} 插图, {len(book_pages)} 页面", dry=True)

        # ── 迁移图像文件 ──────────────────────────────────────────────────────
        moved_imgs = 0
        missing_imgs: list[str] = []
        for img in book_imgs:
            url = img.get("url", "")
            fname = url_to_filename(url)
            if not fname:
                continue
            src = IMAGES_DIR / fname
            dst = img_dir / fname
            if src.exists():
                if not dry:
                    shutil.copy2(str(src), str(dst))
                else:
                    log(f"    → 复制 images/{fname} → books/{bid}/images/{fname}", dry=True)
                moved_imgs += 1
            else:
                missing_imgs.append(fname)
        if missing_imgs:
            log(f"  ⚠ 缺失图像 {len(missing_imgs)} 个: {missing_imgs[:5]}")
            errors.append(f"missing_images:{','.join(missing_imgs[:5])}")
        log(f"  {'→' if dry else '✓'} 图像文件: {moved_imgs} 个迁移{'（计划）' if dry else ''}")

        # ── 迁移 PDF ──────────────────────────────────────────────────────────
        pdf_migrated = False
        pdf_url = book.get("pdfUrl", "")
        pdf_src_candidates: list[Path] = []
        if pdf_url:
            pdf_fname = url_to_filename(pdf_url)
            if pdf_fname:
                pdf_src_candidates.append(PDFS_DIR / pdf_fname)
        # 也尝试按 book_id 或 title 在 pdfs/ 下匹配
        if PDFS_DIR.exists():
            for f in PDFS_DIR.glob("*.pdf"):
                if bid in f.stem or (title and title[:6] in f.stem):
                    pdf_src_candidates.append(f)

        pdf_dst = bdir / "book.pdf"
        for pdf_src in pdf_src_candidates:
            if pdf_src.exists() and not pdf_dst.exists():
                if not dry:
                    shutil.copy2(str(pdf_src), str(pdf_dst))
                else:
                    log(f"    → 复制 {pdf_src.name} → books/{bid}/book.pdf", dry=True)
                pdf_migrated = True
                break
        if not pdf_migrated:
            log(f"  ℹ PDF 未找到或已存在，跳过（pdfUrl={pdf_url!r}）")

        # ── 迁移 model_runs ───────────────────────────────────────────────────
        moved_runs = 0
        if MODEL_RUNS.exists():
            # 旧路径: data/model_runs/<provider>/<model>/<book_id>.jsonl
            for jsonl in MODEL_RUNS.glob(f"*/*/{bid}.jsonl"):
                provider = jsonl.parent.parent.name
                model    = jsonl.parent.name
                dst_dir  = bdir / "model_runs" / safe_seg(provider) / safe_seg(model)
                dst_file = dst_dir / "runs.jsonl"
                if not dry:
                    dst_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(jsonl), str(dst_file))
                else:
                    log(
                        f"    → 复制 model_runs/{provider}/{model}/{bid}.jsonl"
                        f" → books/{bid}/model_runs/{provider}/{model}/runs.jsonl",
                        dry=True,
                    )
                moved_runs += 1
            # 也尝试匹配原始 raw_id
            if raw_id != bid:
                for jsonl in MODEL_RUNS.glob(f"*/*/{safe_seg(raw_id)}.jsonl"):
                    provider = jsonl.parent.parent.name
                    model    = jsonl.parent.name
                    dst_dir  = bdir / "model_runs" / safe_seg(provider) / safe_seg(model)
                    dst_file = dst_dir / "runs.jsonl"
                    if not dry:
                        dst_dir.mkdir(parents=True, exist_ok=True)
                        if not dst_file.exists():
                            shutil.copy2(str(jsonl), str(dst_file))
                            moved_runs += 1
                    else:
                        log(f"    → 复制 model_runs (raw_id 匹配)", dry=True)
                        moved_runs += 1

        log(f"  {'→' if dry else '✓'} model_runs: {moved_runs} 个{'（计划）' if dry else ''}")

        # ── 更新 meta（插图数回写）────────────────────────────────────────────
        meta["illustration_page_count"] = len(book_imgs)
        if not dry:
            atomic_write(bdir / "meta.json", meta)

        report_books.append({
            "book_id":               raw_id,
            "title":                 title,
            "pages_migrated":        len(book_pages),
            "images_migrated":       moved_imgs,
            "model_runs_migrated":   moved_runs,
            "pdf_migrated":          pdf_migrated,
            "status":                "ok" if not errors else "partial",
            "errors":                errors,
        })

        library_entries.append({
            "book_id":    raw_id,
            "title":      title,
            "dynasty":    book.get("dynasty", ""),
            "version":    book.get("version", ""),
            "page_count": len(book_pages),
            "illustration_page_count": len(book_imgs),
            "annotation_count": sum(1 for i in book_imgs if i.get("annotation")),
            "verified_count":   sum(1 for i in book_imgs if (i.get("annotation") or {}).get("verified")),
            "created_at":  book.get("created_at", now_iso),
            "updated_at":  now_iso,
            "path":        f"books/{bid}/",
        })

    # ── 写 library.json ───────────────────────────────────────────────────────
    library = {
        "_version":    1,
        "_updated_at": now_iso,
        "books":       library_entries,
    }
    lib_path = DATA_DIR / "library.json"
    if not dry:
        atomic_write(lib_path, library)
        log(f"\n✓ library.json 写入（{len(library_entries)} 本书）")
    else:
        log(f"\n→ 写入 library.json（{len(library_entries)} 本书）", dry=True)

    # ── 归档全局 session.json ─────────────────────────────────────────────────
    archive_path = SESSION.with_name(f"session.json.migrated_{TIMESTAMP}")
    if not dry:
        shutil.copy2(str(SESSION), str(archive_path))
        log(f"✓ 全局 session.json 已归档为 {archive_path.name}（原文件保留，不删除）")
    else:
        log(f"→ 归档全局 session.json → {archive_path.name}", dry=True)

    # ── 生成报告 ──────────────────────────────────────────────────────────────
    failed = sum(1 for b in report_books if b["status"] != "ok")
    report = {
        "run_at":               now_iso,
        "dry_run":              dry,
        "books_processed":      len(report_books),
        "books_failed":         failed,
        "books":                report_books,
        "global_session_archived": not dry,
        "library_written":      not dry,
    }
    report_path = DATA_DIR / f"migration_report_{TIMESTAMP}.json"
    if not dry:
        atomic_write(report_path, report)
        log(f"✓ 迁移报告: {report_path.name}")
    else:
        log(f"→ 迁移报告将写到: {report_path.name}", dry=True)

    return report


# ─── 回滚 ─────────────────────────────────────────────────────────────────────

def rollback(backup_dir_str: str, yes: bool = False) -> None:
    backup_dir = Path(backup_dir_str)
    if not backup_dir.exists():
        print(f"错误：备份目录不存在: {backup_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"回滚计划：")
    print(f"  1. 删除 data/books/  （迁移产物）")
    print(f"  2. 删除 data/library.json")
    print(f"  3. 从 {backup_dir.name} 还原 session.json / images/ / pdfs/ / model_runs/")

    if not yes:
        ans = input("确认回滚？输入 yes 继续，其他任意键退出：").strip().lower()
        if ans != "yes":
            print("已取消。")
            return

    # 删除迁移产物
    if BOOKS_DIR.exists():
        shutil.rmtree(str(BOOKS_DIR))
        print("✓ 删除 data/books/")
    lib = DATA_DIR / "library.json"
    if lib.exists():
        lib.unlink()
        print("✓ 删除 data/library.json")

    # 还原备份文件
    restore_targets = ["session.json", "images", "pdfs", "model_runs"]
    for target in restore_targets:
        src = backup_dir / target
        dst = DATA_DIR / target
        if src.exists():
            if dst.exists():
                if dst.is_dir():
                    shutil.rmtree(str(dst))
                else:
                    dst.unlink()
            if src.is_dir():
                shutil.copytree(str(src), str(dst))
            else:
                shutil.copy2(str(src), str(dst))
            print(f"✓ 还原 {target}")
        else:
            print(f"  ℹ 备份中无 {target}，跳过")

    print("\n✅ 回滚完成。系统已恢复到迁移前状态。")


# ─── 入口 ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="将 demo/data/ 平铺数据迁移到 data/books/<book_id>/ 结构。"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="只打印迁移计划，不实际写入或移动任何文件。"
    )
    parser.add_argument(
        "--rollback", metavar="BACKUP_DIR",
        help="回滚到指定备份目录（如 data_backup_20260523_150000/）。"
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="回滚时跳过确认提示。"
    )
    args = parser.parse_args()

    if args.rollback:
        rollback(args.rollback, yes=args.yes)
        return

    dry = args.dry_run

    print("=" * 60)
    print(f"{'[DRY-RUN] ' if dry else ''}TCM 插图标注工具 — 按书目录迁移脚本")
    print(f"时间戳：{TIMESTAMP}")
    print(f"数据目录：{DATA_DIR}")
    print("=" * 60)

    if not dry:
        backup_dir = backup_data(dry=False)
        print(f"\n备份完成：{backup_dir}\n")

    report = migrate(dry=dry)

    print("\n" + "=" * 60)
    print(f"{'[DRY-RUN] ' if dry else ''}迁移{'计划' if dry else ''}完成")
    print(f"  处理书籍：{report['books_processed']} 本")
    print(f"  失败：    {report['books_failed']} 本")
    for b in report.get("books", []):
        status_icon = "✓" if b["status"] == "ok" else "⚠"
        print(
            f"  {status_icon} [{b['book_id']}] {b['title']} — "
            f"页:{b['pages_migrated']} 插图:{b['images_migrated']} "
            f"模型归档:{b['model_runs_migrated']} PDF:{'是' if b['pdf_migrated'] else '否'}"
        )
    if not dry:
        print(f"\n如需回滚，运行：")
        backup_name = f"data_backup_{TIMESTAMP}"
        print(f"  python migrate_to_book_dirs.py --rollback {backup_name}/")
    print("=" * 60)


if __name__ == "__main__":
    main()
