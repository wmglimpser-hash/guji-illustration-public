"""Transactional import for scanned image books.

The browser supplies source images plus an explicit volume/page plan. Originals
are preserved byte-for-byte under ``source_images``; logical pages are derived
into ``pages_hires`` for the existing OCR/crop/annotation pipeline.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath

from PIL import Image, ImageOps


IMPORT_SCHEMA = "image-book-import-v1"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
ALLOWED_MODES = {"single", "spread", "skip"}
MAX_FILE_COUNT = 2000


class ImageBookImportError(ValueError):
    def __init__(self, message: str, *, code: str = "IMAGE_BOOK_IMPORT_INVALID", status: int = 422):
        super().__init__(message)
        self.code = code
        self.status = status


def _safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^\w.\-]+", "_", str(value or ""), flags=re.UNICODE).strip("._")
    return (cleaned[:160] or fallback)


def _safe_relative_path(value: str) -> str:
    path = PurePosixPath(str(value or "").replace("\\", "/"))
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ImageBookImportError("图片相对路径不安全。", code="IMAGE_IMPORT_PATH_INVALID")
    return path.as_posix()


def _atomic_write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _save_jpeg(image: Image.Image, path: Path, *, max_size: int | None = None) -> None:
    output = ImageOps.exif_transpose(image).convert("RGB")
    if max_size:
        output.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    output.save(path, "JPEG", quality=95, subsampling=0, optimize=True)


def _validate_manifest(manifest: dict, uploaded_files: list) -> list[dict]:
    if manifest.get("schema") != IMPORT_SCHEMA:
        raise ImageBookImportError("导入清单 schema 不受支持。", code="IMAGE_IMPORT_SCHEMA_INVALID")
    title = str(manifest.get("title") or "").strip()
    if not title:
        raise ImageBookImportError("书名不能为空。", code="IMAGE_IMPORT_TITLE_REQUIRED")
    volumes = manifest.get("volumes")
    if not isinstance(volumes, list) or not volumes:
        raise ImageBookImportError("导入清单没有卷册。", code="IMAGE_IMPORT_VOLUME_REQUIRED")
    if not uploaded_files or len(uploaded_files) > MAX_FILE_COUNT:
        raise ImageBookImportError(
            f"图片数量必须为 1–{MAX_FILE_COUNT}。",
            code="IMAGE_IMPORT_FILE_COUNT_INVALID",
        )

    seen_indexes: set[int] = set()
    normalized = []
    for volume_index, volume in enumerate(volumes):
        scans = volume.get("scans") if isinstance(volume, dict) else None
        if not isinstance(scans, list) or not scans:
            raise ImageBookImportError("卷册不能为空。", code="IMAGE_IMPORT_EMPTY_VOLUME")
        normalized_scans = []
        kept = 0
        for scan_index, scan in enumerate(scans):
            try:
                upload_index = int(scan.get("uploadIndex"))
            except (AttributeError, TypeError, ValueError):
                raise ImageBookImportError("图片上传索引无效。", code="IMAGE_IMPORT_INDEX_INVALID")
            if upload_index < 0 or upload_index >= len(uploaded_files) or upload_index in seen_indexes:
                raise ImageBookImportError("图片上传索引缺失或重复。", code="IMAGE_IMPORT_INDEX_INVALID")
            seen_indexes.add(upload_index)
            mode = str(scan.get("mode") or "")
            if mode not in ALLOWED_MODES:
                raise ImageBookImportError("页面方式无效。", code="IMAGE_IMPORT_MODE_INVALID")
            try:
                split_ratio = float(scan.get("splitRatio") or 0.5)
            except (TypeError, ValueError):
                raise ImageBookImportError(
                    "跨页分割位置不是有效数字。",
                    code="IMAGE_IMPORT_SPLIT_INVALID",
                )
            if mode == "spread" and not 0.35 < split_ratio < 0.65:
                raise ImageBookImportError("跨页分割位置必须位于 35%–65%。", code="IMAGE_IMPORT_SPLIT_INVALID")
            relative_path = _safe_relative_path(scan.get("relativePath") or uploaded_files[upload_index].filename)
            suffix = Path(uploaded_files[upload_index].filename or relative_path).suffix.lower()
            if suffix not in ALLOWED_EXTENSIONS:
                raise ImageBookImportError("包含不支持的图片格式。", code="IMAGE_IMPORT_FORMAT_INVALID")
            if mode != "skip":
                kept += 1
            normalized_scans.append({
                "upload_index": upload_index,
                "relative_path": relative_path,
                "mode": mode,
                "split_ratio": split_ratio,
                "scan_index": scan_index + 1,
            })
        if not kept:
            raise ImageBookImportError("卷册不能全部跳过。", code="IMAGE_IMPORT_EMPTY_VOLUME")
        normalized.append({
            "key": str(volume.get("key") or f"volume-{volume_index + 1}"),
            "source_name": str(volume.get("sourceName") or f"卷{volume_index + 1}"),
            "title": str(volume.get("title") or title),
            "version": str(volume.get("version") or f"卷{volume_index + 1}"),
            "scans": normalized_scans,
        })
    if seen_indexes != set(range(len(uploaded_files))):
        raise ImageBookImportError("上传文件与导入清单不一致。", code="IMAGE_IMPORT_FILE_SET_MISMATCH")
    return normalized


def _logical_parts(image: Image.Image, mode: str, split_ratio: float):
    width, height = image.size
    if mode == "single":
        return [("single", (0, 0, width, height), [0.0, 0.0, 1.0, 1.0])]
    split_x = max(1, min(width - 1, round(width * split_ratio)))
    return [
        ("right", (split_x, 0, width, height), [split_ratio, 0.0, 1.0, 1.0]),
        ("left", (0, 0, split_x, height), [0.0, 0.0, split_ratio, 1.0]),
    ]


def import_image_book(
    manifest: dict,
    uploaded_files: list,
    *,
    books_dir: Path,
    dataset_id: str,
) -> dict:
    normalized_volumes = _validate_manifest(manifest, uploaded_files)
    tx_id = f"image-import-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    staging_root = books_dir.parent / ".image-book-import-staging" / tx_id
    group_id = (
        f"group_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"
        if len(normalized_volumes) > 1
        else None
    )
    imported_at = datetime.now().astimezone().isoformat()
    staged_books: list[tuple[Path, Path]] = []
    promoted: list[Path] = []
    books = []

    try:
        staging_root.mkdir(parents=True, exist_ok=False)
        for volume_index, volume in enumerate(normalized_volumes):
            book_id = f"book_{datetime.now().strftime('%Y%m%d%H%M%S')}_{volume_index + 1}_{uuid.uuid4().hex[:6]}"
            stage_book = staging_root / book_id
            source_dir = stage_book / "source_images"
            hires_dir = stage_book / "pages_hires"
            thumbs_dir = stage_book / "images"
            source_dir.mkdir(parents=True)
            hires_dir.mkdir()
            thumbs_dir.mkdir()
            pages = []
            source_entries = []

            for scan in volume["scans"]:
                upload = uploaded_files[scan["upload_index"]]
                suffix = Path(upload.filename or scan["relative_path"]).suffix.lower()
                stored_name = f"s{scan['scan_index']:05d}_{_safe_name(Path(scan['relative_path']).name, 'source' + suffix)}"
                source_path = source_dir / stored_name
                upload.save(source_path)
                source_hash = _sha256(source_path)
                with Image.open(source_path) as opened:
                    source = ImageOps.exif_transpose(opened).convert("RGB")
                    width, height = source.size
                    source_entries.append({
                        "scanIndex": scan["scan_index"],
                        "relativePath": scan["relative_path"],
                        "storedFilename": stored_name,
                        "sha256": source_hash,
                        "width": width,
                        "height": height,
                        "mode": scan["mode"],
                    })
                    if scan["mode"] == "skip":
                        continue
                    for side, box, normalized_crop in _logical_parts(source, scan["mode"], scan["split_ratio"]):
                        page_num = len(pages) + 1
                        page_image = source.crop(box)
                        hires_name = f"p{page_num:04d}.jpg"
                        thumb_name = f"p{page_num:04d}_220.jpg"
                        thumb_hi_name = f"p{page_num:04d}_420.jpg"
                        _save_jpeg(page_image, hires_dir / hires_name)
                        _save_jpeg(page_image, thumbs_dir / thumb_name, max_size=220)
                        _save_jpeg(page_image, thumbs_dir / thumb_hi_name, max_size=420)
                        page_url = f"/data/books/{book_id}/images/"
                        pages.append({
                            "pageNum": page_num,
                            "pdfPageNum": page_num,
                            "thumb": page_url + thumb_name,
                            "thumbHi": page_url + thumb_hi_name,
                            "cropRect": None,
                            "contentRect": None,
                            "imgDensity": 0,
                            "text": "",
                            "textAsset": {
                                "fullText": "",
                                "associatedText": "",
                                "textSource": "none",
                                "textStatus": "missing",
                                "verified": False,
                                "ocrModel": "",
                                "extractedAt": "",
                                "updatedAt": "",
                            },
                            "sourceImage": {
                                "schema": IMPORT_SCHEMA,
                                "relativePath": scan["relative_path"],
                                "storedFilename": stored_name,
                                "sha256": source_hash,
                                "sourceScanIndex": scan["scan_index"],
                                "side": side,
                                "cropRect": normalized_crop,
                                "originalWidth": width,
                                "originalHeight": height,
                            },
                        })

            title = str(manifest["title"]).strip()
            book = {
                "id": book_id,
                "idShort": re.sub(r"[^\w]+", "", title, flags=re.UNICODE)[:8] or book_id[-8:],
                "title": title,
                "dynasty": str(manifest.get("dynasty") or ""),
                "version": volume["version"],
                "edition": str(manifest.get("edition") or ""),
                "repository": str(manifest.get("repository") or ""),
                "printYear": str(manifest.get("printYear") or ""),
                "textLayout": str(manifest.get("textLayout") or "auto"),
                "totalPages": len(pages),
                "pages": pages,
                "illustrationPages": [],
                "queueAdded": [],
                "importedAt": int(datetime.now().timestamp() * 1000),
                "sensitivity": "mid",
                "copyright": {"source": "用户上传图片", "redistribute": "待核权利"},
                "sourceType": "image_folder",
                "imageBookImport": {
                    "schema": IMPORT_SCHEMA,
                    "transactionId": tx_id,
                    "datasetId": dataset_id,
                    "importedAt": imported_at,
                    "sourceVolume": volume["source_name"],
                    "sourceScanCount": len(volume["scans"]),
                    "logicalPageCount": len(pages),
                    "readingOrder": "right_then_left",
                    "originalsPreserved": True,
                    "sources": source_entries,
                },
            }
            if group_id:
                book["groupId"] = group_id
                book["groupTitle"] = title
            _atomic_write_json(stage_book / "book.json", book)
            _atomic_write_json(stage_book / "images.json", [])
            _atomic_write_json(stage_book / "meta.json", {
                "book_id": book_id,
                "title": title,
                "version": volume["version"],
                "page_count": len(pages),
                "illustration_page_count": 0,
                "created_at": imported_at,
                "updated_at": imported_at,
                "source_type": "image_folder",
            })
            final_book = books_dir / book_id
            if final_book.exists():
                raise ImageBookImportError("目标书籍目录冲突。", code="IMAGE_IMPORT_CONFLICT", status=409)
            staged_books.append((stage_book, final_book))
            books.append(book)

        for source, destination in staged_books:
            os.replace(source, destination)
            promoted.append(destination)
        return {
            "ok": True,
            "schema": IMPORT_SCHEMA,
            "transaction_id": tx_id,
            "group_id": group_id,
            "source_scan_count": sum(len(v["scans"]) for v in normalized_volumes),
            "logical_page_count": sum(book["totalPages"] for book in books),
            "books": books,
        }
    except ImageBookImportError:
        for path in promoted:
            shutil.rmtree(path, ignore_errors=True)
        raise
    except Exception as exc:
        for path in promoted:
            shutil.rmtree(path, ignore_errors=True)
        raise ImageBookImportError(
            f"图片书籍导入失败：{exc}",
            code="IMAGE_BOOK_IMPORT_FAILED",
            status=500,
        ) from exc
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)
        try:
            staging_root.parent.rmdir()
        except OSError:
            pass


def render_cached_page_crop(
    source_path: Path,
    destination_path: Path,
    *,
    clip_rect=None,
    quad_points=None,
    long_edge: int = 1200,
    rotation_deg: float = 0,
) -> bool:
    """Render a crop from an imported raster logical page.

    This mirrors the PDF crop contract enough for existing OCR and illustration
    selection. Perspective quads are reduced to their bounding rectangle; image
    books currently enter with axis-aligned logical pages.
    """
    if not source_path.exists():
        return False
    try:
        with Image.open(source_path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            if quad_points:
                xs = [float(point[0]) for point in quad_points]
                ys = [float(point[1]) for point in quad_points]
                clip_rect = (min(xs), min(ys), max(xs), max(ys))
            if clip_rect:
                width, height = image.size
                x0, y0, x1, y1 = clip_rect
                image = image.crop((
                    round(max(0.0, min(1.0, x0)) * width),
                    round(max(0.0, min(1.0, y0)) * height),
                    round(max(0.0, min(1.0, x1)) * width),
                    round(max(0.0, min(1.0, y1)) * height),
                ))
            if rotation_deg:
                image = image.rotate(
                    float(rotation_deg),
                    resample=Image.Resampling.BICUBIC,
                    expand=False,
                    fillcolor="white",
                )
            _save_jpeg(image, destination_path, max_size=long_edge)
        return True
    except Exception:
        return False
