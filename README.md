# C++ 완전 정복

언어 코어부터 ROS 2 로봇 제어까지 다루는 C++·로보틱스 학습·레퍼런스 시스템. 브라우저에서 도는 단일 웹앱이다.

조작 가능한 시각 위젯(스택/힙, 포인터, 소유권 이동, 스레드 타임라인 등)으로 공간적 개념을 몸에 새기는 것이 이 책의 핵심 설계다. [Pythonic](https://github.com/bong7233/Pythonic)(파이썬 버전)의 구조와 규율을 계승하고, [Hexpider](https://github.com/bong7233/Hexpider)(헥사포드 로봇 플랫폼)에서의 실전 적용으로 검증한다.

## 여는 법

**PC** — `index.html` 을 더블클릭한다. 서버도 인터넷도 필요 없다. 이 앱은 PC 전용이다 — 듀얼 모니터 한쪽에 이 앱, 다른 한쪽에 실제 IDE를 띄워 놓고 쓰는 것을 전제로 설계했다.

**휴대폰** — 웹앱 대신 `content/` 에서 자동 생성한 EPUB 파일(`dist/`)을 폰 기본 e리더로 연다. 이동 중 순수 텍스트 복습 용도다.

## 고치는 법

본문은 `content/` 아래 마크다운이다. 고친 뒤 빌드하면 앱에 반영된다.

```bash
python build.py           # 한 번 빌드
python build.py --watch   # 저장할 때마다 자동 빌드
python build.py --serve   # 개발 중 미리보기 서버
```

## 구조

```
index.html          앱 껍데기
assets/
  style.css         스타일 (라이트/다크)
  markdown.js       이 책 전용 마크다운 렌더러 (의존성 없음)
  highlight.js      구문 강조기 (의존성 없음)
  app.js            라우팅 · 목차 · 검색 · 진도 · SRS 복습 큐
  bundle.js         빌드 산출물 (build.py 가 생성)
  widgets/          인터랙티브 시각 위젯 (순수 Canvas/SVG + vanilla JS)
content/
  toc.json          책의 목차 — 여기가 뼈대다
  glossary.json     용어 사전
  <part>/<id>.md    각 절의 본문
docs/
  STYLE.md          집필 규범
  LINK_LOG.md       외부 링크 검증 로그
tools/
  check_diagrams.py 아스키 다이어그램 정렬 검사
  check_links.py    내부 링크·위젯 참조 무결성 검사
  export_epub.py    폰용 EPUB 내보내기 (pandoc)
build.py            content/ → assets/bundle.js
```

`content/toc.json` 의 챕터 `id` 와 마크다운 파일 이름(`<id>.md`)이 짝이다. 빌드 스크립트가 `content/` 아래를 뒤져 자동으로 연결한다.

### 왜 번들을 만드나

`file://` 로 열면 브라우저가 `fetch()` 를 CORS로 막는다. 마크다운을 JS 파일 안에 JSON으로 박아 `<script>` 로 읽히면 서버 없이도 동작한다. 그래서 `assets/bundle.js` 는 빌드 산출물이지만 일부러 커밋한다.

## 마크다운 확장 문법

일반 마크다운에 더해 이 책에서만 쓰는 것들:

````text
```cpp title="예제.cpp" {3,5-7}       코드 제목과 강조할 줄
```console                            터미널 세션 (명령/출력 구분)

::: note | tip | warn | danger        표시 상자
::: deep | perf | interview | hist
::: quiz | answer                     answer 는 접혀서 나온다
::: lead                              챕터 머리말

::: widget <type>                     인터랙티브 시각 위젯
{ "json": "파라미터" }
:::

$O(n \log n)$                         수식 (인라인)
==형광펜==
````

코드 블록은 표시·복사 전용이다. 실제 컴파일·실행은 당신의 IDE 터미널에서 한다 — 그게 이 책의 학습 방식이다.

## 단축키

| 키 | 동작 |
| --- | --- |
| <kbd>/</kbd> 또는 <kbd>Ctrl</kbd>+<kbd>K</kbd> | 전체 검색 |
| <kbd>[</kbd> / <kbd>]</kbd> | 이전 / 다음 절 |
| <kbd>Esc</kbd> | 닫기 |

## 진도

브라우저 `localStorage` 에 저장된다. PC 앱이 진도의 유일한 기준점이다.
