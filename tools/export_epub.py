#!/usr/bin/env python3
"""content/*.md 를 폰 복습용 EPUB 하나로 내보낸다 (CLAUDE.md §2-3).

웹앱과 완전히 분리된 산출물이다 — 위젯·인터랙션·SRS 는 PC 앱의 몫이고,
이 파일은 이동 중 자투리 시간의 수동적 텍스트 복습만 담당한다. 그래서
변환 규칙은 전부 "빼기" 방향이다:

  1. toc.json 순서대로 챕터를 이어붙인다 (Part 표지 → 챕터들).
  2. `::: widget ...` 블록은 통째로 제거한다 — 본문 산문이 이미 개념을
     설명하고 있어야 한다는 집필 규범(§4-1)이 전제다.
  3. `::: quiz` / `::: answer` 는 굵은 "문제" / "해설" 절로 평문화하되,
     둘 사이에 페이지 구분을 넣어 스포일러를 순서로 최소화한다
     (EPUB 리더에는 접기 UI가 없다).
  4. 나머지 표시 상자(note/tip/... )는 라벨 붙은 인용구로 바꾼다.
  5. pandoc 으로 EPUB 변환. pandoc 은 빌드 타임 전용 CLI 의존성이다 —
     배포되는 앱의 의존성 제로 원칙(§2-1)과는 층이 다르다.

출력 파일명에는 콘텐츠 해시가 들어간다 — 폰에 옮긴 파일이 최신인지를
파일명만 보고 판별하기 위해서다.

사용법:
    python3 tools/export_epub.py
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
DIST = ROOT / "dist"

# 표시 상자 → 인용구 라벨. lead 는 절의 요지문이라 라벨 없이 인용구만 남긴다.
BOX_LABELS = {
    "note": "노트",
    "tip": "팁",
    "warn": "주의",
    "danger": "함정",
    "deep": "깊이 보기",
    "perf": "성능",
    "hist": "배경",
    "interview": "기술면접 포인트",
    "lead": "",
}

# EPUB 리더가 지원하는 페이지 구분 (pandoc 이 epub:type 으로 넘겨준다)
PAGE_BREAK = '\n<div style="page-break-before: always;"></div>\n'

FENCE_RE = re.compile(r"^(```+|~~~+)(.*)$")
BOX_OPEN_RE = re.compile(r"^:::\s*([\w-]+)\s*(.*)$")
INTERNAL_LINK_RE = re.compile(r"\[([^\]]*)\]\(#/[^)]*\)")


def find_doc(chapter_id: str) -> Path | None:
    """content/ 어디에 있든 <id>.md 를 찾는다 (build.py 와 동일 규칙)."""
    for p in CONTENT.rglob(f"{chapter_id}.md"):
        return p
    return None


def normalize_fence(info: str) -> str:
    """코드 펜스 메타에서 언어만 남긴다.

    `cpp title="..."`, `text nolines` 같은 앱 전용 메타는 pandoc 이
    모르는 속성이라 첫 단어(언어)만 남기고 버린다. title 은 코드 위에
    이탤릭 파일명 줄로 살린다 — 파일명이 본문 설명에서 참조되는 일이
    많아서 없애면 문장이 공중에 뜬다.
    """
    parts = info.strip().split()
    return parts[0] if parts else ""


def fence_title(info: str) -> str | None:
    m = re.search(r'title="([^"]*)"', info)
    return m.group(1) if m else None


def transform(md: str) -> str:
    """한 챕터의 마크다운을 EPUB 용 순수 마크다운으로 바꾼다."""
    out: list[str] = []
    lines = md.splitlines()
    i = 0
    in_fence = False
    fence_marker = ""
    # 상자 상태: None 이 아니면 (type,) — 상자 안 본문은 인용구로 접두한다
    box: str | None = None

    while i < len(lines):
        line = lines[i]

        m = FENCE_RE.match(line)
        if m:
            if not in_fence:
                in_fence = True
                fence_marker = m.group(1)[:3]
                info = m.group(2)
                title = fence_title(info)
                lang = normalize_fence(info)
                prefix = "> " if box else ""
                if title:
                    out.append(f"{prefix}*{title}*")
                    out.append(prefix.rstrip() if box else "")
                out.append(f"{prefix}{fence_marker}{lang}")
            else:
                in_fence = False
                out.append(("> " if box else "") + fence_marker)
            i += 1
            continue

        if in_fence:
            out.append(("> " if box else "") + line)
            i += 1
            continue

        bm = BOX_OPEN_RE.match(line)
        if bm and box is None:
            btype, btitle = bm.group(1), bm.group(2).strip()

            if btype == "widget":
                # 위젯 블록은 닫는 ::: 까지 통째로 버린다
                i += 1
                while i < len(lines) and lines[i].strip() != ":::":
                    i += 1
                i += 1
                continue

            if btype == "quiz":
                out.append("")
                out.append(f"**문제{' — ' + btitle if btitle else ''}**")
                out.append("")
                box = "quiz"
                i += 1
                continue

            if btype == "answer":
                # 문제와 해설 사이에 페이지를 끊는다 — 순서 스포일러 최소화
                out.append(PAGE_BREAK)
                out.append(f"**해설{' — ' + btitle if btitle else ''}**")
                out.append("")
                box = "answer"
                i += 1
                continue

            if btype in BOX_LABELS:
                label = BOX_LABELS[btype]
                out.append("")
                if label and btitle:
                    out.append(f"> **{label} — {btitle}**")
                    out.append(">")
                elif label:
                    out.append(f"> **{label}**")
                    out.append(">")
                box = btype
                i += 1
                continue

        if box is not None and line.strip() == ":::":
            out.append("")
            box = None
            i += 1
            continue

        # 내부 앱 링크(#/id)는 EPUB 에서 갈 곳이 없다 — 텍스트만 남긴다
        line = INTERNAL_LINK_RE.sub(r"\1", line)

        if box in ("quiz", "answer"):
            out.append(line)  # 평문 그대로
        elif box is not None:
            out.append(("> " + line) if line.strip() else ">")
        else:
            out.append(line)
        i += 1

    return "\n".join(out)


def collect() -> tuple[str, int, int]:
    """toc 순서대로 전체 원고를 만든다. (원고, 포함 절 수, 전체 절 수)"""
    toc = json.loads((CONTENT / "toc.json").read_text(encoding="utf-8"))
    meta = toc["meta"]
    parts_md: list[str] = []
    done = total = 0

    for part in toc["parts"]:
        chapters_md: list[str] = []
        for ch in part["chapters"]:
            total += 1
            p = find_doc(ch["id"])
            if p is None:
                continue
            done += 1
            chapters_md.append(transform(p.read_text(encoding="utf-8")))
        if chapters_md:
            parts_md.append(f"# {part['num']} — {part['title']}\n\n{part.get('desc', '')}")
            parts_md.extend(chapters_md)

    # 부록: 용어 사전 — 앱의 #/glossary 페이지와 같은 소스
    gl_path = CONTENT / "glossary.json"
    if gl_path.exists():
        glossary = json.loads(gl_path.read_text(encoding="utf-8"))
        if glossary:
            rows = [f"- **{g['term']}** — {g['def']}" for g in sorted(glossary, key=lambda g: g["term"])]
            parts_md.append("# 부록 — 용어 사전\n\n" + "\n".join(rows))

    title_block = "\n".join(
        [
            "---",
            f"title: {meta['title']}",
            f"subtitle: {meta.get('subtitle', '')}",
            "language: ko",
            "---",
            "",
        ]
    )
    return title_block + "\n\n".join(parts_md), done, total


CSS = """\
body { font-family: serif; line-height: 1.6; }
code, pre { font-family: monospace; font-size: 0.85em; }
pre { white-space: pre-wrap; word-break: break-all; background: #f4f4f4; padding: 0.5em; }
blockquote { border-left: 3px solid #999; margin-left: 0; padding-left: 1em; color: #333; }
h1 { page-break-before: always; }
table { border-collapse: collapse; font-size: 0.9em; }
th, td { border: 1px solid #999; padding: 0.3em 0.5em; }
"""


def main() -> int:
    if shutil.which("pandoc") is None:
        print("pandoc 이 설치돼 있지 않다. `sudo apt install pandoc` 으로 설치한 뒤 다시 실행하라.")
        return 1

    manuscript, done, total = collect()
    digest = hashlib.sha256(manuscript.encode("utf-8")).hexdigest()[:10]
    DIST.mkdir(exist_ok=True)
    out_path = DIST / f"cpp-mastery-{digest}.epub"

    with tempfile.TemporaryDirectory() as td:
        md_file = Path(td) / "book.md"
        css_file = Path(td) / "epub.css"
        md_file.write_text(manuscript, encoding="utf-8")
        css_file.write_text(CSS, encoding="utf-8")
        cmd = [
            "pandoc",
            str(md_file),
            "-f", "markdown+raw_html",
            "-o", str(out_path),
            "--toc", "--toc-depth=1",
            "--split-level=1",
            "--mathml",
            f"--css={css_file}",
            "--metadata", "lang=ko",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print("pandoc 변환 실패:")
            print(r.stderr)
            return 1

    size_kb = out_path.stat().st_size // 1024
    print(f"EPUB 생성 완료: {out_path.relative_to(ROOT)} · {done}/{total} 절 · {size_kb} KB")
    # 이전 해시의 산출물은 지운다 — 폰에 어떤 파일이 최신인지 헷갈리지 않게
    for old in DIST.glob("cpp-mastery-*.epub"):
        if old != out_path:
            old.unlink()
            print(f"  이전 산출물 삭제: {old.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
