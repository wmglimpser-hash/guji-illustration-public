"""Image-folder book import regression tests (isolated temporary data only)."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


def _jpeg(color, size=(200, 100)):
    stream = io.BytesIO()
    Image.new("RGB", size, color).save(stream, "JPEG")
    stream.seek(0)
    return stream


@pytest.fixture
def iso(tmp_path, monkeypatch):
    data = tmp_path / "data"
    books = data / "books"
    backups = data / "_data_backups"
    books.mkdir(parents=True)
    backups.mkdir()
    monkeypatch.setattr(bridge, "DATA_DIR", data)
    monkeypatch.setattr(bridge, "BOOKS_DIR", books)
    monkeypatch.setattr(bridge, "DATA_BACKUP_DIR", backups)
    monkeypatch.setattr(bridge, "GLOBAL_PATH", data / "global.json")
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", False)
    monkeypatch.setattr(bridge, "DATA_SOURCE_ID", "image-import-test")
    bridge.app.config.update(TESTING=True)
    return bridge.app.test_client(), data


def _manifest(*, second_mode="spread"):
    return {
        "schema": "image-book-import-v1",
        "title": "杏林杂话",
        "dynasty": "清",
        "volumes": [{
            "key": "volume-1",
            "sourceName": "杏林雑話1",
            "title": "杏林杂话",
            "version": "卷1",
            "scans": [
                {
                    "uploadIndex": 0,
                    "relativePath": "杏林雑話1/杏林雑話1-00001.jpg",
                    "mode": "single",
                    "splitRatio": 0.5,
                },
                {
                    "uploadIndex": 1,
                    "relativePath": "杏林雑話1/杏林雑話1-00002.jpg",
                    "mode": second_mode,
                    "splitRatio": 0.5,
                },
            ],
        }],
    }


def _post(client, manifest):
    return client.post(
        "/api/import-image-book",
        data={
            "manifest": json.dumps(manifest, ensure_ascii=False),
            "files": [
                (_jpeg("red"), "杏林雑話1-00001.jpg"),
                (_jpeg("blue"), "杏林雑話1-00002.jpg"),
            ],
        },
        content_type="multipart/form-data",
    )


def test_import_preserves_sources_and_splits_right_before_left(iso, monkeypatch):
    client, data = iso
    monkeypatch.setattr(bridge, "_data_center_write_backup", lambda reason: {"backup_id": reason})
    response = _post(client, _manifest())
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["source_scan_count"] == 2
    assert payload["logical_page_count"] == 3
    assert payload["backup"]["backup_id"] == "before_image_book_import"

    book = payload["books"][0]
    book_dir = data / "books" / book["id"]
    disk = json.loads((book_dir / "book.json").read_text(encoding="utf-8"))
    assert [page["sourceImage"]["side"] for page in disk["pages"]] == ["single", "right", "left"]
    assert len(list((book_dir / "source_images").glob("*.jpg"))) == 2
    assert len(list((book_dir / "pages_hires").glob("p*.jpg"))) == 3
    assert disk["imageBookImport"]["originalsPreserved"] is True
    assert disk["imageBookImport"]["datasetId"] == "image-import-test"


def test_single_volume_import_remains_ungrouped_for_later_merge(iso, monkeypatch):
    client, data = iso
    monkeypatch.setattr(bridge, "_data_center_write_backup", lambda reason: {"backup_id": reason})

    response = _post(client, _manifest())

    assert response.status_code == 200
    payload = response.get_json()
    book = payload["books"][0]
    disk = json.loads(
        (data / "books" / book["id"] / "book.json").read_text(encoding="utf-8")
    )
    assert payload["group_id"] is None
    assert "groupId" not in book
    assert "groupTitle" not in book
    assert "groupId" not in disk
    assert "groupTitle" not in disk


def test_import_is_rejected_in_read_only_source(iso, monkeypatch):
    client, data = iso
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    response = _post(client, _manifest())
    assert response.status_code == 423
    assert response.get_json()["code"] == "DATA_SOURCE_READ_ONLY"
    assert list((data / "books").iterdir()) == []


def test_invalid_manifest_leaves_no_partial_book(iso, monkeypatch):
    client, data = iso
    monkeypatch.setattr(bridge, "_data_center_write_backup", lambda reason: {"backup_id": reason})
    response = _post(client, _manifest(second_mode="wrong"))
    assert response.status_code == 422
    assert response.get_json()["code"] == "IMAGE_IMPORT_MODE_INVALID"
    assert list((data / "books").iterdir()) == []


def test_imported_page_supports_existing_crop_endpoint(iso, monkeypatch):
    client, _ = iso
    monkeypatch.setattr(bridge, "_data_center_write_backup", lambda reason: {"backup_id": reason})
    payload = _post(client, _manifest()).get_json()
    book_id = payload["books"][0]["id"]
    response = client.get(f"/api/page-image/{book_id}/2?rect=0,0,0.5,1&w=120")
    assert response.status_code == 200
    with Image.open(io.BytesIO(response.data)) as cropped:
        assert max(cropped.size) <= 120


def test_separately_uploaded_image_volumes_merge_without_losing_assets(iso, monkeypatch):
    client, data = iso
    monkeypatch.setattr(bridge, "_data_center_write_backup", lambda reason: {"backup_id": reason})
    monkeypatch.setattr(bridge, "_data_center_auto_backup", lambda reason: {"backup_id": reason})

    volume1 = _post(client, _manifest()).get_json()["books"][0]
    volume2_manifest = _manifest()
    volume2_manifest["volumes"][0]["sourceName"] = "杏林雑話2"
    volume2_manifest["volumes"][0]["version"] = "卷1"  # 模拟修复前分别导入的历史误写
    for scan in volume2_manifest["volumes"][0]["scans"]:
        scan["relativePath"] = scan["relativePath"].replace("杏林雑話1", "杏林雑話2")
    volume2 = _post(client, volume2_manifest).get_json()["books"][0]

    before = {}
    for book in (volume1, volume2):
        book_dir = data / "books" / book["id"]
        before[book["id"]] = {
            "pages": len(json.loads((book_dir / "book.json").read_text(encoding="utf-8"))["pages"]),
            "sources": sorted(path.name for path in (book_dir / "source_images").glob("*")),
            "images": (book_dir / "images.json").read_text(encoding="utf-8"),
        }

    response = client.post(
        "/api/merge-books",
        json={"bookIds": [volume1["id"], volume2["id"]], "title": "杏林杂话"},
    )

    assert response.status_code == 200
    result = response.get_json()
    assert result["ok"] is True
    assert result["volumes"] == 2
    assert [
        (book["bookId"], book["version"], book["groupOrder"])
        for book in result["books"]
    ] == [
        (volume1["id"], "卷1", 0),
        (volume2["id"], "卷2", 1),
    ]
    group_id = result["groupId"]
    merged_books = []
    for expected_order, book in enumerate((volume1, volume2)):
        book_dir = data / "books" / book["id"]
        disk = json.loads((book_dir / "book.json").read_text(encoding="utf-8"))
        merged_books.append(disk)
        assert disk["groupId"] == group_id
        assert disk["groupTitle"] == "杏林杂话"
        assert disk["groupOrder"] == expected_order
        assert len(disk["pages"]) == before[book["id"]]["pages"]
        assert sorted(path.name for path in (book_dir / "source_images").glob("*")) == before[book["id"]]["sources"]
        assert (book_dir / "images.json").read_text(encoding="utf-8") == before[book["id"]]["images"]
    assert [book["version"] for book in merged_books] == ["卷1", "卷2"]
    group = json.loads(
        (data / "books" / group_id / "group.json").read_text(encoding="utf-8")
    )
    assert [volume["bookId"] for volume in group["volumes"]] == [volume1["id"], volume2["id"]]


def test_corrupt_source_rolls_back_complete_transaction(iso, monkeypatch):
    client, data = iso
    monkeypatch.setattr(bridge, "_data_center_write_backup", lambda reason: {"backup_id": reason})
    response = client.post(
        "/api/import-image-book",
        data={
            "manifest": json.dumps(_manifest(), ensure_ascii=False),
            "files": [
                (_jpeg("red"), "杏林雑話1-00001.jpg"),
                (io.BytesIO(b"not-an-image"), "杏林雑話1-00002.jpg"),
            ],
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 500
    assert response.get_json()["code"] == "IMAGE_BOOK_IMPORT_FAILED"
    assert list((data / "books").iterdir()) == []
    staging = data / ".image-book-import-staging"
    assert not staging.exists() or list(staging.iterdir()) == []
