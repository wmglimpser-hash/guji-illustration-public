# -*- coding: utf-8 -*-
"""一次性修复脚本：从自动备份回填被 /api/page-image URL 覆盖的页面缩略图 base64。

背景：_lighten_book_page_urls_for_client 在 GET /api/session 时把缩略图换成轻量
URL，但 book.json 保存路径缺少恢复护栏（已于本次修复补上），导致前端 persist 把
URL 写回磁盘，覆盖了原 base64 缩略图。

策略（保守，只恢复不破坏）：
- thumb / thumbHi（整页图，与裁剪框无关）：备份有 base64 即恢复
- contentThumb(Hi)：仅当当前 contentRect 与备份一致时恢复（不一致说明用户后来
  调过框，备份图已过时，保留 URL——桥接服务可按需渲染，前端再保存时会生成新图）
- cropThumb(Hi)：同理，要求 cropRect、cropQuad、cropRotationDeg 都一致
- 当前值已是 base64 的字段一律不动

运行前自动把受影响书的 book.json 复制到 data/backups/pre_write/。

用法（在 demo/ 目录下）：
    python repair_book_thumbs.py                # 试运行（只报告，不写盘）
    python repair_book_thumbs.py --apply        # 实际写入
    python repair_book_thumbs.py --apply --backup-state <state.json>  # 指定备份
"""
import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
BOOKS_DIR = DATA_DIR / "books"
PRE_WRITE_BACKUP_DIR = DATA_DIR / "backups" / "pre_write"
DEFAULT_BACKUP_STATE = DATA_DIR / "backups" / "auto" / "state_20260609_220836.json"

THUMB_FIELDS_FREE = ("thumb", "thumbHi")                       # 与框无关
THUMB_FIELDS_CONTENT = ("contentThumb", "contentThumbHi")      # 依赖 contentRect
THUMB_FIELDS_CROP = ("cropThumb", "cropThumbHi")               # 依赖 cropRect/Quad/Rot


def iter_pages(book):
    for key in ("pages", "illustrationPages"):
        lst = book.get(key)
        if isinstance(lst, list):
            for pg in lst:
                if isinstance(pg, dict):
                    yield pg


def index_pages(book):
    out = {}
    for pg in iter_pages(book):
        if pg.get("pageNum") is not None:
            out.setdefault(pg.get("pageNum"), pg)
    return out


def is_url(v):
    return isinstance(v, str) and v.startswith("/api/page-image")


def is_b64(v):
    return isinstance(v, str) and v.startswith("data:")


def same(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == \
           json.dumps(b, sort_keys=True, ensure_ascii=False)


def restore_book(cur_book, bak_book):
    """返回 (restored, skipped_stale, left_url)。原地修改 cur_book。"""
    bak_by_num = index_pages(bak_book)
    restored = skipped = left = 0
    for pg in iter_pages(cur_book):
        bak_pg = bak_by_num.get(pg.get("pageNum"))
        for fld in THUMB_FIELDS_FREE + THUMB_FIELDS_CONTENT + THUMB_FIELDS_CROP:
            v = pg.get(fld)
            if not is_url(v):
                continue
            real = bak_pg.get(fld) if isinstance(bak_pg, dict) else None
            if not is_b64(real):
                left += 1
                continue
            if fld in THUMB_FIELDS_CONTENT and not same(pg.get("contentRect"), bak_pg.get("contentRect")):
                skipped += 1
                continue
            if fld in THUMB_FIELDS_CROP and not (
                same(pg.get("cropRect"), bak_pg.get("cropRect"))
                and same(pg.get("cropQuad"), bak_pg.get("cropQuad"))
                and same(pg.get("cropRotationDeg") or pg.get("rotationDeg") or 0,
                         bak_pg.get("cropRotationDeg") or bak_pg.get("rotationDeg") or 0)
            ):
                skipped += 1
                continue
            pg[fld] = real
            restored += 1
    return restored, skipped, left


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="实际写盘（默认试运行）")
    ap.add_argument("--backup-state", default=str(DEFAULT_BACKUP_STATE))
    args = ap.parse_args()

    bak_path = Path(args.backup_state)
    if not bak_path.exists():
        print(f"备份文件不存在: {bak_path}")
        sys.exit(1)

    print(f"读取备份 {bak_path.name} …（文件较大，请稍候）")
    with open(bak_path, encoding="utf-8") as f:
        bak_state = json.load(f)
    bak_books = {b.get("id"): b for b in bak_state.get("books", []) if isinstance(b, dict)}

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    total_restored = 0
    for book_json in sorted(BOOKS_DIR.glob("book_*/book.json")):
        with open(book_json, encoding="utf-8") as f:
            cur = json.load(f)
        # 仅处理被污染的书
        polluted = sum(1 for pg in iter_pages(cur)
                       for fld in THUMB_FIELDS_FREE + THUMB_FIELDS_CONTENT + THUMB_FIELDS_CROP
                       if is_url(pg.get(fld)))
        if not polluted:
            continue
        bid = book_json.parent.name
        bak_book = bak_books.get(bid)
        if not bak_book:
            print(f"{bid}: 污染 {polluted} 个字段，但备份中无此书，跳过")
            continue
        restored, skipped, left = restore_book(cur, bak_book)
        print(f"{bid}: 污染 {polluted} | 恢复 {restored} | 框已变更跳过 {skipped} | 备份无图 {left}")
        if args.apply and restored:
            PRE_WRITE_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            dst = PRE_WRITE_BACKUP_DIR / f"{bid}_book_{ts}_pre_thumb_repair.json"
            shutil.copy2(str(book_json), str(dst))
            tmp = book_json.with_suffix(".json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cur, f, ensure_ascii=False, indent=None)
            tmp.replace(book_json)
            print(f"  已写入（旧文件备份至 {dst.name}）")
        total_restored += restored

    mode = "已写盘" if args.apply else "试运行（加 --apply 实际写入）"
    print(f"\n完成：共恢复 {total_restored} 个缩略图字段。[{mode}]")


if __name__ == "__main__":
    main()
