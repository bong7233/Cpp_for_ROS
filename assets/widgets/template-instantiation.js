/* template-instantiation.js — 함수 템플릿 한 벌이 호출 타입마다 별도 함수로
 * "찍혀 나오는" 과정(템플릿 인스턴스화)을 보여주는 위젯
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget template-instantiation
 *   {}
 *   :::
 *   (파라미터 없이도 동작 — max_val<T> 하나로 메커니즘을 보여주는 시나리오가
 *   전부다. 시나리오 분기를 두지 않은 이유는 stack-heap 과 반대다: 여기서는
 *   "타입이 바뀌어도 같은 메커니즘(치환→개별 컴파일)이 반복된다"는 것 자체가
 *   요점이라, int/double/std::string 세 가지를 한 화면에서 나란히 보여주는
 *   쪽이 여러 시나리오로 쪼개는 것보다 낫다.)
 *
 * 왜 세 인스턴스를 매번 전부 다시 그리는가: widget-core 의 계약과 동일 —
 * render(i) 가 i 만으로 전체 그림을 그릴 수 있어야 슬라이더 임의 접근·
 * 되감기가 공짜로 따라온다. "찍히는 애니메이션"은 실시간 트랜지션이 아니라
 * stamping 상태(막 등장) → done 상태(정착)로의 시각적 대비로 표현한다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  var W = 900, H = 420;
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var GREEN = '#2fae6e';

  /* ---------- 레이아웃 상수 ---------- */

  var TEMPLATE_BOX = { x: 14, y: 10, w: 720, h: 92 };
  var BLOAT_BOX    = { x: 744, y: 10, w: 142, h: 92 };

  var ROW_Y = [118, 212, 306];
  var ROW_H = 82;
  var CALL_BOX = { x: 14, w: 260 };
  var INST_BOX = { x: 290, w: 596 };

  var FOOT_Y = 406;

  /* ---------- 소스 데이터 ---------- */

  var TEMPLATE_LINES = [
    'template <typename T>',
    'T max_val(T a, T b) { return a > b ? a : b; }'
  ];

  var CALLS = [
    { lines: ['max_val(3, 7);'], example: 'max_val(3, 7) == 7' },
    { lines: ['max_val(3.5, 2.1);'], example: 'max_val(3.5, 2.1) == 3.5' },
    { lines: ['max_val(std::string("a"),', '         std::string("b"));'], example: 'max_val(...) == "b"' }
  ];

  var INSTANCES = [
    { sig: 'int max_val<int>(int a, int b)', badge: 'T → int',
      body: '{ return a > b ? a : b; }', example: 'max_val(3, 7) → 7' },
    { sig: 'double max_val<double>(double a, double b)', badge: 'T → double',
      body: '{ return a > b ? a : b; }', example: 'max_val(3.5, 2.1) → 3.5' },
    { sig: 'std::string max_val<std::string>(std::string a, std::string b)', badge: 'T → std::string',
      body: '{ return a > b ? a : b; }', example: 'max_val(...) → "b"' }
  ];

  /* ---------- 스텝 시퀀스 ----------
   * c: 세 호출의 상태('idle'|'active'|'done'), i: 세 인스턴스의 상태
   * ('hidden'|'stamping'|'done'). stamping 은 "방금 찍힌" 스텝 한 번만 켜고
   * 그다음 스텝부터 done 으로 정착한다 — vtable-diagram 의 글로우 on/off와
   * 같은 원리로, 매 스텝 전부 강조하면 "지금 뭘 보라는 건지"가 흐려진다.
   */
  var STEPS = [
    { c: ['idle', 'idle', 'idle'], i: ['hidden', 'hidden', 'hidden'],
      cap: '함수 템플릿은 그 자체로 실행 코드가 아니다 — <b>컴파일러에게 주는 설계도</b>다. ' +
           '<code>T</code> 자리에 어떤 타입이 들어올지는 아직 정해지지 않았고, 아직은 아무 함수도 만들어지지 않았다.' },

    { c: ['active', 'idle', 'idle'], i: ['hidden', 'hidden', 'hidden'],
      cap: '<code>max_val(3, 7)</code> — 인자가 둘 다 <code>int</code>이므로 컴파일러는 ' +
           '<b>T = int</b>로 추론한다. 아직 함수가 찍혀 나오지는 않았다.' },

    { c: ['done', 'idle', 'idle'], i: ['stamping', 'hidden', 'hidden'],
      cap: '컴파일러가 <b>T를 int로 치환한 전용 함수</b>를 실제로 찍어낸다: ' +
           '<code>int max_val&lt;int&gt;(int, int)</code>. 본문(<code>{ return a > b ? a : b; }</code>)은 ' +
           '그대로이고 <b>시그니처의 타입만</b> 바뀌었다.' },

    { c: ['done', 'active', 'idle'], i: ['done', 'hidden', 'hidden'],
      cap: '<code>max_val(3.5, 2.1)</code> — 이번엔 인자가 <code>double</code>이다. ' +
           '같은 템플릿을 다른 타입으로 다시 호출했다.' },

    { c: ['done', 'done', 'idle'], i: ['done', 'stamping', 'hidden'],
      cap: '<b>T = double</b>로 또 하나의 전용 함수가 찍혀 나온다. ' +
           'int 버전과는 <b>완전히 별개의, 서로 다른 주소를 가진 함수</b>다 — 오버로드가 아니라 인스턴스화다.' },

    { c: ['done', 'done', 'active'], i: ['done', 'done', 'hidden'],
      cap: '<code>max_val(std::string("a"), std::string("b"))</code> — 클래스 타입도 예외가 아니다. ' +
           '<code>operator&gt;</code>가 정의돼 있는 한 <code>std::string</code>도 T가 될 수 있다.' },

    { c: ['done', 'done', 'done'], i: ['done', 'done', 'stamping'],
      cap: '<b>T = std::string</b> 버전까지 찍혀 나왔다. 이제 서로 다른 시그니처를 가진 함수가 <b>세 개</b> 존재한다.' },

    { c: ['done', 'done', 'done'], i: ['done', 'done', 'done'], summary: true,
      cap: '<b>템플릿 소스는 한 벌이지만, 실행 파일 안에는 세 개의 서로 다른 함수가 각각 컴파일돼 들어간다.</b> ' +
           '이 과정을 템플릿 <b>인스턴스화(instantiation)</b>라 부른다 — 제네릭 코드 한 벌 → 호출되는 타입마다 별도 코드.' },

    { c: ['done', 'done', 'done'], i: ['done', 'done', 'done'], summary: true, bloat: true,
      cap: '호출에 쓰인 타입 수만큼 함수가 늘어난다 — 템플릿을 <b>많은 타입으로</b> 쓸수록 실행 파일도 그만큼 커진다. ' +
           '이 현상을 <b>코드 크기 팽창(code bloat)</b>이라 부른다. (헤더에 정의된 템플릿을 여러 <code>.cpp</code>에서 쓰면 ' +
           '더 두드러진다 — Part VII 빌드 시스템에서 다시 다룬다.)' }
  ];

  /* ---------- 마운트 ---------- */

  WIDGETS['template-instantiation'] = {
    mount: function (mountEl, params) {
      params = params || {};
      var uid = 'ti' + Math.random().toString(36).slice(2, 8);

      var f = core.frame(mountEl, {
        icon: '🏭',
        title: params.title || '템플릿 인스턴스화 — 제네릭 코드 한 벌, 컴파일된 함수 여러 개'
      });

      var stage = core.el('div', 'widget-stage');
      var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
      stage.appendChild(svgRoot);
      f.body.appendChild(stage);

      /* ----- 그리기 헬퍼 ----- */

      function box(root, r, C, opt) {
        opt = opt || {};
        root.appendChild(core.svg('rect', {
          x: r.x, y: r.y, width: r.w, height: r.h, rx: opt.rx || 7,
          fill: opt.fill || C.bg, stroke: opt.stroke || C.borderStrong,
          'stroke-width': opt.strokeWidth || 1.3,
          'stroke-dasharray': opt.dashed ? '4 4' : null
        }));
      }

      // 템플릿 소스 패널: 항상 보이고, 오른쪽 위 카운터만 스텝에 따라 바뀐다 —
      // "지금까지 몇 개가 찍혔는가"를 매 스텝 눈으로 추적하게 한다.
      function templateBox(root, stepIdx, doneCount, C) {
        box(root, TEMPLATE_BOX, C, { fill: C.sunken });
        root.appendChild(core.svgText(TEMPLATE_BOX.x + 12, TEMPLATE_BOX.y + 18, '템플릿 소스 (컴파일 전, 딱 한 벌)', {
          'font-size': 11, 'font-weight': 700, fill: C.mute
        }));
        var counter = doneCount >= 3 ? '완료 — 1 템플릿 → 3 함수' : ('찍힌 인스턴스: ' + doneCount + ' / 3');
        root.appendChild(core.svgText(TEMPLATE_BOX.x + TEMPLATE_BOX.w - 10, TEMPLATE_BOX.y + 18, counter, {
          'text-anchor': 'end', 'font-size': 10.5, 'font-weight': 700,
          fill: doneCount >= 3 ? GREEN : C.accent
        }));
        root.appendChild(core.svg('line', {
          x1: TEMPLATE_BOX.x + 8, y1: TEMPLATE_BOX.y + 26, x2: TEMPLATE_BOX.x + TEMPLATE_BOX.w - 8, y2: TEMPLATE_BOX.y + 26,
          stroke: C.border
        }));
        TEMPLATE_LINES.forEach(function (line, k) {
          root.appendChild(core.svgText(TEMPLATE_BOX.x + 16, TEMPLATE_BOX.y + 46 + k * 20, line, {
            'font-size': 13, 'font-weight': 700, 'font-family': MONO, fill: C.fg,
            'xml:space': 'preserve', style: 'white-space:pre'
          }));
        });
      }

      // 호출 카드: idle(아직 안 옴, 흐리게) / active(지금 강조) / done(정착, 확정 태그).
      function callCard(root, r, call, state, idx, C) {
        var isActive = state === 'active';
        var isDone = state === 'done';
        box(root, r, C, {
          fill: isActive ? C.accentSoft : C.bg,
          stroke: isActive ? C.accent : C.borderStrong,
          strokeWidth: isActive ? 2 : 1.2
        });
        root.appendChild(core.svgText(r.x + 10, r.y + 16, '호출 ' + (idx + 1), {
          'font-size': 10, 'font-weight': 700, fill: isActive ? C.accent : C.mute
        }));
        if (isDone) {
          root.appendChild(core.svgText(r.x + r.w - 8, r.y + 16, '✓', {
            'text-anchor': 'end', 'font-size': 12, 'font-weight': 700, fill: GREEN
          }));
        }
        call.lines.forEach(function (line, k) {
          root.appendChild(core.svgText(r.x + 10, r.y + 34 + k * 14, line, {
            'font-size': 10.5, 'font-family': MONO, fill: (isActive || isDone) ? C.fg : C.mute,
            'font-weight': isActive ? 700 : 400,
            'xml:space': 'preserve', style: 'white-space:pre'
          }));
        });
        var exY = r.y + 34 + call.lines.length * 14 + 12;
        if (isDone) {
          root.appendChild(core.svgText(r.x + 10, Math.min(exY, r.y + r.h - 8), call.example, {
            'font-size': 9.5, 'font-family': MONO, fill: C.soft
          }));
        }
      }

      // 인스턴스 카드: hidden(안 그림) / stamping(방금 찍힘, 후광+강조) / done(정착).
      function instCard(root, r, inst, state, C) {
        if (state === 'hidden') return;
        var stamping = state === 'stamping';
        if (stamping) {
          // "찍히는 순간" 느낌을 주는 후광 — vtable-diagram 의 강조 화살표 후광과 같은 어휘.
          root.appendChild(core.svg('rect', {
            x: r.x - 3, y: r.y - 3, width: r.w + 6, height: r.h + 6, rx: 10,
            fill: 'none', stroke: C.accent, 'stroke-width': 8, opacity: 0.18
          }));
        }
        box(root, r, C, { stroke: stamping ? C.accent : C.borderStrong, strokeWidth: stamping ? 2 : 1.3 });
        root.appendChild(core.svgText(r.x + 10, r.y + 18, inst.sig, {
          'font-size': 11.5, 'font-weight': 700, 'font-family': MONO, fill: C.fg
        }));
        // T→타입 배지: 채워진 필 모양
        var badgeW = 12 + inst.badge.length * 6.1;
        root.appendChild(core.svg('rect', {
          x: r.x + r.w - badgeW - 8, y: r.y + 6, width: badgeW, height: 17, rx: 8.5,
          fill: C.accent
        }));
        root.appendChild(core.svgText(r.x + r.w - badgeW / 2 - 8, r.y + 18, inst.badge, {
          'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, 'font-family': MONO, fill: C.accentFg
        }));
        root.appendChild(core.svg('line', {
          x1: r.x + 8, y1: r.y + 27, x2: r.x + r.w - 8, y2: r.y + 27, stroke: C.border
        }));
        root.appendChild(core.svgText(r.x + 10, r.y + 45, inst.body, {
          'font-size': 11, 'font-family': MONO, fill: C.soft
        }));
        root.appendChild(core.svgText(r.x + 10, r.y + 63, '실행: ' + inst.example, {
          'font-size': 10, 'font-family': MONO, fill: C.mute
        }));
      }

      // 화살표: 왼쪽 위 template 아래 지점 → 각 인스턴스 카드 상단(찍혀 나오는 경로),
      // 그리고 호출 카드 오른쪽 → 인스턴스 카드 왼쪽(어떤 호출이 이 인스턴스를 만들었는지).
      function curve(root, x1, y1, x2, y2, hi, marker, color, C) {
        var mx = (x1 + x2) / 2;
        var d = 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
        if (hi) {
          root.appendChild(core.svg('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 6, opacity: 0.16 }));
        }
        root.appendChild(core.svg('path', {
          d: d, fill: 'none', stroke: color, 'stroke-width': hi ? 2.4 : 1.3,
          'marker-end': 'url(#' + marker + ')'
        }));
      }

      function bloatChart(root, C) {
        box(root, BLOAT_BOX, C, { fill: C.sunken });
        root.appendChild(core.svgText(BLOAT_BOX.x + 8, BLOAT_BOX.y + 16, '코드 크기', {
          'font-size': 10, 'font-weight': 700, fill: C.mute
        }));
        var baseY = BLOAT_BOX.y + BLOAT_BOX.h - 12;
        var barW = 22, gap = 18;
        var x1 = BLOAT_BOX.x + 20, x2 = x1 + barW + gap;
        var h1 = 14, h2 = 48; // 템플릿 소스 1 : 컴파일된 함수 3개 분량(비례가 아니라 개념적 대비)
        root.appendChild(core.svg('rect', { x: x1, y: baseY - h1, width: barW, height: h1, rx: 2, fill: C.mute }));
        root.appendChild(core.svg('rect', { x: x2, y: baseY - h2, width: barW, height: h2, rx: 2, fill: C.accent }));
        root.appendChild(core.svgText(x1 + barW / 2, baseY + 12, '소스', { 'text-anchor': 'middle', 'font-size': 8.5, fill: C.mute }));
        root.appendChild(core.svgText(x2 + barW / 2, baseY + 12, '함수 3개', { 'text-anchor': 'middle', 'font-size': 8.5, fill: C.mute }));
        root.appendChild(core.svgText(x1 + barW / 2, baseY - h1 - 4, '1', { 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: C.soft }));
        root.appendChild(core.svgText(x2 + barW / 2, baseY - h2 - 4, '3', { 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: C.accent }));
      }

      /* ----- 렌더 ----- */

      function render(idx) {
        var st = STEPS[idx];
        while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);

        var C = {
          bg: core.themeColor('--bg', '#ffffff'),
          border: core.themeColor('--border', '#d9dee8'),
          borderStrong: core.themeColor('--border-strong', '#c3cad8'),
          fg: core.themeColor('--fg', '#1c2230'),
          soft: core.themeColor('--fg-soft', '#454f63'),
          mute: core.themeColor('--fg-mute', '#7b8496'),
          accent: core.themeColor('--accent', '#2f6fed'),
          accentSoft: core.themeColor('--accent-soft', 'rgba(47,111,237,.15)'),
          accentFg: core.themeColor('--accent-fg', '#ffffff'),
          sunken: core.themeColor('--bg-sunken', '#eef1f6')
        };

        var defs = core.svg('defs');
        [['-am', C.mute], ['-ah', C.accent]].forEach(function (m) {
          defs.appendChild(core.svg('marker', {
            id: uid + m[0], viewBox: '0 0 10 10', refX: 8, refY: 5,
            markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
          }, [core.svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: m[1] })]));
        });
        svgRoot.appendChild(defs);

        var doneCount = st.i.filter(function (s) { return s !== 'hidden'; }).length;

        templateBox(svgRoot, idx, doneCount, C);
        if (st.bloat) bloatChart(svgRoot, C);

        // 호출·인스턴스 카드를 먼저 그려 화살표가 카드 위에 겹치지 않게 화살표를 그 다음에 그린다.
        for (var k = 0; k < 3; k++) {
          var cbox = { x: CALL_BOX.x, y: ROW_Y[k], w: CALL_BOX.w, h: ROW_H };
          var ibox = { x: INST_BOX.x, y: ROW_Y[k], w: INST_BOX.w, h: ROW_H };
          callCard(svgRoot, cbox, CALLS[k], st.c[k], k, C);
          instCard(svgRoot, ibox, INSTANCES[k], st.i[k], C);
        }

        for (k = 0; k < 3; k++) {
          if (st.i[k] === 'hidden') continue;
          var hi = st.i[k] === 'stamping';
          var color = hi ? C.accent : C.mute;
          var marker = uid + (hi ? '-ah' : '-am');
          var cbox2 = { x: CALL_BOX.x, y: ROW_Y[k], w: CALL_BOX.w, h: ROW_H };
          var ibox2 = { x: INST_BOX.x, y: ROW_Y[k], w: INST_BOX.w, h: ROW_H };
          // 템플릿 → 인스턴스 ("찍어내기" 경로)
          curve(svgRoot,
            TEMPLATE_BOX.x + TEMPLATE_BOX.w * 0.42, TEMPLATE_BOX.y + TEMPLATE_BOX.h,
            ibox2.x + 46, ibox2.y, hi, marker, color, C);
          // 호출 → 인스턴스 (이 호출이 이 함수를 만들었다는 대응)
          curve(svgRoot,
            cbox2.x + cbox2.w, cbox2.y + cbox2.h / 2,
            ibox2.x, ibox2.y + ibox2.h / 2, hi, marker, color, C);
        }

        root_footer(svgRoot, C);

        f.setCaption(st.cap);
      }

      function root_footer(root, C) {
        root.appendChild(core.svgText(W / 2, FOOT_Y, '템플릿은 컴파일 타임에만 존재한다 — 실행 파일에 남는 것은 찍혀 나온 개별 함수들뿐이다.', {
          'text-anchor': 'middle', 'font-size': 10, fill: C.mute, 'font-style': 'italic'
        }));
      }

      core.player(mountEl, { total: STEPS.length, render: render, autoMs: 1900 });
    }
  };
})(this);
