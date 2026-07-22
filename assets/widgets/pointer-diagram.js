/* pointer-diagram.js — 변수/주소/화살표로 보는 포인터 조작 위젯
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget pointer-diagram
 *   { "scenario": "basics" }        // "array-walk" | "double-pointer"
 *   :::
 *
 * 이 위젯은 스텝 플레이어가 아니라 "조작형"이다. 포인터의 핵심 난점은
 * 정해진 순서의 재생이 아니라 "내가 이 연산을 하면 어디가 바뀌는가"이므로,
 * 사용자가 연산 버튼을 눌러 상태를 직접 굴리는 쪽이 학습 목적에 맞다.
 * 따라서 core.player() 를 쓰지 않고 (상태 → SVG 전체 재그리기) 순수 함수
 * render() 하나로 화면을 유지한다. 증분 갱신을 피하는 이유는 demo.js 와
 * 같다: 상태와 화면이 어긋나는 부류의 버그를 원천 차단.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  /* ---------- 상수 ---------- */
  var W = 900, H = 360;
  var BOX_Y = 214, BOX_H = 88;
  var GAP = 26;                      // 독립 변수 사이 간격
  var ELEM_W = 88, INT_W = 104, PTR_W = 128;
  var ADDR_BASE = 0x0a10;            // 가짜 스택 주소의 하위 오프셋 시작점
  var uidSeq = 0;                    // marker id 충돌 방지 (한 페이지 다중 마운트 대비)

  /* ---------- 내장 시나리오 ----------
   * do 액션 DSL:
   *   {set:P, to:T}      P.target = T          (T: null | "이름" | {arr,index})
   *   {adv:P, by:N}      포인터 산술 (배열 인덱스 이동으로 해석)
   *   {deref:P, value:V} *P = V                (P 가 "지금" 가리키는 셀에 적용)
   *   {deref:P, to:T}    *P = &T               (가리켜진 셀이 포인터일 때)
   *   {deref2:P, value:V} **P = V
   * 역참조 대상은 실행 시점에 resolve() 로 푼다 — 하드코딩하면 "p 를 옮긴 뒤
   * *p 를 하면?" 이라는 이 위젯의 존재 이유가 사라진다.
   */
  var SCENARIOS = {
    'basics': {
      title: '기초', icon: '🎯',
      desc: '<code>int x=42, y=7; int* p=&amp;x;</code> — 버튼을 눌러 p 를 조작해 보라. ' +
            '포인터의 값은 <em>주소</em>이고, 화살표는 그 주소가 가리키는 곳이다.',
      cells: [
        { name: 'x', type: 'int', value: 42 },
        { name: 'y', type: 'int', value: 7 },
        { name: 'p', type: 'int*', points: 'x' }
      ],
      ops: [
        { label: 'p = &x', do: [{ set: 'p', to: 'x' }],
          note: '<code>&amp;x</code> 는 x 의 주소다. p 의 값이 x 의 주소가 되고, 화살표가 x 로 향한다.' },
        { label: 'p = &y', do: [{ set: 'p', to: 'y' }],
          note: 'p 는 이제 y 의 주소를 담는다. 같은 포인터가 실행 중 언제든 다른 대상을 가리킬 수 있다.' },
        { label: '*p = 99', do: [{ deref: 'p', value: 99 }],
          note: '역참조 쓰기: p 가 <em>지금</em> 가리키는 셀에 99 를 쓴다. p 자신의 값(주소)은 변하지 않는다.' },
        { label: 'p = nullptr', do: [{ set: 'p', to: null }],
          note: 'p 는 이제 아무것도 가리키지 않는다. 이 상태의 <code>*p</code> 는 미정의 동작 — 역참조 전 nullptr 검사가 필요한 이유다.' }
      ]
    },

    'array-walk': {
      title: '배열 산술', icon: '🎯',
      desc: '<code>int arr[4] = {10,20,30,40}; int* p = arr;</code> — 배열 요소들이 ' +
            '틈 없이 붙어 있는 것에 주목하라. 연속 메모리라서 포인터 산술이 성립한다.',
      cells: [
        { name: 'arr', type: 'int[4]', values: [10, 20, 30, 40] },
        { name: 'p', type: 'int*', points: { arr: 'arr', index: 0 } }
      ],
      ops: [
        { label: 'p++', do: [{ adv: 'p', by: 1 }],
          note: '포인터 산술: <code>int*</code> 의 +1 은 1바이트가 아니라 <code>sizeof(int)</code> = 4바이트 이동이다. 주소가 4 늘었다.' },
        { label: 'p--', do: [{ adv: 'p', by: -1 }],
          note: '한 요소 뒤로. 주소가 4 줄었다. 배열 앞으로 벗어나면 그 즉시 미정의 동작 영역이다.' },
        { label: '*p = 0', do: [{ deref: 'p', value: 0 }],
          note: '역참조 쓰기는 p 가 <em>지금 서 있는</em> 요소에 적용된다. p 를 옮긴 뒤 다시 눌러 보라.' },
        { label: 'p = arr', do: [{ set: 'p', to: { arr: 'arr', index: 0 } }],
          note: '배열 이름은 첫 요소의 주소로 붕괴(decay)한다. p 가 arr[0] 으로 돌아왔다.' },
        { label: 'p = arr + 4', do: [{ set: 'p', to: { arr: 'arr', index: 4 } }],
          note: 'one-past-end 포인터: 마지막 요소 <em>바로 다음</em>을 가리키는 것까지는 합법이라 반복 종료 조건(<code>p != arr+4</code>)에 쓴다. 단, 이 위치를 역참조하면 미정의 동작이다.' }
      ]
    },

    'double-pointer': {
      title: '이중 포인터', icon: '🎯',
      desc: '<code>int x=42, y=7; int* p=&amp;x; int** pp=&amp;p;</code> — pp 의 화살표는 ' +
            'p 라는 <em>포인터 변수 자체</em>를 가리킨다. 역참조를 한 겹씩 벗겨 보라.',
      cells: [
        { name: 'x', type: 'int', value: 42 },
        { name: 'y', type: 'int', value: 7 },
        { name: 'p', type: 'int*', points: 'x' },
        { name: 'pp', type: 'int**', points: 'p' }
      ],
      ops: [
        { label: '*pp = &y', do: [{ deref: 'pp', to: 'y' }],
          note: 'pp 를 한 번 벗기면 p 가 나온다. 거기에 <code>&amp;y</code> 를 쓰니 p 의 화살표가 y 로 바뀐다 — pp 자신은 그대로다.' },
        { label: '**pp = 99', do: [{ deref2: 'pp', value: 99 }],
          note: '두 번 벗기기: pp → p → int. p 가 <em>지금</em> 가리키는 셀에 99 가 쓰인다.' },
        { label: '*pp = nullptr', do: [{ deref: 'pp', to: null }],
          note: 'pp 를 통해 p 를 nullptr 로 만들었다. 이후 <code>**pp</code> 는 두 번째 역참조에서 미정의 동작이다.' },
        { label: 'p = &x', do: [{ set: 'p', to: 'x' }],
          note: 'p 를 직접 대입해도 pp 는 여전히 p 를 가리키므로, <code>**pp</code> 는 다시 x 에 닿는다.' }
      ]
    }
  };

  /* ---------- 상태 구성 ---------- */

  function normTarget(t) {
    if (t === null || t === undefined) return null;
    if (typeof t === 'string') return { ref: t };
    return { arr: t.arr, index: t.index };
  }

  // 시나리오 정의 → 런타임 상태. 리셋 = 다시 부르기만 하면 되도록
  // 정의를 절대 변형하지 않고 매번 새 슬롯 객체를 만든다.
  function buildState(def) {
    var slots = [], arrays = {};

    def.cells.forEach(function (c) {
      if (c.type.indexOf('[') >= 0) {
        var vals = c.values || [];
        arrays[c.name] = { len: vals.length };
        vals.forEach(function (v, i) {
          slots.push({ id: c.name + '[' + i + ']', name: c.name + '[' + i + ']',
                       type: 'int', kind: 'int', size: 4, value: v, arr: c.name, idx: i });
        });
      } else if (c.type.indexOf('*') >= 0) {
        slots.push({ id: c.name, name: c.name, type: c.type,
                     kind: 'ptr', size: 8, target: normTarget(c.points) });
      } else {
        slots.push({ id: c.name, name: c.name, type: c.type,
                     kind: 'int', size: 4, value: c.value });
      }
    });

    // 주소 부여: 타입 크기만큼 증가, 포인터는 8바이트 정렬.
    // 진짜 스택처럼 보여야 "포인터의 값 = 주소" 가 눈에 박힌다.
    var off = 0, ptrCount = 0;
    slots.forEach(function (s) {
      if (s.size === 8) off = Math.ceil(off / 8) * 8;
      s.addr = ADDR_BASE + off;
      off += s.size;
      if (s.kind === 'ptr') s.colorIdx = ptrCount++;
    });

    // 배치: 배열 요소는 간격 0 으로 붙인다 (연속 메모리의 시각화).
    var x = 0;
    slots.forEach(function (s, i) {
      s.w = s.kind === 'ptr' ? PTR_W : (s.arr ? ELEM_W : INT_W);
      if (i > 0 && !(s.arr && slots[i - 1].arr === s.arr)) x += GAP;
      s.x = x;
      x += s.w;
    });
    var startX = Math.max(10, (W - x) / 2);
    slots.forEach(function (s) { s.x += startX; });

    return { slots: slots, arrays: arrays, hl: {} };
  }

  function byId(state, id) {
    for (var i = 0; i < state.slots.length; i++)
      if (state.slots[i].id === id) return state.slots[i];
    return null;
  }

  // 포인터가 "지금" 가리키는 것을 푼다. 배열 범위 밖은 셀이 없으므로
  // oob 로 구분해 돌려준다 — 화살표 색/역참조 거부가 여기서 갈린다.
  function resolve(state, ptr) {
    var t = ptr.target;
    if (!t) return { kind: 'null' };
    if (t.ref) return { kind: 'slot', slot: byId(state, t.ref) };
    var a = state.arrays[t.arr];
    if (a && t.index >= 0 && t.index < a.len)
      return { kind: 'slot', slot: byId(state, t.arr + '[' + t.index + ']') };
    return { kind: 'oob', arr: t.arr, index: t.index };
  }

  function fmtAddr(n) {
    return '0x7ffc' + ('0000' + (n >>> 0).toString(16)).slice(-4);
  }

  // 포인터 셀 중앙에 표시할 값. 범위 밖이어도 주소 자체는 계산해서 보여준다
  // — "주소는 멀쩡해 보이는데 역참조가 불법" 이라는 함정을 드러내기 위해.
  function targetAddrText(state, ptr) {
    var t = ptr.target;
    if (!t) return 'nullptr';
    if (t.ref) { var s = byId(state, t.ref); return s ? fmtAddr(s.addr) : '?'; }
    var first = byId(state, t.arr + '[0]');
    return first ? fmtAddr(first.addr + 4 * t.index) : '?';
  }

  /* ---------- 마운트 ---------- */

  WIDGETS['pointer-diagram'] = {
    mount: function (mountEl, params) {
      var uid = ++uidSeq;
      var scenKey = SCENARIOS[params.scenario] ? params.scenario : 'basics';
      var f = core.frame(mountEl, {
        icon: '🎯',
        title: params.title || '포인터 다이어그램 — 주소, 화살표, 역참조'
      });

      // 시나리오 전환 바 (body 상단). widget-controls 를 재사용하되
      // body 안이라 위쪽 구분선/배경은 없앤다.
      var scenBar = core.el('div', 'widget-controls');
      scenBar.style.borderTop = 'none';
      scenBar.style.background = 'transparent';
      scenBar.style.padding = '0 0 10px';
      f.body.appendChild(scenBar);

      var stage = core.el('div', 'widget-stage');
      var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
      stage.appendChild(svgRoot);
      f.body.appendChild(stage);

      // 연산 버튼 바 (SVG 아래)
      var opsBar = core.el('div', 'widget-controls');
      opsBar.style.background = 'transparent';
      opsBar.style.padding = '10px 0 0';
      f.body.appendChild(opsBar);

      var state, hlTimer = null;

      /* ----- 그리기: 상태의 순수 함수. 매번 전부 다시 그린다 ----- */
      function render() {
        while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);

        // 렌더마다 CSS 변수를 다시 읽어 테마 전환에 따라온다.
        var cBg     = core.themeColor('--bg', '#ffffff');
        var cBorder = core.themeColor('--border-strong', '#cfd4de');
        var cFg     = core.themeColor('--fg', '#1c1f26');
        var cSoft   = core.themeColor('--fg-soft', '#4a5160');
        var cMute   = core.themeColor('--fg-mute', '#7b8496');
        var cHl     = core.themeColor('--accent-soft', '#eaf1fe');
        var cBad    = '#d93838';
        // 포인터별 화살표 색 순환. 첫 색만 테마 accent 를 따라가고
        // 나머지는 라이트/다크 양쪽에서 읽히는 중간 톤 고정색.
        var palette = [core.themeColor('--accent', '#2f6fed'), '#e0862f', '#2fae6e'];
        var mono = '"JetBrains Mono","Cascadia Code","D2Coding",Consolas,monospace';

        // 화살촉 marker — stroke 색마다 하나씩 필요해서 defs 에 미리 만든다.
        var defs = core.svg('defs');
        palette.concat([cBad]).forEach(function (col, i) {
          defs.appendChild(core.svg('marker', {
            id: 'pd' + uid + '-ah' + i, viewBox: '0 0 10 10',
            refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
          }, [core.svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: col })]));
        });
        svgRoot.appendChild(defs);

        // 1) 메모리 셀 박스
        state.slots.forEach(function (s) {
          var cx = s.x + s.w / 2;
          svgRoot.appendChild(core.svg('rect', {
            x: s.x, y: BOX_Y, width: s.w, height: BOX_H,
            rx: s.arr ? 0 : 8,
            fill: state.hl[s.id] ? cHl : cBg,
            stroke: cBorder, 'stroke-width': 1.4
          }));
          // 주소 (상단, 모노스페이스)
          svgRoot.appendChild(core.svgText(cx, BOX_Y + 17, fmtAddr(s.addr), {
            'text-anchor': 'middle', 'font-size': 11, fill: cMute, 'font-family': mono
          }));
          // 값 (중앙)
          if (s.kind === 'int') {
            svgRoot.appendChild(core.svgText(cx, BOX_Y + 58, String(s.value), {
              'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: cFg
            }));
          } else {
            var vt = targetAddrText(state, s);
            svgRoot.appendChild(core.svgText(cx, BOX_Y + 56, vt, {
              'text-anchor': 'middle', 'font-size': vt === 'nullptr' ? 13 : 12,
              'font-weight': 700, fill: cFg, 'font-family': mono
            }));
          }
          // 이름: 타입 (하단, 포인터는 화살표 색과 맞춰 소유 관계가 보이게)
          var nameCol = s.kind === 'ptr' ? palette[s.colorIdx % palette.length] : cSoft;
          svgRoot.appendChild(core.svgText(cx, BOX_Y + BOX_H + 19, s.name + ': ' + s.type, {
            'text-anchor': 'middle', 'font-size': 12, 'font-weight': 650, fill: nameCol
          }));
        });

        // 2) 포인터 화살표 (박스 위에 겹치도록 나중에 그린다)
        state.slots.forEach(function (s) {
          if (s.kind !== 'ptr') return;
          var col = palette[s.colorIdx % palette.length];
          var sx = s.x + s.w / 2, sy = BOX_Y;
          var r = resolve(state, s);

          if (r.kind === 'null') {
            // 접지 기호: "어디에도 연결되지 않음" 의 관례적 표기
            svgRoot.appendChild(core.svg('line', {
              x1: sx, y1: sy, x2: sx, y2: sy - 16, stroke: cMute, 'stroke-width': 2
            }));
            [[11, 16], [7, 21], [3.5, 26]].forEach(function (b) {
              svgRoot.appendChild(core.svg('line', {
                x1: sx - b[0], y1: sy - b[1], x2: sx + b[0], y2: sy - b[1],
                stroke: cMute, 'stroke-width': 2
              }));
            });
            return;
          }

          var oob = r.kind === 'oob';
          var ex, first;
          if (oob) {
            // 범위 밖: 실제 셀이 없으니 배열 배치를 연장한 가상 위치로 쏜다.
            first = byId(state, r.arr + '[0]');
            ex = first.x + (r.index + 0.5) * ELEM_W;
            ex = Math.max(14, Math.min(W - 14, ex));
          } else {
            // 같은 셀로 화살표가 여럿 몰릴 때 화살촉이 겹치지 않게 살짝 비껴 꽂는다.
            ex = r.slot.x + r.slot.w / 2 + (s.colorIdx % 3 - 1) * 9;
          }
          var ey = BOX_Y - 3;
          var dist = Math.abs(ex - sx);
          // 아치 높이를 거리에 비례시키면 짧은/긴 화살표가 자연히 층이 갈려
          // (pp→p 낮게, p→x 높게) 별도의 레이어 배정 로직이 필요 없다.
          var arc = Math.min(140, 44 + dist * 0.16);
          var d = 'M' + sx + ',' + sy +
                  ' C' + sx + ',' + (sy - arc) +
                  ' ' + ex + ',' + (ey - arc) +
                  ' ' + ex + ',' + ey;
          var attrs = {
            d: d, fill: 'none', 'stroke-width': 2.2,
            stroke: oob ? cBad : col,
            'marker-end': 'url(#pd' + uid + '-ah' + (oob ? palette.length : s.colorIdx % palette.length) + ')'
          };
          if (oob) attrs['stroke-dasharray'] = '6 5';
          svgRoot.appendChild(core.svg('path', attrs));

          if (oob) {
            svgRoot.appendChild(core.svgText(ex, ey - arc - 8, '⚠ 범위 밖', {
              'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: cBad
            }));
          }
        });
      }

      /* ----- 연산 적용 ----- */
      function flash(changed) {
        state.hl = changed;
        render();
        if (hlTimer) clearTimeout(hlTimer);
        // 강조는 "방금 바뀐 곳" 표시일 뿐 상태가 아니므로 잠깐 뒤 걷어낸다.
        hlTimer = setTimeout(function () { state.hl = {}; render(); }, 900);
      }

      function runOp(op) {
        var changed = {}, warn = null, extra = '';

        for (var i = 0; i < op.do.length && !warn; i++) {
          var a = op.do[i];

          if (a.set) {
            var ps = byId(state, a.set);
            ps.target = normTarget(a.to);
            changed[ps.id] = 1;

          } else if (a.adv) {
            var pa = byId(state, a.adv);
            if (!pa.target) {
              warn = '⚠ nullptr 포인터에 대한 산술 연산은 미정의 동작(UB)이다. 아무 것도 바꾸지 않았다.';
            } else if (pa.target.ref) {
              warn = '⚠ 배열이 아닌 단일 변수를 가리키는 포인터의 산술은 미정의 동작(UB)이다.';
            } else {
              pa.target = { arr: pa.target.arr, index: pa.target.index + a.by };
              changed[pa.id] = 1;
            }

          } else if (a.deref) {
            var p1 = byId(state, a.deref);
            var r1 = resolve(state, p1);
            if (r1.kind === 'null') {
              warn = '⚠ <code>*' + p1.name + '</code> — nullptr 역참조는 미정의 동작(UB)이다. 아무 것도 바꾸지 않았다.';
            } else if (r1.kind === 'oob') {
              warn = '⚠ 범위 밖 역참조는 미정의 동작(UB)이다. one-past-end 는 <em>가리킬</em> 수만 있고, 읽거나 쓸 수는 없다.';
            } else if (a.value !== undefined) {
              r1.slot.value = a.value;
              changed[r1.slot.id] = 1;
              extra = ' — 이번 대상: <code>' + core.esc(r1.slot.name) + '</code>';
            } else {
              r1.slot.target = normTarget(a.to);
              changed[r1.slot.id] = 1;
              extra = ' — 이번 대상: <code>' + core.esc(r1.slot.name) + '</code>';
            }

          } else if (a.deref2) {
            var p2 = byId(state, a.deref2);
            var ra = resolve(state, p2);
            if (ra.kind !== 'slot' || ra.slot.kind !== 'ptr') {
              warn = '⚠ <code>*' + p2.name + '</code> 단계에서 유효한 포인터가 나오지 않는다 — 미정의 동작(UB)이다.';
            } else {
              var rb = resolve(state, ra.slot);
              if (rb.kind === 'null') {
                warn = '⚠ 두 번째 역참조 실패: <code>' + core.esc(ra.slot.name) + '</code> 가 nullptr 이다. 미정의 동작(UB).';
              } else if (rb.kind === 'oob') {
                warn = '⚠ 두 번째 역참조가 범위 밖이다. 미정의 동작(UB).';
              } else {
                rb.slot.value = a.value;
                changed[rb.slot.id] = 1;
                extra = ' — 최종 대상: <code>' + core.esc(rb.slot.name) + '</code>';
              }
            }
          }
        }

        flash(changed);
        f.setCaption(warn
          ? '<code>' + core.esc(op.label) + '</code> → <span style="color:#d93838">' + warn + '</span>'
          : '<code>' + core.esc(op.label) + '</code> — ' + op.note + extra);
      }

      /* ----- 시나리오 전환 / 버튼 구성 ----- */
      function setScenario(key) {
        scenKey = key;
        var def = SCENARIOS[key];
        if (hlTimer) { clearTimeout(hlTimer); hlTimer = null; }
        state = buildState(def);

        // 시나리오 바: 현재 것만 primary
        Array.prototype.forEach.call(scenBar.children, function (b) {
          b.className = 'w-btn' + (b.dataset.key === key ? ' primary' : '');
        });

        // 연산 버튼 재구성
        opsBar.innerHTML = '';
        def.ops.forEach(function (op) {
          var b = core.el('button', 'w-btn', core.esc(op.label));
          b.addEventListener('click', function () { runOp(op); });
          opsBar.appendChild(b);
        });
        var reset = core.el('button', 'w-btn', '↺ 처음으로');
        reset.style.marginLeft = 'auto';
        reset.addEventListener('click', function () {
          if (hlTimer) { clearTimeout(hlTimer); hlTimer = null; }
          state = buildState(def);
          render();
          f.setCaption(def.desc);
        });
        opsBar.appendChild(reset);

        render();
        f.setCaption(def.desc);
      }

      Object.keys(SCENARIOS).forEach(function (key) {
        var b = core.el('button', 'w-btn', core.esc(SCENARIOS[key].title));
        b.dataset.key = key;
        b.addEventListener('click', function () { setScenario(key); });
        scenBar.appendChild(b);
      });

      setScenario(scenKey);
    }
  };
})(this);
