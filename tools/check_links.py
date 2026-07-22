#!/usr/bin/env python3
"""내부 링크·위젯 참조 무결성을 검사한다.

왜 필요한가: STYLE.md 체크리스트("링크한 id가 전부 toc.json에 있는가")를
사람이 놓쳐도 기계가 잡는다. 위젯보다 콘텐츠가 먼저 쓰이는 것은 마일스톤
순서상 정상이므로(§9), 미구현 위젯은 실패가 아니라 목록으로 보여준다.

검사 항목:
  1. 본문의 [텍스트](#/id) 가 toc.json 에 실재하는 챕터 id 인가 (실패 항목)
  2. ::: widget <type> 의 type 이 assets/widgets/<type>.js 로 존재하는가 (경고 항목)
  3. glossary.json 이 비어 있는데 집필된 챕터가 있으면 경고 (느슨한 안전망)

사용법:
    python tools/check_links.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
WIDGETS_DIR = ROOT / "assets" / "widgets"

# 챕터 외에 앱이 라우팅하는 특수 페이지
EXTRA_ROUTES = {"glossary", ""}

LINK_RE = re.compile(r"\[[^\]]*\]\(#/([^)#\s]*)(?:#[^)\s]*)?\)")
WIDGET_RE = re.compile(r"^:::\s*widget\s+([\w-]+)", re.M)
FENCE_RE = re.compile(r"```[\s\S]*?```")


def toc_ids() -> set[str]:
    toc = json.loads((CONTENT / "toc.json").read_text(encoding="utf-8"))
    ids = set()
    for part in toc["parts"]:
        for ch in part["chapters"]:
            ids.add(ch["id"])
    return ids


def main() -> int:
    ids = toc_ids()
    bad_links: list[str] = []
    missing_widgets: dict[str, list[str]] = {}
    doc_count = 0

    for md_path in sorted(CONTENT.rglob("*.md")):
        rel = md_path.relative_to(ROOT)
        md = md_path.read_text(encoding="utf-8")
        doc_count += 1
        body = FENCE_RE.sub(" ", md)  # 코드 블록 속 예시 링크는 검사하지 않는다

        for m in LINK_RE.finditer(body):
            target = m.group(1)
            if target not in ids and target not in EXTRA_ROUTES:
                bad_links.append(f"{rel}: 존재하지 않는 챕터 링크 #/{target}")

        for m in WIDGET_RE.finditer(md):
            wtype = m.group(1)
            if not (WIDGETS_DIR / f"{wtype}.js").exists():
                missing_widgets.setdefault(wtype, []).append(str(rel))

    ok = True

    if bad_links:
        ok = False
        print(f"깨진 내부 링크 {len(bad_links)}건:")
        for b in bad_links:
            print(f"  - {b}")

    if missing_widgets:
        # 실패가 아니라 정보 — 마일스톤 우선순위를 다시 볼 계기 (CLAUDE.md §8-1)
        print(f"\n[정보] 아직 구현되지 않은 위젯 {len(missing_widgets)}종:")
        for wtype, places in sorted(missing_widgets.items()):
            print(f"  - {wtype}  (쓰인 곳: {', '.join(places)})")

    glossary_path = CONTENT / "glossary.json"
    if glossary_path.exists():
        glossary = json.loads(glossary_path.read_text(encoding="utf-8"))
        if doc_count > 0 and len(glossary) == 0:
            print("\n[경고] 집필된 챕터가 있는데 glossary.json 이 비어 있다 — §2-4 체크리스트 확인")

    if ok:
        print("내부 링크 이상 없음.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
