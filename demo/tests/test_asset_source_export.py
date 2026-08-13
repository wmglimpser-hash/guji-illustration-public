"""P-Asset Bridge V1 源素材导出回归测试。

所有 PDF、标注数据与素材包均在 pytest 临时目录中创建，不接触真实书库。
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import fitz
import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


def _make_pdf(path: Path):
    raster_path = path.with_suffix(".png")
    image = Image.new("RGB", (200, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 49, 99), fill=(220, 30, 30))
    draw.rectangle((50, 0, 149, 99), fill=(30, 180, 70))
    draw.rectangle((150, 0, 199, 99), fill=(30, 60, 220))
    draw.rectangle((0, 0, 199, 19), fill=(245, 220, 40))
    draw.rectangle((0, 80, 199, 99), fill=(245, 220, 40))
    image.save(raster_path)
    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    page.insert_image(page.rect, filename=str(raster_path))
    doc.save(path)
    doc.close()


def _record(record_id: str, page: int, *, status="ok", index=0, crop=None, quad=None, rotation=0):
    record = {
        "id": record_id,
        "canonicalId": f"canonical_{record_id}",
        "status": status,
        "pdfSource": {
            "bookId": "bookA",
            "bookTitle": "补遗雷公炮制便览（卷1）",
            "pageNum": page,
            "cropRect": crop or [0.25, 0.2, 0.75, 0.8],
            "cropQuad": quad,
            "rotationDeg": rotation,
        },
        "versionContext": {"datasetId": "reannotation-v1-full", "schemaVersion": "annotation-eval-v2"},
        "annotation": {
            "illustrationName": "测试插图",
            "subject": "测试对象",
            "visualDescription": "绿色中央裁图",
            "academicClass": "药物图",
            "academicSubclass": "药物形态图",
            "correspondingText": "测试原文",
            "textEvidenceExcerpt": "测试原文",
            "uncertaintyNote": "",
            "confidence": "high",
            "aiVerdict": "一致",
            "_rawText": "不得进入生产素材快照",
        },
    }
    if index:
        record.update({
            "figureIndex": index,
            "subIndex": index,
            "isSplitIllustration": True,
            "parentId": f"bookA_p{page:03d}",
        })
    return record


@pytest.fixture
def asset_iso(tmp_path, monkeypatch):
    data = tmp_path / "data"
    books = data / "books"
    book_dir = books / "bookA"
    asset_root = tmp_path / "assets"
    book_dir.mkdir(parents=True)
    asset_root.mkdir()
    _make_pdf(book_dir / "book.pdf")
    book = {
        "id": "bookA",
        "code": "TEST01",
        "title": "补遗雷公炮制便览（卷1）",
        "pages": [
            {"pageNum": 8, "pdfPageNum": 1},
            {"pageNum": 9, "pdfPageNum": 1},
            {"pageNum": 10, "pdfPageNum": 1},
            {"pageNum": 11, "pdfPageNum": 1},
            {"pageNum": 12, "pdfPageNum": 1},
        ],
    }
    records = [
        _record("single", 8),
        _record("multi1", 9, index=1, crop=[0.0, 0.0, 0.5, 1.0]),
        _record("multi2", 9, index=2, crop=[0.5, 0.0, 1.0, 1.0]),
        _record("pending", 10, status="review"),
        _record("rotated", 11, rotation=2),
        _record("quad", 12, quad=[[0.25, 0.2], [0.75, 0.2], [0.75, 0.8], [0.25, 0.8]]),
    ]
    bridge.atomic_write_json(book_dir / "book.json", book)
    bridge.atomic_write_json(book_dir / "images.json", records)
    (book_dir / "pages_hires").mkdir()
    Image.new("RGB", (160, 80), "purple").save(book_dir / "pages_hires" / "p0001.jpg")

    monkeypatch.setattr(bridge, "DATA_DIR", data)
    monkeypatch.setattr(bridge, "BOOKS_DIR", books)
    monkeypatch.setattr(bridge, "PRODUCTION_DATA_DIR", data)
    monkeypatch.setattr(bridge, "ASSET_ROOT", asset_root)
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "reannotation-v1-full")
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", False)
    bridge.app.config.update(TESTING=True)
    return bridge.app.test_client(), book_dir, asset_root


def test_exact_crop_manifest_and_annotation_snapshot(asset_iso):
    client, book_dir, asset_root = asset_iso
    before = (book_dir / "images.json").read_bytes()
    response = client.post("/api/asset-sources/export", json={"record_id": "single"})
    assert response.status_code == 200, response.get_json()
    item = response.get_json()["sources"][0]
    assert item["source_id"] == "TEST01_p0008"
    package = asset_root / item["package_path"]
    source = package / "source.png"
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    annotation = json.loads((package / "annotation.json").read_text(encoding="utf-8"))

    with Image.open(source) as image:
        assert image.size == (100, 60)
        center = image.convert("RGB").getpixel((50, 30))
        assert center[1] > center[0] and center[1] > center[2]
    assert source.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert source.read_bytes() != (book_dir / "pages_hires" / "p0001.jpg").read_bytes()
    assert manifest["schema_version"] == "asset-source-v1"
    assert manifest["page_num"] == 8 and manifest["pdf_page_num"] == 1
    assert manifest["image"]["width"] == 100 and manifest["image"]["height"] == 60
    assert manifest["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert manifest["crop"]["normalized_rect"] == [0.25, 0.2, 0.75, 0.8]
    assert "_rawText" not in annotation
    assert set(annotation) == set(bridge._ASSET_ANNOTATION_FIELDS)
    assert (package / "preview.webp").exists()
    assert (package / "context-page.jpg").exists()
    assert (book_dir / "images.json").read_bytes() == before


def test_repeated_export_is_idempotent(asset_iso):
    client, _book_dir, asset_root = asset_iso
    first = client.post("/api/asset-sources/export", json={"record_id": "single"}).get_json()["sources"][0]
    manifest_path = asset_root / first["package_path"] / "manifest.json"
    first_manifest_bytes = manifest_path.read_bytes()
    second = client.post("/api/asset-sources/export", json={"record_id": "single"}).get_json()["sources"][0]
    assert second["idempotent"] is True
    assert second["package_path"] == first["package_path"]
    assert manifest_path.read_bytes() == first_manifest_bytes
    source_dirs = [path for path in (asset_root / "_sources" / "TEST01_p0008").iterdir() if path.is_dir()]
    assert len(source_dirs) == 1


def test_multi_illustration_ids_do_not_collide(asset_iso):
    client, _book_dir, _asset_root = asset_iso
    response = client.post("/api/asset-sources/export", json={"record_ids": ["multi1", "multi2"]})
    assert response.status_code == 200, response.get_json()
    source_ids = {item["source_id"] for item in response.get_json()["sources"]}
    assert source_ids == {"TEST01_p0009_i01", "TEST01_p0009_i02"}


def test_non_ok_requires_explicit_provisional_export(asset_iso):
    client, _book_dir, asset_root = asset_iso
    blocked = client.post("/api/asset-sources/export", json={"record_id": "pending"})
    assert blocked.status_code == 409
    assert blocked.get_json()["code"] == "ASSET_REVIEW_REQUIRED"
    assert not (asset_root / "_sources" / "TEST01_p0010").exists()

    allowed = client.post("/api/asset-sources/export", json={
        "record_id": "pending",
        "allow_provisional": True,
    })
    assert allowed.status_code == 200, allowed.get_json()
    item = allowed.get_json()["sources"][0]
    manifest = json.loads((asset_root / item["package_path"] / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["provisional"] is True
    assert manifest["review_status"] == "review"


def test_rotation_and_quad_are_preserved_in_authoritative_render(asset_iso):
    client, _book_dir, asset_root = asset_iso
    response = client.post("/api/asset-sources/export", json={"record_ids": ["rotated", "quad"]})
    assert response.status_code == 200, response.get_json()
    by_id = {item["source_id"]: item for item in response.get_json()["sources"]}
    rotated_manifest = json.loads((asset_root / by_id["TEST01_p0011"]["package_path"] / "manifest.json").read_text(encoding="utf-8"))
    quad_manifest = json.loads((asset_root / by_id["TEST01_p0012"]["package_path"] / "manifest.json").read_text(encoding="utf-8"))
    assert rotated_manifest["crop"]["type"] == "rect"
    assert rotated_manifest["crop"]["rotation_deg"] == 2.0
    assert quad_manifest["crop"] == {
        "type": "quad",
        "normalized_quad": [[0.25, 0.2], [0.75, 0.2], [0.75, 0.8], [0.25, 0.8]],
        "rotation_deg": 0.0,
    }


def test_source_index_contains_only_metadata(asset_iso):
    client, _book_dir, asset_root = asset_iso
    client.post("/api/asset-sources/export", json={"record_ids": ["single", "multi1"]})
    response = client.get("/api/asset-sources")
    assert response.status_code == 200
    payload = response.get_json()["index"]
    assert set(payload["sources"]) == {"TEST01_p0008", "TEST01_p0009_i01"}
    raw = (asset_root / "manifests" / "source-index.json").read_text(encoding="utf-8")
    assert "base64" not in raw.lower()
    assert "data:image" not in raw.lower()
