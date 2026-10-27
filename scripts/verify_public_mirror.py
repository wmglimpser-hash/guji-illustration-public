#!/usr/bin/env python3
"""Fail closed when private material leaks into the public mirror."""

from __future__ import annotations

import re
import hashlib
import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_PATHS = (
    "paper",
    "research",
    "evaluation",
    "deliverables",
    "tasks",
    ".claude",
    ".playwright-cli",
    "demo/data",
    "demo/data_archives",
    "showcase/data",
    "showcase/samples",
)

FORBIDDEN_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".zip",
    ".7z",
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
}

DEMO_ASSETS = {}
_asset_manifest = ROOT / "scripts" / "online_demo_assets.sha256"
if _asset_manifest.exists():
    for _line in _asset_manifest.read_text(encoding="utf-8").splitlines():
        _digest, _relative = _line.split(None, 1)
        if not re.fullmatch(r"[0-9a-f]{64}", _digest) or not re.fullmatch(r"online-demo/assets/[A-Za-z0-9-]+\.jpg", _relative):
            raise ValueError("Invalid demo asset manifest")
        DEMO_ASSETS[_relative] = _digest

TEXT_FILENAMES = {".gitignore", ".gitattributes"}
TEXT_EXTENSIONS = {".css", ".html", ".js", ".json", ".md", ".ps1", ".py", ".txt"}

PATTERNS = {
    "Windows absolute path": re.compile(r"(?i)[A-Z]:\\(?:Users|TCM|Projects|下载)\\"),
    "Unix home path": re.compile(r"/(?:Users|home)/[^/\s]+/"),
    "OpenAI-style key": re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}"),
    "GitHub token": re.compile(r"(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "email address": re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
    "Chinese mobile number": re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
}

PLACEHOLDER = re.compile(
    r"(?i)(your_|example|placeholder|secret-must-not|dummy|test[_-]?key)"
)

MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+['\"][^)]*['\"])?\)")


def check_markdown_links(path: Path, text: str) -> list[str]:
    """Return broken repository-relative links from one Markdown file."""
    problems: list[str] = []
    for match in MARKDOWN_LINK.finditer(text):
        target = unquote(match.group(1).strip("<>"))
        if not target or target.startswith(("#", "/", "http://", "https://", "mailto:")):
            continue
        relative_target = target.split("#", 1)[0].split("?", 1)[0]
        if not relative_target:
            continue
        resolved = (path.parent / relative_target).resolve()
        if ROOT not in resolved.parents and resolved != ROOT:
            line = text.count("\n", 0, match.start()) + 1
            problems.append(f"link escapes repository: {path.relative_to(ROOT).as_posix()}:{line}")
        elif not resolved.exists():
            line = text.count("\n", 0, match.start()) + 1
            problems.append(
                f"broken relative link: {path.relative_to(ROOT).as_posix()}:{line} -> {target}"
            )
    return problems


def main() -> int:
    problems: list[str] = []

    for relative in FORBIDDEN_PATHS:
        if (ROOT / relative).exists():
            problems.append(f"forbidden path exists: {relative}")

    for path in ROOT.rglob("*"):
        if not path.is_file() or ".git" in path.parts:
            continue
        relative = path.relative_to(ROOT).as_posix()
        if path.suffix.lower() in FORBIDDEN_EXTENSIONS:
            expected = DEMO_ASSETS.get(relative)
            if expected and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
                continue
            problems.append(f"forbidden binary file: {relative}")
            continue
        if path.name not in TEXT_FILENAMES and path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() == ".md":
            problems.extend(check_markdown_links(path, text))
        for label, pattern in PATTERNS.items():
            for match in pattern.finditer(text):
                if PLACEHOLDER.search(match.group(0)):
                    continue
                line = text.count("\n", 0, match.start()) + 1
                problems.append(f"{label}: {relative}:{line}")
                break

    if problems:
        print("Public mirror verification failed:")
        for problem in problems:
            print(f"- {problem}")
        return 1

    print("Public mirror verification passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
