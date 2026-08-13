"""整书参考文本桥接接口回归测试。

参考文本只供校文页面对照，必须与 book/images/textAsset 隔离。
"""

import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


@pytest.fixture
def iso(tmp_path, monkeypatch):
    data = tmp_path / "data"
    books = data / "books"
    book_dir = books / "book_a"
    book_dir.mkdir(parents=True)
    original_book = {
        "id": "book_a",
        "title": "测试古籍（卷一）",
        "groupId": "group_a",
        "pages": [{"pageNum": 1, "textAsset": {"fullText": "原 OCR"}}],
    }
    bridge.atomic_write_json(book_dir / "book.json", original_book)
    bridge.atomic_write_json(book_dir / "images.json", [])

    monkeypatch.setattr(bridge, "DATA_DIR", data)
    monkeypatch.setattr(bridge, "BOOKS_DIR", books)
    monkeypatch.setattr(bridge, "GLOBAL_PATH", data / "global.json")
    monkeypatch.setattr(bridge, "SESSION_PATH", data / "session.json")
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", False)
    bridge.app.config.update(TESTING=True)
    return bridge.app.test_client(), data, book_dir, original_book


def _upload(client, scope_id, filename, payload, title=""):
    form = {"file": (io.BytesIO(payload), filename)}
    if title:
        form["title"] = title
    return client.post(
        f"/api/text-references/{scope_id}",
        data=form,
        content_type="multipart/form-data",
    )


def _minimal_docx(text):
    buffer = io.BytesIO()
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p>"
        '<w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>'
    )
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


def test_txt_reference_roundtrip_is_separate_from_annotation_data(iso):
    client, data, book_dir, original_book = iso
    response = _upload(
        client,
        "book_a",
        "整理本.txt",
        "第一段参考文字。\n第二段参考文字。".encode("utf-8"),
        title="整理本全文",
    )
    assert response.status_code == 201
    item = response.get_json()["item"]
    assert item["usage"] == "proofreading_reference_only"
    assert item["paper_included"] is False
    assert item["title"] == "整理本全文"

    listed = client.get("/api/text-references/book_a").get_json()["items"]
    assert [entry["id"] for entry in listed] == [item["id"]]
    detail = client.get(f"/api/text-references/book_a/{item['id']}").get_json()
    assert detail["content"] == "第一段参考文字。\n第二段参考文字。"
    assert detail["original_content"] == detail["content"]
    assert detail["has_edits"] is False

    assert json.loads((book_dir / "book.json").read_text(encoding="utf-8")) == original_book
    assert json.loads((book_dir / "images.json").read_text(encoding="utf-8")) == []
    reference_dir = data / "text_references" / "book_a" / item["id"]
    assert (reference_dir / "content.txt").exists()
    assert (reference_dir / "original.txt").exists()


def test_group_scope_and_docx_are_supported(iso):
    client, _, _, _ = iso
    response = _upload(client, "group_a", "整理本.docx", _minimal_docx("第一段"))
    assert response.status_code == 201
    item = response.get_json()["item"]
    detail = client.get(f"/api/text-references/group_a/{item['id']}").get_json()
    assert detail["content"] == "第一段\n第二段"
    assert item["source_format"] == "docx"


@pytest.mark.parametrize(
    ("filename", "payload", "expected_code"),
    [
        ("参考.pdf", b"%PDF", "REFERENCE_FILE_INVALID"),
        ("空.txt", b"", "REFERENCE_FILE_INVALID"),
    ],
)
def test_invalid_reference_upload_is_rejected(iso, filename, payload, expected_code):
    client, _, _, _ = iso
    response = _upload(client, "book_a", filename, payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == expected_code


def test_unknown_scope_is_rejected_without_creating_directory(iso):
    client, data, _, _ = iso
    response = _upload(client, "missing_book", "参考.txt", "正文".encode("utf-8"))
    assert response.status_code == 404
    assert not (data / "text_references" / "missing_book").exists()


def test_read_only_source_allows_read_but_blocks_import(iso, monkeypatch):
    client, _, _, _ = iso
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    assert client.get("/api/text-references/book_a").status_code == 200
    blocked = _upload(client, "book_a", "参考.txt", "正文".encode("utf-8"))
    assert blocked.status_code == 423
    assert blocked.get_json()["code"] == "DATA_SOURCE_READ_ONLY"


def test_edit_reference_saves_copy_and_preserves_original(iso):
    client, data, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "原始整理本文字".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    url = f"/api/text-references/book_a/{reference_id}"

    edited = client.put(url, json={"content": "人工修改后的参考文字\n第二行"})
    assert edited.status_code == 200
    payload = edited.get_json()
    assert payload["content"] == "人工修改后的参考文字\n第二行"
    assert payload["original_content"] == "原始整理本文字"
    assert payload["has_edits"] is True
    assert payload["item"]["edited_character_count"] == len(payload["content"])

    reference_dir = data / "text_references" / "book_a" / reference_id
    assert (reference_dir / "content.txt").read_text(encoding="utf-8") == "原始整理本文字"
    assert (reference_dir / "original.txt").read_text(encoding="utf-8") == "原始整理本文字"
    assert (reference_dir / "edited_content.txt").read_text(encoding="utf-8") == payload["content"]

    detail = client.get(url).get_json()
    assert detail["content"] == payload["content"]
    assert detail["original_content"] == "原始整理本文字"
    listed = client.get("/api/text-references/book_a").get_json()["items"]
    assert listed[0]["has_edits"] is True


def test_second_reference_edit_only_updates_edit_copy(iso):
    client, data, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "不可变原文".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    url = f"/api/text-references/book_a/{reference_id}"
    assert client.put(url, json={"content": "编辑一"}).status_code == 200
    assert client.put(url, json={"content": "编辑二"}).status_code == 200

    reference_dir = data / "text_references" / "book_a" / reference_id
    assert (reference_dir / "content.txt").read_text(encoding="utf-8") == "不可变原文"
    assert (reference_dir / "edited_content.txt").read_text(encoding="utf-8") == "编辑二"


def test_reference_edit_allows_punctuation_only_change(iso):
    client, data, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "黄芩味苦".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    url = f"/api/text-references/book_a/{reference_id}"

    edited = client.put(url, json={"content": "黄芩，味苦。"})

    assert edited.status_code == 200
    assert edited.get_json()["content"] == "黄芩，味苦。"
    reference_dir = data / "text_references" / "book_a" / reference_id
    assert (reference_dir / "content.txt").read_text(encoding="utf-8") == "黄芩味苦"
    assert (reference_dir / "edited_content.txt").read_text(encoding="utf-8") == "黄芩，味苦。"


@pytest.mark.parametrize("payload", [{}, {"content": None}, {"content": "  \r\n "}])
def test_invalid_reference_edit_is_rejected(iso, payload):
    client, _, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "原文".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    result = client.put(f"/api/text-references/book_a/{reference_id}", json=payload)
    assert result.status_code == 400


def test_read_only_source_blocks_reference_edit(iso, monkeypatch):
    client, _, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "原文".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    blocked = client.put(
        f"/api/text-references/book_a/{reference_id}",
        json={"content": "不得写入"},
    )
    assert blocked.status_code == 423
    assert blocked.get_json()["code"] == "DATA_SOURCE_READ_ONLY"


def test_reference_files_are_included_in_data_center_backup_whitelist(iso):
    client, _, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "连续全文".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    collected = {rel for rel, _path in bridge._data_center_collect_whitelist_files()}
    prefix = f"text_references/book_a/{reference_id}/"
    assert prefix + "metadata.json" in collected
    assert prefix + "content.txt" in collected
    assert prefix + "original.txt" in collected
    edit = client.put(
        f"/api/text-references/book_a/{reference_id}",
        json={"content": "编辑副本"},
    )
    assert edit.status_code == 200
    collected = {rel for rel, _path in bridge._data_center_collect_whitelist_files()}
    assert prefix + "edited_content.txt" in collected
    assert bridge._is_reference_backup_rel(prefix + "content.txt")
    assert bridge._is_reference_backup_rel(prefix + "edited_content.txt")
    assert not bridge._is_reference_backup_rel("text_references/book_a/../content.txt")
    assert not bridge._is_reference_backup_rel(prefix + "unexpected.exe")


def test_uncertain_marks_are_saved_as_sidecar_without_changing_text(iso):
    client, data, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "黄芩味苦性寒".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    base_url = f"/api/text-references/book_a/{reference_id}"
    marks_url = base_url + "/uncertain-marks"
    mark = {
        "id": "uncertain_a",
        "start": 2,
        "end": 4,
        "quote": "味苦",
        "created_at": "2026-07-29T10:00:00",
    }

    saved = client.put(marks_url, json={"marks": [mark]})

    assert saved.status_code == 200
    assert saved.get_json()["paper_included"] is False
    detail = client.get(base_url).get_json()
    assert detail["content"] == "黄芩味苦性寒"
    assert detail["uncertain_marks"] == [mark]
    reference_dir = data / "text_references" / "book_a" / reference_id
    assert not (reference_dir / "edited_content.txt").exists()
    sidecar = json.loads((reference_dir / "uncertain_marks.json").read_text(encoding="utf-8"))
    assert sidecar["schema"] == "reference-uncertain-marks-v1"
    assert sidecar["marks"] == [mark]
    assert bridge._is_reference_backup_rel(
        f"text_references/book_a/{reference_id}/uncertain_marks.json"
    )


@pytest.mark.parametrize(
    "mark",
    [
        {"id": "uncertain_a", "start": 0, "end": 2, "quote": "错误"},
        {"id": "bad/id", "start": 0, "end": 2, "quote": "黄芩"},
        {"id": "uncertain_a", "start": 3, "end": 99, "quote": "越界"},
    ],
)
def test_invalid_uncertain_marks_are_rejected(iso, mark):
    client, _, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "黄芩味苦".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]

    saved = client.put(
        f"/api/text-references/book_a/{reference_id}/uncertain-marks",
        json={"marks": [mark]},
    )

    assert saved.status_code == 400
    assert saved.get_json()["code"] == "REFERENCE_UNCERTAIN_MARKS_INVALID"


def test_reference_edit_reanchors_or_drops_uncertain_marks(iso):
    client, _, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "黄芩味苦性寒".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    base_url = f"/api/text-references/book_a/{reference_id}"
    marks_url = base_url + "/uncertain-marks"
    marks = [
        {
            "id": "uncertain_keep",
            "start": 2,
            "end": 4,
            "quote": "味苦",
            "created_at": "2026-07-29T10:00:00",
        },
        {
            "id": "uncertain_drop",
            "start": 4,
            "end": 6,
            "quote": "性寒",
            "created_at": "2026-07-29T10:01:00",
        },
    ]
    assert client.put(marks_url, json={"marks": marks}).status_code == 200

    edited = client.put(base_url, json={"content": "药名黄芩味苦"})

    assert edited.status_code == 200
    payload = edited.get_json()
    assert payload["dropped_uncertain_marks"] == 1
    assert payload["uncertain_marks"] == [
        {
            "id": "uncertain_keep",
            "start": 4,
            "end": 6,
            "quote": "味苦",
            "created_at": "2026-07-29T10:00:00",
        }
    ]
    detail = client.get(base_url).get_json()
    assert detail["uncertain_marks"] == payload["uncertain_marks"]


def test_reference_edit_saves_marks_selected_in_unsaved_draft(iso):
    client, data, _, _ = iso
    response = _upload(client, "book_a", "参考.txt", "黄芩味苦性寒".encode("utf-8"))
    reference_id = response.get_json()["item"]["id"]
    base_url = f"/api/text-references/book_a/{reference_id}"
    mark = {
        "id": "uncertain_draft",
        "start": 4,
        "end": 6,
        "quote": "味苦",
        "created_at": "2026-07-31T10:00:00",
    }

    edited = client.put(base_url, json={
        "content": "药名黄芩味苦性寒",
        "uncertain_marks": [mark],
    })

    assert edited.status_code == 200
    assert edited.get_json()["uncertain_marks"] == [mark]
    reference_dir = data / "text_references" / "book_a" / reference_id
    assert (reference_dir / "edited_content.txt").read_text(encoding="utf-8") == "药名黄芩味苦性寒"
    assert json.loads((reference_dir / "uncertain_marks.json").read_text(encoding="utf-8"))["marks"] == [mark]
