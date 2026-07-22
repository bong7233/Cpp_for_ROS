/* ownership-move.js — std::move 전후의 소유권 이전을 스텝으로 시각화
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget ownership-move
 *   { "scenario": "move" }
 *   :::
 *   scenario: "copy" | "move" | "move-then-use" (기본 "copy" — 복사의 비용을
 *   먼저 보여줘야 이동의 O(1)이 왜 대단한지 대비가 생긴다)
 *
 * 왜 스텝마다 상태 객체를 통째로 들고 있는가: render(i)가 순수 함수여야
 * 슬라이더 임의 접근이 안전하다. 상태를 누적 변경하면 되감기에서 깨진다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  /* ---------- 고정 좌표/데이터 ---------- */

  var W = 900, H = 400;
  var BOX = { y: 52, w: 240, h: 118, titleH: 26, rowH: 28 };
  var OBJ_X = { a: 330, b: 622 };            // 스택 위 객체 슬롯
  var BUF_Y = { buf1: 238, buf2: 310 };      // 힙 위 버퍼 슬롯
  var BUF_X = 340, CELL_W = 32, CELL_H = 34;
  var ADDR = { buf1: '0x50a1c0', buf2: '0x50a2e0' };  // 주소 일치로 포인터 정체성을 보여준다
  var STR = 'hello, robot!';                 // 13문자

  /* 객체 상태 축약 생성기 — 스텝 표를 읽기 쉽게 유지한다 */
  function O(ptr, size, cap, ex) {
    var o = { ptr: ptr, size: size, cap: cap };
    if (ex) for (var k in ex) o[k] = ex[k];
    return o;
  }
  function B(id, text, filled, dashed) {
    return { id: id, text: text, filled: filled, dashed: !!dashed };
  }

  /* ---------- 시나리오 정의 ----------
   * 각 스텝: { line, a, b, bufs, cap(캡션 HTML) }
   * line: 코드 패널에서 하이라이트할 줄 (-1 = 없음)
   */
  var SCENARIOS = {

    copy: {
      label: '① 복사',
      code: [
        'std::string a = "hello, robot!";',
        'std::string b = a;  // 복사 생성'
      ],
      steps: [
        { line: 0, a: O('?', '?', '?'), b: null, bufs: [],
          cap: '<code>std::string a</code> 가 스택에 만들어진다. 아직 필드는 미초기화 상태고 힙 버퍼도 없다.' },
        { line: 0, a: O('buf1', 13, 15), b: null, bufs: [B('buf1', STR, 13)],
          cap: '힙에 버퍼를 할당하고 13문자를 채웠다. <code>a.ptr</code> 이 <code>0x50a1c0</code> 을 가리키고 size=13, capacity=15.' },
        { line: 1, a: O('buf1', 13, 15), b: O('?', '?', '?'), bufs: [B('buf1', STR, 13)],
          cap: '<code>b = a</code> — 복사 생성자가 호출된다. <code>b</code> 는 <code>a</code> 의 버퍼를 같이 쓸 수 없으니 자기 버퍼가 필요하다.' },
        { line: 1, a: O('buf1', 13, 15), b: O('buf2', 13, 15), bufs: [B('buf1', STR, 13), B('buf2', STR, 0, true)],
          cap: '힙에 두 번째 버퍼(capacity 15)를 새로 할당했다(점선). 아직 내용은 비어 있다.' },
        { line: 1, a: O('buf1', 13, 15), b: O('buf2', 13, 15), bufs: [B('buf1', STR, 13), B('buf2', STR, 7, true)],
          cap: '문자를 앞에서부터 한 바이트씩 옮기는 중… 지금까지 <b>7 / 13바이트</b>.' },
        { line: 1, a: O('buf1', 13, 15), b: O('buf2', 13, 15), bufs: [B('buf1', STR, 13), B('buf2', STR, 13)],
          cap: '<b>13바이트를 전부 복사했다 — O(n)</b>. 문자열이 13MB였다면 13MB를 전부 복사했을 것이다.' },
        { line: -1, a: O('buf1', 13, 15), b: O('buf2', 13, 15), bufs: [B('buf1', STR, 13), B('buf2', STR, 13)],
          cap: '결과: 객체 2개, 버퍼 2개. 서로 독립이 됐지만 그 대가로 할당 1번 + 13바이트 복사 비용을 치렀다.' }
      ]
    },

    move: {
      label: '② 이동',
      code: [
        'std::string a = "hello, robot!";',
        'std::string b = std::move(a); // 이동'
      ],
      steps: [
        { line: 0, a: O('?', '?', '?'), b: null, bufs: [],
          cap: '<code>std::string a</code> 가 스택에 만들어진다. 여기까지는 복사 시나리오와 완전히 같다.' },
        { line: 0, a: O('buf1', 13, 15), b: null, bufs: [B('buf1', STR, 13)],
          cap: '힙에 버퍼를 할당하고 13문자를 채웠다. <code>a</code> 가 유일한 소유자다.' },
        { line: 1, a: O('buf1', 13, 15, { glow: true }), b: null, bufs: [B('buf1', STR, 13)],
          cap: '<code>std::move(a)</code> 는 아무것도 옮기지 않는다 — <code>a</code> 를 rvalue 로 캐스팅해 "가져가도 된다"는 표시만 붙인다. 기계어 한 줄도 생성되지 않는다.' },
        { line: 1, a: O('buf1', 13, 15, { glow: true }), b: O('?', '?', '?'), bufs: [B('buf1', STR, 13)],
          cap: '인자가 rvalue 라서 복사 생성자 대신 <b>이동 생성자</b>가 선택된다. <code>b</code> 가 스택에 등장한다.' },
        { line: 1, a: O('buf1', 13, 15, { fadeArrow: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '<code>b</code> 가 <code>a</code> 의 ptr·size·capacity <b>세 값만</b> 그대로 가져왔다. 힙의 13바이트는 1바이트도 움직이지 않았다.' },
        { line: 1, a: O(null, 0, 0, { moved: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '이동 생성자가 <code>a.ptr = nullptr</code>, size = 0 으로 정리한다 — <code>a</code> 는 이제 moved-from 상태(회색).' },
        { line: -1, a: O(null, 0, 0, { moved: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '<b>포인터 세 개만 바꿨다 — O(1), 버퍼는 그대로.</b> 복사의 13바이트(O(n)) 대 이동의 워드 3개: 데이터가 클수록 차이는 커진다.' }
      ]
    },

    'move-then-use': {
      label: '③ 이동 후 사용',
      code: [
        'std::string a = "hello, robot!";',
        'std::string b = std::move(a);',
        'auto n = a.size();  // ⚠ 미지정',
        'a = "new";          // 재대입 OK'
      ],
      steps: [
        { line: 0, a: O('buf1', 13, 15), b: null, bufs: [B('buf1', STR, 13)],
          cap: '<code>a</code> 가 힙 버퍼(13문자, capacity 15)를 소유한 채 시작한다.' },
        { line: 1, a: O('buf1', 13, 15, { fadeArrow: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '이동: <code>b</code> 가 ptr·size·capacity 세 값만 넘겨받았다 — <b>O(1)</b>, 복사된 문자는 0바이트.' },
        { line: 1, a: O(null, 0, 0, { moved: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '<code>a</code> 는 moved-from: ptr=nullptr, size=0. "유효하지만 미지정" 상태다.' },
        { line: 2, a: O(null, 0, 0, { moved: true, warn: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '<code>a.size()</code> 호출 시도 — ⚠ <b>유효하지만 미지정 상태 — 재대입은 안전, 값 읽기는 위험.</b>' },
        { line: 2, a: O(null, 0, 0, { moved: true, warn: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '컴파일도 되고 크래시도 안 나지만, 표준은 <code>n</code> 이 0이라고 보장하지 않는다 — 이 값에 의존하면 논리 버그다.' },
        { line: 3, a: O(null, 0, 0, { moved: true }), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13)],
          cap: '<code>a = "new"</code> — 대입 연산자는 기존 값을 읽지 않고 통째로 덮어쓰므로 moved-from 객체에도 <b>언제나 안전</b>하다.' },
        { line: 3, a: O('buf2', 3, 15), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13), B('buf2', 'new', 3)],
          cap: '<code>a</code> 가 새 값 "new"(3문자)를 받아 다시 정상 객체가 됐다. (이렇게 짧은 문자열은 실제로는 SSO 로 힙 없이 저장되지만 구조는 같다.)' },
        { line: -1, a: O('buf2', 3, 15), b: O('buf1', 13, 15), bufs: [B('buf1', STR, 13), B('buf2', 'new', 3)],
          cap: '규칙: 이동시킨 객체에는 <b>재대입 또는 파괴만</b> 하라. 값이 필요하면 이동 전에 읽어 둬라.' }
      ]
    }
  };

  WIDGETS['ownership-move'] = {
    mount: function (mountEl, params) {
      var key = SCENARIOS.hasOwnProperty(params.scenario) ? params.scenario : 'copy';
      var sc = SCENARIOS[key];
      var uid = 'om' + Math.random().toString(36).slice(2, 8);

      var f = core.frame(mountEl, {
        icon: '📦',
        title: params.title || '소유권 이동 — 복사 vs std::move'
      });

      /* 시나리오 전환 버튼 — 재마운트로 전환해 상태 꼬임을 원천 차단 */
      var bar = core.el('div');
      bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
      Object.keys(SCENARIOS).forEach(function (k) {
        var btn = core.el('button', 'w-btn' + (k === key ? ' primary' : ''), SCENARIOS[k].label);
        if (k !== key) {
          btn.addEventListener('click', function () {
            mountEl.innerHTML = '';
            WIDGETS['ownership-move'].mount(mountEl, Object.assign({}, params, { scenario: k }));
          });
        }
        bar.appendChild(btn);
      });
      f.body.appendChild(bar);

      var stage = core.el('div', 'widget-stage');
      var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
      stage.appendChild(svgRoot);
      f.body.appendChild(stage);

      /* ---------- 렌더링 ---------- */

      function ptrLabel(p) {
        if (p === '?') return '?';
        if (p === null) return 'nullptr';
        return ADDR[p];
      }

      function render(i) {
        while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);
        var st = sc.steps[i];

        /* 색은 매 렌더마다 읽는다 — 테마 전환 후 스텝만 넘겨도 색이 맞도록 */
        var C = {
          accent: core.themeColor('--accent', '#2f6fed'),
          accentSoft: core.themeColor('--accent-soft', 'rgba(47,111,237,.15)'),
          fg: core.themeColor('--fg', '#1c2230'),
          soft: core.themeColor('--fg-soft', '#454f63'),
          mute: core.themeColor('--fg-mute', '#7b8496'),
          border: core.themeColor('--border', '#d9dee8'),
          borderStrong: core.themeColor('--border-strong', '#c3cad8'),
          sunken: core.themeColor('--bg-sunken', '#eef1f6'),
          bg: core.themeColor('--bg', '#ffffff'),
          danger: '#d93838'
        };
        var mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

        /* 화살촉 마커 (실선용/희미한 잔상용) */
        var defs = core.svg('defs');
        [['-a', C.accent], ['-m', C.mute]].forEach(function (m) {
          var mk = core.svg('marker', {
            id: uid + m[0], viewBox: '0 0 10 10', refX: 8, refY: 5,
            markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
          });
          mk.appendChild(core.svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: m[1] }));
          defs.appendChild(mk);
        });
        svgRoot.appendChild(defs);

        /* --- 코드 패널 (왼쪽 1/3) --- */
        svgRoot.appendChild(core.svg('rect', {
          x: 8, y: 8, width: 286, height: 384, rx: 8,
          fill: C.sunken, stroke: C.border
        }));
        svgRoot.appendChild(core.svgText(20, 30, '코드', {
          'font-size': 11, 'font-weight': 700, fill: C.mute
        }));
        var lh = 26, y0 = 58;
        sc.code.forEach(function (ln, j) {
          var active = j === st.line;
          if (active) {
            svgRoot.appendChild(core.svg('rect', {
              x: 14, y: y0 + j * lh - 16, width: 274, height: 22, rx: 4, fill: C.accentSoft
            }));
            svgRoot.appendChild(core.svgText(20, y0 + j * lh, '▶', {
              'font-size': 10, fill: C.accent
            }));
          }
          svgRoot.appendChild(core.svgText(36, y0 + j * lh, ln, {
            'font-size': 11, 'font-family': mono,
            fill: active ? C.fg : C.mute,
            'font-weight': active ? 700 : 400
          }));
        });

        /* --- 스택 / 힙 영역 --- */
        svgRoot.appendChild(core.svg('rect', {
          x: 310, y: 16, width: 580, height: 172, rx: 8,
          fill: 'none', stroke: C.border, 'stroke-dasharray': '3 4'
        }));
        svgRoot.appendChild(core.svgText(324, 38, '스택 (자동 저장)', {
          'font-size': 11, 'font-weight': 700, fill: C.mute
        }));
        svgRoot.appendChild(core.svg('rect', {
          x: 310, y: 198, width: 580, height: 194, rx: 8,
          fill: 'none', stroke: C.border, 'stroke-dasharray': '3 4'
        }));
        svgRoot.appendChild(core.svgText(324, 220, '힙 (동적 저장)', {
          'font-size': 11, 'font-weight': 700, fill: C.mute
        }));

        /* --- 힙 버퍼 --- */
        st.bufs.forEach(function (bf) {
          var by = BUF_Y[bf.id];
          var n = bf.text.length + 1; // 널 종료 칸 포함
          svgRoot.appendChild(core.svgText(BUF_X, by - 7,
            '버퍼 @' + ADDR[bf.id] + ' — ' + bf.text.length + '문자 (+\'\\0\')', {
              'font-size': 11, 'font-family': mono, fill: C.mute
            }));
          for (var c = 0; c < n; c++) {
            var isNull = c === bf.text.length;
            var shown = isNull ? bf.filled >= bf.text.length : c < bf.filled;
            svgRoot.appendChild(core.svg('rect', {
              x: BUF_X + c * CELL_W, y: by, width: CELL_W, height: CELL_H,
              fill: shown && !isNull ? C.accentSoft : C.sunken,
              stroke: bf.dashed ? C.mute : C.borderStrong,
              'stroke-dasharray': bf.dashed ? '5 4' : null
            }));
            if (shown) {
              svgRoot.appendChild(core.svgText(
                BUF_X + c * CELL_W + CELL_W / 2, by + 22,
                isNull ? '\\0' : bf.text[c], {
                  'text-anchor': 'middle', 'font-size': 12, 'font-family': mono,
                  fill: isNull ? C.mute : C.fg
                }));
            }
          }
        });

        /* --- 스택 객체 박스 --- */
        ['a', 'b'].forEach(function (name) {
          var o = st[name];
          if (!o) return;
          var x = OBJ_X[name], y = BOX.y;
          var borderCol = o.warn ? C.danger : o.moved ? C.borderStrong : o.glow ? C.accent : C.borderStrong;

          svgRoot.appendChild(core.svg('rect', {
            x: x, y: y, width: BOX.w, height: BOX.h, rx: 8,
            fill: o.moved ? C.sunken : C.bg,
            stroke: borderCol, 'stroke-width': o.glow || o.warn ? 2 : 1.25
          }));
          /* 제목 줄 */
          svgRoot.appendChild(core.svg('path', {
            d: 'M' + x + ',' + (y + BOX.titleH) + ' H' + (x + BOX.w),
            stroke: C.border
          }));
          svgRoot.appendChild(core.svgText(x + 12, y + 18, 'std::string ' + name, {
            'font-size': 13, 'font-weight': 700, 'font-family': mono,
            fill: o.moved ? C.mute : C.fg
          }));
          if (o.moved) {
            svgRoot.appendChild(core.svgText(x + BOX.w - 12, y + 18,
              (o.warn ? '⚠ ' : '') + 'moved-from', {
                'text-anchor': 'end', 'font-size': 11, 'font-weight': 700,
                fill: o.warn ? C.danger : C.mute
              }));
          }
          /* 필드 3줄: ptr / size / capacity — std::string의 실제 뼈대 */
          var rows = [
            ['ptr', ptrLabel(o.ptr)],
            ['size', String(o.size)],
            ['capacity', String(o.cap)]
          ];
          rows.forEach(function (r, k) {
            var ry = y + BOX.titleH + k * BOX.rowH;
            if (k > 0) svgRoot.appendChild(core.svg('path', {
              d: 'M' + (x + 8) + ',' + ry + ' H' + (x + BOX.w - 8),
              stroke: C.border, 'stroke-dasharray': '2 3'
            }));
            svgRoot.appendChild(core.svgText(x + 14, ry + 19, r[0], {
              'font-size': 11, fill: C.mute
            }));
            var isPtr = k === 0;
            var vCol = o.moved ? C.mute
              : isPtr && o.ptr && o.ptr !== '?' ? C.accent
              : r[1] === '?' ? C.mute : C.soft;
            svgRoot.appendChild(core.svgText(x + BOX.w - 14, ry + 19, r[1], {
              'text-anchor': 'end', 'font-size': 12, 'font-family': mono,
              'font-weight': isPtr && !o.moved && o.ptr && o.ptr !== '?' ? 700 : 400,
              fill: vCol
            }));
          });
        });

        /* --- ptr → 버퍼 화살표 --- */
        ['a', 'b'].forEach(function (name) {
          var o = st[name];
          if (!o || !o.ptr || o.ptr === '?' || !BUF_Y.hasOwnProperty(o.ptr)) return;
          var faded = !!o.fadeArrow;
          var sx = OBJ_X[name] + 46, sy = BOX.y + BOX.h;
          var tyTop = BUF_Y[o.ptr] - 2;
          /* 목표 x: 같은 버퍼를 두 객체가 가리키는 순간에도 선이 겹치지 않게 분산 */
          var tx = name === 'a' ? BUF_X + 56 : BUF_X + 300;
          if (o.ptr === 'buf2' && name === 'a') tx = BUF_X + 48;
          var col = faded ? C.mute : C.accent;
          svgRoot.appendChild(core.svg('circle', { cx: sx, cy: sy, r: 3, fill: col }));
          svgRoot.appendChild(core.svg('path', {
            d: 'M' + sx + ',' + sy +
               ' C' + sx + ',' + (sy + 34) + ' ' + tx + ',' + (tyTop - 34) + ' ' + tx + ',' + tyTop,
            fill: 'none', stroke: col, 'stroke-width': faded ? 1.25 : 2,
            'stroke-dasharray': faded ? '4 4' : null,
            'marker-end': 'url(#' + uid + (faded ? '-m' : '-a') + ')'
          }));
        });

        f.setCaption(st.cap);
      }

      core.player(mountEl, { total: sc.steps.length, render: render, autoMs: 1700 });
    }
  };
})(this);
