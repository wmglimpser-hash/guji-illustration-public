#!/usr/bin/env python3
"""Fail closed when private material leaks into the public mirror."""

from __future__ import annotations

import re
import sys
from pathlib import Path


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
            problems.append(f"forbidden binary file: {relative}")
            continue
        if path.name not in TEXT_FILENAMES and path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
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

