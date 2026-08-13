"""
本地 AI 桥接服务器 bridge.py
────────────────────────────
解决浏览器无法直接调用 AI API 的 CORS 问题，同时提供持久化存储。

功能：
  - /api/annotate         代理 AI 标注请求
  - /api/session          GET/POST 保存完整工作状态（JSON）
  - /api/upload-image     POST 保存图像文件，返回可访问 URL
  - /api/upload-pdf       POST 保存 PDF，支持按书目录
  - /api/import-image-book POST 事务导入图片文件夹书籍
  - /api/save-export      POST 保存导出文件到书目录 exports/
  - /api/update-book-meta POST 增量更新 meta.json
  - /api/delete-book-assets POST 删除书资源（新旧路径均支持）
  - /api/store-model-run  POST 保存 AI 模型归档
  - /api/model-runs       GET  查询模型归档（新旧路径混合）
  - /data/images/         静态图像文件服务
  - /data/books/          按书目录静态文件服务

启动方式：
    python bridge.py

自定义工作数据根目录（可选）：
    set TCM_ILLUSTRATION_DATA_DIR=path\\to\\your\\working_data
    set TCM_ILLUSTRATION_DATASET_ID=my-working-dataset
    set TCM_ILLUSTRATION_DATA_LABEL=本地工作库
    python bridge.py

未设置 TCM_ILLUSTRATION_DATA_DIR 时读取 demo/data，并默认作为“历史生产库·只读”。
如确需维护旧数据，必须在启动进程中显式设置 TCM_ILLUSTRATION_READ_ONLY=0。

启动后访问 http://localhost:5678/
前端会自动发现并通过此服务器转发 AI 请求及持久化数据。

依赖：
    pip install flask requests pillow --break-system-packages
"""

import base64
from copy import deepcopy
import hashlib
import io
import json
import os
import re
import shutil
import sys
import threading
import time
import uuid
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from datetime import datetime

from urllib.parse import quote

from image_book_import import (
    ImageBookImportError,
    import_image_book,
    render_cached_page_crop,
)

# 拼音引擎（生僻字辅助）：词组模式缓解多音字；扩展B区罕见字/多音专名仍可能不准，
# 由前端可编辑字段 illustrationNamePinyin 人工纠正。缺包时优雅降级（拼音留空）。
try:
    from pypinyin import lazy_pinyin as _lazy_pinyin, Style as _PinyinStyle
    _PINYIN_OK = True
except Exception:
    _PINYIN_OK = False

# OpenCC 只用于校文页的按需繁简辅助显示。转换结果不写入 OCR、人工校文或标注数据；
# 缺包时服务仍可启动，并由转换接口明确返回不可用。
try:
    from opencc import OpenCC as _OpenCC
    _OPENCC_OK = True
except Exception:
    _OPENCC_OK = False

_OPENCC_CONVERTERS = {}
_OPENCC_LOCK = threading.Lock()
TEXT_CONVERT_MAX_CHARS = 200_000


def name_pinyin(text: str) -> str:
    """生成展示名（illustrationName||subject）的带声调拼音，以空格分隔。"""
    text = (text or "").strip()
    if not text or not _PINYIN_OK:
        return ""
    try:
        return " ".join(_lazy_pinyin(text, style=_PinyinStyle.TONE, errors="default"))
    except Exception:
        return ""


def convert_chinese_text(text: str, direction: str) -> str:
    """使用 OpenCC 生成繁简辅助文本，不承担古籍校勘或持久化。"""
    if direction not in {"t2s", "s2t"}:
        raise ValueError("转换方向必须是 t2s 或 s2t")
    if not _OPENCC_OK:
        raise RuntimeError("OpenCC 未安装，请先执行 pip install -r requirements.txt")
    with _OPENCC_LOCK:
        converter = _OPENCC_CONVERTERS.get(direction)
        if converter is None:
            converter = _OpenCC(direction)
            _OPENCC_CONVERTERS[direction] = converter
        return converter.convert(text)


def _fill_name_pinyin_inplace(recs):
    """写入兜底：对缺拼音且非人工锁定的记录，按解析名就地补 illustrationNamePinyin。
    仅补空值（不刷新陈旧拼音——改名后的刷新由前端在改名点触发）。
    关键：annotation 与 aiDraft 两侧都要补（同一拼音、同标 auto），否则一侧有一侧空，
    前端启动归一化 refreshReviewDiff 会把它误判为"人工改过"，制造伪审核 diff。"""
    if not isinstance(recs, list):
        return
    for r in recs:
        if not isinstance(r, dict):
            continue
        ann = r.get("annotation") if isinstance(r.get("annotation"), dict) else None
        draft = r.get("aiDraft") if isinstance(r.get("aiDraft"), dict) else None
        if not ann and not draft:
            continue
        # 解析名优先取 annotation，回退 aiDraft；两侧用同一拼音保持基线对称
        nm = ""
        for src in (ann, draft):
            if src:
                nm = (src.get("illustrationName") or src.get("subject") or "").strip()
                if nm:
                    break
        if not nm:
            continue
        py = None
        for side in (ann, draft):
            if not isinstance(side, dict):
                continue
            if side.get("pinyinSource") == "human":
                continue
            if (side.get("illustrationNamePinyin") or "").strip():
                continue
            if py is None:
                py = name_pinyin(nm)
            if py:
                side["illustrationNamePinyin"] = py
                side["pinyinSource"] = "auto"

try:
    from flask import Flask, request, jsonify, send_from_directory, send_file, Response
except ImportError:
    print("请先安装 Flask：pip install flask --break-system-packages")
    sys.exit(1)

# ── 路径配置 ──────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
# 默认仍使用生产 data/；Task 21 可通过环境变量指向物理隔离的试验副本，避免任何审核写回生产数据。
# 空环境变量必须与未设置完全等价，不能意外解析为当前工作目录。
_DATA_DIR_OVERRIDE = (os.environ.get("TCM_ILLUSTRATION_DATA_DIR") or "").strip()
PRODUCTION_DATA_DIR = (BASE_DIR / "data").resolve()
DATA_DIR = (Path(_DATA_DIR_OVERRIDE).expanduser().resolve() if _DATA_DIR_OVERRIDE else PRODUCTION_DATA_DIR)
_IS_PRODUCTION_DATA_SOURCE = DATA_DIR == PRODUCTION_DATA_DIR

# 下游游戏/影像素材的独立根目录。该目录只保存派生素材包，绝不写回标注主数据。
# 不设置时素材桥保持关闭；正式启动脚本会用仓库相对路径提供默认值。
_ASSET_ROOT_OVERRIDE = (os.environ.get("TCM_ILLUSTRATION_ASSET_ROOT") or "").strip()
ASSET_ROOT = (
    Path(_ASSET_ROOT_OVERRIDE).expanduser().resolve()
    if _ASSET_ROOT_OVERRIDE else None
)

def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# 数据源身份同时进入 /api/status 与新草稿 versionContext。生产库默认只读；如确需维护旧数据，
# 必须在启动进程中显式设置 TCM_ILLUSTRATION_READ_ONLY=0，不能依赖前端提醒。
DATA_SOURCE_MODE = "production" if _IS_PRODUCTION_DATA_SOURCE else "isolated"
DATA_SOURCE_ID = (os.environ.get("TCM_ILLUSTRATION_DATASET_ID") or (
    "legacy-production" if _IS_PRODUCTION_DATA_SOURCE
    else f"{DATA_DIR.parent.name}-{DATA_DIR.name}"
)).strip()
DATA_SOURCE_LABEL = (os.environ.get("TCM_ILLUSTRATION_DATA_LABEL") or (
    "历史生产库" if _IS_PRODUCTION_DATA_SOURCE else "新版重标库"
)).strip()
DATA_SOURCE_READ_ONLY = _env_bool(
    "TCM_ILLUSTRATION_READ_ONLY",
    default=_IS_PRODUCTION_DATA_SOURCE,
)
IMAGES_DIR  = DATA_DIR / "images"
PDFS_DIR    = DATA_DIR / "pdfs"
MODEL_RUNS_DIR = DATA_DIR / "model_runs"
# session.json / .bak 非主数据源：前端常规流程不写，仅 legacy POST /api/session 全量保存时写入；
# 读取仅作旧格式兜底（books/ 为空时）。内容可能陈旧。
# 主数据源 = books/*/images.json + global.json；恢复来源 = backups/auto + backups/pre_write。
SESSION_PATH = DATA_DIR / "session.json"
SESSION_BACKUP_PATH = DATA_DIR / "session.json.bak"
API_FAILURE_LOG_PATH = DATA_DIR / "bridge_api_failures.jsonl"

BOOKS_DIR       = DATA_DIR / "books"
GLOBAL_PATH     = DATA_DIR / "global.json"
AUTO_BACKUP_DIR = DATA_DIR / "backups" / "auto"   # 自动滚动备份目录（canonical 恢复来源）
PRE_WRITE_BACKUP_DIR = DATA_DIR / "backups" / "pre_write"  # 可疑骤降写入前的旧文件快照
DELETED_BACKUP_DIR = DATA_DIR / "backups" / "deleted"  # 删除回收站：删书前整目录搬到这里，可恢复
RECONCILE_SENTINEL = DATA_DIR / ".session_reconciled"  # 哨兵：平迁只跑一次

# 跌幅护栏：一次写入相对磁盘“骤降”时，先备份旧文件再写（不阻塞，可回滚）
DELTA_GUARD_MIN_EXISTING = 5     # 现有记录少于此数不触发，避免小集合误报
DELTA_GUARD_DROP_RATIO   = 0.4   # 丢失超过 40% 记录视为可疑
PRE_WRITE_BACKUP_KEEP    = 100   # pre_write 备份最多保留份数

# 启动时确保目录存在
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(exist_ok=True)
PDFS_DIR.mkdir(exist_ok=True)
MODEL_RUNS_DIR.mkdir(exist_ok=True)
BOOKS_DIR.mkdir(exist_ok=True)
AUTO_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
PRE_WRITE_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
DELETED_BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# ── 按书分目录的 session 拆分/组装 ──────────────────────────────────────────

def split_and_save_session(state: dict):
    """把完整 state 拆成 global.json + 每本书的 book.json/images.json 分别保存。

    返回拦截结果 {"global": bool, "books": [bookId, ...]}：某路径因空覆盖护栏被拒时
    记下（数据安全，旧文件未被覆盖、.rejected 已落盘），供 legacy POST /api/session
    透出给调用方。不抛错、不中断其余书的保存。
    """
    books  = state.get("books", [])
    images = state.get("images", [])
    blocked = {"global": False, "books": []}

    # global：不属于任何书的图像 + 项目名（经空覆盖/跌幅护栏）
    global_images = [img for img in images
                     if not (img.get("pdfSource") or {}).get("bookId")]
    if not write_images_guarded(GLOBAL_PATH, {
        "project": state.get("project", "中医古籍插图标注"),
        "images":  global_images,
        "showcaseFeaturedIds": state.get("showcaseFeaturedIds", []),
    }, key="images", label="global"):
        blocked["global"] = True

    # 每本书独立存储
    for book in books:
        bid = book.get("id")
        if not bid:
            continue
        book_dir = get_book_dir(bid)
        book_images = [img for img in images
                       if (img.get("pdfSource") or {}).get("bookId") == bid]
        _restore_book_page_thumbs_inplace(book_dir / "book.json", book)
        atomic_write_json(book_dir / "book.json",   book)
        if not write_images_guarded(book_dir / "images.json", book_images, label=book_dir.name):
            blocked["books"].append(bid)

    return blocked


def load_per_book_state():
    """从 global.json + 各书目录读取并组装完整 state，返回 dict 或 None。

    健壮性：global.json 缺失或损坏时**不再直接放弃**，而是按空全局处理、
    继续从 books/ 组装——只要磁盘上有书，就不会因为一个清单文件丢失而显示空白。
    仅当“无 global 文件且无任何书”（真未初始化）时返回 None，交 session.json 兜底。
    """
    global_data = {}
    global_exists = GLOBAL_PATH.exists()
    if global_exists:
        try:
            with open(GLOBAL_PATH, encoding="utf-8") as f:
                global_data = json.load(f)
        except Exception as e:
            print(f"[load] global.json 损坏，按空全局继续组装: {e}")
            global_data = {}

    books  = []
    images = list(global_data.get("images", []))

    if BOOKS_DIR.exists():
        for book_dir in sorted(BOOKS_DIR.iterdir()):
            book_json   = book_dir / "book.json"
            images_json = book_dir / "images.json"
            if not book_json.exists():
                continue
            try:
                with open(book_json, encoding="utf-8") as f:
                    book = json.load(f)
                books.append(book)
                if images_json.exists():
                    with open(images_json, encoding="utf-8") as f:
                        images.extend(json.load(f))
            except Exception as e:
                print(f"[load] 跳过损坏文件 {book_dir.name}: {e}")
                continue

    # 真未初始化（无 global 文件 且 无任何书）→ 交 session.json 兜底
    if not global_exists and not books:
        return None
    # 旧路径：无书但有旧 session.json，仍回退由其恢复
    if not books and SESSION_PATH.exists():
        return None

    return {
        "project": global_data.get("project", "中医古籍插图标注"),
        "showcaseFeaturedIds": global_data.get("showcaseFeaturedIds", []),
        "books":   books,
        "images":  images,
    }


def get_book_dir(book_id: str) -> Path:
    """获取并创建单本书的根目录。传入原始 book_id，内部调用 safe_segment 清洗。"""
    d = BOOKS_DIR / safe_segment(book_id)
    d.mkdir(parents=True, exist_ok=True)
    return d

# ── 读取配置 ──────────────────────────────────────────────────────────────
def load_config():
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}

def _stringify_log_value(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def log_api_failure(kind, provider, model, message, *, status_code=None, response_text="", extra=None):
    try:
        payload = {
            "ts": datetime.now().isoformat(),
            "kind": kind,
            "provider": provider or "",
            "model": model or "",
            "status_code": status_code,
            "message": _stringify_log_value(message),
            "response_text": _stringify_log_value(response_text),
        }
        if extra:
            payload["extra"] = extra
        with open(API_FAILURE_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass

def _existing_image_count(path: Path, key: str = None) -> int:
    """读现有 JSON 文件里的图片数。key 非空时取对象字段（如 global.json 的 images）。
    文件不存在或解析失败返回 -1（视为未知，不触发拦截）。"""
    if not path.exists():
        return -1
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if key:
            return len(data.get(key, []))
        return len(data) if isinstance(data, list) else -1
    except Exception:
        return -1


def maybe_snapshot_before_shrink(path: Path, incoming_count: int, key: str = None, label: str = "") -> bool:
    """跌幅护栏：当 incoming_count 相对磁盘现有记录数骤降时，先把旧文件复制到
    PRE_WRITE_BACKUP_DIR 再让调用方覆盖写入。返回是否做了快照。
    不阻塞写入（合法的批量删除照常生效），只保证可疑骤降可回滚。"""
    existing = _existing_image_count(path, key=key)
    if existing < DELTA_GUARD_MIN_EXISTING:
        return False
    if incoming_count >= existing * (1 - DELTA_GUARD_DROP_RATIO):
        return False
    try:
        ts  = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        safe = safe_segment(label or path.stem)
        dst = PRE_WRITE_BACKUP_DIR / f"{safe}_{ts}_{existing}to{incoming_count}.json"
        shutil.copy2(str(path), str(dst))
        print(f"[delta-guard] 可疑骤降 {existing}->{incoming_count}（{label}），已备份旧文件 {dst.name}")
        backups = sorted(PRE_WRITE_BACKUP_DIR.glob("*.json"))
        for old in backups[:-PRE_WRITE_BACKUP_KEEP]:
            try:
                old.unlink()
            except Exception:
                pass
    except Exception as e:
        print(f"[delta-guard] 备份失败（仍继续写入）: {e}")
    return True


def _is_placeholder_url(u, api_prefix: str) -> bool:
    """识别瘦身占位地址：相对（/api/...）或前端补全后的绝对（http://127.0.0.1:5678/api/...）。
    base64（data:）永远不算占位。"""
    if not isinstance(u, str) or u.startswith("data:"):
        return False
    if u.startswith(api_prefix):
        return True
    return (u.startswith("http://") or u.startswith("https://")) and api_prefix in u


def _restore_embedded_urls_inplace(path: Path, incoming: list, key: str = None) -> int:
    """保存护栏：把 incoming 中 url 为 /api/img/ 占位的记录，按 id 从磁盘现有文件恢复其 base64。
    只在「占位 url + 磁盘存在同 id 的 base64」时替换；其余一律不动。永不删除 base64。

    注意：这是**有意的原地修改**——直接改 incoming 里的 dict。调用方 write_images_guarded
    收到的 payload（含 session_post 里的 body["images"]）会被就地恢复，因此后续
    atomic_write_json 无论写 images.json 还是 session.json，落盘的都是 base64 而非占位符。
    新书（磁盘无文件）时无可恢复，占位 url 原样保留（不报错）。
    """
    if not path.exists():
        return 0
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        return 0
    old_imgs = old.get(key, []) if key else old
    if not isinstance(old_imgs, list):
        return 0
    b64_by_id = {}
    for im in old_imgs:
        if isinstance(im, dict):
            u = im.get("url") or ""
            if u.startswith("data:"):
                b64_by_id[im.get("id")] = u
    n = 0
    for im in incoming:
        if not isinstance(im, dict):
            continue
        u = im.get("url") or ""
        if _is_placeholder_url(u, "/api/img/"):
            real = b64_by_id.get(im.get("id"))
            if real:
                im["url"] = real
                n += 1
    if n:
        print(f"[phase2] 恢复 {n} 条 base64 url（{path.name}）")
    return n


_PAGE_THUMB_FIELDS = ("thumb", "thumbHi", "contentThumb", "contentThumbHi",
                      "cropThumb", "cropThumbHi")

def _restore_book_page_thumbs_inplace(path: Path, book: dict) -> int:
    """保存护栏：session GET 下发时页面缩略图被换成 /api/page-image 轻量 URL
    （见 _lighten_book_page_urls_for_client），前端 persist 原样写回会抹掉磁盘 base64。
    此处按 pageNum 从磁盘现有 book.json 恢复——只在「URL 占位 + 磁盘有 base64」时替换，
    base64 新值（前端刚生成的缩略图）一律不动，永不删除 base64。

    与 _restore_embedded_urls_inplace 同思路，**有意原地修改** book dict，
    调用方随后 atomic_write_json 落盘的即恢复后数据。
    """
    if not isinstance(book, dict) or not path.exists():
        return 0
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        return 0
    old_by_num = {}
    for key in ("pages", "illustrationPages"):
        lst = old.get(key)
        if not isinstance(lst, list):
            continue
        for pg in lst:
            if isinstance(pg, dict) and pg.get("pageNum") is not None:
                old_by_num.setdefault(pg.get("pageNum"), pg)
    if not old_by_num:
        return 0
    n = 0
    for key in ("pages", "illustrationPages"):
        lst = book.get(key)
        if not isinstance(lst, list):
            continue
        for pg in lst:
            if not isinstance(pg, dict):
                continue
            old_pg = old_by_num.get(pg.get("pageNum"))
            if not isinstance(old_pg, dict):
                continue
            for fld in _PAGE_THUMB_FIELDS:
                v = pg.get(fld)
                if _is_placeholder_url(v, "/api/page-image"):
                    real = old_pg.get(fld)
                    if isinstance(real, str) and real.startswith("data:"):
                        pg[fld] = real
                        n += 1
    if n:
        print(f"[guard] 恢复 {n} 个页面缩略图 base64（{path.parent.name}/book.json）")
    return n


def write_images_guarded(path: Path, payload, *, key: str = None, label: str = "") -> bool:
    """带空覆盖硬护栏 + 跌幅快照的图片写入，所有写图路径共用。

    payload 可为裸列表（书 images.json）或含 images 字段的 dict（global.json，传 key='images'）。
    返回 True=已写入；False=空覆盖被拒（已落 .rejected，磁盘旧数据保持不动）。
    """
    incoming = payload.get(key, []) if key else payload
    # Phase 2 护栏：前端持有的是 /api/img/<book>/<id> 轻量占位 url（见 session_get 下发转换），
    # 保存时若按原样写回会抹掉磁盘上的 base64。此处按 id 从现有文件恢复 base64——只恢复不删除。
    if isinstance(incoming, list):
        _restore_embedded_urls_inplace(path, incoming, key=key)
        _fill_name_pinyin_inplace(incoming)  # 兜底：缺拼音的记录落盘时按解析名补全
    incoming_count = len(incoming) if isinstance(incoming, list) else 0
    name = label or path.name
    if incoming_count == 0:
        existing = _existing_image_count(path, key=key)
        if existing > 0:
            atomic_write_json(path.with_suffix(path.suffix + ".rejected"),
                {"blocked_at": datetime.now().isoformat(),
                 "reason": "empty_overwrite_blocked", "incoming": 0, "existing": existing})
            print(f"[guard] 拒绝空覆盖 {name}（现有 {existing} 条）")
            return False
    maybe_snapshot_before_shrink(path, incoming_count, key=key, label=name)
    atomic_write_json(path, payload)
    return True

def atomic_write_json(path: Path, payload):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=None)
    tmp.replace(path)


# ── 整书参考文本（校文辅助，不进入标注/论文数据）────────────────────────────

REFERENCE_TEXT_MAX_BYTES = 20 * 1024 * 1024
REFERENCE_TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".docx"}
REFERENCE_UNCERTAIN_MARKS_SCHEMA = "reference-uncertain-marks-v1"
REFERENCE_UNCERTAIN_MARKS_LIMIT = 2000


def _reference_scope_exists(scope_id: str) -> bool:
    """单卷 book.id 或合并书 groupId 均可作为整书参考文本的挂载范围。"""
    target = str(scope_id or "").strip()
    if not target:
        return False
    state = load_per_book_state() or {}
    for book in state.get("books", []):
        if str(book.get("id") or "") == target or str(book.get("groupId") or "") == target:
            return True
    return False


def _reference_scope_dir(scope_id: str) -> Path:
    return DATA_DIR / "text_references" / safe_segment(scope_id)


def _decode_reference_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("文本编码无法识别，请另存为 UTF-8 后重试")


def _extract_docx_reference_text(raw: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            document_xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise ValueError("DOCX 文件结构无效") from exc
    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError as exc:
        raise ValueError("DOCX 正文 XML 无法解析") from exc
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(f"{namespace}p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{namespace}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{namespace}tab":
                parts.append("\t")
            elif node.tag in {f"{namespace}br", f"{namespace}cr"}:
                parts.append("\n")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def _parse_reference_upload(filename: str, raw: bytes) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in REFERENCE_TEXT_EXTENSIONS:
        raise ValueError("仅支持 TXT、Markdown 或 DOCX 完整文本")
    text = _extract_docx_reference_text(raw) if suffix == ".docx" else _decode_reference_text(raw)
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        raise ValueError("参考文本为空")
    return text


def _load_reference_metadata(scope_id: str):
    root = _reference_scope_dir(scope_id)
    records = []
    if not root.exists():
        return records
    for metadata_path in sorted(root.glob("*/metadata.json")):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            edited_path = metadata_path.parent / "edited_content.txt"
            metadata["has_edits"] = edited_path.exists()
            records.append(metadata)
        except (OSError, ValueError):
            continue
    records.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return records


def _atomic_write_bytes(path: Path, payload: bytes):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(payload)
    tmp.replace(path)


def _atomic_write_text(path: Path, payload: str):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(path)


def _load_reference_uncertain_marks(reference_dir: Path) -> list:
    path = reference_dir / "uncertain_marks.json"
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != REFERENCE_UNCERTAIN_MARKS_SCHEMA:
        raise ValueError("存疑标记 schema 无效")
    marks = payload.get("marks")
    if not isinstance(marks, list):
        raise ValueError("存疑标记列表无效")
    return marks


def _validate_reference_uncertain_marks(marks, content: str) -> list:
    if not isinstance(marks, list):
        raise ValueError("marks 必须是数组")
    if len(marks) > REFERENCE_UNCERTAIN_MARKS_LIMIT:
        raise ValueError(f"存疑标记不得超过 {REFERENCE_UNCERTAIN_MARKS_LIMIT} 条")
    normalized = []
    occupied = []
    for index, raw in enumerate(marks):
        if not isinstance(raw, dict):
            raise ValueError(f"第 {index + 1} 条存疑标记无效")
        mark_id = str(raw.get("id") or "").strip()
        if not mark_id or safe_segment(mark_id) != mark_id:
            raise ValueError(f"第 {index + 1} 条存疑标记 id 无效")
        start = raw.get("start")
        end = raw.get("end")
        if not isinstance(start, int) or isinstance(start, bool):
            raise ValueError(f"第 {index + 1} 条存疑标记起点无效")
        if not isinstance(end, int) or isinstance(end, bool):
            raise ValueError(f"第 {index + 1} 条存疑标记终点无效")
        if start < 0 or end <= start or end > len(content):
            raise ValueError(f"第 {index + 1} 条存疑标记范围越界")
        quote = str(raw.get("quote") or "")
        if not quote or content[start:end] != quote:
            raise ValueError(f"第 {index + 1} 条存疑标记与整理稿文字不一致")
        if any(start < right and end > left for left, right in occupied):
            raise ValueError("存疑标记范围不得相互重叠")
        occupied.append((start, end))
        normalized.append({
            "id": mark_id,
            "start": start,
            "end": end,
            "quote": quote,
            "created_at": str(raw.get("created_at") or datetime.now().isoformat()),
        })
    return sorted(normalized, key=lambda item: (item["start"], item["end"], item["id"]))


def _reanchor_reference_uncertain_marks(marks: list, content: str) -> tuple[list, int]:
    """整理稿改变后，仅保留能在新正文中唯一定位的旁注。"""
    reanchored = []
    dropped = 0
    for raw in marks:
        quote = str(raw.get("quote") or "")
        if not quote:
            dropped += 1
            continue
        old_start = raw.get("start")
        old_end = raw.get("end")
        if (
            isinstance(old_start, int)
            and isinstance(old_end, int)
            and 0 <= old_start < old_end <= len(content)
            and content[old_start:old_end] == quote
        ):
            next_start = old_start
        else:
            first = content.find(quote)
            if first < 0 or content.find(quote, first + 1) >= 0:
                dropped += 1
                continue
            next_start = first
        candidate = {
            **raw,
            "start": next_start,
            "end": next_start + len(quote),
            "quote": quote,
        }
        if any(candidate["start"] < item["end"] and candidate["end"] > item["start"]
               for item in reanchored):
            dropped += 1
            continue
        reanchored.append(candidate)
    return sorted(reanchored, key=lambda item: (item["start"], item["end"])), dropped


def _write_reference_uncertain_marks(reference_dir: Path, marks: list) -> None:
    atomic_write_json(reference_dir / "uncertain_marks.json", {
        "schema": REFERENCE_UNCERTAIN_MARKS_SCHEMA,
        "updated_at": datetime.now().isoformat(),
        "marks": marks,
    })


# Provider 端点表已移至 vision_client，bridge 与 annotate 共用，避免漂移
from vision_client import (
    PROVIDER_BASE_URLS, provider_chat_url, call_vision_content,
    parse_annotation_json, image_part, text_part, VisionAPIError,
    supports_vision, DEEPSEEK_NO_VISION_MSG,
)


# ── 自动备份调度 ──────────────────────────────────────────────────────────────
# 新备份统一写入 data-center-backup-v1（ZIP + manifest）。AUTO_BACKUP_DIR 仅保留
# 为旧 JSON 快照兼容目录；不再产生新的 state_*.json。
_last_auto_backup_ts: float = 0.0
AUTO_BACKUP_INTERVAL = 300   # 每 5 分钟最多一次备份（秒）
AUTO_BACKUP_KEEP     = 12    # 保留最近 12 个备份文件（5分钟节流下约 1 小时）
AUTO_BACKUP_DAILY_KEEP = 7   # 另外每天保留当天最后一份，共约 7 天（跨天恢复用）
_auto_backup_schedule_lock = threading.Lock()
_auto_backup_running = False
_backup_write_lock = threading.Lock()

def write_auto_backup(force=False):
    """按节流写入统一 ZIP 备份；旧 JSON 快照只读保留，不再新增。

    调用点仍沿用旧函数名，避免分散的保存路径失效；实际落盘格式唯一为
    data-center-backup-v1。自动备份仅清理同类 automatic 包，绝不删除手动、
    恢复前或历史 JSON 快照。
    """
    global _last_auto_backup_ts
    now = time.time()
    if not force and now - _last_auto_backup_ts < AUTO_BACKUP_INTERVAL:
        return
    _last_auto_backup_ts = now
    return _write_automatic_backup()


def _write_automatic_backup():
    """执行一次自动备份；供后台任务和兼容的手工端点共用。"""
    try:
        result = _data_center_write_backup(reason="automatic")
        _data_center_prune_automatic_backups()
        return result["zip_name"]
    except Exception as e:
        print(f"[auto-backup] 备份失败（非致命）: {e}")
        return None


def schedule_auto_backup(force=False):
    """把日常自动备份放入后台，绝不阻塞标注保存或服务启动。

    标注数据已由调用方原子写入后才会调用本函数；即使压缩数百 MB 的
    ZIP 需要较久，前端也不应因此把已完成的数据写入误报为会话失败。
    同一时刻只允许一个自动备份任务，批量操作前的同步备份端点仍维持原有
    的“先备份、再操作”语义。
    """
    global _last_auto_backup_ts, _auto_backup_running
    now = time.time()
    with _auto_backup_schedule_lock:
        if _auto_backup_running:
            return {"scheduled": False, "reason": "already_running"}
        if not force and now - _last_auto_backup_ts < AUTO_BACKUP_INTERVAL:
            return {"scheduled": False, "reason": "throttled"}
        _last_auto_backup_ts = now
        _auto_backup_running = True

    def worker():
        global _auto_backup_running
        try:
            name = _write_automatic_backup()
            if name:
                print(f"[auto-backup] 后台备份完成：{name}")
        finally:
            with _auto_backup_schedule_lock:
                _auto_backup_running = False

    threading.Thread(
        target=worker,
        name="illustration-auto-backup",
        daemon=True,
    ).start()
    return {"scheduled": True, "reason": "started"}


# ── 启动时：把 session.json 里 ok/bad 合并进 per-book images.json（平迁修复）──
def reconcile_session_into_per_book():
    """解决从旧格式 session.json 平迁时丢失 ok/bad 确认状态的问题。
    规则：per-book 文件里状态为 review/running/todo 的条目，若 session.json
    中同 id 为 ok/bad，则以 session.json 为准（更高优先级）。
    哨兵文件 .session_reconciled 存在时直接跳过，避免冻结快照反复回滚状态。
    """
    if RECONCILE_SENTINEL.exists():
        return  # 已平迁过，不再重复执行
    if not SESSION_PATH.exists() or not GLOBAL_PATH.exists():
        RECONCILE_SENTINEL.touch()  # 没有旧文件也写哨兵，防止后续无意义检查
        return
    try:
        with open(SESSION_PATH, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        return

    CONFIRMED = {"ok", "bad"}
    LOWER     = {"review", "running", "todo"}
    confirmed = {
        img["id"]: img
        for img in old.get("images", [])
        if img.get("status") in CONFIRMED and img.get("id")
    }
    if not confirmed:
        return

    patched = 0
    for book_dir in sorted(BOOKS_DIR.iterdir()):
        images_json = book_dir / "images.json"
        if not images_json.exists():
            continue
        try:
            with open(images_json, encoding="utf-8") as f:
                imgs = json.load(f)
        except Exception:
            continue

        changed = False
        for img in imgs:
            iid = img.get("id")
            if iid in confirmed and img.get("status") in LOWER:
                src = confirmed[iid]
                img["status"] = src["status"]
                if "reviewMeta" in src:
                    img.setdefault("reviewMeta", {}).update(src["reviewMeta"])
                changed = True
                patched += 1

        if changed:
            atomic_write_json(images_json, imgs)

    if patched:
        print(f"[reconcile] 从 session.json 恢复了 {patched} 条 ok/bad 确认状态")
    RECONCILE_SENTINEL.touch()
    print(f"[reconcile] 平迁完成，写入哨兵 {RECONCILE_SENTINEL.name}，后续启动不再执行")

def safe_segment(value):
    text = str(value or "").strip()
    if not text:
        return "unknown"
    keep = []
    for ch in text:
        if ch.isalnum() or ch in ("-", "_", "."):
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep)[:120] or "unknown"

# ── 服务器安全设置（config 可配；默认保持原行为不影响局域网演示）──────────────
# bind_host:    "0.0.0.0"=局域网可访问（默认，演示用）；"127.0.0.1"=仅本机（更安全）
# allow_origin: "*"=任意网页可调用（默认）；填具体来源如 "http://localhost:5678" 可收紧
_BOOT_CFG    = load_config()
BIND_HOST    = (_BOOT_CFG.get("bind_host") or "0.0.0.0").strip()
ALLOW_ORIGIN = (_BOOT_CFG.get("allow_origin") or "*").strip()

# ── Flask 应用 ────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=".", static_url_path="")

# 只读库仍允许配置、备份、诊断与只读导出类 POST；其余写请求由服务端统一拒绝，
# 避免仅靠按钮禁用造成旁路写入。
_READ_ONLY_POST_ALLOWLIST = {
    "/api/save-config",
    "/api/backup-now",
    "/api/save-export",
    "/api/showcase-export",
    "/api/model-runs/export",
    "/api/asset-sources/export",
    "/api/log-client-error",
    "/api/data-center/backups",
    "/api/data-center/auto-backup",
    "/api/data-center/exports/paper-freeze",
    "/api/data-center/exports/showcase",
    "/api/text-convert",
}

@app.before_request
def protect_read_only_data_source():
    if not DATA_SOURCE_READ_ONLY:
        return None
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    if request.path in _READ_ONLY_POST_ALLOWLIST:
        return None
    return jsonify({
        "ok": False,
        "code": "DATA_SOURCE_READ_ONLY",
        "error": "当前连接的是只读历史生产库；请切换到新版重标库后再保存。",
        "data_source": {
            "id": DATA_SOURCE_ID,
            "label": DATA_SOURCE_LABEL,
            "mode": DATA_SOURCE_MODE,
            "read_only": True,
        },
    }), 423

def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = ALLOW_ORIGIN
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

@app.after_request
def add_cors(resp):
    # 前端代码(HTML/JS)禁缓存：改了 app.js 后浏览器普通刷新即拿最新，不再缓存旧版。
    # 仅作用于 / 、*.html 、*.js；不影响 /api/img 等已自设 Cache-Control 的响应。
    p = request.path
    if p == "/" or p.endswith(".html") or p.endswith(".js"):
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return cors(resp)

@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.route("/guide")
def guide():
    return app.send_static_file("guide.html")

# ── 状态接口 ─────────────────────────────────────────────────────────────

@app.route("/api/pinyin")
def api_pinyin():
    """按解析名生成拼音，供前端改名/AI 回写时同步内存（与后端兜底同一引擎）。"""
    text = request.args.get("text", "")
    return jsonify({"text": text, "pinyin": name_pinyin(text), "engine_ok": _PINYIN_OK})


@app.route("/api/status")
def status():
    cfg = load_config()
    book_count = sum(
        1 for book_json in BOOKS_DIR.glob("*/book.json")
        if book_json.is_file()
    ) if BOOKS_DIR.exists() else 0
    return jsonify({
        "ok": True,
        "provider": cfg.get("api_provider", "未配置"),
        "model": cfg.get("model", "未配置"),
        "has_key": bool(cfg.get("api_key", "").strip()),
        "session_exists": SESSION_PATH.exists(),
        "image_count": len(list(IMAGES_DIR.glob("*"))) if IMAGES_DIR.exists() else 0,
        "data_source": {
            "id": DATA_SOURCE_ID,
            "label": DATA_SOURCE_LABEL,
            "mode": DATA_SOURCE_MODE,
            "read_only": DATA_SOURCE_READ_ONLY,
            "path": str(DATA_DIR),
            "book_count": book_count,
        },
        "asset_bridge": {
            "configured": ASSET_ROOT is not None,
            "schema_version": "asset-source-v1",
        },
        "text_conversion": {
            "available": _OPENCC_OK,
            "engine": "OpenCC" if _OPENCC_OK else None,
            "directions": ["t2s", "s2t"] if _OPENCC_OK else [],
            "persistence": "display_only",
        },
    })


@app.route("/api/text-convert", methods=["POST", "OPTIONS"])
def text_convert():
    """按需生成繁简辅助文本。

    这是无状态、只读计算接口；前端不得把响应自动写回 fullText/correctedText。
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body = request.get_json(silent=True) or {}
    text = body.get("text")
    direction = str(body.get("direction") or "").strip()
    if not isinstance(text, str):
        return jsonify({"ok": False, "code": "TEXT_REQUIRED",
                        "error": "text 必须是字符串"}), 400
    if len(text) > TEXT_CONVERT_MAX_CHARS:
        return jsonify({"ok": False, "code": "TEXT_TOO_LARGE",
                        "error": f"单次转换不得超过 {TEXT_CONVERT_MAX_CHARS} 字"}), 413
    if direction not in {"t2s", "s2t"}:
        return jsonify({"ok": False, "code": "DIRECTION_INVALID",
                        "error": "direction 必须是 t2s 或 s2t"}), 400
    try:
        converted = convert_chinese_text(text, direction)
    except RuntimeError as exc:
        return jsonify({"ok": False, "code": "OPENCC_UNAVAILABLE",
                        "error": str(exc)}), 503
    return jsonify({
        "ok": True,
        "text": converted,
        "direction": direction,
        "engine": "OpenCC",
        "input_chars": len(text),
        "output_chars": len(converted),
        "persistence": "display_only",
    })


@app.route("/api/text-references/<scope_id>", methods=["GET", "POST", "OPTIONS"])
def text_references(scope_id):
    """列出或导入整书参考文本。

    参考文本是校文辅助资产：独立于 book.json、images.json 和 textAsset，
    不参与标注统计，也不会自动覆盖 OCR/人工校正文。
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    if not _reference_scope_exists(scope_id):
        return jsonify({"ok": False, "code": "REFERENCE_SCOPE_NOT_FOUND",
                        "error": "未找到对应书籍或合并书组"}), 404
    if request.method == "GET":
        return jsonify({"ok": True, "scope_id": scope_id,
                        "items": _load_reference_metadata(scope_id)})

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"ok": False, "code": "REFERENCE_FILE_REQUIRED",
                        "error": "请选择完整参考文本文件"}), 400
    raw = upload.read(REFERENCE_TEXT_MAX_BYTES + 1)
    if len(raw) > REFERENCE_TEXT_MAX_BYTES:
        return jsonify({"ok": False, "code": "REFERENCE_FILE_TOO_LARGE",
                        "error": "参考文本文件不得超过 20 MB"}), 413
    try:
        text = _parse_reference_upload(upload.filename, raw)
    except ValueError as exc:
        return jsonify({"ok": False, "code": "REFERENCE_FILE_INVALID",
                        "error": str(exc)}), 400

    digest = hashlib.sha256(raw).hexdigest()
    now = datetime.now()
    reference_id = f"ref_{now.strftime('%Y%m%d%H%M%S%f')}_{digest[:12]}"
    reference_dir = _reference_scope_dir(scope_id) / reference_id
    reference_dir.mkdir(parents=True, exist_ok=False)
    suffix = Path(upload.filename).suffix.lower()
    original_name = Path(upload.filename).name
    title = str(request.form.get("title") or Path(original_name).stem).strip()[:200]
    metadata = {
        "schema": "whole-book-reference-v1",
        "id": reference_id,
        "scope_id": scope_id,
        "title": title or "整书参考文本",
        "original_filename": original_name,
        "source_format": suffix.lstrip("."),
        "sha256": digest,
        "character_count": len(text),
        "line_count": text.count("\n") + 1,
        "created_at": now.isoformat(),
        "usage": "proofreading_reference_only",
        "paper_included": False,
    }
    _atomic_write_text(reference_dir / "content.txt", text)
    _atomic_write_bytes(reference_dir / f"original{suffix}", raw)
    atomic_write_json(reference_dir / "metadata.json", metadata)
    return jsonify({"ok": True, "item": metadata}), 201


@app.route("/api/text-references/<scope_id>/<reference_id>", methods=["GET", "PUT", "OPTIONS"])
def text_reference_detail(scope_id, reference_id):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    if not _reference_scope_exists(scope_id):
        return jsonify({"ok": False, "code": "REFERENCE_SCOPE_NOT_FOUND",
                        "error": "未找到对应书籍或合并书组"}), 404
    safe_reference_id = safe_segment(reference_id)
    if reference_id in {"", ".", ".."} or safe_reference_id != reference_id:
        return jsonify({"ok": False, "code": "REFERENCE_NOT_FOUND",
                        "error": "参考文本不存在"}), 404
    reference_dir = _reference_scope_dir(scope_id) / safe_reference_id
    metadata_path = reference_dir / "metadata.json"
    content_path = reference_dir / "content.txt"
    edited_content_path = reference_dir / "edited_content.txt"
    if not metadata_path.exists() or not content_path.exists():
        return jsonify({"ok": False, "code": "REFERENCE_NOT_FOUND",
                        "error": "参考文本不存在"}), 404
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        original_content = content_path.read_text(encoding="utf-8")
        uncertain_marks = _load_reference_uncertain_marks(reference_dir)
    except (OSError, ValueError) as exc:
        return jsonify({"ok": False, "code": "REFERENCE_STORAGE_INVALID",
                        "error": f"参考文本存储损坏：{exc}"}), 500

    if request.method == "PUT":
        payload = request.get_json(silent=True) or {}
        edited_content = payload.get("content")
        if not isinstance(edited_content, str):
            return jsonify({"ok": False, "code": "REFERENCE_EDIT_INVALID",
                            "error": "编辑副本 content 必须是字符串"}), 400
        edited_content = edited_content.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not edited_content:
            return jsonify({"ok": False, "code": "REFERENCE_EDIT_EMPTY",
                            "error": "编辑副本不能为空"}), 400
        if len(edited_content.encode("utf-8")) > REFERENCE_TEXT_MAX_BYTES:
            return jsonify({"ok": False, "code": "REFERENCE_EDIT_TOO_LARGE",
                            "error": "编辑副本不得超过 20 MB"}), 413
        try:
            # 编辑中的存疑旁注尚不能单独落盘（正文坐标尚未保存）。随同本次
            # 整理稿提交时，以新正文为准校验并在同一保存事务中写入。
            if "uncertain_marks" in payload:
                uncertain_marks = _validate_reference_uncertain_marks(
                    payload.get("uncertain_marks"),
                    edited_content,
                )
                dropped_uncertain_marks = 0
            else:
                uncertain_marks, dropped_uncertain_marks = _reanchor_reference_uncertain_marks(
                    uncertain_marks,
                    edited_content,
                )
        except ValueError as exc:
            return jsonify({"ok": False, "code": "REFERENCE_UNCERTAIN_MARKS_INVALID",
                            "error": str(exc)}), 400
        now = datetime.now().isoformat()
        try:
            _atomic_write_text(edited_content_path, edited_content)
            if uncertain_marks or (reference_dir / "uncertain_marks.json").exists():
                _write_reference_uncertain_marks(reference_dir, uncertain_marks)
            metadata.update({
                "has_edits": True,
                "edited_at": now,
                "edited_character_count": len(edited_content),
                "edited_line_count": edited_content.count("\n") + 1,
            })
            atomic_write_json(metadata_path, metadata)
        except OSError as exc:
            return jsonify({"ok": False, "code": "REFERENCE_STORAGE_WRITE_FAILED",
                            "error": f"编辑副本保存失败：{exc}"}), 500
        return jsonify({
            "ok": True,
            "item": metadata,
            "content": edited_content,
            "original_content": original_content,
            "has_edits": True,
            "uncertain_marks": uncertain_marks,
            "dropped_uncertain_marks": dropped_uncertain_marks,
        })

    try:
        has_edits = edited_content_path.exists()
        content = edited_content_path.read_text(encoding="utf-8") if has_edits else original_content
    except OSError as exc:
        return jsonify({"ok": False, "code": "REFERENCE_STORAGE_INVALID",
                        "error": f"参考文本编辑副本损坏：{exc}"}), 500
    metadata["has_edits"] = has_edits
    return jsonify({
        "ok": True,
        "item": metadata,
        "content": content,
        "original_content": original_content,
        "has_edits": has_edits,
        "uncertain_marks": uncertain_marks,
    })


@app.route(
    "/api/text-references/<scope_id>/<reference_id>/uncertain-marks",
    methods=["PUT", "OPTIONS"],
)
def text_reference_uncertain_marks(scope_id, reference_id):
    """保存整理稿上的存疑旁注；旁注不写入正文文件。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    if not _reference_scope_exists(scope_id):
        return jsonify({"ok": False, "code": "REFERENCE_SCOPE_NOT_FOUND",
                        "error": "未找到对应书籍或合并书组"}), 404
    safe_reference_id = safe_segment(reference_id)
    if reference_id in {"", ".", ".."} or safe_reference_id != reference_id:
        return jsonify({"ok": False, "code": "REFERENCE_NOT_FOUND",
                        "error": "参考文本不存在"}), 404
    reference_dir = _reference_scope_dir(scope_id) / safe_reference_id
    content_path = reference_dir / "content.txt"
    edited_content_path = reference_dir / "edited_content.txt"
    if not (reference_dir / "metadata.json").exists() or not content_path.exists():
        return jsonify({"ok": False, "code": "REFERENCE_NOT_FOUND",
                        "error": "参考文本不存在"}), 404
    try:
        content = (
            edited_content_path.read_text(encoding="utf-8")
            if edited_content_path.exists()
            else content_path.read_text(encoding="utf-8")
        )
        marks = _validate_reference_uncertain_marks(
            (request.get_json(silent=True) or {}).get("marks"),
            content,
        )
        _write_reference_uncertain_marks(reference_dir, marks)
    except ValueError as exc:
        return jsonify({"ok": False, "code": "REFERENCE_UNCERTAIN_MARKS_INVALID",
                        "error": str(exc)}), 400
    except OSError as exc:
        return jsonify({"ok": False, "code": "REFERENCE_STORAGE_WRITE_FAILED",
                        "error": f"存疑标记保存失败：{exc}"}), 500
    return jsonify({
        "ok": True,
        "schema": REFERENCE_UNCERTAIN_MARKS_SCHEMA,
        "marks": marks,
        "paper_included": False,
    })


# ── 多提供商配置读写接口 ──────────────────────────────────────────────────

_PROVIDER_KEY_FIELDS = ["qwenKey","openaiKey","deepseekKey","kimiKey",
                        "doubaoKey","zhipuKey","geminiKey","baiduKey"]
_MODEL_FIELDS        = ["qwenModel","openaiModel","deepseekModel","kimiModel",
                        "doubaoModel","zhipuModel","geminiModel","baiduModel"]
_MISC_FIELDS         = [
    "provider", "scanProvider", "scanModel",
    "batchConcurrency", "scanConcurrency",
    "contextRadius", "scanContextRadius", "crossCheck",
]

@app.route("/api/config", methods=["GET", "OPTIONS"])
def get_full_config():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    cfg = load_config()
    # 向下兼容：若 qwenKey 未存，尝试从旧 api_key 字段推断
    legacy_key      = cfg.get("api_key", "")
    legacy_provider = cfg.get("api_provider", "qwen")
    out = {"ok": True}
    for f in _PROVIDER_KEY_FIELDS:
        val = cfg.get(f, "")
        # 旧配置迁移：主提供商的 key 回填
        if not val and f == legacy_provider + "Key":
            val = legacy_key
        out[f] = val
    for f in _MODEL_FIELDS + _MISC_FIELDS:
        out[f] = cfg.get(f, "")
    # 旧字段迁移
    if not out["provider"]:
        out["provider"] = legacy_provider
    if not out["qwenModel"] and legacy_provider == "qwen":
        out["qwenModel"] = cfg.get("model", "")
    return cors(jsonify(out))


@app.route("/api/save-config", methods=["POST", "OPTIONS"])
def save_full_config():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body = request.get_json(force=True, silent=True) or {}
    cfg  = load_config()

    for f in _PROVIDER_KEY_FIELDS + _MODEL_FIELDS + _MISC_FIELDS:
        if f in body:
            cfg[f] = body[f]

    # 同步更新旧字段，保持 OCR/标注接口的向下兼容
    provider = cfg.get("provider", "qwen")
    cfg["api_provider"] = provider
    key_field = provider + "Key"
    if key_field in cfg and cfg[key_field]:
        cfg["api_key"] = cfg[key_field]
    model_field = provider + "Model"
    if model_field in cfg and cfg[model_field]:
        cfg["model"] = cfg[model_field]

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cors(jsonify({"ok": True}))


# ── 会话持久化接口 ────────────────────────────────────────────────────────

def _lighten_image_urls_for_client(state: dict) -> int:
    """Phase 2：只在下发给前端时，把内嵌 base64 的 url 换成轻量 /api/img/<book>/<id> 占位，
    让前端 state 不再持有 52MB base64。磁盘真源与备份（load_per_book_state 原样）不受影响。
    仅转换带 pdfSource.bookId 的记录；无归属的全局图保留 base64。"""
    n = 0
    for im in state.get("images", []) or []:
        if not isinstance(im, dict):
            continue
        u = im.get("url") or ""
        bid = (im.get("pdfSource") or {}).get("bookId")
        if u.startswith("data:") and bid and im.get("id"):
            im["url"] = "/api/img/" + quote(str(bid), safe="") + "/" + quote(str(im["id"]), safe="")
            n += 1
    return n


def _rect_query(rect) -> str:
    if not isinstance(rect, list) or len(rect) != 4:
        return ""
    try:
        vals = [max(0.0, min(1.0, float(v))) for v in rect]
    except (TypeError, ValueError):
        return ""
    if vals[2] - vals[0] < 0.01 or vals[3] - vals[1] < 0.01:
        return ""
    return ",".join(f"{v:.6f}".rstrip("0").rstrip(".") for v in vals)


def _quad_query(quad) -> str:
    if not isinstance(quad, list) or len(quad) != 4:
        return ""
    vals = []
    try:
        for pt in quad:
            if not isinstance(pt, list) or len(pt) != 2:
                return ""
            vals.extend([max(0.0, min(1.0, float(pt[0]))), max(0.0, min(1.0, float(pt[1])))])
    except (TypeError, ValueError):
        return ""
    return ",".join(f"{v:.6f}".rstrip("0").rstrip(".") for v in vals)


def _page_image_url(book_id, page_num, *, rect=None, quad=None, rotation_deg=0, width=360) -> str:
    url = "/api/page-image/" + quote(str(book_id), safe="") + "/" + quote(str(int(page_num)), safe="")
    qs = []
    rect_s = _rect_query(rect)
    quad_s = _quad_query(quad)
    if rect_s:
        qs.append("rect=" + quote(rect_s, safe=","))
    if quad_s:
        qs.append("quad=" + quote(quad_s, safe=","))
    try:
        rot = float(rotation_deg or 0)
    except (TypeError, ValueError):
        rot = 0
    if abs(rot) >= 0.001:
        qs.append("rot=" + quote(f"{max(-5.0, min(5.0, rot)):.3f}".rstrip("0").rstrip("."), safe=""))
    if width:
        qs.append("w=" + quote(str(int(width)), safe=""))
    return url + (("?" + "&".join(qs)) if qs else "")


def _lighten_book_page_urls_for_client(state: dict) -> int:
    """Only shrink the API response: replace embedded page thumbnails with lazy render URLs.

    Disk book.json remains unchanged, so existing backups and write guards keep their current behavior.
    """
    n = 0
    for book in state.get("books", []) or []:
        if not isinstance(book, dict):
            continue
        bid = book.get("id")
        if not bid:
            continue
        pages = book.get("pages") if isinstance(book.get("pages"), list) else book.get("illustrationPages")
        if not isinstance(pages, list):
            continue
        for page in pages:
            if not isinstance(page, dict):
                continue
            page_num = page.get("pageNum")
            try:
                # URL 一律用 PDF 物理页（删除页后 pageNum 为显示页码，渲染需物理页）
                page_num_i = int(page.get("pdfPageNum") or page_num)
            except (TypeError, ValueError):
                continue

            def replace_data_url(field, url):
                nonlocal n
                if isinstance(page.get(field), str) and page[field].startswith("data:"):
                    page[field] = url
                    n += 1

            full_small = _page_image_url(bid, page_num_i, width=360)
            full_large = _page_image_url(bid, page_num_i, width=900)
            replace_data_url("thumb", full_small)
            replace_data_url("thumbHi", full_large)

            content_rect = page.get("contentRect")
            content_small = _page_image_url(bid, page_num_i, rect=content_rect, width=360)
            content_large = _page_image_url(bid, page_num_i, rect=content_rect, width=900)
            replace_data_url("contentThumb", content_small)
            replace_data_url("contentThumbHi", content_large)

            crop_rect = page.get("cropRect")
            crop_quad = page.get("cropQuad")
            crop_rot = page.get("cropRotationDeg") or page.get("rotationDeg") or 0
            crop_small = _page_image_url(bid, page_num_i, rect=crop_rect, quad=crop_quad, rotation_deg=crop_rot, width=360)
            crop_large = _page_image_url(bid, page_num_i, rect=crop_rect, quad=crop_quad, rotation_deg=crop_rot, width=900)
            replace_data_url("cropThumb", crop_small)
            replace_data_url("cropThumbHi", crop_large)
    return n


@app.route("/api/session", methods=["GET", "OPTIONS"])
def session_get():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    # 优先从按书分目录读取（新格式）
    state = load_per_book_state()
    if state is not None:
        _lighten_image_urls_for_client(state)
        _lighten_book_page_urls_for_client(state)
        return jsonify({"ok": True, "state": state})
    # 降级：读旧的单文件 session.json
    if not SESSION_PATH.exists():
        return jsonify({"ok": False, "reason": "no_session"}), 404
    try:
        with open(SESSION_PATH, encoding="utf-8") as f:
            data = json.load(f)
        _lighten_image_urls_for_client(data)   # legacy 降级路径同样轻量化，避免旧 session.json 里的 base64 大响应
        return jsonify({"ok": True, "state": data})
    except Exception as e:
        return jsonify({"ok": False, "reason": str(e)}), 500

@app.route("/api/session", methods=["POST"])
def session_post():
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({"error": "空请求体"}), 400
    try:
        # 拆分存入按书目录（新格式，内部已过空覆盖/跌幅护栏）
        blocked = split_and_save_session(body)
        # legacy 全量保存：前端常规流程不调用本端点；仅此处写 session.json 作完整快照
        atomic_write_json(SESSION_PATH, body)
        atomic_write_json(SESSION_BACKUP_PATH, body)
        resp = {"ok": True}
        # 有书/全局因空覆盖护栏被拦时透出（仍 200：其余书已正常保存，不硬失败）
        if blocked["global"] or blocked["books"]:
            resp["blocked"] = blocked
        return jsonify(resp)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/session/global", methods=["POST", "OPTIONS"])
def session_global_post():
    """保存全局 state（非书图像 + 项目名）。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({"error": "空请求体"}), 400
    try:
        if not write_images_guarded(GLOBAL_PATH, body, key="images", label="global"):
            return jsonify({"ok": False, "reason": "empty_overwrite_blocked"}), 409
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/session/book/<book_id>", methods=["POST", "OPTIONS"])
def session_book_post(book_id):
    """保存单本书的 book.json + images.json。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({"error": "空请求体"}), 400
    try:
        book_dir = get_book_dir(book_id)
        if "book" in body:
            _restore_book_page_thumbs_inplace(book_dir / "book.json", body["book"])
            atomic_write_json(book_dir / "book.json",   body["book"])
        if "images" in body:
            if not write_images_guarded(book_dir / "images.json", body["images"], label=book_dir.name):
                return jsonify({"ok": False, "reason": "empty_overwrite_blocked"}), 409
        backup = schedule_auto_backup()  # 后台滚动备份，保存响应不等待 ZIP 压缩
        return jsonify({"ok": True, "backup": backup})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── 图像上传接口 ──────────────────────────────────────────────────────────

@app.route("/api/upload-image", methods=["POST", "OPTIONS"])
def upload_image():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    image_b64 = body.get("image_b64", "")
    data_url   = body.get("data_url", "")
    image_id   = body.get("id", "")
    ext        = body.get("ext", "png")

    if data_url and not image_b64:
        try:
            header, image_b64 = data_url.split(",", 1)
            if "jpeg" in header or "jpg" in header:
                ext = "jpg"
            elif "webp" in header:
                ext = "webp"
            elif "gif" in header:
                ext = "gif"
        except Exception:
            pass

    if not image_b64:
        return jsonify({"error": "未提供图像数据（image_b64 或 data_url）"}), 400

    try:
        img_bytes = base64.b64decode(image_b64)
    except Exception as e:
        return jsonify({"error": f"base64 解码失败：{e}"}), 400

    safe_id = image_id.replace("/", "_").replace("\\", "_") if image_id else str(uuid.uuid4())[:8]
    filename = f"{safe_id}.{ext}"

    book_id_raw = (body.get("book_id") or "").strip()
    if book_id_raw:
        img_dir = get_book_dir(book_id_raw) / "images"
        img_dir.mkdir(exist_ok=True)
        dest = img_dir / filename
        url  = f"http://localhost:5678/data/books/{safe_segment(book_id_raw)}/images/{filename}"
    else:
        dest = IMAGES_DIR / filename
        url  = f"http://localhost:5678/data/images/{filename}"

    try:
        with open(dest, "wb") as f:
            f.write(img_bytes)
        return jsonify({"ok": True, "url": url, "filename": filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── 静态文件服务 ──────────────────────────────────────────────────────────

@app.route("/data/images/<path:filename>")
def serve_image(filename):
    return send_from_directory(str(IMAGES_DIR), filename)

@app.route("/data/books/<book_id>/images/<path:filename>")
def serve_book_image(book_id, filename):
    img_dir = BOOKS_DIR / safe_segment(book_id) / "images"
    return send_from_directory(str(img_dir), filename)

# Phase 2 缓存：按书缓存 images.json 的 id→url 映射，避免每个 /api/img 请求都重读+解析整份多 MB JSON。
# 以文件 mtime 作失效键：任何保存（atomic_write_json 替换文件）都会改 mtime，下次请求自动重读。
# 非线程安全，但最坏只是并发首请求各解析一次，结果一致、不会出错（同 _realesrgan_lock 思路）。
_img_index_cache = {}   # safe_book -> (mtime, {image_id: url})

def _book_img_url_index(safe_book: str):
    images_json = BOOKS_DIR / safe_book / "images.json"
    try:
        mtime = images_json.stat().st_mtime
    except OSError:
        return None
    cached = _img_index_cache.get(safe_book)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        with open(images_json, encoding="utf-8") as f:
            imgs = json.load(f)
    except Exception:
        return None
    idx = {i.get("id"): (i.get("url") or "")
           for i in imgs if isinstance(i, dict) and i.get("id")}
    _img_index_cache[safe_book] = (mtime, idx)
    return idx


@app.route("/api/img/<path:book_id>/<path:image_id>")
def serve_embedded_image(book_id, image_id):
    """Phase 2：按需把某条记录内嵌的 base64 解码成真实图片返回。
    base64 仍存于 images.json（磁盘真源不动），浏览器据此惰性加载 + 缓存，避免一次性把 52MB 灌进前端。
    id→url 映射经 _book_img_url_index 按 mtime 缓存，避免每请求重读整份 JSON。"""
    idx = _book_img_url_index(safe_segment(book_id))
    if idx is None:
        return jsonify({"error": "book not found"}), 404
    url = idx.get(image_id)
    if url is None:
        return jsonify({"error": "image not found"}), 404
    if not url.startswith("data:"):
        return jsonify({"error": "not embedded"}), 404
    try:
        header, b64 = url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "") or "image/jpeg"
        raw = base64.b64decode(b64)
    except Exception as e:
        return jsonify({"error": f"decode error: {e}"}), 500
    resp = Response(raw, mimetype=mime)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return cors(resp)

# ── 高清页图缓存（pdf.js 渲染结果存盘，避免每次翻页重解码 JPEG2000/JBIG2）──────
# 仅新增 data/books/<id>/pages_hires/pNNNN.jpg；绝不触碰 book.json / images.json /
# 标注数据 / 备份。前端首次打开某页时渲一次高清上传存盘，之后秒取。
def _pages_hires_dir(book_id: str, create: bool = False) -> Path:
    d = BOOKS_DIR / safe_segment(book_id) / "pages_hires"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d

def _page_hires_name(page_num) -> str:
    try:
        n = int(page_num)
    except (TypeError, ValueError):
        return ""
    if n < 1 or n > 99999:
        return ""
    return f"p{n:04d}.jpg"

def _book_pdf_path(book_id: str):
    """定位 PDF；隔离数据目录可只读复用生产 PDF，缓存和审核写入仍留在隔离目录。"""
    roots = [BOOKS_DIR]
    production_books = PRODUCTION_DATA_DIR / "books"
    if production_books.resolve() != BOOKS_DIR.resolve():
        roots.append(production_books)
    for root in roots:
        bdir = root / safe_segment(book_id)
        p = bdir / "book.pdf"
        if p.exists():
            return p
        pdfs = bdir / "pdfs"
        if pdfs.exists():
            cands = sorted(pdfs.glob("*.pdf"))
            if cands:
                return cands[0]
    return None

def _parse_rect(s):
    """'x0,y0,x1,y1' 归一化矩形 → (x0,y0,x1,y1)，非法或过小返回 None。"""
    try:
        parts = [float(v) for v in str(s).split(",")]
    except (ValueError, TypeError):
        return None
    if len(parts) != 4:
        return None
    x0, y0, x1, y1 = (max(0.0, min(1.0, p)) for p in parts)
    if x1 - x0 < 0.01 or y1 - y0 < 0.01:
        return None
    return (x0, y0, x1, y1)

def _parse_rotation_deg(value):
    """Parse a small deskew angle from query params, clamped to -5..5 degrees."""
    try:
        deg = float(value or 0)
    except (ValueError, TypeError):
        deg = 0.0
    deg = max(-5.0, min(5.0, deg))
    if abs(deg) < 0.001:
        return 0.0
    return deg

def _parse_quad(value):
    try:
        parts = [float(v) for v in str(value).split(",")]
    except (ValueError, TypeError):
        return None
    if len(parts) != 8:
        return None
    pts = []
    for i in range(0, 8, 2):
        x = max(0.0, min(1.0, parts[i]))
        y = max(0.0, min(1.0, parts[i + 1]))
        pts.append((x, y))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    if max(xs) - min(xs) < 0.01 or max(ys) - min(ys) < 0.01:
        return None
    return pts

def _quad_bbox(points, page_rect):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    pad = max(max(xs) - min(xs), max(ys) - min(ys)) * 0.03
    return (
        max(page_rect.x0, min(xs) - pad),
        max(page_rect.y0, min(ys) - pad),
        min(page_rect.x1, max(xs) + pad),
        min(page_rect.y1, max(ys) + pad),
    )

def _rotated_bbox(x0, y0, x1, y1, deg, page_rect):
    """Return the axis-aligned bbox containing a CSS-clockwise rotated rectangle."""
    import math
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0
    rad = math.radians(deg)
    cos_v = math.cos(rad)
    sin_v = math.sin(rad)
    pts = []
    for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        dx = x - cx
        dy = y - cy
        pts.append((cx + dx * cos_v - dy * sin_v, cy + dx * sin_v + dy * cos_v))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    pad = max(x1 - x0, y1 - y0) * 0.03
    return (
        max(page_rect.x0, min(xs) - pad),
        max(page_rect.y0, min(ys) - pad),
        min(page_rect.x1, max(xs) + pad),
        min(page_rect.y1, max(ys) + pad),
    )

def _render_format_for_path(fpath: Path, requested: str = None) -> str:
    if requested:
        value = str(requested).strip().upper()
        if value in {"PNG", "JPEG"}:
            return value
    return "PNG" if fpath.suffix.lower() == ".png" else "JPEG"


def _encode_pixmap(pix, image_format: str) -> bytes:
    if image_format == "PNG":
        return pix.tobytes("png")
    return pix.tobytes("jpg", jpg_quality=88)


def _save_image_bytes(image, image_format: str) -> bytes:
    out = io.BytesIO()
    if image_format == "PNG":
        image.save(out, format="PNG", optimize=True)
    else:
        image.convert("RGB").save(out, format="JPEG", quality=88)
    return out.getvalue()


def _render_page_hires(book_id: str, page_num: int, fpath: Path,
                       long_edge: int = 1600, clip_rect=None, rotation_deg: float = 0.0,
                       quad_points=None, image_format: str = None) -> bool:
    """服务端用 PyMuPDF(MuPDF 原生解码器)把某页(或其归一化矩形 clip_rect)渲成高清 JPEG 存盘。
    MuPDF 原生解 JPEG2000/JBIG2，~120ms/页，远快于浏览器 pdf.js(纯 JS，数十秒)。
    clip_rect=(x0,y0,x1,y1) 时只渲该区域(版心/插图裁剪)，省去前端 canvas 裁剪+重编码。"""
    pdf_path = _book_pdf_path(book_id)
    if not pdf_path:
        return False
    try:
        import fitz
        output_format = _render_format_for_path(fpath, image_format)
        doc = fitz.open(str(pdf_path))
        try:
            if page_num < 1 or page_num > doc.page_count:
                return False
            page = doc[page_num - 1]
            r = page.rect
            if quad_points:
                abs_points = [
                    (r.x0 + px * r.width, r.y0 + py * r.height)
                    for px, py in quad_points
                ]
                bx0, by0, bx1, by1 = _quad_bbox(abs_points, r)
                render_rect = fitz.Rect(bx0, by0, bx1, by1)
                def _dist(p1, p2):
                    import math
                    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                top_w = _dist(abs_points[0], abs_points[1])
                bottom_w = _dist(abs_points[3], abs_points[2])
                left_h = _dist(abs_points[0], abs_points[3])
                right_h = _dist(abs_points[1], abs_points[2])
                target_w = max(1.0, (top_w + bottom_w) / 2.0)
                target_h = max(1.0, (left_h + right_h) / 2.0)
                longest = max(target_w, target_h) or 1.0
                scale = max(0.5, min(8.0, long_edge / longest))
                matrix = fitz.Matrix(scale, scale)
                pix = page.get_pixmap(matrix=matrix, clip=render_rect)
                data = _encode_pixmap(pix, output_format)
                from PIL import Image
                img = Image.open(io.BytesIO(data)).convert("RGB")
                local_points = []
                for x, y in abs_points:
                    local_points.extend([
                        (x - render_rect.x0) * scale,
                        (y - render_rect.y0) * scale,
                    ])
                out_w = max(1, int(round(target_w * scale)))
                out_h = max(1, int(round(target_h * scale)))
                rectified = img.transform(
                    (out_w, out_h),
                    Image.Transform.QUAD,
                    (
                        local_points[0], local_points[1],
                        local_points[6], local_points[7],
                        local_points[4], local_points[5],
                        local_points[2], local_points[3],
                    ),
                    resample=Image.Resampling.BICUBIC,
                    fillcolor=(255, 255, 255),
                )
                data = _save_image_bytes(rectified, output_format)
            elif clip_rect:
                cx0 = r.x0 + clip_rect[0] * r.width
                cy0 = r.y0 + clip_rect[1] * r.height
                cx1 = r.x0 + clip_rect[2] * r.width
                cy1 = r.y0 + clip_rect[3] * r.height
                selected = fitz.Rect(cx0, cy0, cx1, cy1)
                render_rect = selected
                if rotation_deg:
                    bx0, by0, bx1, by1 = _rotated_bbox(cx0, cy0, cx1, cy1, rotation_deg, r)
                    render_rect = fitz.Rect(bx0, by0, bx1, by1)
                longest = max(selected.width, selected.height) or 1.0
                scale = max(0.5, min(8.0, long_edge / longest))
                matrix = fitz.Matrix(scale, scale)
                pix = page.get_pixmap(matrix=matrix, clip=render_rect)
                data = _encode_pixmap(pix, output_format)
                if rotation_deg:
                    from PIL import Image
                    img = Image.open(io.BytesIO(data)).convert("RGB")
                    local_center = (
                        (selected.x0 + selected.width / 2.0 - render_rect.x0) * scale,
                        (selected.y0 + selected.height / 2.0 - render_rect.y0) * scale,
                    )
                    fill = (255, 255, 255)
                    # UI positive angles are clockwise; Pillow positive angles are counter-clockwise.
                    corrected = img.rotate(rotation_deg, resample=Image.Resampling.BICUBIC, center=local_center, expand=False, fillcolor=fill)
                    crop_box = (
                        int(round((selected.x0 - render_rect.x0) * scale)),
                        int(round((selected.y0 - render_rect.y0) * scale)),
                        int(round((selected.x1 - render_rect.x0) * scale)),
                        int(round((selected.y1 - render_rect.y0) * scale)),
                    )
                    img = corrected.crop(crop_box)
                    data = _save_image_bytes(img, output_format)
            else:
                longest = max(r.width, r.height) or 1.0
                scale = max(0.5, min(6.0, long_edge / longest))
                matrix = fitz.Matrix(scale, scale)
                pix = page.get_pixmap(matrix=matrix)
                data = _encode_pixmap(pix, output_format)
        finally:
            doc.close()
        fpath.parent.mkdir(parents=True, exist_ok=True)
        tmp = fpath.with_suffix(fpath.suffix + ".tmp")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(str(tmp), str(fpath))
        return True
    except Exception as e:
        print(f"[page-hires] render failed book={book_id} page={page_num}: {e}", flush=True)
        return False

# 注：删除页面后 pageNum(显示) 与 pdfPageNum(物理) 分离。约定：本端点 URL 一律收
# PDF 物理页码（前端经 pdfPageOf() 换算，lighten URL 由 _page_image_url 用 pdfPageNum
# 构建），渲染与 pages_hires 缓存文件名天然按物理页，删除页前后缓存均有效。
@app.route("/api/page-image/<book_id>/<int:page_num>", methods=["GET", "POST", "OPTIONS"])
def page_hires_image(book_id, page_num):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    name = _page_hires_name(page_num)
    if not name:
        return jsonify({"error": "bad page number"}), 400
    d = _pages_hires_dir(book_id, create=True)
    fpath = d / name
    if request.method == "POST":
        up = request.files.get("file")
        if up is not None:
            up.save(str(fpath))
        else:
            raw = request.get_data() or b""
            if not raw:
                return jsonify({"error": "no image data"}), 400
            with open(fpath, "wb") as f:
                f.write(raw)
        return cors(jsonify({"ok": True, "page": page_num, "size": fpath.stat().st_size}))
    # GET：缓存命中直接出图；未命中则服务端 PyMuPDF 现场渲染(~120ms)→存盘→出图
    # 带 rect 参数时服务端直接裁渲该区域(版心/插图)，前端无需 canvas 裁剪，和整页一样快。
    rect_param = (request.args.get("rect") or "").strip()
    quad_param = (request.args.get("quad") or "").strip()
    rotation_deg = _parse_rotation_deg(request.args.get("rot"))
    if rect_param or quad_param:
        clip = _parse_rect(rect_param)
        quad = _parse_quad(quad_param)
        if rect_param and not clip:
            return jsonify({"error": "bad rect"}), 400
        if quad_param and not quad:
            return jsonify({"error": "bad quad"}), 400
        try:
            long_edge = int((request.args.get("w") or "1200").strip())
        except ValueError:
            long_edge = 1200
        long_edge = max(120, min(2400, long_edge))
        import hashlib
        key = ""
        if quad:
            key = ",".join(f"{p[0]:.4f},{p[1]:.4f}" for p in quad) + f"|{long_edge}"
        else:
            key = "%.4f,%.4f,%.4f,%.4f|%d|%.2f" % (clip[0], clip[1], clip[2], clip[3], long_edge, rotation_deg)
        rh = hashlib.md5(key.encode()).hexdigest()[:10]
        cname = f"p{page_num:04d}_{rh}.jpg"
        cpath = d / cname
        if not cpath.exists():
            raster_book = _book_pdf_path(book_id) is None and fpath.exists()
            rendered = (
                render_cached_page_crop(
                    fpath,
                    cpath,
                    long_edge=long_edge,
                    clip_rect=clip,
                    rotation_deg=rotation_deg,
                    quad_points=quad,
                )
                if raster_book
                else _render_page_hires(
                    book_id,
                    page_num,
                    cpath,
                    long_edge=long_edge,
                    clip_rect=clip,
                    rotation_deg=rotation_deg,
                    quad_points=quad,
                )
            )
            if not rendered:
                return jsonify({"error": "render failed (no pdf or page out of range)"}), 404
        resp = send_from_directory(str(d), cname)
        resp.headers["Cache-Control"] = "public, max-age=86400"
        return cors(resp)
    if not fpath.exists():
        if not _render_page_hires(book_id, page_num, fpath):
            return jsonify({"error": "render failed (no pdf or page out of range)"}), 404
    resp = send_from_directory(str(d), name)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return cors(resp)

@app.route("/api/page-image/<book_id>", methods=["GET", "OPTIONS"])
def page_hires_list(book_id):
    """列出该书已缓存高清页图的页码集合，供前端判断哪些页已就绪。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    d = _pages_hires_dir(book_id, create=False)
    pages = []
    if d.exists():
        for f in d.iterdir():
            m = re.match(r"^p(\d+)\.jpg$", f.name)
            if m:
                pages.append(int(m.group(1)))
    pages.sort()
    return cors(jsonify({"ok": True, "pages": pages}))


# ── P-Asset Bridge V1：权威插图源素材导出 ────────────────────────────────
_ASSET_ANNOTATION_FIELDS = (
    "illustrationName",
    "subject",
    "visualDescription",
    "academicClass",
    "academicSubclass",
    "correspondingText",
    "textEvidenceExcerpt",
    "uncertaintyNote",
    "confidence",
    "aiVerdict",
)


class AssetSourceError(Exception):
    def __init__(self, message, *, code="ASSET_SOURCE_INVALID", status=422):
        super().__init__(message)
        self.code = code
        self.status = status


def _asset_root_required() -> Path:
    if ASSET_ROOT is None:
        raise AssetSourceError(
            "素材根目录未配置；请设置 TCM_ILLUSTRATION_ASSET_ROOT 后重启标注系统。",
            code="ASSET_ROOT_NOT_CONFIGURED",
            status=503,
        )
    root = ASSET_ROOT.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _asset_relative(path: Path, root: Path) -> str:
    """Return a package-relative POSIX path and reject accidental root escapes."""
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise AssetSourceError("素材路径越出配置根目录。", code="ASSET_PATH_ESCAPE", status=400) from exc
    return relative.as_posix()


def _canonical_json_bytes(payload) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_bytes_atomic(path: Path, payload: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex}.tmp")
    tmp.write_bytes(payload)
    os.replace(str(tmp), str(path))


def _book_source_code(book: dict) -> str:
    explicit = str(book.get("code") or "").strip()
    if explicit:
        return safe_segment(explicit)
    return _book_code_from_title(book.get("title") or book.get("id") or "")


def _stable_source_id(record: dict, book: dict) -> str:
    """Python port of app.js `_showcaseId`; this is the sole asset source ID rule."""
    src = record.get("pdfSource") or {}
    try:
        page_num = int(src.get("pageNum") or 0)
    except (TypeError, ValueError):
        page_num = 0
    if page_num < 1:
        raise AssetSourceError("插图记录缺少有效页码。")
    try:
        crop_index = int(record.get("figureIndex") or record.get("subIndex") or 0)
    except (TypeError, ValueError):
        crop_index = 0
    is_figure = bool(
        record.get("isSplitIllustration")
        or record.get("isSubRecord")
        or record.get("parentId")
        or crop_index > 0
    )
    suffix = f"_i{crop_index:02d}" if is_figure and crop_index > 0 else ""
    return f"{_book_source_code(book)}_p{page_num:04d}{suffix}"


def _load_asset_export_record(record_id: str):
    matches = []
    if not record_id:
        raise AssetSourceError("缺少 record_id。", status=400)
    for book_dir in sorted(BOOKS_DIR.iterdir()) if BOOKS_DIR.exists() else []:
        if not book_dir.is_dir():
            continue
        images_path = book_dir / "images.json"
        book_path = book_dir / "book.json"
        if not images_path.exists() or not book_path.exists():
            continue
        try:
            payload = json.loads(images_path.read_text(encoding="utf-8"))
            images = payload.get("images", []) if isinstance(payload, dict) else payload
            for record in images if isinstance(images, list) else []:
                if isinstance(record, dict) and record.get("id") == record_id:
                    matches.append((record, json.loads(book_path.read_text(encoding="utf-8"))))
        except (OSError, ValueError, TypeError):
            continue
    if not matches:
        raise AssetSourceError(
            f"未找到插图记录：{record_id}",
            code="ASSET_RECORD_NOT_FOUND",
            status=404,
        )
    if len(matches) > 1:
        raise AssetSourceError(
            f"插图记录 ID 不唯一：{record_id}",
            code="ASSET_RECORD_ID_CONFLICT",
            status=409,
        )
    return matches[0]


def _physical_pdf_page(book: dict, display_page_num: int) -> int:
    for page in book.get("pages") or []:
        try:
            if int(page.get("pageNum")) != int(display_page_num):
                continue
            return int(page.get("pdfPageNum") or page.get("pageNum"))
        except (TypeError, ValueError):
            continue
    return int(display_page_num)


def _native_pdf_render_metrics(book_id: str, page_num: int) -> dict:
    pdf_path = _book_pdf_path(book_id)
    if not pdf_path:
        raise AssetSourceError("找不到权威 PDF。", code="ASSET_SOURCE_PDF_MISSING", status=404)
    try:
        import fitz
        doc = fitz.open(str(pdf_path))
        try:
            if page_num < 1 or page_num > doc.page_count:
                raise AssetSourceError("PDF 物理页码越界。", code="ASSET_SOURCE_PAGE_MISSING", status=404)
            page = doc[page_num - 1]
            page_width = float(page.rect.width)
            page_height = float(page.rect.height)
            scale_candidates = []
            embedded = []
            for image_info in page.get_images(full=True):
                try:
                    pix = fitz.Pixmap(doc, image_info[0])
                    embedded.append((int(pix.width), int(pix.height)))
                    scale_candidates.extend([
                        pix.width / max(page_width, 1.0),
                        pix.height / max(page_height, 1.0),
                    ])
                except Exception:
                    continue
            render_scale = max(scale_candidates) if scale_candidates else 2.0
            render_scale = max(1.0, min(8.0, render_scale))
            return {
                "pdf_path": pdf_path,
                "page_width_points": page_width,
                "page_height_points": page_height,
                "render_scale": render_scale,
                "render_dpi": round(72.0 * render_scale, 2),
                "native_long_edge": max(1, int(round(max(page_width, page_height) * render_scale))),
                "embedded_images": embedded,
            }
        finally:
            doc.close()
    except AssetSourceError:
        raise
    except Exception as exc:
        raise AssetSourceError(
            f"读取权威 PDF 失败：{exc}",
            code="ASSET_SOURCE_PDF_INVALID",
            status=422,
        ) from exc


def _asset_crop_spec(record: dict) -> dict:
    src = record.get("pdfSource") or {}
    quad = src.get("cropQuad") or src.get("annotateQuad")
    rect = src.get("cropRect") or src.get("annotateRect")
    quad_values = []
    if isinstance(quad, (list, tuple)):
        for point in quad:
            if isinstance(point, (list, tuple)):
                quad_values.extend(point)
            else:
                quad_values.append(point)
    parsed_quad = _parse_quad(",".join(str(v) for v in quad_values)) if quad_values else None
    parsed_rect = _parse_rect(",".join(str(v) for v in rect)) if rect else None
    rotation_deg = _parse_rotation_deg(src.get("rotationDeg") or 0)
    if parsed_quad:
        return {
            "type": "quad",
            "normalized_quad": [[round(x, 15), round(y, 15)] for x, y in parsed_quad],
            "rotation_deg": 0.0,
            "_quad": parsed_quad,
            "_rect": None,
        }
    if parsed_rect:
        return {
            "type": "rect",
            "normalized_rect": [round(value, 15) for value in parsed_rect],
            "rotation_deg": rotation_deg,
            "_quad": None,
            "_rect": parsed_rect,
        }
    raise AssetSourceError(
        "当前记录没有有效 cropRect/cropQuad，不能把整页缓存冒充正式插图源。",
        code="ASSET_CROP_MISSING",
        status=422,
    )


def _asset_crop_render_long_edge(crop: dict, metrics: dict) -> int:
    page_width = metrics["page_width_points"]
    page_height = metrics["page_height_points"]
    scale = metrics["render_scale"]
    if crop.get("_quad"):
        import math
        points = [(x * page_width, y * page_height) for x, y in crop["_quad"]]
        top = math.dist(points[0], points[1])
        bottom = math.dist(points[3], points[2])
        left = math.dist(points[0], points[3])
        right = math.dist(points[1], points[2])
        longest = max((top + bottom) / 2.0, (left + right) / 2.0)
    else:
        x0, y0, x1, y1 = crop["_rect"]
        longest = max((x1 - x0) * page_width, (y1 - y0) * page_height)
    return max(1, int(round(longest * scale)))


def _asset_annotation_snapshot(record: dict) -> dict:
    annotation = record.get("annotation") if isinstance(record.get("annotation"), dict) else {}
    return {field: annotation.get(field) for field in _ASSET_ANNOTATION_FIELDS}


def _asset_annotation_revision(record: dict, book: dict, crop_public: dict, annotation: dict) -> str:
    context = record.get("versionContext") if isinstance(record.get("versionContext"), dict) else {}
    payload = {
        "record_id": record.get("id"),
        "canonical_id": record.get("canonicalId"),
        "book_id": book.get("id") or (record.get("pdfSource") or {}).get("bookId"),
        "dataset_id": context.get("datasetId") or DATA_SOURCE_ID,
        "review_status": record.get("status"),
        "crop": crop_public,
        "annotation": annotation,
        "version_context": {
            "schemaVersion": context.get("schemaVersion"),
            "classificationVersion": context.get("classificationVersion"),
            "promptVersion": context.get("promptVersion"),
            "createdAt": context.get("createdAt"),
        },
    }
    return _sha256_bytes(_canonical_json_bytes(payload))


def _make_asset_previews(source_path: Path, preview_path: Path):
    from PIL import Image
    with Image.open(source_path) as image:
        preview = image.convert("RGB")
        preview.thumbnail((900, 900), Image.Resampling.LANCZOS)
        preview.save(preview_path, format="WEBP", quality=86, method=6)


def _update_asset_source_index(root: Path, manifest: dict, package_dir: Path):
    index_path = root / "manifests" / "source-index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            index = {}
    else:
        index = {}
    if not isinstance(index, dict):
        index = {}
    index["schema_version"] = "asset-source-index-v1"
    sources = index.setdefault("sources", {})
    source = sources.setdefault(manifest["source_id"], {
        "record_id": manifest["record_id"],
        "canonical_id": manifest.get("canonical_id"),
        "revisions": [],
    })
    package_path = _asset_relative(package_dir, root)
    revision_entry = {
        "source_revision": manifest["source_revision"],
        "package_path": package_path,
        "source_sha256": manifest["source_sha256"],
        "annotation_revision": manifest["annotation_revision"],
        "review_status": manifest["review_status"],
        "provisional": manifest["provisional"],
        "updated_at": manifest["exported_at"],
    }
    revisions = source.setdefault("revisions", [])
    existing = next((item for item in revisions
                     if item.get("source_revision") == manifest["source_revision"]), None)
    if existing == revision_entry and source.get("latest_revision") == manifest["source_revision"]:
        return
    if existing:
        existing.clear()
        existing.update(revision_entry)
    else:
        revisions.append(revision_entry)
    source["record_id"] = manifest["record_id"]
    source["canonical_id"] = manifest.get("canonical_id")
    source["latest_revision"] = manifest["source_revision"]
    source["updated_at"] = manifest["exported_at"]
    index["updated_at"] = manifest["exported_at"]
    atomic_write_json(index_path, index)


def _export_asset_source(record: dict, book: dict, *, allow_provisional: bool = False) -> dict:
    if record.get("mergedInto"):
        raise AssetSourceError(
            "该记录已并入合并图，请导出合并后的主记录。",
            code="ASSET_RECORD_MERGED",
            status=409,
        )
    review_status = str(record.get("status") or "").strip()
    provisional = review_status != "ok"
    if provisional and not allow_provisional:
        raise AssetSourceError(
            f"记录 {record.get('id')} 尚未审核确认（status={review_status or 'missing'}）。",
            code="ASSET_REVIEW_REQUIRED",
            status=409,
        )
    root = _asset_root_required()
    source_id = _stable_source_id(record, book)
    crop = _asset_crop_spec(record)
    crop_public = {key: value for key, value in crop.items() if not key.startswith("_")}
    annotation = _asset_annotation_snapshot(record)
    annotation_revision = _asset_annotation_revision(record, book, crop_public, annotation)
    src = record.get("pdfSource") or {}
    book_id = str(src.get("bookId") or book.get("id") or "").strip()
    try:
        display_page_num = int(src.get("pageNum"))
    except (TypeError, ValueError) as exc:
        raise AssetSourceError("记录缺少可用的页码，无法从原始 PDF 导出裁图。") from exc
    pdf_page_num = _physical_pdf_page(book, display_page_num)
    metrics = _native_pdf_render_metrics(book_id, pdf_page_num)

    source_parent = root / "_sources" / safe_segment(source_id)
    staging = source_parent / f".tmp_{uuid.uuid4().hex}"
    staging.mkdir(parents=True, exist_ok=False)
    try:
        source_path = staging / "source.png"
        ok = _render_page_hires(
            book_id,
            pdf_page_num,
            source_path,
            long_edge=_asset_crop_render_long_edge(crop, metrics),
            clip_rect=crop.get("_rect"),
            rotation_deg=crop_public.get("rotation_deg", 0.0),
            quad_points=crop.get("_quad"),
            image_format="PNG",
        )
        if not ok:
            raise AssetSourceError("正式裁图渲染失败。", code="ASSET_SOURCE_RENDER_FAILED", status=422)
        source_sha256 = _sha256_file(source_path)
        source_revision = "rev_" + _sha256_bytes(
            f"{source_sha256}:{annotation_revision}".encode("utf-8")
        )[:16]
        package_dir = source_parent / source_revision

        if package_dir.exists():
            manifest_path = package_dir / "manifest.json"
            if not manifest_path.exists():
                raise AssetSourceError(
                    "同版本素材目录不完整，请人工检查后重试。",
                    code="ASSET_PACKAGE_INCOMPLETE",
                    status=409,
                )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (manifest.get("source_sha256") != source_sha256
                    or manifest.get("annotation_revision") != annotation_revision):
                raise AssetSourceError(
                    "同版本目录哈希冲突，请人工检查。",
                    code="ASSET_REVISION_CONFLICT",
                    status=409,
                )
            _update_asset_source_index(root, manifest, package_dir)
            return {
                "source_id": source_id,
                "source_revision": source_revision,
                "package_path": _asset_relative(package_dir, root),
                "source_path": _asset_relative(package_dir / "source.png", root),
                "source_sha256": source_sha256,
                "width": manifest.get("image", {}).get("width"),
                "height": manifest.get("image", {}).get("height"),
                "provisional": manifest.get("provisional", False),
                "idempotent": True,
            }

        from PIL import Image
        with Image.open(source_path) as source_image:
            width, height = source_image.size
        _make_asset_previews(source_path, staging / "preview.webp")
        if not _render_page_hires(
            book_id,
            pdf_page_num,
            staging / "context-page.jpg",
            long_edge=metrics["native_long_edge"],
            image_format="JPEG",
        ):
            raise AssetSourceError("上下文整页渲染失败。", code="ASSET_CONTEXT_RENDER_FAILED", status=422)
        atomic_write_json(staging / "annotation.json", annotation)

        exported_at = datetime.now().astimezone().isoformat(timespec="seconds")
        manifest = {
            "schema_version": "asset-source-v1",
            "source_id": source_id,
            "source_revision": source_revision,
            "record_id": record.get("id"),
            "canonical_id": record.get("canonicalId"),
            "book_id": book_id,
            "book_title": book.get("title") or src.get("bookTitle") or "",
            "page_num": display_page_num,
            "pdf_page_num": pdf_page_num,
            "crop_index": int(record.get("figureIndex") or record.get("subIndex") or 1),
            "dataset_id": (record.get("versionContext") or {}).get("datasetId") or DATA_SOURCE_ID,
            "review_status": review_status,
            "provisional": provisional,
            "crop": crop_public,
            "image": {
                "width": width,
                "height": height,
                "format": "png",
                "render_scale": round(metrics["render_scale"], 6),
                "render_dpi": metrics["render_dpi"],
                "source": "authoritative_pdf",
            },
            "files": {
                "source": "source.png",
                "preview": "preview.webp",
                "context_page": "context-page.jpg",
                "annotation": "annotation.json",
            },
            "source_sha256": source_sha256,
            "annotation_revision": annotation_revision,
            "exported_at": exported_at,
        }
        atomic_write_json(staging / "manifest.json", manifest)
        package_dir.parent.mkdir(parents=True, exist_ok=True)
        os.replace(str(staging), str(package_dir))
        _update_asset_source_index(root, manifest, package_dir)
        return {
            "source_id": source_id,
            "source_revision": source_revision,
            "package_path": _asset_relative(package_dir, root),
            "source_path": _asset_relative(package_dir / "source.png", root),
            "source_sha256": source_sha256,
            "width": width,
            "height": height,
            "provisional": provisional,
            "idempotent": False,
        }
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


@app.route("/api/asset-sources/export", methods=["POST", "OPTIONS"])
def export_asset_sources():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body = request.get_json(force=True, silent=True) or {}
    record_ids = body.get("record_ids")
    if record_ids is None and body.get("record_id"):
        record_ids = [body.get("record_id")]
    if not isinstance(record_ids, list) or not record_ids:
        return jsonify({"ok": False, "code": "ASSET_RECORD_IDS_REQUIRED", "error": "请选择至少一张插图。"}), 400
    normalized_ids = []
    for value in record_ids:
        record_id = str(value or "").strip()
        if record_id and record_id not in normalized_ids:
            normalized_ids.append(record_id)
    if not normalized_ids:
        return jsonify({"ok": False, "code": "ASSET_RECORD_IDS_REQUIRED", "error": "请选择至少一张插图。"}), 400
    try:
        prepared = [_load_asset_export_record(record_id) for record_id in normalized_ids]
        allow_provisional = body.get("allow_provisional") is True
        if not allow_provisional:
            pending = [record.get("id") for record, _book in prepared if record.get("status") != "ok"]
            if pending:
                raise AssetSourceError(
                    "以下插图尚未审核确认：" + "、".join(pending),
                    code="ASSET_REVIEW_REQUIRED",
                    status=409,
                )
        results = [
            _export_asset_source(record, book, allow_provisional=allow_provisional)
            for record, book in prepared
        ]
        return cors(jsonify({"ok": True, "count": len(results), "sources": results}))
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status
    except Exception as exc:
        print(f"[asset-source] export failed: {exc}", flush=True)
        return cors(jsonify({
            "ok": False,
            "code": "ASSET_SOURCE_EXPORT_FAILED",
            "error": f"素材源导出失败：{exc}",
        })), 500


@app.route("/api/asset-sources", methods=["GET", "OPTIONS"])
def list_asset_sources():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        root = _asset_root_required()
        index_path = root / "manifests" / "source-index.json"
        index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {
            "schema_version": "asset-source-index-v1",
            "sources": {},
        }
        # 给素材台一次性返回目录摘要，避免前端为了判断“是否有素材”而
        # 对每一张插图逐个请求 asset-packages（目录较大时会造成明显刷新）。
        # 摘要只读派生索引，不写回源图或标注记录。
        enriched = deepcopy(index)
        links = _load_asset_links()
        linked_sources = links.get("sources", {}) if isinstance(links, dict) else {}
        with_layers = 0
        for source_id, entry in (enriched.get("sources", {}) or {}).items():
            linked = linked_sources.get(source_id, {}) if isinstance(linked_sources, dict) else {}
            packages = linked.get("packages", []) if isinstance(linked, dict) else []
            if not isinstance(packages, list):
                packages = []
            valid_packages = [item for item in packages if isinstance(item, dict) and item.get("package_id")]
            layer_count = sum(
                len(item.get("layers", []))
                for item in valid_packages
                if isinstance(item.get("layers", []), list)
            )
            has_restoration = any(
                isinstance(item.get("files"), dict) and item["files"].get("production_reference")
                for item in valid_packages
            )
            entry["package_count"] = len(valid_packages)
            entry["layer_count"] = layer_count
            entry["has_layer_package"] = bool(valid_packages)
            entry["has_restoration_reference"] = has_restoration
            if valid_packages:
                with_layers += 1
        enriched["summary"] = {
            "source_count": len(enriched.get("sources", {}) or {}),
            "with_layer_packages": with_layers,
        }
        return cors(jsonify({"ok": True, "index": enriched}))
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status


# ── P-Asset Bridge V1：分层素材包扫描与独立审查（Phase 2）───────────────
# 图层包及其审查状态是派生素材数据：只写 DATA_DIR/asset-links.json，绝不写回
# images.json 的 annotation、aiDraft、reviewDiff 或插图 status。
_ASSET_LINKS_SCHEMA = "asset-links-v1"
_LAYER_PACKAGE_SCHEMA = "layer-package-v1"
_LAYER_DERIVATION_TYPES = {
    "original_crop",
    "restored_original",
    "ai_regenerated_layer",
    "manual_redraw",
    "artistic_generation",
}
_LAYER_ASSET_TYPES = {
    "character",
    "prop",
    "environment",
    "architecture",
    "inscription",
    # 兼容在早期生产中仍未拆成原子对象的画面片段；新包应优先使用前四类。
    "scene_fragment",
}
_LAYER_FIT_MODES = {"contain", "cover", "fill"}
_LAYER_ANCHOR_KINDS = {"center", "bottom_center", "top_center", "left_center", "right_center", "custom"}
_PACKAGE_DERIVATION_TYPES = _LAYER_DERIVATION_TYPES | {"ai_regenerated_layers"}
_ASSET_REVIEW_STATUSES = {"pending", "approved", "needs_revision", "rejected", "stale"}
_ASSET_REVIEWABLE_STATUSES = {"approved", "needs_revision", "rejected"}
_ASSET_FILE_SUFFIXES = {".png", ".webp", ".jpg", ".jpeg", ".json"}


def _asset_links_path() -> Path:
    return DATA_DIR / "asset-links.json"


def _load_asset_links() -> dict:
    path = _asset_links_path()
    if not path.exists():
        return {"schema_version": _ASSET_LINKS_SCHEMA, "sources": {}, "updated_at": None}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise AssetSourceError(
            "素材审查索引无法读取；请先修复 asset-links.json。",
            code="ASSET_LINKS_INVALID",
            status=500,
        ) from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("sources", {}), dict):
        raise AssetSourceError(
            "素材审查索引结构无效。",
            code="ASSET_LINKS_INVALID",
            status=500,
        )
    payload["schema_version"] = _ASSET_LINKS_SCHEMA
    payload.setdefault("sources", {})
    payload.setdefault("updated_at", None)
    return payload


def _save_asset_links(payload: dict):
    payload["schema_version"] = _ASSET_LINKS_SCHEMA
    payload["updated_at"] = datetime.now().astimezone().isoformat()
    atomic_write_json(_asset_links_path(), payload)


def _list_asset_stale_packages() -> list:
    """列出 asset-links.json 中 status=stale 的素材包（任务书 §8）。

    返回 [(source_id, package_id), ...]。asset-links.json 缺失或不可解析时返回空列表，
    不抛异常——stale 统计用于总览与健康检查，应容错。
    """
    try:
        links = _load_asset_links()
    except Exception:
        return []
    out = []
    for sid, src in links.get("sources", {}).items():
        if not isinstance(src, dict):
            continue
        for pkg in src.get("packages", []) or []:
            if isinstance(pkg, dict) and pkg.get("status") == "stale":
                out.append((str(sid), str(pkg.get("package_id") or pkg.get("id") or "")))
    return out


def _asset_safe_relative_path(relative_path, scope: Path, *, label: str) -> Path:
    """Resolve a package path while rejecting absolute paths and traversal explicitly."""
    raw = str(relative_path or "").strip().replace("\\", "/")
    pure = PurePosixPath(raw)
    if not raw or pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise AssetSourceError(f"{label} 必须是包内相对路径。", code="ASSET_PATH_ESCAPE")
    # Windows 驱动器名会被视为普通 path part，单独拒绝，防止 C:/... 形式混入 manifest。
    if ":" in raw.split("/", 1)[0]:
        raise AssetSourceError(f"{label} 不得使用绝对路径。", code="ASSET_PATH_ESCAPE")
    candidate = (scope / Path(*pure.parts)).resolve()
    try:
        candidate.relative_to(scope.resolve())
    except ValueError as exc:
        raise AssetSourceError(f"{label} 越出允许目录。", code="ASSET_PATH_ESCAPE") from exc
    return candidate


def _asset_root_relative(path: Path, root: Path) -> str:
    return _asset_relative(path, root)


def _read_asset_source_index(root: Path) -> dict:
    path = root / "manifests" / "source-index.json"
    if not path.exists():
        return {"schema_version": "asset-source-index-v1", "sources": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise AssetSourceError("素材源索引无法读取。", code="ASSET_SOURCE_INDEX_INVALID", status=500) from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("sources"), dict):
        raise AssetSourceError("素材源索引结构无效。", code="ASSET_SOURCE_INDEX_INVALID", status=500)
    return payload


def _latest_asset_source_manifest(root: Path, source_id: str) -> dict:
    index = _read_asset_source_index(root)
    source_entry = index.get("sources", {}).get(source_id)
    if not isinstance(source_entry, dict):
        raise AssetSourceError(
            f"未找到素材源 {source_id}；请先从标注系统导出正式 source.png。",
            code="ASSET_SOURCE_NOT_FOUND",
            status=404,
        )
    revision = str(source_entry.get("latest_revision") or "").strip()
    revisions = source_entry.get("revisions") if isinstance(source_entry.get("revisions"), list) else []
    revision_entry = next((item for item in revisions if isinstance(item, dict) and item.get("source_revision") == revision), None)
    if not revision_entry or not revision_entry.get("package_path"):
        raise AssetSourceError("素材源索引缺少最新版本路径。", code="ASSET_SOURCE_INDEX_INVALID", status=500)
    package_dir = _asset_safe_relative_path(revision_entry["package_path"], root, label="素材源包路径")
    manifest_path = package_dir / "manifest.json"
    if not manifest_path.is_file():
        raise AssetSourceError("素材源 manifest.json 不存在。", code="ASSET_SOURCE_MISSING", status=404)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise AssetSourceError("素材源 manifest.json 无法读取。", code="ASSET_SOURCE_INVALID", status=500) from exc
    if manifest.get("schema_version") != "asset-source-v1" or manifest.get("source_id") != source_id:
        raise AssetSourceError("素材源 manifest 身份不匹配。", code="ASSET_SOURCE_INVALID", status=422)
    source_file = _asset_safe_relative_path((manifest.get("files") or {}).get("source"), package_dir, label="source.png 路径")
    if not source_file.is_file():
        raise AssetSourceError("素材源 source.png 不存在。", code="ASSET_SOURCE_MISSING", status=404)
    return {
        "entry": source_entry,
        "manifest": manifest,
        "package_dir": package_dir,
        "manifest_path": manifest_path,
    }


def _current_asset_source_state(root: Path, source_id: str) -> dict:
    """Compare a package against both the latest exported source and current record metadata."""
    latest = _latest_asset_source_manifest(root, source_id)
    manifest = latest["manifest"]
    record, book = _load_asset_export_record(manifest.get("record_id"))
    computed_id = _stable_source_id(record, book)
    if computed_id != source_id:
        raise AssetSourceError(
            "素材源对应插图的稳定编号已变化，不能继续关联旧包。",
            code="ASSET_SOURCE_ID_CHANGED",
            status=409,
        )
    crop = _asset_crop_spec(record)
    crop_public = {key: value for key, value in crop.items() if not key.startswith("_")}
    current_annotation_revision = _asset_annotation_revision(
        record,
        book,
        crop_public,
        _asset_annotation_snapshot(record),
    )
    return {
        "source_id": source_id,
        "record_id": record.get("id"),
        "canonical_id": record.get("canonicalId"),
        "latest_source_manifest": manifest,
        "source_package_dir": latest["package_dir"],
        "source_sha256": manifest.get("source_sha256"),
        "annotation_revision": current_annotation_revision,
        "source_annotation_revision": manifest.get("annotation_revision"),
        "source_file": _asset_safe_relative_path((manifest.get("files") or {}).get("source"), latest["package_dir"], label="source.png 路径"),
        "preview_file": _asset_safe_relative_path((manifest.get("files") or {}).get("preview"), latest["package_dir"], label="素材源预览路径"),
        "source_package_path": _asset_root_relative(latest["package_dir"], root),
    }


def _image_file_info(path: Path, *, label: str) -> dict:
    try:
        from PIL import Image
        with Image.open(path) as image:
            image.load()
            width, height, mode = image.width, image.height, image.mode
    except Exception as exc:
        raise AssetSourceError(f"{label} 不是可读取的图像文件。", code="LAYER_IMAGE_INVALID") from exc
    if width <= 0 or height <= 0:
        raise AssetSourceError(f"{label} 宽高无效。", code="LAYER_IMAGE_INVALID")
    return {"width": width, "height": height, "mode": mode, "has_alpha": "A" in mode or mode == "P"}


def _number(value, *, label: str, minimum=None):
    if isinstance(value, bool):
        raise AssetSourceError(f"{label} 必须是数字。", code="LAYER_PACKAGE_INVALID")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise AssetSourceError(f"{label} 必须是数字。", code="LAYER_PACKAGE_INVALID") from exc
    if minimum is not None and number < minimum:
        raise AssetSourceError(f"{label} 不得小于 {minimum}。", code="LAYER_PACKAGE_INVALID")
    return number


def _validate_layer_package(root: Path, source_dir: Path, package_dir: Path) -> dict:
    manifest_path = package_dir / "layer-package.json"
    if not manifest_path.is_file():
        raise AssetSourceError("缺少 layer-package.json。", code="LAYER_MANIFEST_MISSING")
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise AssetSourceError("layer-package.json 无法读取。", code="LAYER_MANIFEST_INVALID") from exc
    if not isinstance(raw, dict) or raw.get("schema_version") != _LAYER_PACKAGE_SCHEMA:
        raise AssetSourceError("layer-package.json 的 schema_version 必须是 layer-package-v1。", code="LAYER_MANIFEST_INVALID")
    source = raw.get("source") if isinstance(raw.get("source"), dict) else None
    derivation = raw.get("derivation") if isinstance(raw.get("derivation"), dict) else None
    canvas = raw.get("canvas") if isinstance(raw.get("canvas"), dict) else None
    files = raw.get("files") if isinstance(raw.get("files"), dict) else None
    layers = raw.get("layers") if isinstance(raw.get("layers"), list) else None
    package_id = str(raw.get("package_id") or "").strip()
    source_id = str(source.get("source_id") if source else "").strip()
    if not package_id or safe_segment(package_id) != package_id or package_id != package_dir.name:
        raise AssetSourceError("package_id 必须与包目录同名，且只能使用安全字符。", code="LAYER_MANIFEST_INVALID")
    if not source_id or safe_segment(source_id) != source_id or source_id != source_dir.name:
        raise AssetSourceError("source.source_id 必须与来源目录同名，且只能使用安全字符。", code="LAYER_MANIFEST_INVALID")
    if not derivation or derivation.get("type") not in _PACKAGE_DERIVATION_TYPES:
        raise AssetSourceError("derivation.type 不在允许的来源类型中。", code="LAYER_MANIFEST_INVALID")
    if not canvas:
        raise AssetSourceError("缺少 canvas。", code="LAYER_MANIFEST_INVALID")
    canvas_width = int(_number(canvas.get("width"), label="canvas.width", minimum=1))
    canvas_height = int(_number(canvas.get("height"), label="canvas.height", minimum=1))
    if not files:
        raise AssetSourceError("缺少 files。", code="LAYER_MANIFEST_INVALID")
    composite_path = _asset_safe_relative_path(files.get("composite_preview"), package_dir, label="组合预览路径")
    contact_path = _asset_safe_relative_path(files.get("contact_sheet"), package_dir, label="联系表路径")
    if not composite_path.is_file() or not contact_path.is_file():
        raise AssetSourceError("组合预览或联系表文件不存在。", code="LAYER_FILE_MISSING")
    composite_info = _image_file_info(composite_path, label="组合预览")
    _image_file_info(contact_path, label="联系表")
    production_reference_path = None
    if files.get("production_reference"):
        production_reference_path = _asset_safe_relative_path(files.get("production_reference"), package_dir, label="整图制作参考路径")
        if not production_reference_path.is_file():
            raise AssetSourceError("整图制作参考文件不存在。", code="LAYER_FILE_MISSING")
        _image_file_info(production_reference_path, label="整图制作参考")
    if not layers:
        raise AssetSourceError("至少需要一个图层。", code="LAYER_MANIFEST_INVALID")
    seen_layer_ids = set()
    parsed_layers = []
    warnings = [str(item) for item in raw.get("warnings", []) if isinstance(item, (str, int, float))]
    for index, layer in enumerate(layers, start=1):
        if not isinstance(layer, dict):
            raise AssetSourceError(f"第 {index} 个图层不是对象。", code="LAYER_MANIFEST_INVALID")
        layer_id = str(layer.get("id") or "").strip()
        if not layer_id or safe_segment(layer_id) != layer_id or layer_id in seen_layer_ids:
            raise AssetSourceError(f"第 {index} 个图层 id 缺失、不安全或重复。", code="LAYER_MANIFEST_INVALID")
        seen_layer_ids.add(layer_id)
        layer_file = _asset_safe_relative_path(layer.get("file"), package_dir, label=f"图层 {layer_id} 文件路径")
        if layer_file.suffix.lower() != ".png" or not layer_file.is_file():
            raise AssetSourceError(f"图层 {layer_id} 的 PNG 文件不存在。", code="LAYER_FILE_MISSING")
        def parse_layer_bbox(value, field_name):
            if not isinstance(value, list) or len(value) != 4:
                raise AssetSourceError(
                    f"图层 {layer_id} 的 {field_name} 必须是 [x,y,width,height]。",
                    code="LAYER_MANIFEST_INVALID",
                )
            parsed = [_number(v, label=f"图层 {layer_id} {field_name}", minimum=0) for v in value]
            bx, by, bw, bh = parsed
            if bw <= 0 or bh <= 0 or bx + bw > canvas_width or by + bh > canvas_height:
                raise AssetSourceError(
                    f"图层 {layer_id} 的 {field_name} 超出 source.png 画布。",
                    code="LAYER_MANIFEST_INVALID",
                )
            return parsed

        bbox = parse_layer_bbox(layer.get("bbox"), "bbox")
        source_bbox = parse_layer_bbox(layer.get("source_bbox") or bbox, "source_bbox")
        render_bbox = parse_layer_bbox(layer.get("render_bbox") or bbox, "render_bbox")
        fit_mode = str(layer.get("fit_mode") or "contain").strip()
        if fit_mode not in _LAYER_FIT_MODES:
            raise AssetSourceError(f"图层 {layer_id} 的 fit_mode 无效。", code="LAYER_MANIFEST_INVALID")
        default_visible = layer.get("default_visible", True)
        if not isinstance(default_visible, bool):
            raise AssetSourceError(f"图层 {layer_id} 的 default_visible 必须是布尔值。", code="LAYER_MANIFEST_INVALID")
        z_index = _number(layer.get("z_index"), label=f"图层 {layer_id} z_index")
        derivation_type = layer.get("derivation_type")
        if derivation_type not in _LAYER_DERIVATION_TYPES:
            raise AssetSourceError(f"图层 {layer_id} 的 derivation_type 无效。", code="LAYER_MANIFEST_INVALID")
        asset_type = str(layer.get("asset_type") or "scene_fragment").strip()
        if asset_type not in _LAYER_ASSET_TYPES:
            raise AssetSourceError(f"图层 {layer_id} 的 asset_type 无效。", code="LAYER_MANIFEST_INVALID")
        assembly_group = str(layer.get("assembly_group") or "").strip()
        scale_group = str(layer.get("scale_group") or assembly_group).strip()
        parent_asset = str(layer.get("parent_asset") or "").strip()
        attachment_point = str(layer.get("attachment_point") or "").strip()
        content_role = str(layer.get("content_role") or "").strip()
        text_source = str(layer.get("text_source") or "").strip()
        for value, label in ((assembly_group, "assembly_group"), (scale_group, "scale_group"), (parent_asset, "parent_asset"), (attachment_point, "attachment_point"), (content_role, "content_role")):
            if value and safe_segment(value) != value:
                raise AssetSourceError(f"图层 {layer_id} 的 {label} 只能使用安全字符。", code="LAYER_MANIFEST_INVALID")
        if len(text_source) > 500:
            raise AssetSourceError(f"图层 {layer_id} 的 text_source 不得超过 500 字符。", code="LAYER_MANIFEST_INVALID")
        image_info = _image_file_info(layer_file, label=f"图层 {layer_id}")
        anchor = layer.get("anchor") or {}
        if not isinstance(anchor, dict):
            raise AssetSourceError(f"图层 {layer_id} 的 anchor 必须是对象。", code="LAYER_MANIFEST_INVALID")
        anchor_kind = str(anchor.get("kind") or "center").strip()
        if anchor_kind not in _LAYER_ANCHOR_KINDS:
            raise AssetSourceError(f"图层 {layer_id} 的 anchor.kind 无效。", code="LAYER_MANIFEST_INVALID")
        source_point = anchor.get("source_point")
        asset_point = anchor.get("asset_point")
        if source_point is not None:
            if not isinstance(source_point, list) or len(source_point) != 2:
                raise AssetSourceError(f"图层 {layer_id} 的 anchor.source_point 必须是 [x,y]。", code="LAYER_MANIFEST_INVALID")
            source_point = [
                _number(source_point[0], label=f"图层 {layer_id} anchor.source_point.x", minimum=0),
                _number(source_point[1], label=f"图层 {layer_id} anchor.source_point.y", minimum=0),
            ]
            if source_point[0] > canvas_width or source_point[1] > canvas_height:
                raise AssetSourceError(f"图层 {layer_id} 的 anchor.source_point 超出画布。", code="LAYER_MANIFEST_INVALID")
        if asset_point is not None:
            if not isinstance(asset_point, list) or len(asset_point) != 2:
                raise AssetSourceError(f"图层 {layer_id} 的 anchor.asset_point 必须是 [u,v]。", code="LAYER_MANIFEST_INVALID")
            asset_point = [
                _number(asset_point[0], label=f"图层 {layer_id} anchor.asset_point.u", minimum=0),
                _number(asset_point[1], label=f"图层 {layer_id} anchor.asset_point.v", minimum=0),
            ]
            if asset_point[0] > 1 or asset_point[1] > 1:
                raise AssetSourceError(f"图层 {layer_id} 的 anchor.asset_point 必须在 0..1。", code="LAYER_MANIFEST_INVALID")
        if not image_info["has_alpha"]:
            warnings.append(f"图层 {layer_id} 没有 alpha 通道；请确认它确实是可独立组合的图层。")
        intrinsic_ratio = image_info["width"] / max(image_info["height"], 1)
        render_ratio = render_bbox[2] / max(render_bbox[3], 1)
        aspect_delta = abs(render_ratio / intrinsic_ratio - 1)
        if aspect_delta > 0.12:
            warnings.append(
                f"图层 {layer_id} 的透明素材与 render_bbox 长宽比相差 {aspect_delta:.1%}；"
                "系统将等比 contain，不会强制拉伸，请复核源框或重新生成。"
            )
        parsed_layers.append({
            "id": layer_id,
            "label": str(layer.get("label") or layer_id),
            "file": _asset_root_relative(layer_file, root),
            "bbox": bbox,
            "source_bbox": source_bbox,
            "render_bbox": render_bbox,
            "fit_mode": fit_mode,
            "default_visible": default_visible,
            "z_index": z_index,
            "derivation_type": derivation_type,
            "asset_type": asset_type,
            "assembly_group": assembly_group,
            "scale_group": scale_group,
            "parent_asset": parent_asset,
            "attachment_point": attachment_point,
            "content_role": content_role,
            "text_source": text_source,
            "anchor": {
                "kind": anchor_kind,
                **({"source_point": source_point} if source_point is not None else {}),
                **({"asset_point": asset_point} if asset_point is not None else {}),
            },
            "note": str(layer.get("note") or ""),
            "image": image_info,
        })
    source_state = _current_asset_source_state(root, source_id)
    stale_reasons = []
    if source.get("source_sha256") != source_state["source_sha256"]:
        stale_reasons.append("source_sha256 与当前正式源图不一致")
    if source.get("annotation_revision") != source_state["annotation_revision"]:
        stale_reasons.append("annotation_revision 与当前人工终稿不一致")
    if source_state["source_annotation_revision"] != source_state["annotation_revision"]:
        stale_reasons.append("当前标注已变化，尚未重新导出素材源版本")
    return {
        "source_id": source_id,
        "record_id": source_state["record_id"],
        "canonical_id": source_state["canonical_id"],
        "package_id": package_id,
        "package_path": _asset_root_relative(package_dir, root),
        "manifest_path": _asset_root_relative(manifest_path, root),
        "source_sha256": str(source.get("source_sha256") or ""),
        "annotation_revision": str(source.get("annotation_revision") or ""),
        "derivation": {
            "type": derivation["type"],
            "skill": str(derivation.get("skill") or ""),
            "run_id": str(derivation.get("run_id") or ""),
        },
        "canvas": {"width": canvas_width, "height": canvas_height},
        "files": {
            "composite_preview": _asset_root_relative(composite_path, root),
            "contact_sheet": _asset_root_relative(contact_path, root),
            **({"production_reference": _asset_root_relative(production_reference_path, root)} if production_reference_path else {}),
        },
        "layers": sorted(parsed_layers, key=lambda item: (item["z_index"], item["id"])),
        "warnings": warnings,
        "stale_reasons": stale_reasons,
        "source": {
            "source_path": _asset_root_relative(source_state["source_file"], root),
            "preview_path": _asset_root_relative(source_state["preview_file"], root),
            "source_sha256": source_state["source_sha256"],
            "annotation_revision": source_state["annotation_revision"],
            "package_path": source_state["source_package_path"],
        },
        "created_at": raw.get("created_at"),
    }


def _existing_asset_package(links: dict, source_id: str, package_id: str) -> dict:
    source = links.get("sources", {}).get(source_id)
    packages = source.get("packages", []) if isinstance(source, dict) else []
    return next((item for item in packages if isinstance(item, dict) and item.get("package_id") == package_id), {})


def _scan_layer_packages() -> dict:
    root = _asset_root_required()
    package_root = root / "_packages"
    links = _load_asset_links()
    discovered, errors = [], []
    if package_root.exists():
        for source_dir in sorted(path for path in package_root.iterdir() if path.is_dir()):
            for package_dir in sorted(path for path in source_dir.iterdir() if path.is_dir()):
                if not (package_dir / "layer-package.json").exists():
                    continue
                try:
                    discovered.append(_validate_layer_package(root, source_dir, package_dir))
                except AssetSourceError as exc:
                    errors.append({
                        "path": _asset_root_relative(package_dir, root),
                        "code": exc.code,
                        "error": str(exc),
                    })
    changed = False
    for package in discovered:
        source_id, package_id = package["source_id"], package["package_id"]
        existing = _existing_asset_package(links, source_id, package_id)
        status = "stale" if package["stale_reasons"] else existing.get("status", "pending")
        if status not in _ASSET_REVIEW_STATUSES:
            status = "pending"
        # stale 永远优先于旧 approval；原始审查记录仍保留，源图更新后需人工重新审查。
        package["status"] = status
        package["review_note"] = str(existing.get("review_note") or "")
        package["reviewed_at"] = existing.get("reviewed_at")
        package["scanned_at"] = datetime.now().astimezone().isoformat()
        source_entry = links["sources"].setdefault(source_id, {
            "record_id": package["record_id"],
            "canonical_id": package["canonical_id"],
            "packages": [],
        })
        source_entry["record_id"] = package["record_id"]
        source_entry["canonical_id"] = package["canonical_id"]
        package_list = source_entry.setdefault("packages", [])
        index = next((i for i, item in enumerate(package_list) if item.get("package_id") == package_id), None)
        if index is None:
            package_list.append(package)
        else:
            package_list[index] = package
        changed = True
    if changed:
        _save_asset_links(links)
    return {"scanned": len(discovered), "errors": errors, "links": links}


def _asset_packages_for_record(record_id: str) -> dict:
    root = _asset_root_required()
    record, book = _load_asset_export_record(record_id)
    source_id = _stable_source_id(record, book)
    links = _load_asset_links()
    source_entry = links.get("sources", {}).get(source_id) or {}
    packages = source_entry.get("packages", []) if isinstance(source_entry, dict) else []
    source = None
    try:
        state = _current_asset_source_state(root, source_id)
        source = {
            "source_path": _asset_root_relative(state["source_file"], root),
            "preview_path": _asset_root_relative(state["preview_file"], root),
            "source_sha256": state["source_sha256"],
            "annotation_revision": state["annotation_revision"],
            "package_path": state["source_package_path"],
        }
    except AssetSourceError as exc:
        if exc.code not in {"ASSET_SOURCE_NOT_FOUND", "ASSET_SOURCE_MISSING"}:
            raise
    return {
        "record_id": record_id,
        "source_id": source_id,
        "source": source,
        "packages": packages,
    }


def _find_asset_package(source_id: str, package_id: str) -> dict:
    links = _load_asset_links()
    item = _existing_asset_package(links, source_id, package_id)
    if not item:
        raise AssetSourceError("未找到已扫描的分层素材包。", code="LAYER_PACKAGE_NOT_FOUND", status=404)
    return item


@app.route("/api/layer-packages/scan", methods=["POST", "OPTIONS"])
def scan_layer_packages():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        result = _scan_layer_packages()
        return cors(jsonify({"ok": True, **result}))
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status


@app.route("/api/illustrations/<image_id>/asset-packages", methods=["GET", "OPTIONS"])
def illustration_asset_packages(image_id):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        return cors(jsonify({"ok": True, **_asset_packages_for_record(image_id)}))
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status


@app.route("/api/asset-packages/<source_id>/<package_id>/review", methods=["POST", "OPTIONS"])
def review_asset_package(source_id, package_id):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body = request.get_json(force=True, silent=True) or {}
    status = str(body.get("status") or "").strip()
    note = str(body.get("review_note") or "").strip()
    if status not in _ASSET_REVIEWABLE_STATUSES:
        return cors(jsonify({"ok": False, "code": "ASSET_REVIEW_STATUS_INVALID", "error": "审查状态只能是 approved、needs_revision 或 rejected。"})), 400
    if len(note) > 4000:
        return cors(jsonify({"ok": False, "code": "ASSET_REVIEW_NOTE_TOO_LONG", "error": "审查意见不得超过 4000 字符。"})), 400
    try:
        root = _asset_root_required()
        package = _find_asset_package(source_id, package_id)
        # 审查前再次核对，避免用户在源图已更新后误把旧包批准。
        source_state = _current_asset_source_state(root, source_id)
        stale = (
            package.get("source_sha256") != source_state["source_sha256"]
            or package.get("annotation_revision") != source_state["annotation_revision"]
            or source_state["source_annotation_revision"] != source_state["annotation_revision"]
        )
        if stale:
            return cors(jsonify({
                "ok": False,
                "code": "ASSET_PACKAGE_STALE",
                "error": "该分层包基于旧版源图或旧版标注，请重新检查。",
            })), 409
        links = _load_asset_links()
        stored = _existing_asset_package(links, source_id, package_id)
        stored["status"] = status
        stored["review_note"] = note
        stored["reviewed_at"] = datetime.now().astimezone().isoformat()
        _save_asset_links(links)
        return cors(jsonify({"ok": True, "package": stored}))
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status


@app.route("/api/asset-file/<path:relative_path>")
def serve_asset_file(relative_path):
    try:
        root = _asset_root_required()
        file_path = _asset_safe_relative_path(relative_path, root, label="素材文件路径")
        if file_path.suffix.lower() not in _ASSET_FILE_SUFFIXES or not file_path.is_file():
            return jsonify({"ok": False, "code": "ASSET_FILE_NOT_FOUND", "error": "素材文件不存在或类型不允许。"}), 404
        as_download = request.args.get("download") == "1"
        response = send_file(str(file_path), as_attachment=as_download, download_name=file_path.name)
        if as_download:
            response.headers["Cache-Control"] = "no-store"
        else:
            normalized = str(relative_path).replace("\\", "/").lstrip("/")
            # 源图路径包含内容哈希版本号，版本目录不会被原地覆盖，可安全长期缓存。
            if normalized.startswith("_sources/") and "/rev_" in normalized:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif normalized.startswith("_packages/"):
                response.headers["Cache-Control"] = "public, max-age=3600"
            else:
                response.headers["Cache-Control"] = "public, max-age=300"
        return response
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status


@app.route("/api/asset-packages/<source_id>/<package_id>/download")
def download_asset_package(source_id, package_id):
    try:
        root = _asset_root_required()
        package = _find_asset_package(source_id, package_id)
        package_dir = _asset_safe_relative_path(package.get("package_path"), root, label="分层包路径")
        if not package_dir.is_dir():
            raise AssetSourceError("分层包目录不存在。", code="LAYER_PACKAGE_NOT_FOUND", status=404)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for child in sorted(package_dir.rglob("*")):
                if not child.is_file() or child.is_symlink():
                    continue
                resolved = child.resolve()
                try:
                    rel = resolved.relative_to(package_dir.resolve())
                except ValueError:
                    continue
                bundle.write(resolved, arcname=rel.as_posix())
        archive.seek(0)
        return send_file(archive, mimetype="application/zip", as_attachment=True, download_name=f"{package_id}.zip")
    except AssetSourceError as exc:
        return cors(jsonify({"ok": False, "code": exc.code, "error": str(exc)})), exc.status

@app.route("/data/books/<book_id>/book.pdf")
def serve_book_pdf(book_id):
    book_dir = BOOKS_DIR / safe_segment(book_id)
    return send_from_directory(str(book_dir), "book.pdf")

@app.route("/data/books/<book_id>/pdfs/<path:filename>")
def serve_group_pdf(book_id, filename):
    """服务合并书籍 pdfs/ 子目录中的 PDF 文件。"""
    pdfs_dir = BOOKS_DIR / safe_segment(book_id) / "pdfs"
    return send_from_directory(str(pdfs_dir), filename)

# ── 合并书籍接口 ──────────────────────────────────────────────────────────

@app.route("/api/merge-books", methods=["POST", "OPTIONS"])
def merge_books():
    """把多本书合并到一个文件夹统一管理。
    请求体：{ "bookIds": ["id1","id2",...], "title": "合并后书名" }
    效果：
      - 新建 data/books/group_TIMESTAMP/ 文件夹
      - 各书 PDF 复制到 group/pdfs/vol_0.pdf, vol_1.pdf, ...
      - 各书 book.json 写入 groupId / groupTitle / pdfStorage.url（指向新路径）
      - 新建 group.json 记录卷信息
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    book_ids = body.get("bookIds", [])
    title = (body.get("title") or "合并书籍").strip()

    if len(book_ids) < 2:
        return jsonify({"error": "至少需要选择 2 本书"}), 400

    # 批量合并前自动备份（任务书 §5.2）
    _data_center_auto_backup("before_bulk_merge_split")

    # 创建合并组目录
    group_id  = f"group_{int(datetime.now().timestamp() * 1000)}"
    group_dir = BOOKS_DIR / safe_segment(group_id)
    group_dir.mkdir(parents=True, exist_ok=True)
    pdfs_dir  = group_dir / "pdfs"
    pdfs_dir.mkdir(exist_ok=True)

    volumes = []
    errors  = []

    for i, bid in enumerate(book_ids):
        src_dir = BOOKS_DIR / safe_segment(bid)
        if not src_dir.exists():
            errors.append(f"书籍目录不存在：{bid}")
            continue

        book_json_path = src_dir / "book.json"
        book_data = {}
        if book_json_path.exists():
            try:
                with open(book_json_path, encoding="utf-8") as f:
                    book_data = json.load(f)
            except Exception:
                pass

        # 复制 PDF（保留原始文件名，冲突时加序号前缀）
        src_pdf = src_dir / "book.pdf"
        vol_pdf_name = None
        if src_pdf.exists():
            # 尝试用原始文件名（来自 meta 或 book title）
            orig_name = (book_data.get("pdfStorage") or {}).get("filename") or f"vol_{i}.pdf"
            safe_name = Path(orig_name).name or f"vol_{i}.pdf"
            dest_name = safe_name if not (pdfs_dir / safe_name).exists() else f"vol_{i}_{safe_name}"
            shutil.copy2(str(src_pdf), str(pdfs_dir / dest_name))
            vol_pdf_name = dest_name

            # 更新 pdfStorage 指向合并目录中的 PDF
            book_data["pdfStorage"] = {
                "url":      f"http://localhost:5678/data/books/{safe_segment(group_id)}/pdfs/{dest_name}",
                "filename": dest_name,
            }

        # 写入 groupId / groupTitle
        book_data["groupId"]    = group_id
        book_data["groupTitle"] = title
        book_data["groupOrder"] = i

        # 修复旧版“分别导入图片卷册”把每卷都写成卷1的问题。
        # 只信任图片导入时保存的来源文件夹尾号，不改 PDF 书或人工版本名。
        image_import = book_data.get("imageBookImport") or {}
        source_volume = str(image_import.get("sourceVolume") or "")
        ordinal_match = re.search(r"([0-9０-９]+)\s*$", source_volume)
        if book_data.get("sourceType") == "image_folder" and ordinal_match:
            ordinal_text = ordinal_match.group(1).translate(
                str.maketrans("０１２３４５６７８９", "0123456789")
            )
            book_data["version"] = f"卷{int(ordinal_text)}"

        if book_json_path.exists():
            atomic_write_json(book_json_path, book_data)
        meta_path = src_dir / "meta.json"
        if meta_path.exists():
            try:
                meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta_data = {}
            meta_data["version"] = book_data.get("version", meta_data.get("version", ""))
            meta_data["updated_at"] = datetime.now().isoformat()
            atomic_write_json(meta_path, meta_data)

        volumes.append({
            "bookId":      bid,
            "title":       book_data.get("title", bid),
            "version":     book_data.get("version", ""),
            "groupOrder":  i,
            "pdfFilename": vol_pdf_name,
            "totalPages":  book_data.get("totalPages", 0),
        })

    # 写 group.json
    group_data = {
        "id":        group_id,
        "title":     title,
        "volumes":   volumes,
        "createdAt": datetime.now().isoformat(),
    }
    atomic_write_json(group_dir / "group.json", group_data)

    result = {
        "ok": True,
        "groupId": group_id,
        "volumes": len(volumes),
        "books": volumes,
    }
    if errors:
        result["warnings"] = errors
    return jsonify(result)

# ── 书籍组元信息更新接口 ───────────────────────────────────────────────────

@app.route("/api/update-group-meta", methods=["POST", "OPTIONS"])
def update_group_meta():
    """更新书籍组级别的元信息（名称、朝代、版本、总介绍）。
    请求体：{ "groupId": "group_xxx", "title": "...", "meta": { "dynasty": "", "version": "", "description": "" } }
    同时更新 group.json 及各卷 book.json 中的 groupTitle / groupMeta 字段。
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    group_id = body.get("groupId", "").strip()
    new_title = body.get("title", "").strip()
    meta      = body.get("meta", {})

    if not group_id:
        return jsonify({"error": "缺少 groupId"}), 400

    group_dir       = BOOKS_DIR / safe_segment(group_id)
    group_json_path = group_dir / "group.json"
    if not group_json_path.exists():
        return jsonify({"error": f"书籍组目录不存在：{group_id}"}), 404

    # 更新 group.json
    with open(group_json_path, encoding="utf-8") as f:
        group_data = json.load(f)
    if new_title:
        group_data["title"] = new_title
    for key in ("dynasty", "version", "description"):
        if key in meta:
            group_data[key] = meta[key]
    atomic_write_json(group_json_path, group_data)

    final_title = group_data.get("title", group_id)
    clean_meta  = {k: group_data.get(k, "") for k in ("dynasty", "version", "description")}

    # 更新各卷 book.json 中的 groupTitle / groupMeta
    for vol in group_data.get("volumes", []):
        bid       = vol.get("bookId", "")
        book_path = BOOKS_DIR / safe_segment(bid) / "book.json"
        if book_path.exists():
            try:
                with open(book_path, encoding="utf-8") as f:
                    book_data = json.load(f)
                book_data["groupTitle"] = final_title
                book_data["groupMeta"]  = clean_meta
                atomic_write_json(book_path, book_data)
            except Exception:
                pass

    return jsonify({"ok": True, "title": final_title})

# ── 导出保存接口 ──────────────────────────────────────────────────────────

@app.route("/api/save-export", methods=["POST", "OPTIONS"])
def save_export():
    """保存导出文件到 data/books/<book_id>/exports/（带时间戳文件名）。
    请求体：{ book_id, filename, content_b64?, content_text? }
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    book_id_raw  = (body.get("book_id") or "").strip()
    filename_raw = (body.get("filename") or "export.bin").strip()
    content_b64  = body.get("content_b64", "")
    content_text = body.get("content_text", "")

    if not book_id_raw:
        return jsonify({"error": "缺少 book_id"}), 400
    if not content_b64 and not content_text:
        return jsonify({"error": "缺少 content_b64 或 content_text"}), 400

    safe_fname = Path(filename_raw).name or "export.bin"
    stem, suffix = safe_fname.rsplit(".", 1) if "." in safe_fname else (safe_fname, "bin")
    ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
    tname = f"{stem}_{ts}.{suffix}"

    exports_dir = get_book_dir(book_id_raw) / "exports"
    exports_dir.mkdir(exist_ok=True)
    dest = exports_dir / tname

    try:
        if content_b64:
            dest.write_bytes(base64.b64decode(content_b64))
        else:
            dest.write_text(content_text, encoding="utf-8")
        _update_exports_index(exports_dir, tname)
        return jsonify({
            "ok":       True,
            "filename": tname,
            "path":     str(dest.relative_to(BASE_DIR)),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _update_exports_index(exports_dir: Path, new_filename: str):
    """在 exports/index.json 中追加最新导出记录（最多保留 50 条）。"""
    index_path = exports_dir / "index.json"
    index = {"exports": []}
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    index.setdefault("exports", [])
    index["exports"].insert(0, {
        "filename": new_filename,
        "saved_at": datetime.now().isoformat(),
    })
    index["exports"] = index["exports"][:50]
    index["last_export_at"] = index["exports"][0]["saved_at"]
    index["export_count"]   = len(index["exports"])
    atomic_write_json(index_path, index)

# ── 展示站导出（标注数据管理页「导出到展示站」）──────────────────────────
# 只读标注数据，产出 showcase 数据契约（docs/SHOWCASE_BRIEF.md §4）。
# 全量覆盖语义：每次导出都是所选范围的完整快照；直写模式只清理导出自有的
# 文件/目录，videos/（人工放置的 AI 视频）永不触碰。
SHOWCASE_DATA_DIR = BASE_DIR.parent / "showcase" / "data"
_SHOWCASE_OWNED = ("illustrations.json", "books.json", "featured.json", "export_manifest.json",
                   "images", "page_thumbs", "pages", "covers", "pdfs")

def _showcase_book_title_for_sort(book_id: str) -> str:
    book_path = get_book_dir(book_id) / "book.json"
    if not book_path.exists():
        return book_id
    try:
        book = json.loads(book_path.read_text(encoding="utf-8"))
        return book.get("title") or book_id
    except Exception:
        return book_id

def _showcase_book_sort_key(book_id: str, original_index: int):
    title = _showcase_book_title_for_sort(book_id)
    m = re.search(r"补遗雷公炮制便览[（(]卷(\d+)[）)]", title)
    if m:
        return (0, int(m.group(1)), original_index)
    if "补遗雷公炮制便览" in title:
        return (0, 99, original_index)
    return (1, original_index, 0)

def _showcase_build(payload, out_dir: Path):
    """收集所选记录并写入 out_dir，返回 manifest dict。"""
    raw_book_ids = payload.get("book_ids") or []
    book_ids   = [bid for bid, _ in sorted(
        [(bid, i) for i, bid in enumerate(raw_book_ids)],
        key=lambda item: _showcase_book_sort_key(item[0], item[1])
    )]
    subclass   = (payload.get("subclass") or "").strip()
    image_ids  = set(payload.get("image_ids") or [])
    featured_ids = [str(x) for x in (payload.get("featured_ids") or []) if str(x).strip()]
    inc_thumbs = bool(payload.get("include_page_thumbs", True))
    inc_hires  = bool(payload.get("include_hires_pages", True))
    inc_pdf    = bool(payload.get("include_pdf", False))

    img_dir = out_dir / "images";      img_dir.mkdir(parents=True, exist_ok=True)
    items, books_meta, warnings = [], [], []

    for bid in book_ids:
        bdir = get_book_dir(bid)
        images_path = bdir / "images.json"
        book_path   = bdir / "book.json"
        if not images_path.exists():
            warnings.append(f"{bid}: 无 images.json，跳过")
            continue
        recs = json.loads(images_path.read_text(encoding="utf-8"))
        if isinstance(recs, dict):
            recs = recs.get("images", [])
        book = json.loads(book_path.read_text(encoding="utf-8")) if book_path.exists() else {}
        btitle   = book.get("title") or bid
        bdynasty = book.get("dynasty") or ""
        pages    = book.get("pages") or []
        total    = book.get("totalPages") or len(pages)
        cover_page_num = book.get("showcaseCoverPageNum")
        try:
            cover_page_num = int(cover_page_num) if cover_page_num not in (None, "") else 1
        except (TypeError, ValueError):
            cover_page_num = 1

        picked, used_pages = [], set()
        rec_index = {str(r.get("id")): r for r in recs if isinstance(r, dict) and r.get("id")}

        def copy_showcase_image(src_rec):
            """Copy one illustration image to showcase/images and return its public metadata."""
            if not isinstance(src_rec, dict) or not src_rec.get("id"):
                return None
            url = src_rec.get("url") or ""
            rid = safe_segment(src_rec["id"])
            src = src_rec.get("pdfSource") or {}
            pnum = src.get("pageNum")
            if url.startswith("data:"):
                head, b64 = url.split(",", 1)
                ext = "png" if "png" in head else "jpg"
                (img_dir / f"{rid}.{ext}").write_bytes(base64.b64decode(b64))
            else:
                # 新版生产库只保存轻量图像 URL；展示导出必须从权威原书重新裁图，
                # 不能因记录不再内嵌 base64 而静默漏掉已确认插图。
                ext = "jpg"
                target = img_dir / f"{rid}.{ext}"
                try:
                    crop = _asset_crop_spec(src_rec)
                    physical_page = _physical_pdf_page(book, int(pnum))
                    rendered = _render_page_hires(
                        bid,
                        physical_page,
                        target,
                        long_edge=1400,
                        clip_rect=crop.get("_rect"),
                        rotation_deg=crop.get("rotation_deg") or 0,
                        quad_points=crop.get("_quad"),
                    )
                except (AssetSourceError, TypeError, ValueError) as exc:
                    warnings.append(f"{src_rec.get('id')}: 无法从原书裁图（{exc}）")
                    return None
                if not rendered:
                    warnings.append(f"{src_rec.get('id')}: 无法从原书裁图")
                    return None
            cr = src.get("cropRect")
            crop = ({"x": cr[0], "y": cr[1],
                     "w": round(cr[2] - cr[0], 15), "h": round(cr[3] - cr[1], 15)}
                    if isinstance(cr, list) and len(cr) == 4 else None)
            if isinstance(pnum, (int, float)):
                used_pages.add(int(pnum))
            return {
                "image_id": src_rec["id"],
                "file": f"images/{rid}.{ext}",
                "page_num": pnum,
                "crop_rect": crop,
            }

        for rec in recs:
            if rec.get("mergedInto"):
                continue
            if rec.get("status") != "ok":
                continue
            a = rec.get("annotation") or {}
            sub = a.get("academicSubclass") or ""
            if subclass and sub != subclass:
                continue
            merge_ids = rec.get("imageMerge", {}).get("items") if isinstance(rec.get("imageMerge"), dict) else []
            merge_ids = [str(x) for x in (merge_ids or []) if str(x).strip()]
            if image_ids and rec.get("id") not in image_ids and not any(mid in image_ids for mid in merge_ids):
                continue
            component_ids = merge_ids if len(merge_ids) > 1 else [rec["id"]]
            merged_items = []
            for mid in component_ids:
                component = rec_index.get(mid)
                if not component:
                    warnings.append(f"{rec.get('id')}: 合并图组成项 {mid} 不存在，已跳过")
                    continue
                copied = copy_showcase_image(component)
                if copied:
                    merged_items.append(copied)
            if not merged_items:
                continue
            primary = merged_items[0]
            src = rec.get("pdfSource") or {}
            video_src = None
            if "炮制" in sub:
                video_file = out_dir / "videos" / f"{safe_segment(rec['id'])}.mp4"
                if video_file.exists():
                    video_src = {"src": f"videos/{safe_segment(rec['id'])}.mp4", "available": True}
            item = {
                "image_id": rec["id"],
                "file": primary["file"],
                "subject": a.get("subject") or rec.get("name") or rec["id"],
                # 展示主标题统一走 name(=illustrationName||subject)，与标注台 _showcaseName 对齐，
                # 避免 228 条 illustrationName!=subject 记录在展示站标题/拼音错位。
                "name": _illustration_name(rec),
                "name_pinyin": _illustration_name_pinyin(rec),
                "class": a.get("academicClass", ""),
                "subclass": sub,
                "book": {"id": bid, "title": btitle,
                         "dynasty": src.get("dynasty") or bdynasty or "明"},
                "page_num": primary.get("page_num"),
                "crop_rect": primary.get("crop_rect"),
                "annotation": {
                    "description": a.get("visualDescription", ""),
                    "quote": (a.get("correspondingText") or a.get("textEvidenceExcerpt") or "")[:600],
                },
                "video": video_src,
            }
            if len(merged_items) > 1:
                item["merged_items"] = merged_items
            picked.append(item)

        if not picked:
            continue

        # 全书页缩略图（轨道用）
        if inc_thumbs and pages:
            tdir = out_dir / "page_thumbs"; tdir.mkdir(exist_ok=True)
            for pg in pages:
                t = pg.get("thumb") or ""
                pn = pg.get("pageNum")
                if not (isinstance(pn, (int, float)) and t.startswith("data:")):
                    continue
                _, tb64 = t.split(",", 1)
                (tdir / f"{safe_segment(bid)}_p{int(pn)}.jpg").write_bytes(base64.b64decode(tb64))

        cover_path = None

        # 含插图页的高清页图（阅读器用，pdf.js 接入前的过渡）；指定展示封面页也会复制为高清封面。
        if inc_hires:
            pdir = out_dir / "pages"; pdir.mkdir(exist_ok=True)
            cdir = out_dir / "covers"; cdir.mkdir(exist_ok=True)
            hires = _pages_hires_dir(bid, create=False)
            # pages_hires 缓存按 PDF 物理页命名；删除页后显示页≠物理页，需经映射取文件
            phys = {int(pg["pageNum"]): int(pg.get("pdfPageNum") or pg["pageNum"])
                    for pg in pages if isinstance(pg.get("pageNum"), (int, float))}
            cover_src = hires / _page_hires_name(phys.get(cover_page_num, cover_page_num))
            if cover_src.exists():
                cover_name = f"{safe_segment(bid)}_p{cover_page_num}.jpg"
                shutil.copy2(cover_src, cdir / cover_name)
                cover_path = f"covers/{cover_name}"
            elif pages:
                warnings.append(f"{bid} 展示封面第{cover_page_num}页: 无高清页缓存（前端打开过该页才会生成），回退缩略图")
            for pn in sorted(used_pages):
                srcf = hires / _page_hires_name(phys.get(pn, pn))
                if srcf.exists():
                    shutil.copy2(srcf, pdir / f"{safe_segment(bid)}_p{pn}.jpg")
                    for it in picked:
                        if it["page_num"] == pn:
                            it["page_image"] = f"pages/{safe_segment(bid)}_p{pn}.jpg"
                        for mi in it.get("merged_items", []):
                            if mi.get("page_num") == pn:
                                mi["page_image"] = f"pages/{safe_segment(bid)}_p{pn}.jpg"
                else:
                    warnings.append(f"{bid} 第{pn}页: 无高清页缓存（前端打开过该页才会生成）")

        if inc_pdf:
            pdf = _book_pdf_path(bid)
            if pdf:
                ddir = out_dir / "pdfs"; ddir.mkdir(exist_ok=True)
                shutil.copy2(pdf, ddir / f"{safe_segment(bid)}.pdf")
            else:
                warnings.append(f"{bid}: 未找到 PDF")

        books_meta.append({
            "id": bid, "title": btitle, "dynasty": bdynasty or "明",
            "total_pages": total, "illustration_count": len(picked),
            "showcase_cover_page_num": cover_page_num,
            "cover": cover_path or (f"page_thumbs/{safe_segment(bid)}_p{cover_page_num}.jpg" if inc_thumbs else None),
            "pdf": (f"pdfs/{safe_segment(bid)}.pdf" if inc_pdf and _book_pdf_path(bid) else None),
        })
        items.extend(picked)

    manifest = {
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "count": len(items),
        "books": [{"id": b["id"], "title": b["title"], "count": b["illustration_count"]}
                  for b in books_meta],
        "filters": {"subclass": subclass or "全部",
                    "image_ids": len(image_ids) or "全部已确认"},
        "includes": {"page_thumbs": inc_thumbs, "hires_pages": inc_hires, "pdf": inc_pdf},
        "warnings": warnings,
    }
    (out_dir / "illustrations.json").write_text(
        json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "books.json").write_text(
        json.dumps(books_meta, ensure_ascii=False, indent=1), encoding="utf-8")
    by_id = {it["image_id"]: it for it in items}
    featured_items = []
    for rank, image_id in enumerate(featured_ids, 1):
        it = by_id.get(image_id)
        if not it:
            continue
        featured_items.append({
            "rank": rank,
            "image_id": it["image_id"],
            "book_id": it["book"]["id"],
            "book_title": it["book"]["title"],
            "page_num": it.get("page_num"),
            "title": it.get("name") or it.get("subject") or it["image_id"],
            "subclass": it.get("subclass", ""),
            "description": (it.get("annotation") or {}).get("description", ""),
            "quote": (it.get("annotation") or {}).get("quote", ""),
        })
    if featured_items:
        featured = {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "source_manifest": "data/export_manifest.json",
            "count": len(featured_items),
            "item_ids": [x["image_id"] for x in featured_items],
            "items": featured_items,
        }
        (out_dir / "featured.json").write_text(
            json.dumps(featured, ensure_ascii=False, indent=1), encoding="utf-8")
    (out_dir / "export_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest

@app.route("/api/showcase-export", methods=["POST", "OPTIONS"])
def showcase_export():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    payload = request.get_json(force=True, silent=True) or {}
    if not payload.get("book_ids"):
        return cors(jsonify({"error": "未选择书籍"})), 400
    mode = payload.get("mode") or "local"
    try:
        if mode == "local":
            # 直写本地展示站：只清理导出自有路径，videos/ 永不触碰
            SHOWCASE_DATA_DIR.mkdir(parents=True, exist_ok=True)
            for name in _SHOWCASE_OWNED:
                p = SHOWCASE_DATA_DIR / name
                if p.is_dir():
                    shutil.rmtree(p)
                elif p.exists():
                    p.unlink()
            manifest = _showcase_build(payload, SHOWCASE_DATA_DIR)
            return cors(jsonify({"ok": True, "mode": "local",
                                 "path": str(SHOWCASE_DATA_DIR), "manifest": manifest}))
        # zip 下载模式
        import io, tempfile, zipfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp) / "showcase_data"
            tmp_dir.mkdir()
            manifest = _showcase_build(payload, tmp_dir)
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in sorted(tmp_dir.rglob("*")):
                    if f.is_file():
                        zf.write(f, f.relative_to(tmp_dir.parent))
            buf.seek(0)
            resp = Response(buf.read(), mimetype="application/zip")
            resp.headers["Content-Disposition"] = "attachment; filename=showcase_data.zip"
            resp.headers["X-Export-Count"] = str(manifest["count"])
            return cors(resp)
    except Exception as e:
        return cors(jsonify({"error": f"导出失败：{e}"})), 500

# ── 旧即时备份端点（兼容维护脚本；普通前端已移除入口）─────────────────────
# 强制写入统一 ZIP + manifest，绕过 5 分钟节流；不再产生旧 JSON 快照。
@app.route("/api/backup-now", methods=["POST", "OPTIONS"])
def backup_now():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    name = write_auto_backup(force=True)
    if not name:
        return cors(jsonify({"error": "备份失败，详见 bridge 日志"})), 500
    fpath = DATA_BACKUP_DIR / name
    size_mb = round(fpath.stat().st_size / 1048576) if fpath.exists() else 0
    return cors(jsonify({"ok": True, "file": name, "size_mb": size_mb,
                         "format": "data-center-backup-v1"}))

# ── 删除书页（硬删除 + 重编号）────────────────────────────────────────────
# 服务端原子完成：pre_write 备份 → 删页 → 剩余页 pageNum 重排 1..N（原物理页存
# pdfPageNum，渲染映射见 _pdf_page_of）→ 重映射 book.json/images.json 全部页码引用。
# 选中页含 status=ok 已确认标注时整体拒绝（409），保护成果。
@app.route("/api/book/<book_id>/delete-pages", methods=["POST", "OPTIONS"])
def delete_book_pages(book_id):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    payload = request.get_json(force=True, silent=True) or {}
    try:
        removed = {int(n) for n in (payload.get("page_nums") or [])}
    except (TypeError, ValueError):
        return cors(jsonify({"error": "page_nums 含非法页码"})), 400
    if not removed:
        return cors(jsonify({"error": "未指定要删除的页"})), 400

    bdir = get_book_dir(book_id)
    bpath, ipath = bdir / "book.json", bdir / "images.json"
    if not bpath.exists():
        return cors(jsonify({"error": "book.json 不存在"})), 404
    book = json.loads(bpath.read_text(encoding="utf-8"))
    recs = json.loads(ipath.read_text(encoding="utf-8")) if ipath.exists() else []
    if isinstance(recs, dict):
        recs = recs.get("images", [])

    def _src_pn(r):
        try:
            return int((r.get("pdfSource") or {}).get("pageNum"))
        except (TypeError, ValueError):
            return None

    # 保护：已确认标注页拒绝删除
    blocked = sorted({_src_pn(r) for r in recs
                      if r.get("status") == "ok" and _src_pn(r) in removed})
    if blocked:
        return cors(jsonify({"error": f"第 {','.join(map(str, blocked))} 页有已确认标注，禁止删除",
                             "blocked_pages": blocked})), 409

    pages = book.get("pages") or []
    exist = {int(p["pageNum"]) for p in pages if isinstance(p.get("pageNum"), (int, float))}
    removed &= exist
    if not removed:
        return cors(jsonify({"error": "指定页码均不存在"})), 400

    # pre_write 备份（与 repair 脚本同目录约定）
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    bk_dir = DATA_DIR / "backups" / "pre_write"
    bk_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(bpath, bk_dir / f"{safe_segment(book_id)}_book_pre_delpages_{ts}.json")
    if ipath.exists():
        shutil.copy2(ipath, bk_dir / f"{safe_segment(book_id)}_images_pre_delpages_{ts}.json")

    # 删页 + 重编号（mapping: 旧显示页 -> 新显示页）
    kept = sorted((p for p in pages if int(p.get("pageNum", -1)) not in removed),
                  key=lambda p: int(p.get("pageNum", 0)))
    mapping = {}
    for i, p in enumerate(kept, 1):
        old = int(p["pageNum"])
        if not isinstance(p.get("pdfPageNum"), (int, float)):
            p["pdfPageNum"] = old      # 首次删除时固化物理页；再次删除保留原值
        mapping[old] = i
        p["pageNum"] = i
        ta = p.get("textAsset")
        if ta and isinstance(ta.get("associatedPageNums"), list):
            ta["associatedPageNums"] = [mapping[int(n)] for n in ta["associatedPageNums"]
                                        if isinstance(n, (int, float)) and int(n) in mapping]
    book["pages"] = kept
    book["totalPages"] = len(kept)

    ips = book.get("illustrationPages")
    if isinstance(ips, list):
        new_ips = []
        for ip in ips:
            try:
                pn = int(ip.get("pageNum"))
            except (TypeError, ValueError):
                continue
            if pn in mapping:
                ip["pageNum"] = mapping[pn]
                new_ips.append(ip)
        book["illustrationPages"] = new_ips

    bt = book.get("bookTraits") or {}
    cv = bt.get("coverPageNum")
    if isinstance(cv, (int, float)):
        bt["coverPageNum"] = mapping.get(int(cv))   # 被删则置 None
    tsp = book.get("contentRectTemplateSourcePageNum")
    if isinstance(tsp, (int, float)):
        book["contentRectTemplateSourcePageNum"] = mapping.get(int(tsp))

    # images.json：被删页的记录删除（已校验无 ok），其余重映射
    deleted_recs, kept_recs = 0, []
    label_re = re.compile(r"^第\s*\d+\s*页$")
    for r in recs:
        pn = _src_pn(r)
        if pn in removed:
            deleted_recs += 1
            continue
        if pn in mapping:
            src = r["pdfSource"]
            if not isinstance(src.get("pdfPageNum"), (int, float)):
                src["pdfPageNum"] = pn
            src["pageNum"] = mapping[pn]
            for k in ("page", "name"):
                if isinstance(r.get(k), str) and label_re.match(r[k].strip()):
                    r[k] = f"第 {mapping[pn]} 页" if k == "page" else f"第{mapping[pn]}页"
        kept_recs.append(r)

    atomic_write_json(bpath, book)
    atomic_write_json(ipath, kept_recs)
    return cors(jsonify({
        "ok": True,
        "deleted_pages": sorted(removed),
        "remaining_pages": len(kept),
        "deleted_records": deleted_recs,
        "backup": f"backups/pre_write/{safe_segment(book_id)}_*_pre_delpages_{ts}.json",
    }))

# ── PDF 上传接口 ──────────────────────────────────────────────────────────

@app.route("/api/import-image-book", methods=["POST", "OPTIONS"])
def import_image_book_route():
    """Import a folder of source scans as one grouped, multi-volume image book.

    The endpoint validates the complete manifest and writes into a staging
    transaction first. Source scans remain byte-identical; only derived logical
    pages are converted to JPEG for the existing OCR/crop pipeline.
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    manifest_raw = request.form.get("manifest") or ""
    try:
        manifest = json.loads(manifest_raw)
    except (TypeError, json.JSONDecodeError):
        return cors(jsonify({
            "ok": False,
            "code": "IMAGE_IMPORT_MANIFEST_INVALID",
            "error": "图片书籍导入清单不是有效 JSON。",
        })), 400
    uploads = request.files.getlist("files")
    backup = None
    try:
        # 有现存数据时先建立可恢复快照；空数据集会返回 NO_BACKUP_DATA，
        # 不应阻止第一本书导入。
        try:
            backup = _data_center_write_backup(reason="before_image_book_import")
        except Exception as exc:
            if getattr(exc, "code", "") != "NO_BACKUP_DATA":
                raise ImageBookImportError(
                    f"导入前备份失败：{exc}",
                    code="IMAGE_IMPORT_BACKUP_FAILED",
                    status=500,
                ) from exc
        result = import_image_book(
            manifest,
            uploads,
            books_dir=BOOKS_DIR,
            dataset_id=DATA_SOURCE_ID,
        )
        result["backup"] = backup
        return cors(jsonify(result))
    except ImageBookImportError as exc:
        return cors(jsonify({
            "ok": False,
            "code": exc.code,
            "error": str(exc),
        })), exc.status

@app.route("/api/upload-pdf", methods=["POST", "OPTIONS"])
def upload_pdf():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    up = request.files.get("file")
    if not up:
        return jsonify({"error": "未提供 PDF 文件"}), 400

    filename = up.filename or "book.pdf"
    safe_name = filename.replace("\\", "_").replace("/", "_")
    stem = Path(safe_name).stem
    book_id_raw = (request.form.get("book_id") or "").strip()

    meta_path = None
    merged_meta = None

    if book_id_raw:
        book_dir = get_book_dir(book_id_raw)
        dest = book_dir / "book.pdf"
        url  = f"http://localhost:5678/data/books/{safe_segment(book_id_raw)}/book.pdf"
        meta_path = book_dir / "meta.json"
        now_iso   = datetime.now().isoformat()
        existing_meta = {}
        if meta_path.exists():
            try:
                existing_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        merged_meta = {
            "book_id":                  book_id_raw,
            "title":                    request.form.get("title")   or existing_meta.get("title", ""),
            "dynasty":                  request.form.get("dynasty") or existing_meta.get("dynasty", ""),
            "version":                  request.form.get("version") or existing_meta.get("version", ""),
            "page_count":               existing_meta.get("page_count", 0),
            "illustration_page_count":  existing_meta.get("illustration_page_count", 0),
            "created_at":               existing_meta.get("created_at", now_iso),
            "updated_at":               now_iso,
            "pdf_path":                 "book.pdf",
        }
    else:
        final_name = f"{stem}.pdf"
        dest = PDFS_DIR / final_name
        url  = f"http://localhost:5678/data/pdfs/{final_name}"

    try:
        up.save(dest)
        if meta_path and merged_meta:
            atomic_write_json(meta_path, merged_meta)
        return jsonify({
            "ok":       True,
            "filename": dest.name,
            "url":      url,
            "size":     dest.stat().st_size,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/data/pdfs/<path:filename>")
def serve_pdf(filename):
    return send_from_directory(str(PDFS_DIR), filename)

# ── meta.json 更新接口 ────────────────────────────────────────────────────

@app.route("/api/update-book-meta", methods=["POST", "OPTIONS"])
def update_book_meta():
    """更新书目录下的 meta.json（增量合并，不覆盖未传字段）。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    book_id_raw = (body.get("book_id") or "").strip()
    if not book_id_raw:
        return jsonify({"error": "缺少 book_id"}), 400

    book_dir  = BOOKS_DIR / safe_segment(book_id_raw)
    meta_path = book_dir / "meta.json"
    if not book_dir.exists():
        return jsonify({"error": f"书目录不存在: {safe_segment(book_id_raw)}"}), 404

    existing = {}
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    UPDATABLE = ("title", "dynasty", "version", "page_count", "illustration_page_count")
    now_iso = datetime.now().isoformat()
    merged = {
        "book_id":                 book_id_raw,
        "title":                   existing.get("title", ""),
        "dynasty":                 existing.get("dynasty", ""),
        "version":                 existing.get("version", ""),
        "page_count":              existing.get("page_count", 0),
        "illustration_page_count": existing.get("illustration_page_count", 0),
        "created_at":              existing.get("created_at", now_iso),
        "updated_at":              now_iso,
        "pdf_path":                existing.get("pdf_path", "book.pdf"),
    }
    for key in UPDATABLE:
        if body.get(key) is not None:
            merged[key] = body[key]

    try:
        atomic_write_json(meta_path, merged)
        return jsonify({"ok": True, "meta": merged})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── 书资源删除接口 ────────────────────────────────────────────────────────

def _move_to_trash(src: Path, label: str = "") -> str:
    """删除回收站：把 src（目录或文件）移动到 data/backups/deleted/<名字>_<时间戳>/，返回相对路径。
    比直接删除安全——可手动移回恢复。命名冲突自动加序号。"""
    DELETED_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = (label or src.name)
    dest = DELETED_BACKUP_DIR / f"{base}_{ts}"
    i = 1
    while dest.exists():
        dest = DELETED_BACKUP_DIR / f"{base}_{ts}_{i}"
        i += 1
    shutil.move(str(src), str(dest))
    return str(dest.relative_to(BASE_DIR))


@app.route("/api/delete-book-assets", methods=["POST", "OPTIONS"])
def delete_book_assets():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    pdf_filename    = (body.get("pdf_filename") or "").strip()
    image_filenames = body.get("image_filenames") or []
    book_id_raw     = (body.get("book_id") or "").strip()

    if not isinstance(image_filenames, list):
        return jsonify({"error": "image_filenames must be a list"}), 400

    def _safe_name(name):
        if not name:
            return ""
        clean = Path(str(name)).name
        return clean if clean == str(name) else ""

    deleted_pdf             = None
    deleted_images          = []
    missing_images          = []
    deleted_book_dir        = None
    deleted_book_dir_files  = []
    deleted_model_runs      = []
    missing_book_dir_files  = []
    trashed_to              = None   # 回收站位置（可恢复）

    if book_id_raw:
        book_dir = BOOKS_DIR / safe_segment(book_id_raw)
        try:
            if book_dir.exists() and book_dir.is_dir():
                for p in book_dir.rglob("*"):
                    if not p.is_file():
                        continue
                    rel   = str(p.relative_to(book_dir))
                    parts = p.relative_to(book_dir).parts
                    if parts and parts[0] == "model_runs":
                        deleted_model_runs.append(rel)
                    else:
                        deleted_book_dir_files.append(rel)
                # 回收站：整目录搬到 backups/deleted/ 而非直接删，便于误删恢复
                trashed_to = _move_to_trash(book_dir, safe_segment(book_id_raw))
                print(f"[trash] 删除书目录 → 回收站 {trashed_to}")
                deleted_book_dir = str(book_dir.relative_to(BASE_DIR))
            else:
                for expected in ["book.pdf", "meta.json"]:
                    missing_book_dir_files.append(expected)
        except Exception as e:
            return jsonify({"error": f"删除书目录失败: {e}"}), 500

    safe_pdf = _safe_name(pdf_filename)
    if safe_pdf:
        target = PDFS_DIR / safe_pdf
        try:
            if target.exists():
                target.unlink()
                deleted_pdf = safe_pdf
        except Exception as e:
            return jsonify({"error": f"删除 PDF 失败: {e}"}), 500

    for raw_name in image_filenames:
        safe_name = _safe_name(raw_name)
        if not safe_name:
            continue
        target = IMAGES_DIR / safe_name
        try:
            if target.exists():
                target.unlink()
                deleted_images.append(safe_name)
            else:
                missing_images.append(safe_name)
        except Exception as e:
            return jsonify({"error": f"删除图像失败 {safe_name}: {e}"}), 500

    return jsonify({
        "ok": True,
        "deleted_book_dir":       deleted_book_dir,
        "deleted_book_dir_files": deleted_book_dir_files,
        "deleted_model_runs":     deleted_model_runs,
        "missing_book_dir_files": missing_book_dir_files,
        "deleted_pdf":            deleted_pdf,
        "deleted_images":         deleted_images,
        "missing_images":         missing_images,
    })

# ── 模型归档接口 ──────────────────────────────────────────────────────────

@app.route("/api/store-model-run", methods=["POST", "OPTIONS"])
def store_model_run():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    provider   = (body.get("provider") or "").strip()
    model      = (body.get("model") or "").strip()
    image_id   = (body.get("image_id") or "").strip()
    annotation = body.get("annotation")
    if not provider or not model or not image_id or not isinstance(annotation, dict):
        return jsonify({"error": "provider/model/image_id/annotation 缺失或格式错误"}), 400

    book_id_raw = (body.get("book_id") or "").strip()
    book_id     = safe_segment(book_id_raw or "no_book")

    if book_id_raw:
        run_dir = get_book_dir(book_id_raw) / "model_runs" / safe_segment(provider) / safe_segment(model)
        run_dir.mkdir(parents=True, exist_ok=True)
        dest = run_dir / "runs.jsonl"
    else:
        provider_dir = MODEL_RUNS_DIR / safe_segment(provider) / safe_segment(model)
        provider_dir.mkdir(parents=True, exist_ok=True)
        dest = provider_dir / f"{book_id}.jsonl"

    record = {
        "stored_at": datetime.now().isoformat(),
        "provider": provider,
        "model": model,
        "image_id": image_id,
        "book_id": body.get("book_id") or "",
        "book_title": body.get("book_title") or "",
        "page_num": body.get("page_num"),
        "selection_mode": body.get("selection_mode") or "",
        "status": body.get("status") or "",
        "has_multiple_illustrations": bool(body.get("has_multiple_illustrations")),
        "text_asset": body.get("text_asset") or {},
        "crossref": body.get("crossref") or {},
        "annotation": annotation,
    }
    try:
        with open(dest, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return jsonify({
            "ok": True,
            "saved": str(dest),
            "relative_path": str(dest.relative_to(BASE_DIR)),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/model-runs", methods=["GET", "OPTIONS"])
def list_model_runs():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    image_id = (request.args.get("image_id") or "").strip()
    book_id  = (request.args.get("book_id") or "").strip()
    if not image_id:
        return jsonify({"error": "缺少 image_id"}), 400

    scan_paths: list[Path] = list(MODEL_RUNS_DIR.glob("*/*/*.jsonl"))
    for bd in BOOKS_DIR.iterdir():
        if bd.is_dir():
            scan_paths.extend((bd / "model_runs").glob("*/*/*.jsonl"))

    hidden = _load_hidden_runs()
    records = []
    for path in scan_paths:
        try:
            rel = str(path.relative_to(BASE_DIR))
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    rec = json.loads(line)
                    if rec.get("image_id") != image_id:
                        continue
                    if book_id and rec.get("book_id") != book_id:
                        continue
                    key = _run_key(rel, rec)
                    if key in hidden:          # 标注数据管理页隐藏的回放，这里也跳过
                        continue
                    rec["relative_path"] = rel
                    rec["run_key"] = key
                    records.append(rec)
        except Exception:
            continue

    records.sort(key=lambda item: item.get("stored_at", ""), reverse=True)
    return jsonify({"ok": True, "records": records})


# ── 模型归档批量管理（标注数据管理页）──────────────────────────────────────
MODEL_RUNS_HIDDEN_PATH = DATA_DIR / "model_runs_hidden.json"
MODEL_RUNS_BACKUP_DIR  = DATA_DIR / "backups" / "model_runs"

def _all_model_run_paths():
    paths = list(MODEL_RUNS_DIR.glob("*/*/*.jsonl"))
    if BOOKS_DIR.exists():
        for bd in BOOKS_DIR.iterdir():
            if bd.is_dir():
                paths.extend((bd / "model_runs").glob("*/*/*.jsonl"))
    return paths

def _run_key(rel_path, rec):
    import hashlib
    raw = f"{rel_path}|{rec.get('stored_at','')}|{rec.get('image_id','')}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

def _load_hidden_runs():
    if MODEL_RUNS_HIDDEN_PATH.exists():
        try:
            return set(json.loads(MODEL_RUNS_HIDDEN_PATH.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()

def _save_hidden_runs(keys):
    atomic_write_json(MODEL_RUNS_HIDDEN_PATH, sorted(keys))

def _ann_summary(rec):
    ann = rec.get("annotation") or {}
    cls  = ann.get("academicClass") or ann.get("academic_class") or ann.get("type") or ""
    subj = ann.get("subject") or (ann.get("content") or {}).get("main_subject") or ""
    return cls, subj

def _current_illustration_index():
    """Return image_id -> current illustration snapshot from canonical per-book files."""
    idx = {}
    if not BOOKS_DIR.exists():
        return idx
    for bd in BOOKS_DIR.iterdir():
        if not bd.is_dir():
            continue
        images_path = bd / "images.json"
        if not images_path.exists():
            continue
        try:
            payload = json.loads(images_path.read_text(encoding="utf-8"))
            images = payload.get("images", []) if isinstance(payload, dict) else payload
            book = {}
            book_path = bd / "book.json"
            if book_path.exists():
                book = json.loads(book_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(images, list):
            continue
        for img in images:
            if isinstance(img, dict) and img.get("id"):
                idx[img["id"]] = {"image": img, "book": book}
    return idx

def _merge_current_illustration_fields(rec, current_index):
    """Use current human-reviewed illustration fields for display/export, keep archive provenance."""
    image_id = rec.get("image_id", "")
    cur = current_index.get(image_id or "")
    if not cur:
        return rec
    img = cur.get("image") or {}
    book = cur.get("book") or {}
    merged_into = img.get("mergedInto")
    if merged_into:
        owner_cur = current_index.get(str(merged_into))
        if owner_cur:
            img = owner_cur.get("image") or img
            book = owner_cur.get("book") or book
    src = img.get("pdfSource") or {}
    merged = dict(rec)
    merged["archive_status"] = rec.get("status", "")
    merged["archive_annotation"] = rec.get("annotation") or {}
    merged["archive_book_title"] = rec.get("book_title", "")
    merged["current_image_found"] = True
    if merged_into:
        merged["merged_into"] = merged_into
        merged["current_owner_id"] = img.get("id") or merged_into
    merged["status"] = img.get("status", rec.get("status", ""))
    merged["annotation"] = img.get("annotation") or rec.get("annotation") or {}
    merged["book_id"] = src.get("bookId") or rec.get("book_id", "")
    merged["book_title"] = book.get("title") or rec.get("book_title", "")
    merged["page_num"] = src.get("pageNum", rec.get("page_num"))
    return merged


@app.route("/api/model-runs/all", methods=["GET", "OPTIONS"])
def list_all_model_runs():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    hidden = _load_hidden_runs()
    current_index = _current_illustration_index()
    records = []
    for path in _all_model_run_paths():
        rel = str(path.relative_to(BASE_DIR))
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    key = _run_key(rel, rec)
                    rec_view = _merge_current_illustration_fields(rec, current_index)
                    cls, subj = _ann_summary(rec_view)
                    records.append({
                        "run_key":   key,
                        "image_id":  rec_view.get("image_id", ""),
                        "book_id":   rec_view.get("book_id", ""),
                        "book_title": rec_view.get("book_title", ""),
                        "page_num":  rec_view.get("page_num"),
                        "provider":  rec.get("provider", ""),
                        "model":     rec.get("model", ""),
                        "stored_at": rec.get("stored_at", ""),
                        "status":    rec_view.get("status", ""),
                        "archive_status": rec.get("status", ""),
                        "academic_class": cls,
                        "subject":   subj,
                        "hidden":    key in hidden,
                    })
        except Exception:
            continue
    records.sort(key=lambda r: r.get("stored_at", ""), reverse=True)
    models    = sorted({r["model"] for r in records if r["model"]})
    providers = sorted({r["provider"] for r in records if r["provider"]})
    books     = sorted({(r["book_id"], r["book_title"]) for r in records if r["book_id"]})
    return cors(jsonify({
        "ok": True, "records": records, "total": len(records),
        "models": models, "providers": providers,
        "books": [{"id": b[0], "title": b[1]} for b in books],
    }))


@app.route("/api/model-runs/bulk", methods=["POST", "OPTIONS"])
def bulk_model_runs():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    body   = request.get_json(force=True, silent=True) or {}
    action = body.get("action", "")
    keys   = set(body.get("keys") or [])
    if action not in ("hide", "unhide", "delete"):
        return jsonify({"error": "action 须为 hide/unhide/delete"}), 400
    if not keys:
        return jsonify({"error": "未选择记录"}), 400

    # 隐藏/取消隐藏：可逆，只动注册表，不碰归档文件
    if action in ("hide", "unhide"):
        hidden = _load_hidden_runs()
        hidden = (hidden | keys) if action == "hide" else (hidden - keys)
        _save_hidden_runs(hidden)
        return cors(jsonify({"ok": True, "action": action,
                             "affected": len(keys), "hidden_total": len(hidden)}))

    # 删除：逐文件重写剔除匹配项；改前先备份原 runs.jsonl
    MODEL_RUNS_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    deleted = 0
    touched = []
    for path in _all_model_run_paths():
        rel = str(path.relative_to(BASE_DIR))
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        kept = []
        removed_here = 0
        for line in lines:
            s = line.strip()
            if not s:
                continue
            try:
                rec = json.loads(s)
            except Exception:
                kept.append(s)
                continue
            if _run_key(rel, rec) in keys:
                removed_here += 1
            else:
                kept.append(s)
        if removed_here:
            safe = safe_segment(rel.replace("/", "_").replace("\\", "_"))
            shutil.copy2(str(path), str(MODEL_RUNS_BACKUP_DIR / f"{safe}_{ts}.bak"))
            path.write_text(("\n".join(kept) + "\n") if kept else "", encoding="utf-8")
            deleted += removed_here
            touched.append(rel)
    # 被删的 key 同时从隐藏表清掉
    hidden = _load_hidden_runs()
    if hidden & keys:
        _save_hidden_runs(hidden - keys)
    return cors(jsonify({"ok": True, "action": "delete", "deleted": deleted,
                         "files": touched,
                         "backup_dir": str(MODEL_RUNS_BACKUP_DIR.relative_to(BASE_DIR))}))


def _book_code_from_title(title: str) -> str:
    """ASCII 书名码（与前端 getBookCode 规则一致；归档记录只有 book_title 可用）。"""
    t = title or ""
    if "雷公炮制便览" in t:
        m = re.search(r"卷\s*(\d+)", t)
        return "BYLGJ" + (m.group(1).zfill(2) if m else "00")
    if "内镜" in t:
        return "NJ"
    if "素问入式运气论奥" in t:
        return "SWYQ"
    if "医学指归" in t:
        return "YXZG"
    h = 0
    for ch in t:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return "BK" + str(h % 9000 + 1000)


def _illustration_code(rec: dict) -> str:
    """结构化编号：书名码_pNNNN_iII。"""
    code = _book_code_from_title(rec.get("book_title") or "")
    ann = rec.get("annotation") or {}
    pn = rec.get("page_num")
    try:
        pn = int(pn)
    except (TypeError, ValueError):
        pn = 0
    idx = ann.get("subIndex") or rec.get("sub_index") or 1
    try:
        idx = int(idx)
    except (TypeError, ValueError):
        idx = 1
    return f"{code}_p{str(pn).zfill(4)}_i{str(idx).zfill(2)}"


def _illustration_name(rec: dict) -> str:
    ann = rec.get("annotation") or {}
    return (ann.get("illustrationName") or ann.get("subject") or "").strip() or "（未命名插图）"


def _illustration_name_pinyin(rec: dict) -> str:
    """名称拼音：优先已存字段（含人工纠正），缺则按解析名现算。"""
    ann = rec.get("annotation") or {}
    stored = (ann.get("illustrationNamePinyin") or "").strip()
    if stored:
        return stored
    nm = (ann.get("illustrationName") or ann.get("subject") or "").strip()
    return name_pinyin(nm) if nm else ""


@app.route("/api/model-runs/export", methods=["POST", "OPTIONS"])
def export_model_runs():
    """导出选中的归档记录（run_key 列表）为 jsonl / csv / html。
    返回 {filename, mime, content}，前端据此触发下载。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    import csv as _csv
    import io as _io
    import html as _html

    body = request.get_json(force=True, silent=True) or {}
    keys = set(body.get("keys") or [])
    fmt  = (body.get("format") or "jsonl").lower()
    if not keys:
        return jsonify({"error": "未选择记录"}), 400
    if fmt not in ("jsonl", "csv", "html"):
        return jsonify({"error": "format 须为 jsonl/csv/html"}), 400

    # 收集选中记录的完整数据；展示/导出字段优先使用当前人工终稿，归档快照保留为 archive_*。
    current_index = _current_illustration_index()
    recs = []
    for path in _all_model_run_paths():
        rel = str(path.relative_to(BASE_DIR))
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    if _run_key(rel, rec) in keys:
                        rec["run_key"] = _run_key(rel, rec)
                        merged = _merge_current_illustration_fields(rec, current_index)
                        merged["run_key"] = rec["run_key"]
                        merged["illustration_code"] = _illustration_code(merged)
                        merged["illustration_name"] = _illustration_name(merged)
                        merged["illustration_name_pinyin"] = _illustration_name_pinyin(merged)
                        recs.append(merged)
        except Exception:
            continue
    recs.sort(key=lambda r: r.get("stored_at", ""), reverse=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    def _f(rec, *path):
        cur = rec
        for p in path:
            if not isinstance(cur, dict):
                return ""
            cur = cur.get(p)
        return cur if cur not in (None,) else ""

    if fmt == "jsonl":
        content = "\n".join(json.dumps(r, ensure_ascii=False) for r in recs)
        return cors(jsonify({"ok": True, "filename": f"annotations_{ts}.jsonl",
                             "mime": "application/x-ndjson", "content": content,
                             "count": len(recs)}))

    if fmt == "csv":
        cols = ["illustration_code", "illustration_name", "illustration_name_pinyin", "run_key", "image_id", "book_title", "page_num", "model", "provider",
                "stored_at", "status", "archive_status", "academic_class", "academic_subclass", "subject",
                "herb_ancient", "herb_modern", "procedure_step", "text_image_verdict",
                "corresponding_text"]
        buf = _io.StringIO()
        buf.write("﻿")  # BOM，便于 Excel 识别 UTF-8
        w = _csv.writer(buf)
        w.writerow(cols)
        for r in recs:
            ann = r.get("annotation") or {}
            w.writerow([
                r.get("illustration_code", ""), r.get("illustration_name", ""),
                r.get("illustration_name_pinyin", ""),
                r.get("run_key", ""), r.get("image_id", ""), r.get("book_title", ""),
                r.get("page_num", ""), r.get("model", ""), r.get("provider", ""),
                r.get("stored_at", ""), r.get("status", ""), r.get("archive_status", ""),
                ann.get("academicClass") or ann.get("type") or "", ann.get("academicSubclass") or "",
                ann.get("subject") or "", ann.get("herbClassical") or "", ann.get("herbModern") or "",
                ann.get("procedureStep") or "",
                (r.get("crossref") or {}).get("verdict") or ann.get("aiVerdict") or "",
                ann.get("correspondingText") or "",
            ])
        return cors(jsonify({"ok": True, "filename": f"annotations_{ts}.csv",
                             "mime": "text/csv", "content": buf.getvalue(), "count": len(recs)}))

    # html 报告（元数据卡片；归档无图像数据，故为图文信息表）
    cards = []
    for r in recs:
        ann = r.get("annotation") or {}
        e = _html.escape
        rows = "".join(
            f"<tr><td>{e(k)}</td><td>{e(str(v))}</td></tr>"
            for k, v in [
                ("编号", r.get("illustration_code", "")), ("名称", r.get("illustration_name", "")),
                ("名称拼音", r.get("illustration_name_pinyin", "")),
                ("图片", r.get("image_id", "")), ("书·页", f"{r.get('book_title','')} 第{r.get('page_num','')}页"),
                ("模型", r.get("model", "")), ("时间", r.get("stored_at", "")), ("状态", r.get("status", "")),
                ("归档状态", r.get("archive_status", "")),
                ("类别", ann.get("academicClass") or ann.get("type") or ""), ("子类", ann.get("academicSubclass") or ""),
                ("主体", ann.get("subject") or ""), ("古名/今名", f"{ann.get('herbClassical') or ''} / {ann.get('herbModern') or ''}"),
                ("炮制工序", ann.get("procedureStep") or ""),
                ("图文互证", (r.get("crossref") or {}).get("verdict") or ann.get("aiVerdict") or ""),
            ] if str(v).strip()
        )
        ct = e(ann.get("correspondingText") or "")
        cards.append(f'<div class="c"><table>{rows}</table>'
                     + (f'<div class="ct"><b>对应原文</b><br>{ct}</div>' if ct else "") + "</div>")
    style = ("body{font-family:'Microsoft YaHei',sans-serif;background:#f5f6f8;margin:0;padding:24px}"
             ".c{background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:14px 16px;margin:0 0 14px;max-width:860px}"
             "table{width:100%;border-collapse:collapse;font-size:13px}td{padding:4px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top}"
             "td:first-child{color:#888;width:90px;white-space:nowrap}"
             ".ct{margin-top:8px;padding:8px 10px;background:#fffbf0;border-left:3px solid #c6a84b;font-size:13px;line-height:1.9}")
    html_doc = (f"<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>"
                f"<title>标注归档导出 {ts}</title><style>{style}</style></head><body>"
                f"<h2>标注归档导出（{len(recs)} 条）· {ts}</h2>" + "".join(cards) + "</body></html>")
    return cors(jsonify({"ok": True, "filename": f"annotations_{ts}.html",
                         "mime": "text/html", "content": html_doc, "count": len(recs)}))

@app.route("/api/log-client-error", methods=["POST", "OPTIONS"])
def log_client_error():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    log_api_failure(
        body.get("kind") or "client_runtime",
        body.get("provider") or "",
        body.get("model") or "",
        body.get("message") or "",
        status_code=body.get("status_code"),
        response_text=body.get("stack") or "",
        extra=body.get("extra") or {},
    )
    return jsonify({"ok": True, "logged": str(API_FAILURE_LOG_PATH)})

# ── 页面文字提取接口（AI OCR，供扫描件使用）─────────────────────────────

@app.route("/api/extract-page-text", methods=["POST", "OPTIONS"])
def extract_page_text():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    page_b64 = body.get("page_b64", "")
    if not page_b64:
        return jsonify({"error": "Missing page_b64"}), 400

    cfg = load_config()
    api_key  = body.get("api_key") or cfg.get("api_key", "")
    provider = body.get("provider") or cfg.get("api_provider", "qwen")
    model    = body.get("model")    or cfg.get("model", "qwen-vl-plus")

    if not api_key:
        return jsonify({"error": "No API key configured"}), 400

    if not supports_vision(provider):
        return jsonify({"error": DEEPSEEK_NO_VISION_MSG}), 400
    if not provider_chat_url(provider):
        return jsonify({"error": f"Unsupported provider: {provider}"}), 400

    ocr_prompt = (
        "This is a page from a Chinese classical herbal medicine book. "
        "Please transcribe ALL text visible on this page, character by character, "
        "preserving column order (right-to-left, top-to-bottom for vertical text). "
        "Output only the transcribed text, no explanation."
    )
    content_parts = [image_part(b64=page_b64, mime="image/jpeg"), text_part(ocr_prompt)]

    try:
        full_text = call_vision_content(provider, api_key, model, content_parts,
                                        max_tokens=2000, timeout=90).strip()
        return jsonify({
            "ok":          True,
            "full_text":   full_text,
            "text_source": "ai_ocr",
            "model":       model,
            "extracted_at": datetime.now().isoformat(),
        })
    except VisionAPIError as e:
        log_api_failure("ocr", provider, model, str(e),
                        status_code=e.status_code, response_text=e.response_text,
                        extra={"endpoint": "/api/extract-page-text"})
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        log_api_failure("ocr", provider, model, str(e),
                        extra={"endpoint": "/api/extract-page-text"})
        return jsonify({"error": str(e)}), 500


# ── 全书扫描接口（OCR + 插图判断，合并一次调用）────────────────────────────

def build_scan_page_prompt(*, text_direction="不明", title_label_direction="不明",
                           page_order="从右到左", reading_note="", input_region="content_rect"):
    """Build the scan prompt from the book's registered reading rules.

    The image is either the registered content rectangle or an explicitly chosen
    full-page fallback. These values control transcription order only; they must
    not inject research conclusions.
    """
    text_direction = str(text_direction or "不明").strip()
    title_label_direction = str(title_label_direction or "不明").strip()
    page_order = str(page_order or "从右到左").strip()
    reading_note = str(reading_note or "").strip()
    reading_rules = (
        f"正文方向：{text_direction}\n"
        f"题签方向：{title_label_direction}\n"
        f"书页顺序：{page_order}\n"
        f"补充读向规则：{reading_note or '无'}"
    )
    input_region = str(input_region or "content_rect").strip().lower()
    if input_region == "full_page":
        image_scope = (
            "This image is an explicitly selected FULL ORIGINAL PAGE rendered from the original PDF. "
            "No content rectangle was available. Ignore outer margins, collector seals, watermarks, "
            "digital-library marks, page frames and other page furniture when transcribing and detecting illustrations."
        )
        scope_name = "full original page"
    else:
        image_scope = (
            "This image is the registered CONTENT RECTANGLE (正文框/版心) rendered "
            "from the original PDF page of a Chinese classical medicine book. "
            "Margins outside the content rectangle are intentionally excluded."
        )
        scope_name = "content rectangle"
    return (
        f"{image_scope}\n\n"
        f"【本书已登记的阅读规则】\n{reading_rules}\n\n"
        "Please do TWO things:\n"
        f"1. Transcribe ALL Chinese text visible inside this {scope_name}, character by character. "
        "Follow the registered text/title directions above; do not default to modern left-to-right order. "
        "Preserve the resulting reading order in full_text. "
        f"If the {scope_name} is mostly or entirely an illustration with little or no text, "
        "output an empty string for full_text.\n"
        f"2. Determine whether this {scope_name} contains a genuine CONTENT illustration (插图): "
        "medical/botanical/animal/mineral drawings, anatomical or 脏腑 diagrams, "
        "经穴/经络 charts, 器具 (instruments), 养生/功法 figures, portraits of persons, "
        "理论 diagrams — i.e. a substantive pictorial drawing that is part of the book's content.\n"
        "   Set has_illustration=FALSE for covers/title/front-matter pages, watermarks, collector seals, "
        "digital-library logos, page frames, borders, column rules, fish-tail marks, or purely textual pages.\n"
        f"3. If there is an illustration, determine whether the {scope_name} contains MULTIPLE "
        "independent illustrations rather than one single illustration. Set has_multiple_illustrations=TRUE "
        "only when there are clearly two or more separable content illustrations.\n\n"
        "Respond ONLY with a JSON object (no markdown, no explanation):\n"
        '{"full_text": "...transcribed text...", '
        '"has_illustration": true or false, '
        '"has_multiple_illustrations": true or false, '
        '"confidence": "high" or "medium" or "low", '
        '"detected_text_direction": "实际观察到的文字方向或不明", '
        '"detected_title_label_direction": "实际观察到的题签方向或不明", '
        '"note": "用中文简要描述插图内容或读向冲突；否则填空字符串"}'
    )

@app.route("/api/scan-page-ocr-detect", methods=["POST", "OPTIONS"])
def scan_page_ocr_detect():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body = request.get_json(force=True, silent=True) or {}
    page_b64 = body.get("page_b64", "")
    if not page_b64:
        return jsonify({"error": "Missing page_b64"}), 400

    cfg = load_config()
    api_key  = body.get("api_key") or cfg.get("api_key", "")
    provider = body.get("provider") or cfg.get("api_provider", "qwen")
    model    = body.get("model")    or cfg.get("model", "qwen-vl-plus")

    if not api_key:
        return jsonify({"error": "No API key configured"}), 400

    if not supports_vision(provider):
        return jsonify({"error": DEEPSEEK_NO_VISION_MSG}), 400

    if not provider_chat_url(provider):
        return jsonify({"error": f"Unsupported provider: {provider}"}), 400

    prompt = build_scan_page_prompt(
        text_direction=body.get("text_direction", "不明"),
        title_label_direction=body.get("title_label_direction", "不明"),
        page_order=body.get("page_order", "从右到左"),
        reading_note=body.get("reading_note", ""),
        input_region=body.get("input_region", "content_rect"),
    )
    content_parts = [image_part(b64=page_b64, mime="image/jpeg"), text_part(prompt)]

    try:
        raw = call_vision_content(provider, api_key, model, content_parts,
                                  max_tokens=2500, timeout=90).strip()
        parsed = parse_annotation_json(raw)
        if parsed.get("parse_failed"):
            # 解析失败时尽量保留原始文字，插图判断置为 uncertain
            parsed = {"full_text": raw[:2000], "has_illustration": False,
                      "has_multiple_illustrations": False,
                      "confidence": "low", "note": "JSON parse failed"}

        return cors(jsonify({
            "ok":              True,
            "full_text":       parsed.get("full_text", "").strip(),
            "has_illustration": bool(parsed.get("has_illustration", False)),
            "has_multiple_illustrations": bool(parsed.get("has_multiple_illustrations", False)),
            "confidence":      parsed.get("confidence", "low"),
            "note":            parsed.get("note", ""),
            "detected_text_direction": parsed.get("detected_text_direction", "不明"),
            "detected_title_label_direction": parsed.get("detected_title_label_direction", "不明"),
            "scan_input_version": body.get("scan_input_version", ""),
            "input_region":    body.get("input_region", ""),
            "model":           model,
            "scanned_at":      datetime.now().isoformat(),
        }))
    except VisionAPIError as e:
        log_api_failure("scan", provider, model, str(e),
                        status_code=e.status_code, response_text=e.response_text,
                        extra={"endpoint": "/api/scan-page-ocr-detect",
                               "book_id": body.get("book_id", ""),
                               "page_num": body.get("page_num")})
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        log_api_failure("scan", provider, model, str(e),
                        extra={"endpoint": "/api/scan-page-ocr-detect",
                               "book_id": body.get("book_id", ""),
                               "page_num": body.get("page_num")})
        return jsonify({"error": str(e)}), 500


# ── AI 标注代理 ───────────────────────────────────────────────────────────

@app.route("/api/annotate", methods=["POST", "OPTIONS"])
def annotate():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body      = request.get_json()
    image_b64 = body.get("image_b64", "")
    image_url = body.get("image_url", "")
    page_b64  = body.get("page_b64", "")
    prompt    = body.get("prompt", "")
    provider  = body.get("provider", "qwen")
    api_key   = body.get("api_key", "")
    model     = body.get("model", "qwen3.6-plus")

    if not api_key:
        cfg = load_config()
        api_key = cfg.get("api_key", "")
        if not model or model == "qwen3.6-plus":
            model = cfg.get("model", "qwen3.6-plus")
        if not provider or provider == "qwen":
            provider = cfg.get("api_provider", "qwen")

    if not api_key:
        return jsonify({"error": "未配置 API Key，请在 config.json 或设置面板中填写"}), 400

    try:
        result = _call_api(provider, api_key, model, image_b64, image_url, prompt,
                           page_b64=page_b64)
        return jsonify({"ok": True, "annotation": result})
    except Exception as e:
        log_api_failure(
            "annotate", provider, model, str(e),
            extra={
                "endpoint":      "/api/annotate",
                "has_image_b64": bool(image_b64),
                "has_image_url": bool(image_url),
                "has_page_b64":  bool(page_b64),
            },
        )
        return jsonify({"error": str(e)}), 500


def _call_api(provider, api_key, model, image_b64, image_url, prompt, page_b64=""):
    """统一 API 调用入口（薄封装 vision_client，保留 bridge 侧失败日志）。"""
    img_content = image_part(b64=image_b64) if image_b64 else image_part(url=image_url)
    if not img_content:
        raise ValueError("未提供图像（image_b64 或 image_url）")

    content_parts = []
    if page_b64:
        content_parts.append(image_part(b64=page_b64, mime="image/jpeg"))
    content_parts.append(img_content)
    content_parts.append(text_part(prompt))

    try:
        response = call_vision_content(
            provider, api_key, model, content_parts,
            max_tokens=1800, return_metadata=True,
        )
    except VisionAPIError as e:
        if e.status_code is not None:
            log_api_failure("annotate", provider, model, f"API error {e.status_code}",
                            status_code=e.status_code, response_text=e.response_text,
                            extra={"endpoint": "/api/annotate"})
        raise RuntimeError(str(e))
    parsed = parse_annotation_json(response["content"])
    parsed["_response_meta"] = {
        "finish_reason": response.get("finish_reason", ""),
        "usage": response.get("usage") or {},
    }
    return parsed


# 兼容别名：旧代码/测试可能引用 _parse_annotation
_parse_annotation = parse_annotation_json


# ── AI 图像修复已拆至 image_restore.py（纯计算，重依赖按需 import）──
import image_restore as _restore


@app.route("/api/restore", methods=["POST", "OPTIONS"])
def api_restore():
    """图像修复接口，支持两种模式：
      mode='doc'  文档优化（默认）：边缘保留放大+锐化，适合古籍线稿/文字
      mode='ai'   AI超分辨率：Real-ESRGAN，适合纯插图/绘画区域
    请求体：{ image_b64, mode?, de_yellow?, scale?, sharpen? }
    """
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))

    body      = request.get_json(force=True, silent=True) or {}
    image_b64 = body.get("image_b64", "")
    mode      = body.get("mode", "doc")          # 'doc' | 'ai'
    de_yellow = bool(body.get("de_yellow", True))
    scale     = int(body.get("scale", 2))        # doc 模式默认 ×2
    sharpen   = float(body.get("sharpen", 0.8))  # 0~2，文档锐化强度

    if not image_b64:
        return cors(jsonify({"error": "缺少 image_b64"})), 400

    try:
        import numpy as np
        from PIL import Image
        import io

        img_bytes = base64.b64decode(image_b64)
        pil_img   = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        w0, h0    = pil_img.size
        img_np    = np.array(pil_img)[:, :, ::-1]  # RGB → BGR

        if mode == "gen":
            # ── 通义万象生图修复（仅展示，结果带水印）──
            cfg     = load_config()
            api_key = body.get("api_key") or cfg.get("api_key", "")
            if not api_key:
                return cors(jsonify({"error": "未配置 API Key，请在设置面板填写"})), 400
            result_b64, (w1, h1) = _restore.restore_with_gen_api(img_np, de_yellow, api_key)
            return cors(jsonify({
                "ok":            True,
                "result_b64":    result_b64,
                "width_before":  w0,
                "height_before": h0,
                "width_after":   w1,
                "height_after":  h1,
                "mode":          "gen",
                "display_only":  True,
            }))

        elif mode == "combined":
            # ── 组合增强：LAB 归一化 → AI ×2 → 锐化，适合图文混排页面 ──
            output_np = _restore.restore_combined(img_np, de_yellow, sharpen)
        elif mode == "ai":
            # ── 纯 AI 超分辨率（Real-ESRGAN ×4），适合纯插图区域 ──
            upsampler    = _restore.get_realesrgan()
            output_np, _ = upsampler.enhance(img_np, outscale=4)
            if de_yellow:
                output_np = _restore.correct_yellow(output_np)
        else:
            # ── 文档优化（背景归一化 + CLAHE + 锐化），适合纯文字/线稿 ──
            scale     = max(1, min(4, scale))
            output_np = _restore.restore_document(img_np, scale, de_yellow, sharpen)

        output_pil = Image.fromarray(output_np[:, :, ::-1])
        w1, h1     = output_pil.size
        buf        = io.BytesIO()
        output_pil.save(buf, format="JPEG", quality=92)
        result_b64 = base64.b64encode(buf.getvalue()).decode()

        return cors(jsonify({
            "ok":            True,
            "result_b64":    result_b64,
            "width_before":  w0,
            "height_before": h0,
            "width_after":   w1,
            "height_after":  h1,
            "mode":          mode,
        }))

    except RuntimeError as e:
        return cors(jsonify({
            "error":        str(e),
            "install_hint": "pip install realesrgan basicsr",
        })), 500
    except Exception as e:
        import traceback
        return cors(jsonify({
            "error": str(e),
            "trace": traceback.format_exc()[-1000:],
        })), 500


# ── D-Data Center V1：标注数据中心、备份恢复与健康检查 ─────────────────────
# 设计原则：
#   - 只读标注数据用于计数/健康检查；不写 aiDraft/annotation/reviewDiff/status/reviewEvents。
#   - 所有写入/下载/解包路径服务端生成与校验，拒绝绝对/盘符/.. 路径。
#   - 不在真实数据上测试恢复；不在生产只读库执行写操作。
#   - 不暴露数据根目录/datasetId/环境变量给前端日常操作。
DATA_BACKUP_DIR = DATA_DIR / "_data_backups"
DATA_BACKUP_DIR.mkdir(parents=True, exist_ok=True)


class DataCenterError(Exception):
    """数据中心模块统一错误。"""
    def __init__(self, message: str, *, code: str = "DATA_CENTER_ERROR", status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


# 任务书 §5.1 默认备份白名单（可恢复标注工作数据）。
# 每条 = (相对 DATA_DIR 的路径模板, 是否按书展开, 缺失时是否允许)
_DATA_BACKUP_WHITELIST = [
    ("global.json",        False, True),
    ("asset-links.json",   False, True),
    ("books/<id>/book.json",   True, False),
    ("books/<id>/images.json", True, False),
    ("books/<id>/meta.json",   True, True),
]


def _is_reference_backup_rel(rel: str) -> bool:
    """参考文本备份路径：text_references/<scope>/<reference>/<file>。"""
    parts = PurePosixPath(str(rel or "").replace("\\", "/")).parts
    if len(parts) != 4 or parts[0] != "text_references":
        return False
    if any(part in {"", ".", ".."} or safe_segment(part) != part for part in parts[1:3]):
        return False
    filename = parts[3]
    if filename in {
        "metadata.json",
        "content.txt",
        "edited_content.txt",
        "uncertain_marks.json",
    }:
        return True
    return filename.startswith("original.") and Path(filename).suffix.lower() in REFERENCE_TEXT_EXTENSIONS


# 任务书 §5.2 自动备份触发点（由各批量端点调用 _data_center_auto_backup）。
# 单条编辑继续走 atomic_write_json + 历史事件，不创建 ZIP。
_DATA_CENTER_AUTO_BACKUP_REASONS = {
    "before_bulk_ocr": "批量 OCR 前",
    "before_bulk_annotate": "批量重新标注前",
    "before_bulk_confirm": "批量确认前",
    "before_bulk_merge_split": "批量合并/拆分前",
    "before_restore": "恢复前",
}

# 任务书 §8 健康检查项（只读，不自动修复）。
HEALTH_CHECK_ITEMS = [
    ("book_json_parse",   "book.json 可解析"),
    ("images_json_parse", "images.json 可解析"),
    ("duplicate_illus_id", "插图 ID 重复"),
    ("pdf_missing",       "pdfSource.bookId 与 PDF 缺失"),
    ("confirmed_no_crop", "已确认插图缺有效裁框"),
    ("merge_residual",    "合并插图残留重复可标注子图"),
    ("ocr_text_broken",   "OCR/文字资产中断或缺失"),
    ("version_ctx_missing", "必要版本上下文缺失"),
    ("empty_record",      "异常空记录"),
    ("asset_links_parse", "asset-links.json 可解析"),
    ("asset_stale",       "素材 stale"),
    ("backup_manifest",   "备份 manifest 可校验"),
]


def _data_center_backup_dir() -> Path:
    """返回活动数据根目录下的 _data_backups/，确保存在。"""
    DATA_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_BACKUP_DIR


def _data_center_collect_whitelist_files() -> list:
    """收集当前 DATA_DIR 下白名单文件，返回 [(rel_posix_path, abs_path), ...]。
    缺失的可选文件（如 global.json）跳过；缺失的必要文件（book.json/images.json）也跳过
    并在 manifest 中标注 present:false。"""
    collected = []
    seen_books = set()
    # 1) 全局文件
    for rel, _is_book, _optional in _DATA_BACKUP_WHITELIST:
        if "<id>" in rel:
            continue
        abs_p = DATA_DIR / rel
        if abs_p.exists() and abs_p.is_file():
            collected.append((rel, abs_p))
    # 2) 按书展开
    if BOOKS_DIR.exists():
        for book_dir in sorted(BOOKS_DIR.iterdir()):
            if not book_dir.is_dir():
                continue
            bid = book_dir.name
            seen_books.add(bid)
            for tmpl, _is_book, _optional in _DATA_BACKUP_WHITELIST:
                if "<id>" not in tmpl:
                    continue
                rel = tmpl.replace("<id>", bid)
                abs_p = DATA_DIR / rel
                if abs_p.exists() and abs_p.is_file():
                    collected.append((rel, abs_p))
    # 3) 整书参考文本属于校文工作资产，递归收集受限的三类文件。
    reference_root = DATA_DIR / "text_references"
    if reference_root.exists():
        for abs_p in sorted(reference_root.rglob("*")):
            if not abs_p.is_file():
                continue
            rel = abs_p.relative_to(DATA_DIR).as_posix()
            if _is_reference_backup_rel(rel):
                collected.append((rel, abs_p))
    return collected


def _data_center_build_manifest(reason: str, file_entries: list, dataset_id: str,
                                dataset_label: str, schema_ver: str,
                                classification_ver: str, prompt_ver: str) -> dict:
    """构建 backup-manifest.json（任务书 §5.1）。"""
    total_size = sum(e["size"] for e in file_entries)
    book_count = len({e["rel"].split("/")[1] for e in file_entries
                      if e["rel"].startswith("books/") and len(e["rel"].split("/")) > 2})
    return {
        "schema": "data-center-backup-v1",
        "created_at": datetime.now().astimezone().isoformat(),
        "reason": reason,  # manual / automatic / before_restore
        "dataset": {
            "id": dataset_id,
            "label": dataset_label,
            "read_only": DATA_SOURCE_READ_ONLY,
        },
        "versions": {
            "schemaVersion": schema_ver,
            "classificationVersion": classification_ver,
            "promptVersion": prompt_ver,
        },
        "files": file_entries,           # [{rel, size, sha256}]
        "summary": {
            "book_count": book_count,
            "record_count": sum(e.get("_record_count", 0) for e in file_entries),
            "total_size": total_size,
            "file_count": len(file_entries),
        },
    }


def _data_center_write_backup(reason: str) -> dict:
    """创建一份 ZIP 备份 + manifest，返回 {backup_id, zip_name, manifest_name, summary}。
    不自动删除旧备份（任务书 §5.2）。只读库允许备份（仅读主数据+写备份目录，不修改主数据）。"""
    # 手动/批量前备份也会与后台自动备份串行，避免同秒文件名冲突或 ZIP 互相覆盖。
    with _backup_write_lock:
        files = _data_center_collect_whitelist_files()
        if not files:
            raise DataCenterError("未找到可备份的标注工作数据。",
                                  code="NO_BACKUP_DATA", status=400)

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_id = f"backup_{ts}_{reason}"
        zip_name = f"{backup_id}.zip"
        manifest_name = f"{backup_id}.manifest.json"
        zip_path = DATA_BACKUP_DIR / zip_name
        manifest_path = DATA_BACKUP_DIR / manifest_name

        # 计算 SHA-256 + 收集 manifest 条目（按 rel 排序确保稳定）
        files_sorted = sorted(files, key=lambda x: x[0])
        file_entries = []
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for rel, abs_p in files_sorted:
                sha = _sha256_file(abs_p)
                size = abs_p.stat().st_size
                # 记录数：images.json 按列表长度，其他为 0
                rec_count = 0
                if rel.endswith("images.json"):
                    try:
                        with open(abs_p, encoding="utf-8") as f:
                            data = json.load(f)
                        rec_count = len(data) if isinstance(data, list) else 0
                    except Exception:
                        rec_count = 0
                file_entries.append({
                    "rel": rel, "size": size, "sha256": sha,
                    "_record_count": rec_count,
                })
                # 写入 ZIP 时使用 posix 相对路径，杜绝绝对/盘符前缀
                zf.write(abs_p, arcname=rel)

        # 写 manifest（不放入 ZIP，便于不下载即可校验）
        manifest = _data_center_build_manifest(
            reason=reason, file_entries=[
                {k: v for k, v in e.items() if not k.startswith("_")} for e in file_entries
            ],
            dataset_id=DATA_SOURCE_ID, dataset_label=DATA_SOURCE_LABEL,
            schema_ver="annotation-eval-v2",
            classification_ver="academic-12class-v1",
            prompt_ver="quick_search_v5_explicit_name",
        )
        atomic_write_json(manifest_path, manifest)

        return {
            "backup_id": backup_id,
            "zip_name": zip_name,
            "manifest_name": manifest_name,
            "summary": manifest["summary"],
            "manifest": manifest,
        }


def _data_center_prune_automatic_backups() -> None:
    """保留统一自动备份的最近窗口与每日末份。

    只清理 manifest.reason == automatic 的 ZIP/manifest 对；手动备份、批量操作前
    备份、恢复前备份及旧 AUTO_BACKUP_DIR 中的 JSON 快照均永不由此函数删除。
    """
    automatic = []
    for mf in sorted(DATA_BACKUP_DIR.glob("backup_*.manifest.json")):
        try:
            with open(mf, encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            continue
        if manifest.get("reason") == "automatic":
            automatic.append((mf, manifest))
    if len(automatic) <= AUTO_BACKUP_KEEP:
        return
    keep = {mf for mf, _ in automatic[-AUTO_BACKUP_KEEP:]}
    daily_last = {}
    for mf, manifest in automatic:
        created = str(manifest.get("created_at") or "")[:10]
        if created:
            daily_last[created] = mf
    keep.update(list(daily_last.values())[-AUTO_BACKUP_DAILY_KEEP:])
    for mf, _manifest in automatic:
        if mf in keep:
            continue
        zip_path = DATA_BACKUP_DIR / f"{mf.name[:-len('.manifest.json')]}.zip"
        for target in (mf, zip_path):
            try:
                target.unlink(missing_ok=True)
            except Exception as e:
                print(f"[auto-backup] 清理旧备份失败：{target.name}: {e}")


def _data_center_auto_backup(reason_key: str) -> dict | None:
    """批量操作前自动备份（任务书 §5.2）。reason_key 必须在白名单内。
    备份文件名使用 reason_key 作为后缀，便于区分触发来源。
    失败时返回 None（不阻塞主操作），由调用方决定是否记录日志。"""
    if reason_key not in _DATA_CENTER_AUTO_BACKUP_REASONS:
        return None
    if DATA_SOURCE_READ_ONLY:
        return None
    try:
        return _data_center_write_backup(reason=reason_key)
    except Exception as e:
        print(f"[data-center] 自动备份失败（{reason_key}）: {e}")
        return None


def _data_center_list_backups() -> list:
    """列出所有备份（按时间倒序），返回 [{backup_id, reason, created_at, summary, has_zip, has_manifest}]。"""
    items = []
    for mf in sorted(DATA_BACKUP_DIR.glob("backup_*.manifest.json"), reverse=True):
        try:
            with open(mf, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        bid = mf.name[:-len(".manifest.json")]
        zip_path = DATA_BACKUP_DIR / f"{bid}.zip"
        items.append({
            "backup_id": bid,
            "reason": data.get("reason", "unknown"),
            "created_at": data.get("created_at", ""),
            "summary": data.get("summary", {}),
            "manifest": data,
            "has_zip": zip_path.exists(),
            "has_manifest": True,
        })
    return items


def _data_center_find_backup(backup_id: str) -> Path | None:
    """安全定位备份 ZIP：仅允许 backup_YYYYMMDD_HHMMSS_<reason> 格式，拒绝穿越。"""
    bid = str(backup_id or "").strip()
    if not re.fullmatch(r"backup_\d{8}_\d{6}_[a-z_]+", bid):
        return None
    candidate = (DATA_BACKUP_DIR / f"{bid}.zip").resolve()
    try:
        candidate.relative_to(DATA_BACKUP_DIR.resolve())
    except ValueError:
        return None
    return candidate if candidate.exists() else None


def _data_center_load_manifest(backup_id: str) -> dict | None:
    """加载指定备份的 manifest。"""
    bid = str(backup_id or "").strip()
    if not re.fullmatch(r"backup_\d{8}_\d{6}_[a-z_]+", bid):
        return None
    mf = DATA_BACKUP_DIR / f"{bid}.manifest.json"
    if not mf.exists():
        return None
    try:
        with open(mf, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _data_center_compute_summary() -> dict:
    """计算数据中心总览（任务书 §4）。只读，不修改任何标注字段。"""
    books = []
    images = []
    global_present = GLOBAL_PATH.exists()
    if global_present:
        try:
            with open(GLOBAL_PATH, encoding="utf-8") as f:
                gdata = json.load(f)
            images = list(gdata.get("images", []))
        except Exception:
            gdata = {}
    else:
        gdata = {}

    page_count = 0
    if BOOKS_DIR.exists():
        for book_dir in sorted(BOOKS_DIR.iterdir()):
            if not book_dir.is_dir():
                continue
            book_json = book_dir / "book.json"
            images_json = book_dir / "images.json"
            if book_json.exists():
                try:
                    with open(book_json, encoding="utf-8") as f:
                        b = json.load(f)
                    books.append(b)
                    page_count += int(b.get("pageCount") or len(b.get("pages") or []) or 0)
                except Exception:
                    pass
            if images_json.exists():
                try:
                    with open(images_json, encoding="utf-8") as f:
                        images.extend(json.load(f))
                except Exception:
                    pass

    # 状态计数
    status_count = {"confirmed": 0, "pending_review": 0, "pending_annotate": 0, "abnormal": 0}
    for img in images:
        st = str(img.get("status") or "").lower()
        if st == "ok":
            status_count["confirmed"] += 1
        elif st in ("pending", "review", "reviewing"):
            status_count["pending_review"] += 1
        elif st in ("", "new", "draft", "ai_draft"):
            status_count["pending_annotate"] += 1
        else:
            status_count["abnormal"] += 1

    # 最近写入时间 = 所有白名单文件 mtime 最大值
    mtimes = []
    for rel, _is_book, _opt in _DATA_BACKUP_WHITELIST:
        if "<id>" in rel:
            continue
        p = DATA_DIR / rel
        if p.exists():
            mtimes.append(p.stat().st_mtime)
    if BOOKS_DIR.exists():
        for book_dir in BOOKS_DIR.iterdir():
            if not book_dir.is_dir():
                continue
            for fn in ("book.json", "images.json", "meta.json"):
                p = book_dir / fn
                if p.exists():
                    mtimes.append(p.stat().st_mtime)
    last_write_at = datetime.fromtimestamp(max(mtimes)).astimezone().isoformat() if mtimes else None

    # 最近备份时间
    backups = _data_center_list_backups()
    last_backup_at = backups[0]["created_at"] if backups else None

    # 素材包扫描
    asset_sources_count = 0
    if ASSET_ROOT is not None:
        try:
            index = _read_asset_source_index(ASSET_ROOT)
            asset_sources_count = len(index.get("sources", {}))
        except Exception:
            pass
    # stale 统计读 asset-links.json 的 package status（任务书 §8）
    asset_stale_count = len(_list_asset_stale_packages())

    return {
        "dataset": {
            "id": DATA_SOURCE_ID,
            "label": DATA_SOURCE_LABEL,
            "mode": DATA_SOURCE_MODE,
            "read_only": DATA_SOURCE_READ_ONLY,
        },
        "global_present": global_present,
        "project": gdata.get("project", "中医古籍插图标注"),
        "counts": {
            "books": len(books),
            "pages": page_count,
            "illustrations": len(images),
            "asset_sources": asset_sources_count,
            "asset_stale": asset_stale_count,
            "backups": len(backups),
        },
        "status_counts": status_count,
        "last_write_at": last_write_at,
        "last_backup_at": last_backup_at,
        "versions": {
            "schemaVersion": "annotation-eval-v2",
            "classificationVersion": "academic-12class-v1",
            "promptVersion": "quick_search_v5_explicit_name",
        },
    }


def _data_center_health_check() -> dict:
    """只读健康检查（任务书 §8）。不自动修复。"""
    problems = []
    # 1) book.json / images.json 可解析
    books_data = []
    if BOOKS_DIR.exists():
        for book_dir in sorted(BOOKS_DIR.iterdir()):
            if not book_dir.is_dir():
                continue
            bid = book_dir.name
            book_json = book_dir / "book.json"
            images_json = book_dir / "images.json"
            book = None
            imgs = []
            if book_json.exists():
                try:
                    with open(book_json, encoding="utf-8") as f:
                        book = json.load(f)
                    books_data.append((bid, book_dir, book))
                except Exception as e:
                    problems.append({
                        "severity": "error", "item": "book_json_parse",
                        "book_id": bid, "cause": f"book.json 无法解析：{e}",
                        "impact": "该书标注无法读取", "suggestion": "从备份恢复或修复 JSON",
                    })
            if images_json.exists():
                try:
                    with open(images_json, encoding="utf-8") as f:
                        imgs = json.load(f)
                except Exception as e:
                    problems.append({
                        "severity": "error", "item": "images_json_parse",
                        "book_id": bid, "cause": f"images.json 无法解析：{e}",
                        "impact": "该书插图无法读取", "suggestion": "从备份恢复或修复 JSON",
                    })
            # 2) 插图 ID 重复
            seen = {}
            for img in imgs:
                iid = img.get("id") if isinstance(img, dict) else None
                if iid is None:
                    continue
                seen[iid] = seen.get(iid, 0) + 1
            for iid, cnt in seen.items():
                if cnt > 1:
                    problems.append({
                        "severity": "error", "item": "duplicate_illus_id",
                        "book_id": bid, "illustration_id": iid,
                        "cause": f"插图 ID 重复 {cnt} 次",
                        "impact": "标注与统计可能错乱", "suggestion": "修正重复 ID",
                    })
            # 3) pdfSource.bookId 与 PDF 是否存在
            if book and book.get("pdfSource", {}).get("bookId"):
                pdf_p = book_dir / "book.pdf"
                if not pdf_p.exists():
                    problems.append({
                        "severity": "warning", "item": "pdf_missing",
                        "book_id": bid, "cause": "book.pdf 缺失",
                        "impact": "无法渲染原书页面", "suggestion": "重新上传 PDF",
                    })
            # 4) 已确认插图缺有效裁框
            for img in imgs:
                if not isinstance(img, dict):
                    continue
                if img.get("status") == "ok":
                    crop = img.get("crop") or img.get("cropRect")
                    if not crop:
                        problems.append({
                            "severity": "warning", "item": "confirmed_no_crop",
                            "book_id": bid, "illustration_id": img.get("id"),
                            "cause": "已确认插图缺有效裁框",
                            "impact": "展示与论文冻结可能受影响", "suggestion": "补全裁框",
                        })
            # 5) 合并插图残留重复可标注子图（任务书 §8：实现现有合并字段下的实际残留检测）
            img_ids = {img.get("id") for img in imgs if isinstance(img, dict) and img.get("id")}
            # 5a) 主记录声明 imageMerge.items，但子图未标 mergedInto（仍可独立标注）= 残留
            for img in imgs:
                if not isinstance(img, dict):
                    continue
                img_id = img.get("id")
                merge_decl = img.get("imageMerge")
                items = merge_decl.get("items") if isinstance(merge_decl, dict) else None
                if not isinstance(items, list) or not items:
                    continue
                for child_id in items:
                    child_id = str(child_id or "").strip()
                    if not child_id:
                        continue
                    child = next((c for c in imgs if isinstance(c, dict) and c.get("id") == child_id), None)
                    if child is None:
                        problems.append({
                            "severity": "warning", "item": "merge_residual",
                            "book_id": bid, "illustration_id": img_id,
                            "cause": f"合并主记录声明子图 {child_id}，但该子图不存在",
                            "impact": "合并声明与实际数据不一致", "suggestion": "清理 imageMerge.items 或恢复子图记录",
                        })
                    elif not child.get("mergedInto"):
                        problems.append({
                            "severity": "warning", "item": "merge_residual",
                            "book_id": bid, "illustration_id": child_id,
                            "cause": f"子图被主记录 {img_id} 声明合并，但未标记 mergedInto，仍可独立标注",
                            "impact": "可能产生重复标注", "suggestion": "补全子图 mergedInto 字段或移除声明",
                        })
                    elif str(child.get("mergedInto")) != str(img_id):
                        problems.append({
                            "severity": "warning", "item": "merge_residual",
                            "book_id": bid, "illustration_id": child_id,
                            "cause": f"子图 mergedInto 指向 {child.get('mergedInto')}，与主记录 {img_id} 不一致",
                            "impact": "合并引用不一致", "suggestion": "修正 mergedInto 或 imageMerge.items",
                        })
            # 5b) 子图标 mergedInto 但主记录不存在 = 孤儿残留
            for img in imgs:
                if not isinstance(img, dict):
                    continue
                mi = img.get("mergedInto")
                if mi and str(mi) not in img_ids:
                    problems.append({
                        "severity": "warning", "item": "merge_residual",
                        "book_id": bid, "illustration_id": img.get("id"),
                        "cause": f"子图 mergedInto 指向 {mi}，但主记录不存在",
                        "impact": "孤儿合并子图", "suggestion": "删除该子图或恢复主记录",
                    })
            # 6) OCR/文字资产中断或缺失
            for img in imgs:
                if not isinstance(img, dict):
                    continue
                ta = img.get("textAsset") or {}
                ts = str(ta.get("textStatus") or "").lower()
                if ts in ("missing", "broken", "failed"):
                    problems.append({
                        "severity": "warning", "item": "ocr_text_broken",
                        "book_id": bid, "illustration_id": img.get("id"),
                        "cause": f"文字资产状态异常：{ts}",
                        "impact": "OCR 上下文缺失", "suggestion": "重跑 OCR 或补全文字",
                    })
            # 7) 必要版本上下文缺失
            for img in imgs:
                if not isinstance(img, dict):
                    continue
                if img.get("status") == "ok" and not img.get("versionContext"):
                    problems.append({
                        "severity": "info", "item": "version_ctx_missing",
                        "book_id": bid, "illustration_id": img.get("id"),
                        "cause": "已确认插图缺 versionContext",
                        "impact": "审核归因不完整", "suggestion": "重新生成版本上下文",
                    })
            # 8) 异常空记录
            for img in imgs:
                if not isinstance(img, dict):
                    continue
                if not img.get("id") and not img.get("pdfSource"):
                    problems.append({
                        "severity": "warning", "item": "empty_record",
                        "book_id": bid, "illustration_id": img.get("id"),
                        "cause": "异常空记录（无 id 与 pdfSource）",
                        "impact": "数据脏污", "suggestion": "删除或补全",
                    })
    # 9) asset-links.json 可解析
    al_path = DATA_DIR / "asset-links.json"
    if al_path.exists():
        try:
            with open(al_path, encoding="utf-8") as f:
                json.load(f)
        except Exception as e:
            problems.append({
                "severity": "error", "item": "asset_links_parse",
                "cause": f"asset-links.json 无法解析：{e}",
                "impact": "素材审查派生状态不可用", "suggestion": "从备份恢复或重建",
            })
    # 10) 素材 stale（读 asset-links.json 的 package status，任务书 §8）
    for sid, pid in _list_asset_stale_packages():
        problems.append({
            "severity": "info", "item": "asset_stale",
            "cause": f"素材包 {sid}/{pid} 标记为 stale",
            "impact": "素材审查可能引用过期内容", "suggestion": "重新导出素材源或重新审查",
        })
    # 11) 备份 manifest 可校验
    for mf in DATA_BACKUP_DIR.glob("backup_*.manifest.json"):
        try:
            with open(mf, encoding="utf-8") as f:
                m = json.load(f)
            bid = mf.name[:-len(".manifest.json")]
            zip_p = DATA_BACKUP_DIR / f"{bid}.zip"
            if not zip_p.exists():
                problems.append({
                    "severity": "warning", "item": "backup_manifest",
                    "cause": f"备份 {bid} 缺失 ZIP",
                    "impact": "该备份不可恢复", "suggestion": "删除该 manifest 或重新备份",
                })
        except Exception as e:
            problems.append({
                "severity": "warning", "item": "backup_manifest",
                "cause": f"manifest {mf.name} 无法解析：{e}",
                "impact": "该备份不可恢复", "suggestion": "删除该 manifest",
            })
    grouped = {}
    for problem in problems:
        key = (problem.get("severity", "info"), problem.get("item", "unknown"))
        entry = grouped.setdefault(key, {
            "severity": key[0], "item": key[1], "count": 0, "book_count": 0,
            "sample": problem,
            "_books": set(),
        })
        entry["count"] += 1
        if problem.get("book_id"):
            entry["_books"].add(problem["book_id"])
    problem_summary = []
    for entry in grouped.values():
        entry["book_count"] = len(entry.pop("_books"))
        problem_summary.append(entry)
    problem_summary.sort(key=lambda item: (
        {"error": 0, "warning": 1, "info": 2}.get(item["severity"], 3),
        -item["count"], item["item"],
    ))
    return {
        "ok": len([p for p in problems if p["severity"] == "error"]) == 0,
        "problems": problems,
        "problem_summary": problem_summary,
        "checked_items": [item for item, _ in HEALTH_CHECK_ITEMS],
        "problem_count": len(problems),
        "error_count": sum(1 for p in problems if p["severity"] == "error"),
        "warning_count": sum(1 for p in problems if p["severity"] == "warning"),
        "info_count": sum(1 for p in problems if p["severity"] == "info"),
    }


def _data_center_build_paper_freeze_package(out_path: Path) -> dict:
    """论文数据冻结包（任务书 §7.2）：已确认记录 + 版本上下文 + 审核归因 + 有效审核时间
    + 统计 + 数据字典 + 冻结 manifest。标记“仅供论文复算，不代表公开发布许可”。
    不改写论文数字、数据本体或展示数据规则。"""
    state = load_per_book_state() or {"books": [], "images": []}
    confirmed = [img for img in state.get("images", [])
                 if isinstance(img, dict) and img.get("status") == "ok"]
    # 仅保留必要字段，剥离模型原始响应、超长 _rawText、密钥
    records = []
    for img in confirmed:
        rec = {
            "id": img.get("id"),
            "pdfSource": img.get("pdfSource"),
            "annotation": img.get("annotation"),
            "versionContext": img.get("versionContext"),
            "reviewEvents": img.get("reviewEvents"),
            "effectiveReviewSeconds": img.get("effectiveReviewSeconds"),
            "reviewMeta": img.get("reviewMeta"),
        }
        records.append(rec)
    data_dict = {
        "id": "插图唯一标识",
        "pdfSource": "原书页来源 {bookId, pageNum}",
        "annotation": "人工确认标注字段集",
        "versionContext": "版本上下文（schema/classification/prompt/model/evidence/OCR）",
        "reviewEvents": "审核事件流",
        "effectiveReviewSeconds": "有效审核时间（秒）",
        "reviewMeta": "审核元数据（模式/原因/时间）",
    }
    manifest = {
        "schema": "paper-freeze-v1",
        "created_at": datetime.now().astimezone().isoformat(),
        "dataset": {"id": DATA_SOURCE_ID, "label": DATA_SOURCE_LABEL},
        "versions": {
            "schemaVersion": "annotation-eval-v2",
            "classificationVersion": "academic-12class-v1",
            "promptVersion": "quick_search_v5_explicit_name",
        },
        "record_count": len(records),
        "notice": "仅供论文复算，不代表公开发布许可",
        "data_dictionary": data_dict,
    }
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("records.json", json.dumps(records, ensure_ascii=False, indent=2))
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return {
        "ok": True,
        "file": out_path.name,
        "record_count": len(records),
        "size": out_path.stat().st_size,
        "manifest": manifest,
    }


def _data_center_validate_restore_zip(zip_path: Path, manifest: dict) -> list:
    """校验备份 ZIP：schema、白名单路径、hash、集合一致性、Zip Slip。
    返回 [(rel, abs_in_zip)], 校验通过；失败抛 DataCenterError。"""
    # manifest.schema 必须为 data-center-backup-v1（调用方已校验，此处双保险）
    if manifest.get("schema") != "data-center-backup-v1":
        raise DataCenterError(
            f"manifest.schema 不是 data-center-backup-v1（实际：{manifest.get('schema')}）",
            code="MANIFEST_SCHEMA_MISMATCH", status=400)
    expected_files = {f["rel"]: f for f in manifest.get("files", [])}
    # manifest.files 不得有重复条目
    raw_rels = [f.get("rel") for f in manifest.get("files", [])]
    seen_rels = set()
    for rel in raw_rels:
        if rel in seen_rels:
            raise DataCenterError(f"manifest 含重复条目：{rel}",
                                  code="MANIFEST_DUPLICATE_ENTRY", status=400)
        seen_rels.add(rel)
    # 遍历 ZIP，校验路径、hash、白名单；同时收集实际条目以检查集合一致性
    actual_entries = []
    actual_rels = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            # 拒绝绝对/盘符/..
            if name.startswith("/") or ":" in name.split("/", 1)[0] or ".." in name.split("/"):
                raise DataCenterError(f"ZIP 含非法路径：{name}",
                                      code="ZIP_PATH_ESCAPE", status=400)
            if name not in expected_files:
                raise DataCenterError(f"ZIP 含 manifest 外文件：{name}",
                                      code="ZIP_EXTRA_FILE", status=400)
            # 校验 SHA-256
            data = zf.read(info)
            actual_sha = hashlib.sha256(data).hexdigest()
            if actual_sha != expected_files[name]["sha256"]:
                raise DataCenterError(f"SHA-256 不匹配：{name}",
                                      code="ZIP_HASH_MISMATCH", status=400)
            # 校验白名单路径前缀
            allowed_prefixes = (
                "books/",
                "global.json",
                "asset-links.json",
                "text_references/",
            )
            if not any(name == p or name.startswith(p) for p in allowed_prefixes):
                raise DataCenterError(f"路径越出白名单：{name}",
                                      code="ZIP_PATH_NOT_WHITELISTED", status=400)
            actual_rels.append(name)
            actual_entries.append((name, data))
    # 集合一致性：ZIP 条目必须与 manifest.files 完全一致（缺文件/额外文件/重复均拒绝）
    actual_set = sorted(actual_rels)
    expected_set = sorted(expected_files.keys())
    if actual_set != expected_set:
        missing = sorted(set(expected_set) - set(actual_set))
        extra = sorted(set(actual_set) - set(expected_set))
        parts = []
        if missing:
            parts.append(f"ZIP 缺失文件：{missing}")
        if extra:
            parts.append(f"ZIP 含额外文件：{extra}")
        raise DataCenterError(
            "ZIP 文件集合与 manifest 不一致：" + "; ".join(parts),
            code="ZIP_SET_MISMATCH", status=400)
    # 重复条目（同名条目出现多次）
    if len(actual_rels) != len(set(actual_rels)):
        dupes = [r for r in actual_rels if actual_rels.count(r) > 1]
        raise DataCenterError(f"ZIP 含重复条目：{sorted(set(dupes))}",
                              code="ZIP_DUPLICATE_ENTRY", status=400)
    return actual_entries


def _data_center_apply_restore(actual_entries: list) -> dict:
    """仅对白名单文件执行原子替换（任务书 §6）。不删除额外记录。"""
    applied = []
    for rel, data in actual_entries:
        # 二次校验路径（防御）
        pure = PurePosixPath(rel)
        if pure.is_absolute() or any(p in {"", ".", ".."} for p in pure.parts):
            raise DataCenterError(f"恢复路径非法：{rel}",
                                  code="RESTORE_PATH_ESCAPE", status=400)
        if ":" in rel.split("/", 1)[0]:
            raise DataCenterError(f"恢复路径含盘符：{rel}",
                                  code="RESTORE_PATH_ESCAPE", status=400)
        dst = (DATA_DIR / Path(*pure.parts)).resolve()
        try:
            dst.relative_to(DATA_DIR.resolve())
        except ValueError:
            raise DataCenterError(f"恢复路径越界：{rel}",
                                  code="RESTORE_PATH_ESCAPE", status=400)
        # 仅允许白名单路径前缀
        allowed = False
        for tmpl, is_book, _opt in _DATA_BACKUP_WHITELIST:
            if "<id>" in tmpl:
                # books/<id>/xxx → 检查 books/<seg>/xxx 形式
                prefix = tmpl.split("<id>")[0]  # "books/"
                suffix = tmpl.split("<id>")[1]  # "/book.json"
                if rel.startswith(prefix) and rel.endswith(suffix):
                    mid = rel[len(prefix):-len(suffix)]
                    if mid and "/" not in mid and mid != "." and mid != "..":
                        allowed = True
                        break
            else:
                if rel == tmpl:
                    allowed = True
                    break
        if _is_reference_backup_rel(rel):
            allowed = True
        if not allowed:
            raise DataCenterError(f"恢复目标不在白名单：{rel}",
                                  code="RESTORE_NOT_WHITELISTED", status=400)
        # 原子写入：先写临时文件再 os.replace
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + f".restore.{uuid.uuid4().hex}.tmp")
        tmp.write_bytes(data)
        os.replace(str(tmp), str(dst))
        applied.append(rel)
    return {"applied": applied, "count": len(applied)}


@app.route("/api/data-center/summary", methods=["GET", "OPTIONS"])
def data_center_summary():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        return cors(jsonify({"ok": True, "summary": _data_center_compute_summary()}))
    except DataCenterError as e:
        return cors(jsonify({"ok": False, "code": e.code, "error": str(e)})), e.status
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


@app.route("/api/data-center/health", methods=["GET", "OPTIONS"])
def data_center_health():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        result = _data_center_health_check()
        return cors(jsonify({"ok": True, "health": result}))
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


@app.route("/api/data-center/backups", methods=["GET", "POST", "OPTIONS"])
def data_center_backups():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        if request.method == "POST":
            body = request.get_json(force=True, silent=True) or {}
            reason = str(body.get("reason") or "manual").strip().lower()
            if reason not in ("manual", "automatic", "before_restore"):
                return cors(jsonify({"ok": False, "code": "INVALID_REASON",
                                     "error": "reason 必须是 manual/automatic/before_restore"})), 400
            result = _data_center_write_backup(reason=reason)
            return cors(jsonify({"ok": True, "backup": result}))
        # GET
        return cors(jsonify({"ok": True, "backups": _data_center_list_backups()}))
    except DataCenterError as e:
        return cors(jsonify({"ok": False, "code": e.code, "error": str(e)})), e.status
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


@app.route("/api/data-center/auto-backup", methods=["POST", "OPTIONS"])
def data_center_auto_backup():
    """批量操作前自动备份（任务书 §5.2）。前端在批量 OCR/标注/确认前调用。
    reason_key 必须在 _DATA_CENTER_AUTO_BACKUP_REASONS 内。
    失败不阻塞主操作（返回 ok=true, backup=null, skipped=true）。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        body = request.get_json(force=True, silent=True) or {}
        reason_key = str(body.get("reason_key") or "").strip()
        if reason_key not in _DATA_CENTER_AUTO_BACKUP_REASONS:
            return cors(jsonify({"ok": False, "code": "INVALID_REASON_KEY",
                                 "error": f"reason_key 必须是 {sorted(_DATA_CENTER_AUTO_BACKUP_REASONS.keys())} 之一"})), 400
        result = _data_center_auto_backup(reason_key)
        if result is None:
            return cors(jsonify({"ok": True, "backup": None, "skipped": True,
                                 "reason": "只读库或无可备份数据"}))
        return cors(jsonify({"ok": True, "backup": result, "skipped": False}))
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


@app.route("/api/data-center/backups/<backup_id>/download", methods=["GET", "OPTIONS"])
def data_center_backup_download(backup_id):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        zip_path = _data_center_find_backup(backup_id)
        if not zip_path:
            return cors(jsonify({"ok": False, "code": "BACKUP_NOT_FOUND",
                                 "error": "备份不存在或路径非法"})), 404
        return send_file(
            str(zip_path),
            as_attachment=True,
            download_name=zip_path.name,
            mimetype="application/zip",
        )
    except Exception as e:
        return cors(jsonify({"ok": False, "code": "INTERNAL", "error": str(e)})), 500


@app.route("/api/data-center/backups/<backup_id>/restore", methods=["POST", "OPTIONS"])
def data_center_backup_restore(backup_id):
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        if DATA_SOURCE_READ_ONLY:
            return cors(jsonify({"ok": False, "code": "DATA_SOURCE_READ_ONLY",
                                 "error": "当前是只读数据源，禁止恢复"})), 423
        body = request.get_json(force=True, silent=True) or {}
        confirm_text = str(body.get("confirm_text") or "").strip()
        if confirm_text != "恢复":
            return cors(jsonify({"ok": False, "code": "CONFIRM_REQUIRED",
                                 "error": "请输入「恢复」以二次确认"})), 400
        # 1) 定位 ZIP + manifest
        zip_path = _data_center_find_backup(backup_id)
        if not zip_path:
            return cors(jsonify({"ok": False, "code": "BACKUP_NOT_FOUND",
                                 "error": "备份不存在或路径非法"})), 404
        manifest = _data_center_load_manifest(backup_id)
        if not manifest:
            return cors(jsonify({"ok": False, "code": "MANIFEST_MISSING",
                                 "error": "manifest 缺失或损坏"})), 400
        # 2) manifest.schema 必须为 data-center-backup-v1
        if manifest.get("schema") != "data-center-backup-v1":
            return cors(jsonify({"ok": False, "code": "MANIFEST_SCHEMA_MISMATCH",
                                 "error": f"manifest.schema 不是 data-center-backup-v1（实际：{manifest.get('schema')}）"})), 400
        # 3) 数据集兼容性：跨数据集硬拒绝（不得绕过）
        backup_dsid = manifest.get("dataset", {}).get("id", "")
        if backup_dsid and backup_dsid != DATA_SOURCE_ID:
            return cors(jsonify({
                "ok": False, "code": "DATASET_MISMATCH",
                "error": f"备份来自数据集「{backup_dsid}」，当前数据集「{DATA_SOURCE_ID}」，跨数据集恢复已被拒绝",
                "backup_dataset": backup_dsid, "current_dataset": DATA_SOURCE_ID,
            })), 409
        # 4) before_restore 备份
        pre_backup = _data_center_write_backup(reason="before_restore")
        # 5) 校验 ZIP + schema + 集合一致 + SHA-256 + 路径
        try:
            entries = _data_center_validate_restore_zip(zip_path, manifest)
        except DataCenterError as e:
            return cors(jsonify({"ok": False, "code": e.code, "error": str(e)})), e.status
        # 6) 仅对白名单文件原子替换
        try:
            applied = _data_center_apply_restore(entries)
        except DataCenterError as e:
            return cors(jsonify({"ok": False, "code": e.code, "error": str(e)})), e.status
        return cors(jsonify({
            "ok": True,
            "restored": applied,
            "before_restore_backup": pre_backup,
            "notice": "PDF、素材包和源代码未被恢复或删除；额外记录未被删除",
        }))
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


@app.route("/api/data-center/exports/paper-freeze", methods=["POST", "OPTIONS"])
def data_center_export_paper_freeze():
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"paper_freeze_{ts}.zip"
        out_path = DATA_BACKUP_DIR / out_name
        result = _data_center_build_paper_freeze_package(out_path)
        return cors(jsonify({"ok": True, "export": result}))
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


@app.route("/api/data-center/exports/showcase", methods=["POST", "OPTIONS"])
def data_center_export_showcase():
    """展示数据导出（任务书 §7.3）：复用既有 accepted-only 展示导出。
    不含未确认记录、模型原始响应、超长 _rawText 或密钥。"""
    if request.method == "OPTIONS":
        return cors(jsonify({"ok": True}))
    try:
        # 复用现有 /api/showcase-export 的逻辑：直接调用其底层函数
        # 为避免循环依赖，这里直接重新实现 accepted-only 选取
        state = load_per_book_state() or {"books": [], "images": []}
        accepted = [img for img in state.get("images", [])
                    if isinstance(img, dict) and img.get("status") == "ok"]
        # 剥离模型原始响应、超长 _rawText、密钥
        records = []
        for img in accepted:
            rec = {
                "id": img.get("id"),
                "pdfSource": img.get("pdfSource"),
                "annotation": img.get("annotation"),
                "illustrationName": img.get("illustrationName"),
                "illustrationNamePinyin": img.get("illustrationNamePinyin"),
                "subject": img.get("subject"),
            }
            records.append(rec)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"showcase_{ts}.json"
        out_path = DATA_BACKUP_DIR / out_name
        atomic_write_json(out_path, {
            "schema": "showcase-export-v1",
            "created_at": datetime.now().astimezone().isoformat(),
            "dataset": {"id": DATA_SOURCE_ID, "label": DATA_SOURCE_LABEL},
            "record_count": len(records),
            "records": records,
        })
        return cors(jsonify({"ok": True, "export": {
            "file": out_name, "record_count": len(records),
            "size": out_path.stat().st_size,
        }}))
    except Exception as e:
        import traceback
        return cors(jsonify({"ok": False, "code": "INTERNAL",
                             "error": str(e), "trace": traceback.format_exc()[-800:]})), 500


if __name__ == "__main__":
    cfg = load_config()
    print("=" * 50)
    print("Guji Illustration Annotator - Local Bridge")
    print("=" * 50)
    print("Provider:", cfg.get("api_provider", "?"), "/", cfg.get("model", "?"))
    key_ok = "OK" if cfg.get("api_key", "").strip() else "NOT SET (edit config.json)"
    print("API Key:", key_ok)
    print()
    print("Data dir   :", str(DATA_DIR))
    print("Image dir  :", str(IMAGES_DIR))
    print("PDF dir    :", str(PDFS_DIR))
    print("Books dir  :", str(BOOKS_DIR))
    print("Backups dir:", str(DATA_BACKUP_DIR), "(data-center-backup-v1)")
    print()

    # 启动前：把 session.json 里 ok/bad 合并进 per-book 文件（平迁安全网）
    reconcile_session_into_per_book()

    # 启动时排入一次完整备份，但不能阻塞前端验活或首次标注保存。
    _last_auto_backup_ts = 0.0
    schedule_auto_backup(force=True)

    print("Frontend : http://localhost:5678")
    print("主数据源 : data/books/*/images.json + data/global.json")
    print("恢复来源 : _data_backups/（ZIP + manifest）+ backups/pre_write/（骤降快照）")
    print("注意     : data/session.json 非主数据源（仅 legacy 全量保存写入），可能陈旧")
    print(f"Bind host: {BIND_HOST}  (config.json: bind_host / allow_origin)")
    if BIND_HOST == "0.0.0.0":
        print("  [!] 当前局域网可访问；如需仅本机访问，config.json 设 bind_host=127.0.0.1")
    print(f"CORS     : Allow-Origin = {ALLOW_ORIGIN}")
    print("=" * 50)
    app.run(host=BIND_HOST, port=5678, debug=False)
