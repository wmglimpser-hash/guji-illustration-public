"""校文页繁简辅助接口测试。

转换必须是无状态显示层：只返回文本，不触碰数据文件，并在只读数据源可用。
"""

from __future__ import annotations

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bridge  # noqa: E402


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(bridge, "DATA_SOURCE_READ_ONLY", True)
    bridge.app.config.update(TESTING=True)
    with bridge.app.test_client() as test_client:
        yield test_client


@pytest.mark.skipif(not bridge._OPENCC_OK, reason="OpenCC dependency is not installed")
def test_traditional_to_simplified_is_display_only(client):
    response = client.post("/api/text-convert", json={
        "text": "後臺發展與藥材",
        "direction": "t2s",
    })

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["text"] == "后台发展与药材"
    assert payload["engine"] == "OpenCC"
    assert payload["persistence"] == "display_only"


@pytest.mark.skipif(not bridge._OPENCC_OK, reason="OpenCC dependency is not installed")
def test_simplified_to_traditional_is_display_only(client):
    response = client.post("/api/text-convert", json={
        "text": "后台发展与药材",
        "direction": "s2t",
    })

    assert response.status_code == 200
    assert response.get_json()["text"] == "後臺發展與藥材"


def test_invalid_direction_is_rejected(client):
    response = client.post("/api/text-convert", json={
        "text": "藥材",
        "direction": "unknown",
    })

    assert response.status_code == 400
    assert response.get_json()["code"] == "DIRECTION_INVALID"


def test_non_string_text_is_rejected(client):
    response = client.post("/api/text-convert", json={
        "text": ["藥材"],
        "direction": "t2s",
    })

    assert response.status_code == 400
    assert response.get_json()["code"] == "TEXT_REQUIRED"


def test_oversized_text_is_rejected(client, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(bridge, "TEXT_CONVERT_MAX_CHARS", 3)
    response = client.post("/api/text-convert", json={
        "text": "藥材炮製",
        "direction": "t2s",
    })

    assert response.status_code == 413
    assert response.get_json()["code"] == "TEXT_TOO_LARGE"
