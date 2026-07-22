/* stack-heap.js — 스택 프레임과 힙 블록의 생멸을 스텝 단위로 보여주는 위젯
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget stack-heap
 *   { "scenario": "heap-alloc" }
 *   :::
 *
 * 시나리오는 위젯 안에 내장한다. 콘텐츠 JSON 에 스텝 배열을 직접 쓰게 하면
 * 저자가 C++ 의미론(프레임 pop 시점, 누수 조건)을 매번 정확히 재현해야 해서
 * 오류 여지가 크다. 검증된 시나리오를 코드에 두고 키로만 고르게 한다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  /* ---------- 내장 시나리오 ----------
   * steps[i] 는 "스텝 i 가 끝난 직후의 세계 전체"를 담는다 (실행 줄, 스택, 힙).
   * 이전 스텝과의 차분이 아니라 전체 상태를 두는 이유: render(i) 가 i 만 보고
   * 그릴 수 있어야 슬라이더 임의 접근이 공짜가 된다 (widget-core 의 계약).
   * heap 항목: { id, label, size, freed?, leaked? }
   * stack var: { name, val, ptr?: heapId }  — ptr 이 있으면 곡선 화살표를 그린다.
   */
  var SCENARIOS = {
    'basic-call': {
      title: '함수 호출과 스택 프레임',
      label: '함수 호출',
      code: [
        'int square(int n) {',
        '  int r = n * n;',
        '  return r;',
        '}',
        '',
        'int main() {',
        '  int a = 3;',
        '  int b = square(a);',
        '  return 0;',
        '}'
      ],
      steps: [
        { line: 7,
          stack: [{ fn: 'main', vars: [{ name: 'a', val: '3' }] }],
          heap: [],
          note: 'main이 시작되며 스택에 main 프레임이 생기고, 지역변수 a가 3으로 초기화된다.' },
        { line: 8,
          stack: [{ fn: 'main', vars: [{ name: 'a', val: '3' }, { name: 'b', val: '?' }] }],
          heap: [],
          note: 'b의 자리가 잡히지만 아직 값이 없다. 초기값을 얻으려고 square(a)를 호출한다.' },
        { line: 1,
          stack: [
            { fn: 'main', vars: [{ name: 'a', val: '3' }, { name: 'b', val: '?' }] },
            { fn: 'square', vars: [{ name: 'n', val: '3' }] }
          ],
          heap: [],
          note: 'square 프레임이 main 위에 쌓인다. 매개변수 n에는 a의 값 3이 복사된다 — 값 전달(pass by value)이다.' },
        { line: 2,
          stack: [
            { fn: 'main', vars: [{ name: 'a', val: '3' }, { name: 'b', val: '?' }] },
            { fn: 'square', vars: [{ name: 'n', val: '3' }, { name: 'r', val: '9' }] }
          ],
          heap: [],
          note: '지역변수 r가 square 프레임 안에 만들어진다. r는 이 프레임이 사는 동안만 존재한다.' },
        { line: 3,
          stack: [
            { fn: 'main', vars: [{ name: 'a', val: '3' }, { name: 'b', val: '?' }] },
            { fn: 'square', vars: [{ name: 'n', val: '3' }, { name: 'r', val: '9' }] }
          ],
          heap: [],
          note: 'return r — 반환값 9를 호출자에게 넘길 준비를 한다.' },
        { line: 8,
          stack: [{ fn: 'main', vars: [{ name: 'a', val: '3' }, { name: 'b', val: '9' }] }],
          heap: [],
          note: 'square 프레임이 통째로 사라지고(pop) 반환값 9가 b에 저장된다. n과 r도 프레임과 함께 소멸했다.' },
        { line: 9,
          stack: [{ fn: 'main', vars: [{ name: 'a', val: '3' }, { name: 'b', val: '9' }] }],
          heap: [],
          note: 'main이 return 0에 도달했다. 곧 main 프레임도 사라진다.' },
        { line: 10,
          stack: [],
          heap: [],
          note: 'main 프레임까지 사라져 스택이 비었다. 지역변수의 수명은 자신이 속한 프레임의 수명과 같다.' }
      ]
    },

    'heap-alloc': {
      title: 'new / delete 와 힙',
      label: '힙 할당/해제',
      code: [
        'int main() {',
        '  int* p = new int[4];',
        '  p[0] = 42;',
        '  int x = 7;',
        '  delete[] p;',
        '  p = nullptr;',
        '  return 0;',
        '}'
      ],
      steps: [
        { line: 1,
          stack: [{ fn: 'main', vars: [] }],
          heap: [],
          note: 'main 프레임이 생긴다. 아직 힙에는 아무것도 없다.' },
        { line: 2,
          stack: [{ fn: 'main', vars: [{ name: 'p', val: '0x5a10', ptr: 'arr' }] }],
          heap: [{ id: 'arr', label: 'int[4]', size: '16B' }],
          note: 'new int[4]가 힙에 16바이트를 할당하고 그 주소를 돌려준다. 주소를 담는 포인터 p 자체는 스택에 산다.' },
        { line: 3,
          stack: [{ fn: 'main', vars: [{ name: 'p', val: '0x5a10', ptr: 'arr' }] }],
          heap: [{ id: 'arr', label: 'int[4]', size: '16B' }],
          note: 'p[0] = 42 — 스택의 p를 거쳐 힙 배열의 첫 칸에 값을 쓴다.' },
        { line: 4,
          stack: [{ fn: 'main', vars: [{ name: 'p', val: '0x5a10', ptr: 'arr' }, { name: 'x', val: '7' }] }],
          heap: [{ id: 'arr', label: 'int[4]', size: '16B' }],
          note: '지역변수 x는 스택에 놓인다. 같은 함수 안에서 스택 변수와 힙 블록이 나란히 쓰인다.' },
        { line: 5,
          stack: [{ fn: 'main', vars: [{ name: 'p', val: '0x5a10', ptr: 'arr' }, { name: 'x', val: '7' }] }],
          heap: [{ id: 'arr', label: 'int[4]', size: '16B', freed: true }],
          note: 'delete[] p — 힙 블록이 해제됐다. 그런데 p는 여전히 옛 주소를 들고 있다(댕글링 포인터). 이 상태로 p를 쓰면 미정의 동작이다.' },
        { line: 6,
          stack: [{ fn: 'main', vars: [{ name: 'p', val: 'nullptr' }, { name: 'x', val: '7' }] }],
          heap: [],
          note: 'p = nullptr — 댕글링 상태를 끊었다. 이제 사용 전 널 검사로 실수를 걸러낼 수 있다.' },
        { line: 8,
          stack: [],
          heap: [],
          note: 'main이 리턴하며 스택이 비었다. new와 delete가 짝을 이뤘으므로 힙도 깨끗하다.' }
      ]
    },

    'leak': {
      title: 'delete 없는 리턴 = 누수',
      label: '메모리 누수',
      code: [
        'void work() {',
        '  int* buf = new int[8];',
        '  buf[0] = 1;',
        '}  // delete[] 가 없다!',
        '',
        'int main() {',
        '  work();',
        '  return 0;',
        '}'
      ],
      steps: [
        { line: 7,
          stack: [{ fn: 'main', vars: [] }],
          heap: [],
          note: 'main 프레임에서 work()를 호출한다.' },
        { line: 1,
          stack: [{ fn: 'main', vars: [] }, { fn: 'work', vars: [] }],
          heap: [],
          note: 'work 프레임이 스택에 쌓인다.' },
        { line: 2,
          stack: [{ fn: 'main', vars: [] }, { fn: 'work', vars: [{ name: 'buf', val: '0x7c40', ptr: 'buf8' }] }],
          heap: [{ id: 'buf8', label: 'int[8]', size: '32B' }],
          note: 'new int[8]이 힙에 32바이트를 할당하고, 주소는 work의 지역변수 buf에 저장된다.' },
        { line: 3,
          stack: [{ fn: 'main', vars: [] }, { fn: 'work', vars: [{ name: 'buf', val: '0x7c40', ptr: 'buf8' }] }],
          heap: [{ id: 'buf8', label: 'int[8]', size: '32B' }],
          note: 'buf를 통해 힙 배열에 값을 쓴다. 여기까지는 아무 문제 없다.' },
        { line: 4,
          stack: [{ fn: 'main', vars: [] }, { fn: 'work', vars: [{ name: 'buf', val: '0x7c40', ptr: 'buf8' }] }],
          heap: [{ id: 'buf8', label: 'int[8]', size: '32B' }],
          note: 'work가 끝나는데 delete[]가 없다. buf는 곧 프레임과 함께 사라질 참이다.' },
        { line: 7,
          stack: [{ fn: 'main', vars: [] }],
          heap: [{ id: 'buf8', label: 'int[8]', size: '32B', leaked: true }],
          note: 'work 프레임이 사라지며 buf도 소멸했다. 힙의 32바이트는 남았지만 주소를 아는 변수가 하나도 없다 — 메모리 누수다.' },
        { line: 8,
          stack: [{ fn: 'main', vars: [] }],
          heap: [{ id: 'buf8', label: 'int[8]', size: '32B', leaked: true }],
          note: '프로그램이 끝날 때까지 이 블록을 회수할 방법이 없다. new에는 반드시 짝이 되는 delete가 필요하다.' },
        { line: 9,
          stack: [],
          heap: [{ id: 'buf8', label: 'int[8]', size: '32B', leaked: true }],
          note: 'main까지 리턴해 스택은 비었지만, 누수된 블록은 힙에 그대로 남아 있다. (스마트 포인터가 이 문제를 구조적으로 막는다.)' }
      ]
    }
  };

  var ORDER = ['basic-call', 'heap-alloc', 'leak'];
  var DANGER = '#d93838'; // style.css 의 .widget-error 와 같은 값 — 테마와 무관하게 "위험"은 빨강
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  /* ---------- 기하 상수 ---------- */
  var W = 900, H = 430;
  var CODE = { x: 14, w: 286 };                 // 왼쪽 1/3: 코드
  var STK  = { x: 336, w: 222, baseY: 404 };    // 가운데 1/3: 스택 (baseY 에서 위로)
  var HP   = { x: 636, w: 218, topY: 46 };      // 오른쪽 1/3: 힙 (topY 에서 아래로)
  var ROW = 20;                                  // 변수 한 줄 높이

  WIDGETS['stack-heap'] = {
    mount: function (mountEl, params) {
      params = params || {};
      // 미지의 시나리오 키는 조용히 basic-call 로 폴백 — 콘텐츠 오타로 위젯이
      // 통째로 죽는 것보다 기본 시나리오라도 보여주는 편이 낫다.
      var key = SCENARIOS[params.scenario] ? params.scenario : 'basic-call';
      // 한 페이지에 이 위젯이 여러 개 있어도 SVG marker id 가 충돌하지 않도록
      // 마운트마다 고유 접두어를 만든다 (marker 는 문서 전역 id 로 참조된다).
      var uid = 'sh' + Math.random().toString(36).slice(2, 8);
      build(mountEl, key, uid);
    }
  };

  /* 시나리오 전환 = 전체 재마운트. 플레이어의 total 이 시나리오마다 달라서
   * 기존 플레이어를 고쳐 쓰는 것보다 비우고 다시 만드는 쪽이 단순하고 안전하다. */
  function build(mountEl, key, uid) {
    mountEl.innerHTML = '';
    var sc = SCENARIOS[key];

    var f = core.frame(mountEl, { icon: '🧱', title: '스택과 힙 — ' + sc.title });

    // 시나리오 전환 버튼: head 는 공통 프레임 구조라 건드리지 않고 body 상단에 둔다.
    var bar = core.el('div', '');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
    ORDER.forEach(function (k) {
      var b = core.el('button', 'w-btn' + (k === key ? ' primary' : ''), core.esc(SCENARIOS[k].label));
      b.addEventListener('click', function () {
        if (k === key) return;
        p.destroy(); // 자동재생 타이머가 살아 있으면 재마운트 후에도 돌아가므로 반드시 끊는다
        build(mountEl, k, uid);
      });
      bar.appendChild(b);
    });
    f.body.appendChild(bar);

    var stage = core.el('div', 'widget-stage');
    var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
    stage.appendChild(svgRoot);
    f.body.appendChild(stage);

    function render(i) {
      var step = sc.steps[i];
      while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);

      // 색은 렌더마다 CSS 변수에서 다시 읽는다 — 사용자가 테마를 바꾼 뒤
      // 스텝만 넘겨도 새 테마 색으로 그려진다.
      var C = {
        accent: core.themeColor('--accent', '#2f6fed'),
        fg:     core.themeColor('--fg', '#20242c'),
        soft:   core.themeColor('--fg-soft', '#4a5160'),
        mute:   core.themeColor('--fg-mute', '#7b8496'),
        border: core.themeColor('--border-strong', '#c3cad6'),
        sunken: core.themeColor('--bg-sunken', '#eef1f6')
      };

      defineMarkers(svgRoot, uid, C.accent);
      drawCode(svgRoot, sc.code, step.line, C);
      var ptrAnchors = drawStack(svgRoot, step.stack, C);
      var blockAnchors = drawHeap(svgRoot, step.heap, C);
      drawArrows(svgRoot, ptrAnchors, blockAnchors, step.heap, uid, C);

      f.setCaption(core.esc(step.note));
    }

    var p = core.player(mountEl, { total: sc.steps.length, render: render, autoMs: 1600 });
  }

  /* ---------- 화살촉 marker ---------- */
  function defineMarkers(root, uid, accent) {
    function marker(id, color) {
      return core.svg('marker', {
        id: id, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      }, [core.svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color })]);
    }
    root.appendChild(core.svg('defs', {}, [
      marker(uid + '-arw', accent),
      marker(uid + '-arwd', DANGER)
    ]));
  }

  /* ---------- 왼쪽: 코드 패널 ---------- */
  function drawCode(root, code, curLine, C) {
    root.appendChild(core.svg('rect', {
      x: CODE.x, y: 14, width: CODE.w, height: H - 28, rx: 8,
      fill: C.sunken, stroke: C.border
    }));
    var lh = 19, top = 40;
    for (var k = 0; k < code.length; k++) {
      var y = top + k * lh;
      var cur = (k + 1) === curLine;
      if (cur) {
        root.appendChild(core.svg('rect', {
          x: CODE.x + 6, y: y - 13, width: CODE.w - 12, height: 18, rx: 4,
          fill: 'color-mix(in srgb, ' + C.accent + ' 18%, transparent)'
        }));
        root.appendChild(core.svgText(CODE.x + 12, y, '▶',
          { 'font-size': 10, fill: C.accent }));
      }
      root.appendChild(core.svgText(CODE.x + 28, y, code[k], {
        'font-size': 12, 'font-family': MONO,
        fill: cur ? C.fg : C.soft, 'font-weight': cur ? 700 : 400,
        'xml:space': 'preserve', style: 'white-space:pre'
      }));
    }
  }

  /* ---------- 가운데: 스택 ----------
   * 프레임을 배열 순서(0 = 가장 오래된 것)대로 baseY 에서 위로 쌓는다.
   * 실제 스택이 높은 주소에서 낮은 주소로 자라는 것과 방향 논쟁이 있지만,
   * 교육용 그림의 관례("위로 쌓인다")를 따르고 라벨로 명시한다.
   * 반환값: ptr 변수 행의 화살표 시작점 목록 [{heapId, x, y, dangling}]
   */
  function drawStack(root, frames, C) {
    root.appendChild(core.svgText(STK.x + STK.w / 2, 26, '스택 (위로 성장)', {
      'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: C.soft
    }));
    // 바닥선: 프레임이 하나도 없어도 "여기서부터 쌓인다"는 기준을 보여준다.
    root.appendChild(core.svg('line', {
      x1: STK.x - 10, y1: STK.baseY, x2: STK.x + STK.w + 10, y2: STK.baseY,
      stroke: C.border, 'stroke-width': 2
    }));

    var anchors = [];
    if (!frames.length) {
      root.appendChild(core.svgText(STK.x + STK.w / 2, STK.baseY - 16, '(비어 있음)', {
        'text-anchor': 'middle', 'font-size': 12, fill: C.mute
      }));
      return anchors;
    }

    var y = STK.baseY; // 아래에서 위로 프레임을 배치
    for (var fi = 0; fi < frames.length; fi++) {
      var fr = frames[fi];
      var top = fi === frames.length - 1;
      var head = 22, fh = head + Math.max(fr.vars.length, 0) * ROW + 6;
      y -= fh;

      root.appendChild(core.svg('rect', {
        x: STK.x, y: y, width: STK.w, height: fh, rx: 6,
        fill: 'color-mix(in srgb, ' + C.accent + (top ? ' 10%' : ' 5%') + ', transparent)',
        stroke: top ? C.accent : C.border, 'stroke-width': top ? 2 : 1
      }));
      root.appendChild(core.svgText(STK.x + 10, y + 15, fr.fn + '()', {
        'font-size': 12, 'font-family': MONO, 'font-weight': 700,
        fill: top ? C.accent : C.soft
      }));
      root.appendChild(core.svg('line', {
        x1: STK.x, y1: y + head, x2: STK.x + STK.w, y2: y + head,
        stroke: top ? C.accent : C.border, 'stroke-width': 1, opacity: 0.5
      }));

      for (var vi = 0; vi < fr.vars.length; vi++) {
        var v = fr.vars[vi];
        var ry = y + head + vi * ROW + 14;
        root.appendChild(core.svgText(STK.x + 14, ry, v.name, {
          'font-size': 12, 'font-family': MONO, fill: C.fg
        }));
        root.appendChild(core.svgText(STK.x + STK.w - 12, ry, '= ' + v.val, {
          'text-anchor': 'end', 'font-size': 12, 'font-family': MONO,
          fill: v.ptr ? C.accent : C.soft, 'font-weight': v.ptr ? 700 : 400
        }));
        if (v.ptr) anchors.push({ heapId: v.ptr, x: STK.x + STK.w, y: ry - 4 });
      }
      y -= 6; // 프레임 사이 간격
    }
    return anchors;
  }

  /* ---------- 오른쪽: 힙 ----------
   * 반환값: 화살표 도착점 { heapId: {x, y} }
   */
  function drawHeap(root, blocks, C) {
    root.appendChild(core.svgText(HP.x + HP.w / 2, 26, '힙', {
      'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: C.soft
    }));

    var anchors = {};
    if (!blocks.length) {
      root.appendChild(core.svgText(HP.x + HP.w / 2, HP.topY + 30, '(비어 있음)', {
        'text-anchor': 'middle', 'font-size': 12, fill: C.mute
      }));
      return anchors;
    }

    var bh = 50, gap = 16;
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      var by = HP.topY + bi * (bh + gap);
      var stroke = b.leaked ? DANGER : (b.freed ? C.mute : C.accent);

      root.appendChild(core.svg('rect', {
        x: HP.x, y: by, width: HP.w, height: bh, rx: 6,
        fill: b.leaked
          ? 'color-mix(in srgb, ' + DANGER + ' 10%, transparent)'
          : (b.freed ? 'none' : 'color-mix(in srgb, ' + C.accent + ' 8%, transparent)'),
        stroke: stroke, 'stroke-width': b.leaked ? 2 : 1.5,
        'stroke-dasharray': b.freed ? '5 4' : null,
        opacity: b.freed ? 0.65 : 1
      }));
      root.appendChild(core.svgText(HP.x + 12, by + 21, b.label + '  ' + b.size, {
        'font-size': 12, 'font-family': MONO, 'font-weight': 700,
        fill: b.freed ? C.mute : C.fg
      }));
      var sub = b.leaked ? '아무도 가리키지 않음' : (b.freed ? '해제됨 (delete[])' : 'new 로 할당됨');
      root.appendChild(core.svgText(HP.x + 12, by + 39, sub, {
        'font-size': 11, fill: b.leaked ? DANGER : C.mute
      }));
      if (b.leaked) {
        root.appendChild(core.svgText(HP.x + HP.w - 10, by + 21, '누수!', {
          'text-anchor': 'end', 'font-size': 12, 'font-weight': 800, fill: DANGER
        }));
      }
      anchors[b.id] = { x: HP.x, y: by + bh / 2 };
    }
    return anchors;
  }

  /* ---------- 포인터 화살표 ----------
   * 스택 변수 행 오른쪽 끝 → 힙 블록 왼쪽 변. 해제된 블록을 가리키면
   * (댕글링) 빨간 점선으로 그려 "여전히 가리키고는 있지만 위험"을 표현한다.
   */
  function drawArrows(root, ptrAnchors, blockAnchors, heap, uid, C) {
    var freedById = {};
    heap.forEach(function (b) { freedById[b.id] = !!b.freed; });

    ptrAnchors.forEach(function (a) {
      var to = blockAnchors[a.heapId];
      if (!to) return;
      var dangling = freedById[a.heapId];
      var color = dangling ? DANGER : C.accent;
      // 두 열 사이 빈 공간에서 부드럽게 휘도록 제어점을 수평 방향으로만 벌린다.
      var d = 'M ' + a.x + ' ' + a.y +
        ' C ' + (a.x + 46) + ' ' + a.y + ', ' + (to.x - 46) + ' ' + to.y +
        ', ' + (to.x - 3) + ' ' + to.y;
      root.appendChild(core.svg('path', {
        d: d, fill: 'none', stroke: color, 'stroke-width': 1.8,
        'stroke-dasharray': dangling ? '5 4' : null,
        'marker-end': 'url(#' + uid + (dangling ? '-arwd' : '-arw') + ')'
      }));
    });
  }
})(this);
