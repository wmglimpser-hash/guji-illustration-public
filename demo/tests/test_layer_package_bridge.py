"""P-Asset Bridge V1 Phase 2：分层包扫描、审查与 stale 回归。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


def _make_pdf(path: Path):
    raster = path.with_suffix(".png")
    Image.new("RGB", (200, 100), (48, 128, 72)).save(raster)
    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    page.insert_image(page.rect, filename=str(raster))
    doc.save(path)
    doc.close()


@pytest.fixture
def layer_iso(tmp_path, monkeypatch):
    data = tmp_path / "data"
    book_dir = data / "books" / "bookA"
    asset_root = tmp_path / "assets"
    book_dir.mkdir(parents=True)
    _make_pdf(book_dir / "book.pdf")
    book = {
        "id": "bookA", "code": "TEST01", "title": "测试书",
        "pages": [{"pageNum": 8, "pdfPageNum": 1}],
    }
    record = {
        "id": "single", "canonicalId": "canonical_single", "status": "ok",
        "pdfSource": {"bookId": "bookA", "bookTitle": "测试书", "pageNum": 8,
                      "cropRect": [0.25, 0.2, 0.75, 0.8], "rotationDeg": 0},
        "versionContext": {"datasetId": "test-v1", "schemaVersion": "annotation-eval-v2"},
        "annotation": {"illustrationName": "测试图", "subject": "草药", "visualDescription": "绿色方形图。",
                       "academicClass": "药物图", "academicSubclass": "药物形态图", "correspondingText": "原文",
                       "textEvidenceExcerpt": "原文", "uncertaintyNote": "", "confidence": "high", "aiVerdict": "一致"},
    }
    bridge.atomic_write_json(book_dir / "book.json", book)
    bridge.atomic_write_json(book_dir / "images.json", [record])
    monkeypatch.setattr(bridge, "DATA_DIR", data)
    monkeypatch.setattr(bridge, "BOOKS_DIR", data / "books")
    monkeypatch.setattr(bridge, "ASSET_ROOT", asset_root)
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "test-v1")
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", False)
    bridge.app.config.update(TESTING=True)
    client = bridge.app.test_client()
    exported = client.post("/api/asset-sources/export", json={"record_id": "single"})
    assert exported.status_code == 200
    source = exported.get_json()["sources"][0]
    source_manifest = json.loads((asset_root / source["package_path"] / "manifest.json").read_text(encoding="utf-8"))
    return client, book_dir, asset_root, source, source_manifest


def _write_layer_package(
    asset_root: Path,
    source_manifest: dict,
    *,
    package_id="TEST01_p0008_layered_v001",
    source_id=None,
    mutate=None,
):
    source_id = source_id or source_manifest["source_id"]
    package_dir = asset_root / "_packages" / source_id / package_id
    (package_dir / "preview").mkdir(parents=True)
    (package_dir / "layers").mkdir()
    Image.new("RGB", (100, 60), (20, 80, 30)).save(package_dir / "preview" / "composite.png")
    Image.new("RGB", (100, 60), (200, 200, 200)).save(package_dir / "preview" / "contact-sheet.jpg")
    Image.new("RGBA", (100, 60), (20, 80, 30, 180)).save(package_dir / "layers" / "L010_herb.png")
    manifest = {
        "schema_version": "layer-package-v1",
        "package_id": package_id,
        "source": {
            "source_id": source_id,
            "record_id": source_manifest["record_id"],
            "canonical_id": source_manifest["canonical_id"],
            "source_sha256": source_manifest["source_sha256"],
            "annotation_revision": source_manifest["annotation_revision"],
        },
        "derivation": {"type": "ai_regenerated_layers", "skill": "layered-img", "run_id": "fixture"},
        "canvas": {"width": 100, "height": 60},
        "files": {"composite_preview": "preview/composite.png", "contact_sheet": "preview/contact-sheet.jpg"},
        "layers": [{"id": "herb", "label": "草药主体", "file": "layers/L010_herb.png",
                    "bbox": [0, 0, 100, 60], "z_index": 10,
                    "source_bbox": [2, 1, 96, 58], "render_bbox": [0, 0, 100, 60],
                    "fit_mode": "contain", "default_visible": False, "scale_group": "test_station",
                    "anchor": {"kind": "bottom_center", "source_point": [50, 59], "asset_point": [0.5, 1]},
                    "derivation_type": "ai_regenerated_layer", "asset_type": "prop",
                    "assembly_group": "test_scene", "parent_asset": "", "attachment_point": "",
                    "note": ""}],
        "warnings": [], "review_status": "pending", "created_at": "2026-07-22T00:00:00+08:00",
    }
    if mutate:
        mutate(manifest, package_dir)
    bridge.atomic_write_json(package_dir / "layer-package.json", manifest)
    return package_dir


def test_scan_review_and_files_are_independent_from_annotation(layer_iso):
    client, book_dir, asset_root, _source, manifest = layer_iso
    before = (book_dir / "images.json").read_bytes()
    _write_layer_package(asset_root, manifest)

    scanned = client.post("/api/layer-packages/scan")
    assert scanned.status_code == 200, scanned.get_json()
    assert scanned.get_json()["scanned"] == 1, scanned.get_json()
    package = scanned.get_json()["links"]["sources"]["TEST01_p0008"]["packages"][0]
    assert package["status"] == "pending"
    assert package["layers"][0]["z_index"] == 10
    assert package["layers"][0]["file"].endswith("L010_herb.png")
    assert package["layers"][0]["asset_type"] == "prop"
    assert package["layers"][0]["assembly_group"] == "test_scene"
    assert package["layers"][0]["source_bbox"] == [2, 1, 96, 58]
    assert package["layers"][0]["render_bbox"] == [0, 0, 100, 60]
    assert package["layers"][0]["fit_mode"] == "contain"
    assert package["layers"][0]["default_visible"] is False
    assert package["layers"][0]["scale_group"] == "test_station"
    assert package["layers"][0]["anchor"]["kind"] == "bottom_center"
    assert "base64" not in json.dumps(package).lower()
    assert (book_dir / "images.json").read_bytes() == before
    review = client.post("/api/asset-packages/TEST01_p0008/TEST01_p0008_layered_v001/review", json={
        "status": "approved", "review_note": "边缘和层级正确。",
    })
    assert review.status_code == 200, review.get_json()
    assert review.get_json()["package"]["status"] == "approved"
    links = json.loads((asset_root.parent / "data" / "asset-links.json").read_text(encoding="utf-8"))
    assert links["sources"]["TEST01_p0008"]["packages"][0]["review_note"] == "边缘和层级正确。"
    assert (book_dir / "images.json").read_bytes() == before

    listing = client.get("/api/illustrations/single/asset-packages")
    assert listing.status_code == 200
    assert listing.get_json()["source_id"] == "TEST01_p0008"
    assert listing.get_json()["packages"][0]["status"] == "approved"
    asset_file = client.get("/api/asset-file/_packages/TEST01_p0008/TEST01_p0008_layered_v001/layers/L010_herb.png")
    assert asset_file.status_code == 200
    assert asset_file.data[:8] == b"\x89PNG\r\n\x1a\n"
    archive = client.get("/api/asset-packages/TEST01_p0008/TEST01_p0008_layered_v001/download")
    assert archive.status_code == 200
    assert archive.mimetype == "application/zip"
    assert archive.data.startswith(b"PK")
    assert client.get("/api/asset-file/../data/asset-links.json").status_code in {400, 404, 422}


def test_asset_source_catalog_exposes_package_summary_without_n_plus_one(layer_iso):
    client, _book_dir, asset_root, _source, manifest = layer_iso
    _write_layer_package(asset_root, manifest)
    assert client.post("/api/layer-packages/scan").status_code == 200

    response = client.get("/api/asset-sources")
    assert response.status_code == 200
    payload = response.get_json()
    entry = payload["index"]["sources"]["TEST01_p0008"]
    assert entry["has_layer_package"] is True
    assert entry["package_count"] == 1
    assert entry["layer_count"] == 1
    assert entry["has_restoration_reference"] is False
    assert payload["index"]["summary"] == {"source_count": 1, "with_layer_packages": 1}


def test_optional_production_reference_is_validated_and_exposed(layer_iso):
    client, _book_dir, asset_root, _source, manifest = layer_iso

    def add_reference(data, package_dir):
        Image.new("RGB", (100, 60), (186, 175, 145)).save(package_dir / "preview" / "production-reference.png")
        data["files"]["production_reference"] = "preview/production-reference.png"

    _write_layer_package(asset_root, manifest, mutate=add_reference)
    payload = client.post("/api/layer-packages/scan").get_json()
    package = payload["links"]["sources"]["TEST01_p0008"]["packages"][0]
    assert package["files"]["production_reference"].endswith("preview/production-reference.png")


def test_invalid_paths_and_missing_files_do_not_leave_links(layer_iso):
    client, _book_dir, asset_root, _source, manifest = layer_iso

    _write_layer_package(asset_root, manifest, package_id="TEST01_p0008_layered_escape", mutate=lambda data, _dir: data["layers"][0].update({"file": "../secret.png"}))
    _write_layer_package(asset_root, manifest, package_id="TEST01_p0008_layered_missing", mutate=lambda data, _dir: data["layers"][0].update({"file": "layers/missing.png"}))
    _write_layer_package(
        asset_root,
        manifest,
        package_id="GHOST_p0008_layered_v001",
        source_id="GHOST_p0008",
    )
    result = client.post("/api/layer-packages/scan")
    assert result.status_code == 200
    payload = result.get_json()
    assert payload["scanned"] == 0
    assert {item["code"] for item in payload["errors"]} >= {
        "ASSET_PATH_ESCAPE", "LAYER_FILE_MISSING", "ASSET_SOURCE_NOT_FOUND",
    }
    links_path = asset_root.parent / "data" / "asset-links.json"
    assert not links_path.exists()


def test_invalid_asset_type_is_rejected(layer_iso):
    client, _book_dir, asset_root, _source, manifest = layer_iso
    _write_layer_package(
        asset_root, manifest, package_id="TEST01_p0008_layered_bad_type",
        mutate=lambda data, _dir: data["layers"][0].update({"asset_type": "unknown_type"}),
    )
    result = client.post("/api/layer-packages/scan")
    assert result.status_code == 200
    assert result.get_json()["scanned"] == 0
    assert result.get_json()["errors"][0]["code"] == "LAYER_MANIFEST_INVALID"


def test_invalid_geometry_constraints_are_rejected(layer_iso):
    client, _book_dir, asset_root, _source, manifest = layer_iso
    _write_layer_package(
        asset_root, manifest, package_id="TEST01_p0008_layered_bad_geometry",
        mutate=lambda data, _dir: data["layers"][0].update({"fit_mode": "stretch", "render_bbox": [0, 0, 100, 60]}),
    )
    result = client.post("/api/layer-packages/scan")
    assert result.status_code == 200
    assert result.get_json()["scanned"] == 0
    assert result.get_json()["errors"][0]["code"] == "LAYER_MANIFEST_INVALID"


def test_non_boolean_default_visibility_is_rejected(layer_iso):
    client, _book_dir, asset_root, _source, manifest = layer_iso
    _write_layer_package(
        asset_root, manifest, package_id="TEST01_p0008_layered_bad_visibility",
        mutate=lambda data, _dir: data["layers"][0].update({"default_visible": "false"}),
    )
    result = client.post("/api/layer-packages/scan")
    assert result.status_code == 200
    assert result.get_json()["scanned"] == 0
    assert result.get_json()["errors"][0]["code"] == "LAYER_MANIFEST_INVALID"


def test_stale_and_multiple_versions_are_preserved_idempotently(layer_iso):
    client, book_dir, asset_root, _source, manifest = layer_iso
    _write_layer_package(asset_root, manifest, package_id="TEST01_p0008_layered_v001")
    _write_layer_package(asset_root, manifest, package_id="TEST01_p0008_layered_v002")
    first = client.post("/api/layer-packages/scan")
    assert first.status_code == 200
    assert first.get_json()["scanned"] == 2
    again = client.post("/api/layer-packages/scan")
    assert again.status_code == 200
    assert len(again.get_json()["links"]["sources"]["TEST01_p0008"]["packages"]) == 2

    images = json.loads((book_dir / "images.json").read_text(encoding="utf-8"))
    images[0]["annotation"]["subject"] = "修订后的草药"
    bridge.atomic_write_json(book_dir / "images.json", images)
    stale = client.post("/api/layer-packages/scan")
    assert stale.status_code == 200
    packages = stale.get_json()["links"]["sources"]["TEST01_p0008"]["packages"]
    assert {item["status"] for item in packages} == {"stale"}
    assert all(item["stale_reasons"] for item in packages)
    review = client.post("/api/asset-packages/TEST01_p0008/TEST01_p0008_layered_v001/review", json={"status": "approved"})
    assert review.status_code == 409
    assert review.get_json()["code"] == "ASSET_PACKAGE_STALE"
