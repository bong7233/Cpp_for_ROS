#!/usr/bin/env python3
"""아스키 다이어그램의 상자 정렬을 검사한다.

왜 필요한가: 한글은 고정폭 글꼴에서 두 칸을 차지한다(East Asian Width = W/F).
상자 안에 한글을 한 글자만 넣어도 테두리가 어긋나는데, 원본 텍스트에서는
줄이 맞아 보여서 사람 눈으로는 잡기 어렵다.

검사 규칙 — 두 칸 문자가 **선 문자보다 왼쪽에** 오면 그 줄의 선이 밀린다.
그래서 딱 그것만 잡는다.

  OK   ├── pyvenv.cfg     ← 설명은 한글이어도 된다 (선보다 오른쪽이라 무해)
  OK   a ──▶ ┌──────┐
  BAD  numpy 2.2  ← 충돌!   ┌───┐   (한글이 상자를 오른쪽으로 밀어낸다)
  BAD  │ int 객체  │                (상자 안의 한글이 테두리를 깬다)

사용법:
    python tools/check_diagrams.py
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

LINE_CHARS = "│┌┐└┘├┤┬┴┼─"


def is_wide(c: str) -> bool:
    """고정폭 글꼴에서 두 칸을 차지하는가.

    박스 드로잉 문자와 화살표(◀ ▶)는 East Asian Width 가 'A'(모호)지만,
    이 책이 쓰는 라틴 계열 고정폭 글꼴에서는 한 칸으로 그려진다. 그래서
    'W'/'F'(한글·한자·전각) 만 두 칸으로 센다.
    """
    return unicodedata.east_asian_width(c) in ("W", "F")


def find_text_blocks(md: str) -> list[tuple[int, list[str]]]:
    blocks = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        if not re.match(r"^```text\b", lines[i]):
            i += 1
            continue
        start = i + 1
        body = []
        i += 1
        while i < len(lines) and not re.match(r"^```\s*$", lines[i]):
            body.append(lines[i])
            i += 1
        blocks.append((start, body))
        i += 1
    return blocks


def check_block(start: int, body: list[str]) -> list[str]:
    problems = []
    for n, ln in enumerate(body):
        last_line_char = max((i for i, c in enumerate(ln) if c in LINE_CHARS), default=-1)
        if last_line_char < 0:
            continue  # 선이 없는 줄은 아무것도 밀어내지 못한다
        offenders = sorted({c for c in ln[:last_line_char] if is_wide(c)})
        if offenders:
            problems.append(
                f"줄 {start + n + 1}: 선 문자 왼쪽에 두 칸 문자 {''.join(offenders)!r} "
                f"— 이 줄의 선이 밀린다. 선 왼쪽에는 ASCII만 쓸 것\n"
                f"      {ln!r}"
            )
    return problems


def main() -> int:
    bad = 0
    for md_path in sorted(CONTENT.rglob("*.md")):
        md = md_path.read_text(encoding="utf-8")
        for start, body in find_text_blocks(md):
            problems = check_block(start, body)
            if problems:
                bad += len(problems)
                print(f"\n{md_path.relative_to(ROOT)}:{start + 1}")
                for p in problems:
                    print(f"  - {p}")

    if bad:
        print(f"\n문제 {bad}건.")
        return 1
    print("아스키 다이어그램 정렬 이상 없음.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
