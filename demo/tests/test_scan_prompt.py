"""OCR/插图候选预处理的输入与读向契约测试。"""

from __future__ import annotations

import sys
from pathlib import Path


DEMO_DIR = Path(__file__).resolve().parents[1]
if str(DEMO_DIR) not in sys.path:
    sys.path.insert(0, str(DEMO_DIR))

import bridge  # noqa: E402


def test_scan_prompt_uses_registered_content_rect_and_reading_rules():
    prompt = bridge.build_scan_page_prompt(
        text_direction="竖排右起",
        title_label_direction="横排右起",
        page_order="从右到左",
        reading_note="蓝底题签按横排右起读取。",
    )

    assert "CONTENT RECTANGLE" in prompt
    assert "正文方向：竖排右起" in prompt
    assert "题签方向：横排右起" in prompt
    assert "书页顺序：从右到左" in prompt
    assert "蓝底题签按横排右起读取" in prompt
    assert "do not default to modern left-to-right order" in prompt


def test_scan_prompt_does_not_hardcode_vertical_right_to_left():
    prompt = bridge.build_scan_page_prompt(
        text_direction="横排左起",
        title_label_direction="随正文",
        page_order="从左到右",
    )

    assert "正文方向：横排左起" in prompt
    assert "书页顺序：从左到右" in prompt
    assert "正文方向：竖排右起" not in prompt


def test_scan_prompt_marks_explicit_full_page_fallback_and_ignores_page_furniture():
    prompt = bridge.build_scan_page_prompt(
        text_direction="竖排右起",
        title_label_direction="横排右起",
        input_region="full_page",
    )

    assert "FULL ORIGINAL PAGE" in prompt
    assert "No content rectangle was available" in prompt
    assert "collector seals" in prompt
    assert "CONTENT RECTANGLE" not in prompt
