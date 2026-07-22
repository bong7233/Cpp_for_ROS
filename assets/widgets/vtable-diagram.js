/* vtable-diagram.js — 클래스 계층·객체 메모리·vtable을 잇는 동적 바인딩 위젯
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget vtable-diagram
 *   {}
 *   :::
 *   (파라미터 없이도 동작 — 시나리오가 하나뿐이라 스텝 플레이어만 있으면 된다)
 *
 * 왜 시나리오가 하나뿐인가: 이 위젯의 목적은 "가상함수 호출이 정적 타입이 아니라
 * vptr을 따라간다"는 단일 메커니즘을 보여주는 것이다. 그 메커니즘은 클래스가
 * 몇 개든 동일하므로, Derived 하나로 메커니즘을 보여주고 Derived2로 같은 메커니즘이
 * 다른 결과를 낳는 것을 대비시키는 스텝 시퀀스 하나면 충분하다 — 시나리오 분기는
 * 오히려 "vtable은 한 가지 방식으로만 작동한다"는 요점을 흐린다.
 *
 * 왜 스텝마다 상태를 전부 다시 그리는가: widget-core의 계약과 동일 — render(i)가
 * i만 보고 그릴 수 있어야 슬라이더 임의 접근·되감기가 공짜로 따라온다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  var W = 900, H = 420;
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var DANGER = '#d93838';
  var GREEN = '#2fae6e';

  /* ---------- 레이아웃 상수 ---------- */

  var TOP_Y = 8, TOP_H = 292;
  var HCOL = { x: 10, w: 220, label: '클래스 계층' };
  var OCOL = { x: 244, w: 300, label: '객체 메모리' };
  var VCOL = { x: 558, w: 332, label: 'vtable' };

  // 각 열 y 시작점을 컨테이너 라벨(TOP_Y+16 부근) 아래로 여유 있게 내려서
  // 라벨 글자가 박스 위로 삐져나오지 않게 한다.
  var BASE = { x: HCOL.x, y: TOP_Y + 20, w: HCOL.w, h: 66 };
  var DER1 = { x: HCOL.x, y: BASE.y + BASE.h + 40, w: 102, h: 70 };
  var DER2 = { x: HCOL.x + 118, y: DER1.y, w: 102, h: 70 };

  // p 박스도 열 폭 전체를 채워 라벨을 완전히 가린다 (Base 박스와 같은 원리).
  var PBOX1 = { x: OCOL.x, y: TOP_Y + 20, w: OCOL.w, h: 30 };
  var OBJ1  = { x: OCOL.x, y: PBOX1.y + PBOX1.h + 8, w: OCOL.w, h: 92 };
  var PBOX2 = { x: OCOL.x, y: OBJ1.y + OBJ1.h + 10, w: OCOL.w, h: 30 };
  var OBJ2  = { x: OCOL.x, y: PBOX2.y + PBOX2.h + 8, w: OCOL.w, h: 92 };
  var OBJ_TITLE_H = 20, OBJ_VPTR_H = 36; // 나머지는 데이터 멤버 행

  var VT1 = { x: VCOL.x, y: TOP_Y + 24, w: VCOL.w, h: 58 };
  var FN1 = { x: VCOL.x, y: VT1.y + VT1.h + 12, w: VCOL.w, h: 34 };
  var VT2 = { x: VCOL.x, y: FN1.y + FN1.h + 30, w: VCOL.w, h: 58 };
  var FN2 = { x: VCOL.x, y: VT2.y + VT2.h + 12, w: VCOL.w, h: 34 };

  var CODE_Y = TOP_Y + TOP_H + 8;
  var CODE_H = H - CODE_Y - 8;

  var CODE_LINES = [
    'Derived d;',
    'Base* p = &d;',
    'p->speak();',
    'Derived2 d2;',
    'Base* p2 = &d2;',
    'p2->speak();',
    'delete p;   // ~Base() 비가상 → ~Derived() 스킵'
  ];

  /* ---------- 스텝 시퀀스 ----------
   * a1/a2/a3: p→obj1→vtableD1→fnD1 경로의 하이라이트(호출 1~3단계에서만 잠깐 켠다).
   * b1/b2/b3: p2→obj2→vtableD2→fnD2 경로. 결과가 확정된 뒤에는 글로우를 끄고
   * tag(체크마크)만 남긴다 — 매 스텝 전부 켜 두면 "지금 뭘 보라는 건지"가 흐려진다.
   */
  var STEPS = [
    { code: -1, obj1: false, p1: false, vt1: false, der2: false, obj2: false, p2: false, vt2: false,
      a1: false, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: null, tag2: null, destructorWarn: false,
      cap: 'Base 는 <code>virtual void speak()</code> 를 선언하고, Derived 는 이를 <code>override</code> 한다. ' +
           '이 시점엔 객체도 vtable 화살표도 아직 없다 — vtable 연결은 <b>객체가 생성되는 순간</b>부터 의미를 갖는다.' },

    { code: 0, obj1: true, p1: false, vt1: true, der2: false, obj2: false, p2: false, vt2: false,
      a1: false, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: null, tag2: null, destructorWarn: false,
      cap: '<code>Derived d;</code> — 객체 맨 앞에 컴파일러가 심어 둔 숨은 필드 <b>vptr</b>이 생긴다. ' +
           'vptr은 Derived용 vtable을 가리키고, 그 vtable의 speak() 슬롯에는 <code>Derived::speak</code>의 실제 주소가 적혀 있다.' },

    { code: 1, obj1: true, p1: true, vt1: true, der2: false, obj2: false, p2: false, vt2: false,
      a1: false, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: null, tag2: null, destructorWarn: false,
      cap: '<code>Base* p = &d;</code> — p의 <b>선언(정적) 타입</b>은 <code>Base*</code>지만, ' +
           '<b>실제로 가리키는(동적) 타입</b>은 <code>Derived</code>다. 이 둘의 차이가 다음 스텝의 핵심이다.' },

    { code: 2, obj1: true, p1: true, vt1: true, der2: false, obj2: false, p2: false, vt2: false,
      a1: true, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: null, tag2: null, destructorWarn: false,
      cap: '<code>p->speak()</code> 1단계 — 컴파일러는 p의 <b>선언 타입(Base*)만으로 호출할 함수를 정하지 않는다.</b> ' +
           '먼저 p가 실제로 가리키는 객체를 따라간다.' },

    { code: 2, obj1: true, p1: true, vt1: true, der2: false, obj2: false, p2: false, vt2: false,
      a1: true, a2: true, a3: false, b1: false, b2: false, b3: false, tag1: null, tag2: null, destructorWarn: false,
      cap: '2단계 — 객체 맨 앞의 <b>vptr</b>을 읽는다. 이 객체는 Derived로 생성됐으므로 vptr은 Derived의 vtable을 가리킨다.' },

    { code: 2, obj1: true, p1: true, vt1: true, der2: false, obj2: false, p2: false, vt2: false,
      a1: true, a2: true, a3: true, b1: false, b2: false, b3: false, tag1: null, tag2: null, destructorWarn: false,
      cap: '3단계 — vtable의 speak() 슬롯에 적힌 함수 주소로 점프한다. <b>슬롯의 내용이 실제로 실행될 코드를 결정한다.</b>' },

    { code: 2, obj1: true, p1: true, vt1: true, der2: false, obj2: false, p2: false, vt2: false,
      a1: false, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: '✓ Derived::speak() 호출됨', tag2: null, destructorWarn: false,
      cap: '결과: <b>Base* 였지만 Derived::speak()가 호출됐다.</b> 정적 타입이 아니라 vptr이 가리키는 동적 타입을 따라간 것 — ' +
           '이것이 동적 바인딩(dynamic dispatch)이다.' },

    { code: [3, 4], obj1: true, p1: true, vt1: true, der2: true, obj2: true, p2: true, vt2: true,
      a1: false, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: '✓ Derived::speak() 호출됨', tag2: null, destructorWarn: false,
      cap: '대비를 위해 <code>Derived2</code>를 추가한다. <code>Derived2 d2; Base* p2 = &d2;</code> — 똑같은 <code>Base*</code>지만, ' +
           '이번 객체의 vptr은 <b>Derived2용 vtable</b>을 가리킨다.' },

    { code: 5, obj1: true, p1: true, vt1: true, der2: true, obj2: true, p2: true, vt2: true,
      a1: false, a2: false, a3: false, b1: true, b2: true, b3: true, tag1: '✓ Derived::speak() 호출됨', tag2: '✓ Derived2::speak() 호출됨', destructorWarn: false,
      cap: '<code>p2->speak()</code> — 호출 코드는 <code>p->speak()</code>와 똑같이 생겼지만, vptr이 다른 vtable을 가리켜서 ' +
           '<b>Derived2::speak()</b>가 호출된다. 실행될 함수를 정하는 건 호출 코드가 아니라 <b>객체의 vptr</b>이다.' },

    { code: 6, obj1: true, p1: true, vt1: true, der2: true, obj2: true, p2: true, vt2: true,
      a1: false, a2: false, a3: false, b1: false, b2: false, b3: false, tag1: '✓ Derived::speak() 호출됨', tag2: '✓ Derived2::speak() 호출됨', destructorWarn: true,
      cap: '<code>delete p;</code> — <code>~Base()</code>가 <code>virtual</code>이 아니면 delete는 정적 타입(Base)의 소멸자만 호출하고 ' +
           '<code>~Derived()</code>는 건너뛴다. (자원 누수 자체는 다른 위젯에서 다뤘다 — 여기서는 다형성이 소멸자에도 똑같이 적용된다는 접점만 확인한다.)' }
  ];

  /* ---------- 마운트 ---------- */

  WIDGETS['vtable-diagram'] = {
    mount: function (mountEl, params) {
      params = params || {};
      var uid = 'vt' + Math.random().toString(36).slice(2, 8);

      var f = core.frame(mountEl, {
        icon: '🧭',
        title: params.title || 'vtable과 동적 바인딩 — 가상함수는 실제로 어떤 함수를 부르는가'
      });

      var stage = core.el('div', 'widget-stage');
      var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
      stage.appendChild(svgRoot);
      f.body.appendChild(stage);

      function isHi(k, code) {
        if (code < 0 || code === undefined) return false;
        if (Array.isArray(code)) return code.indexOf(k) >= 0;
        return code === k;
      }

      /* ----- 자잘한 그리기 헬퍼 ----- */

      function container(root, rect, C) {
        root.appendChild(core.svg('rect', {
          x: rect.x, y: TOP_Y, width: rect.w, height: TOP_H, rx: 8,
          fill: 'none', stroke: C.border, 'stroke-dasharray': '3 4'
        }));
        root.appendChild(core.svgText(rect.x + rect.w / 2, TOP_Y + 16, rect.label, {
          'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: C.mute
        }));
      }

      // 클래스 박스: 제목 + 가상함수 목록. 좁은 파생 클래스 박스는 폰트를 살짝 줄인다.
      function classBox(root, box, title, methods, C, opt) {
        opt = opt || {};
        root.appendChild(core.svg('rect', {
          x: box.x, y: box.y, width: box.w, height: box.h, rx: 6,
          fill: C.bg, stroke: opt.stroke || C.borderStrong, 'stroke-width': opt.strokeWidth || 1.3
        }));
        root.appendChild(core.svgText(box.x + box.w / 2, box.y + 17, title, {
          'text-anchor': 'middle', 'font-size': opt.titleSize || 12.5, 'font-weight': 700,
          'font-family': MONO, fill: C.fg
        }));
        root.appendChild(core.svg('line', {
          x1: box.x + 5, y1: box.y + 24, x2: box.x + box.w - 5, y2: box.y + 24, stroke: C.border
        }));
        methods.forEach(function (m, i) {
          var isWarn = m.indexOf('아님') >= 0;
          var isVirtual = m.indexOf('virtual') >= 0 || m.indexOf('override') >= 0;
          root.appendChild(core.svgText(box.x + 8, box.y + 40 + i * 15, m, {
            'font-size': opt.methodSize || 10.5, 'font-family': MONO, 'font-weight': isWarn ? 700 : 400,
            fill: isWarn ? DANGER : (isVirtual ? C.accent : C.soft)
          }));
        });
      }

      // 포인터/vptr 화살표: 완만한 곡선 + 강조 시 후광(halo)을 밑에 한 번 더 깔아 눈에 띄게 한다.
      function flowArrow(root, x1, y1, x2, y2, hi, uid2, C) {
        var mx = (x1 + x2) / 2;
        var d = 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
        var color = hi ? C.accent : C.mute;
        if (hi) {
          root.appendChild(core.svg('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 7, opacity: 0.16 }));
        }
        root.appendChild(core.svg('path', {
          d: d, fill: 'none', stroke: color, 'stroke-width': hi ? 2.6 : 1.5,
          'marker-end': 'url(#' + uid2 + (hi ? '-ah' : '-am') + ')'
        }));
      }

      function ptrBox(root, box, label, statType, dynType, C) {
        root.appendChild(core.svg('rect', {
          x: box.x, y: box.y, width: box.w, height: box.h, rx: 6,
          fill: C.bg, stroke: C.borderStrong, 'stroke-width': 1.3
        }));
        root.appendChild(core.svgText(box.x + 8, box.y + 20, label + ' : ' + statType, {
          'font-size': 12, 'font-family': MONO, 'font-weight': 700, fill: C.fg
        }));
        root.appendChild(core.svgText(box.x + box.w - 8, box.y + 20, '동적: ' + dynType, {
          'text-anchor': 'end', 'font-size': 10.5, 'font-family': MONO, fill: C.accent
        }));
      }

      function objectBox(root, box, title, dataLabel, C, hlVptr) {
        root.appendChild(core.svg('rect', {
          x: box.x, y: box.y, width: box.w, height: box.h, rx: 7,
          fill: C.bg, stroke: C.borderStrong, 'stroke-width': 1.3
        }));
        root.appendChild(core.svgText(box.x + box.w / 2, box.y + 15, title, {
          'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: C.fg
        }));
        root.appendChild(core.svg('line', {
          x1: box.x, y1: box.y + OBJ_TITLE_H, x2: box.x + box.w, y2: box.y + OBJ_TITLE_H, stroke: C.border
        }));
        // vptr 행 — 강조 시 은은한 배경 tint로 "지금 여기를 본다"를 표시
        var vy = box.y + OBJ_TITLE_H;
        root.appendChild(core.svg('rect', {
          x: box.x + 1, y: vy + 1, width: box.w - 2, height: OBJ_VPTR_H - 2,
          fill: hlVptr ? C.accentSoft : 'none'
        }));
        root.appendChild(core.svgText(box.x + 14, vy + OBJ_VPTR_H / 2 + 4, 'vptr', {
          'font-size': 12, 'font-family': MONO, 'font-weight': 700, fill: C.accent
        }));
        root.appendChild(core.svgText(box.x + box.w - 14, vy + OBJ_VPTR_H / 2 + 4, '(숨은 필드)', {
          'text-anchor': 'end', 'font-size': 10.5, fill: C.mute
        }));
        root.appendChild(core.svg('line', {
          x1: box.x, y1: vy + OBJ_VPTR_H, x2: box.x + box.w, y2: vy + OBJ_VPTR_H, stroke: C.border, 'stroke-dasharray': '2 3'
        }));
        // 데이터 멤버 행
        root.appendChild(core.svgText(box.x + 14, vy + OBJ_VPTR_H + 24, dataLabel, {
          'font-size': 11.5, 'font-family': MONO, fill: C.soft
        }));
      }

      function vtableBox(root, box, title, slotText, C, hlSlot) {
        root.appendChild(core.svg('rect', {
          x: box.x, y: box.y, width: box.w, height: box.h, rx: 7,
          fill: C.bg, stroke: C.borderStrong, 'stroke-width': 1.3
        }));
        root.appendChild(core.svgText(box.x + 10, box.y + 17, title, {
          'font-size': 11.5, 'font-weight': 700, fill: C.mute
        }));
        root.appendChild(core.svg('line', {
          x1: box.x + 5, y1: box.y + 24, x2: box.x + box.w - 5, y2: box.y + 24, stroke: C.border
        }));
        root.appendChild(core.svg('rect', {
          x: box.x + 1, y: box.y + 25, width: box.w - 2, height: box.h - 26,
          fill: hlSlot ? C.accentSoft : 'none'
        }));
        root.appendChild(core.svgText(box.x + 14, box.y + 46, slotText, {
          'font-size': 12, 'font-family': MONO, 'font-weight': 700, fill: C.fg
        }));
      }

      function fnBox(root, box, text, C, hi) {
        root.appendChild(core.svg('rect', {
          x: box.x, y: box.y, width: box.w, height: box.h, rx: 6,
          fill: C.sunken, stroke: hi ? C.accent : C.border, 'stroke-width': hi ? 1.8 : 1
        }));
        root.appendChild(core.svgText(box.x + box.w / 2, box.y + box.h / 2 + 4, text, {
          'text-anchor': 'middle', 'font-size': 11.5, 'font-family': MONO, fill: C.soft
        }));
      }

      /* ----- 렌더 ----- */

      function render(i) {
        var st = STEPS[i];
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
          sunken: core.themeColor('--bg-sunken', '#eef1f6')
        };

        // 마커는 색이 테마에 종속되므로 렌더마다 새로 정의한다.
        var defs = core.svg('defs');
        [['-am', C.mute], ['-ah', C.accent]].forEach(function (m) {
          defs.appendChild(core.svg('marker', {
            id: uid + m[0], viewBox: '0 0 10 10', refX: 8, refY: 5,
            markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
          }, [core.svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: m[1] })]));
        });
        defs.appendChild(core.svg('marker', {
          id: uid + '-tri', viewBox: '0 0 12 12', refX: 10, refY: 6,
          markerWidth: 9, markerHeight: 9, orient: 'auto-start-reverse'
        }, [core.svg('path', { d: 'M0,0 L12,6 L0,12 z', fill: C.bg, stroke: C.borderStrong, 'stroke-width': 1 })]));
        svgRoot.appendChild(defs);
        // 상속 화살표 stroke 는 marker 밖에서 지정해야 하므로 currentColor 트릭 대신 직접 색을 넣는다
        var inheritStroke = C.borderStrong;

        // 1) 배경 컨테이너 3열
        container(svgRoot, HCOL, C);
        container(svgRoot, OCOL, C);
        container(svgRoot, VCOL, C);

        // 2) 클래스 계층
        classBox(svgRoot, BASE, 'Base', ['virtual void speak();'].concat(
          st.destructorWarn ? ['virtual ~Base();  ← 아님!'] : []
        ), C, { titleSize: 13 });
        if (st.destructorWarn) {
          svgRoot.appendChild(core.svgText(BASE.x + BASE.w - 8, BASE.y + 55, '⚠ 비가상 소멸자', {
            'text-anchor': 'end', 'font-size': 10, 'font-weight': 700, fill: DANGER
          }));
        }
        classBox(svgRoot, DER1, 'Derived', ['speak() override'], C, { titleSize: 11.5, methodSize: 9.5 });
        svgRoot.appendChild(core.svg('path', {
          d: 'M' + (DER1.x + DER1.w / 2) + ',' + DER1.y + ' L' + (BASE.x + BASE.w * 0.3) + ',' + (BASE.y + BASE.h),
          fill: 'none', stroke: inheritStroke, 'stroke-width': 1.6, 'marker-end': 'url(#' + uid + '-tri)'
        }));

        if (st.der2) {
          classBox(svgRoot, DER2, 'Derived2', ['speak() override'], C, { titleSize: 11.5, methodSize: 9.5 });
          svgRoot.appendChild(core.svg('path', {
            d: 'M' + (DER2.x + DER2.w / 2) + ',' + DER2.y + ' L' + (BASE.x + BASE.w * 0.7) + ',' + (BASE.y + BASE.h),
            fill: 'none', stroke: inheritStroke, 'stroke-width': 1.6, 'marker-end': 'url(#' + uid + '-tri)'
          }));
          if (st.destructorWarn) {
            svgRoot.appendChild(core.svgText(DER1.x + DER1.w / 2, DER1.y + DER1.h + 14, '✕ ~Derived() 스킵', {
              'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: DANGER
            }));
          }
        } else if (st.destructorWarn) {
          svgRoot.appendChild(core.svgText(DER1.x + DER1.w / 2, DER1.y + DER1.h + 14, '✕ ~Derived() 스킵', {
            'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: DANGER
          }));
        }

        // 3) 객체 / 포인터 / vtable / 함수 — 첫 번째 체인 (Base* p → Derived 객체)
        if (st.p1) ptrBox(svgRoot, PBOX1, 'p', 'Base*', 'Derived', C);
        if (st.obj1) objectBox(svgRoot, OBJ1, 'Derived 객체 (obj)', 'id : int = 1', C, st.a2);
        if (st.vt1) vtableBox(svgRoot, VT1, 'Derived 의 vtable', '[0] speak() → Derived::speak', C, st.a3);
        if (st.vt1) fnBox(svgRoot, FN1, 'Derived::speak() { … }', C, st.a3);

        if (st.p1 && st.obj1) {
          flowArrow(svgRoot, PBOX1.x + PBOX1.w / 2, PBOX1.y + PBOX1.h, OBJ1.x + 26, OBJ1.y, st.a1, uid, C);
        }
        if (st.obj1 && st.vt1) {
          var vy1 = OBJ1.y + OBJ_TITLE_H + OBJ_VPTR_H / 2;
          flowArrow(svgRoot, OBJ1.x + OBJ1.w, vy1, VT1.x, VT1.y + VT1.h * 0.68, st.a2, uid, C);
        }
        if (st.vt1) {
          flowArrow(svgRoot, VT1.x + VT1.w / 2, VT1.y + VT1.h, FN1.x + FN1.w / 2, FN1.y, st.a3, uid, C);
        }
        if (st.tag1) {
          svgRoot.appendChild(core.svgText(FN1.x + FN1.w - 8, FN1.y + FN1.h + 16, st.tag1, {
            'text-anchor': 'end', 'font-size': 11.5, 'font-weight': 700, fill: GREEN
          }));
        }

        // 4) 두 번째 체인 (Base* p2 → Derived2 객체) — 대비용
        if (st.p2) ptrBox(svgRoot, PBOX2, 'p2', 'Base*', 'Derived2', C);
        if (st.obj2) objectBox(svgRoot, OBJ2, 'Derived2 객체 (obj2)', 'id : int = 2', C, st.b2);
        if (st.vt2) vtableBox(svgRoot, VT2, 'Derived2 의 vtable', '[0] speak() → Derived2::speak', C, st.b3);
        if (st.vt2) fnBox(svgRoot, FN2, 'Derived2::speak() { … }', C, st.b3);

        if (st.p2 && st.obj2) {
          flowArrow(svgRoot, PBOX2.x + PBOX2.w / 2, PBOX2.y + PBOX2.h, OBJ2.x + 26, OBJ2.y, st.b1, uid, C);
        }
        if (st.obj2 && st.vt2) {
          var vy2 = OBJ2.y + OBJ_TITLE_H + OBJ_VPTR_H / 2;
          flowArrow(svgRoot, OBJ2.x + OBJ2.w, vy2, VT2.x, VT2.y + VT2.h * 0.68, st.b2, uid, C);
        }
        if (st.vt2) {
          flowArrow(svgRoot, VT2.x + VT2.w / 2, VT2.y + VT2.h, FN2.x + FN2.w / 2, FN2.y, st.b3, uid, C);
        }
        if (st.tag2) {
          svgRoot.appendChild(core.svgText(FN2.x + FN2.w - 8, FN2.y + FN2.h + 16, st.tag2, {
            'text-anchor': 'end', 'font-size': 11.5, 'font-weight': 700, fill: GREEN
          }));
        }

        // 5) 코드 패널 (하단, 전체 폭) — 7줄이 한 줄로는 안 들어가서 2단으로 접는다
        svgRoot.appendChild(core.svg('rect', {
          x: 10, y: CODE_Y, width: W - 20, height: CODE_H, rx: 8, fill: C.sunken, stroke: C.border
        }));
        svgRoot.appendChild(core.svgText(22, CODE_Y + 16, '호출 코드', {
          'font-size': 10.5, 'font-weight': 700, fill: C.mute
        }));
        var lh = 16, top = CODE_Y + 34;
        var COLS = [{ x: 24, w: W / 2 - 24 }, { x: W / 2 + 8, w: W / 2 - 40 }];
        var ROWS_PER_COL = 4; // 7줄 → 왼쪽 4줄 + 오른쪽 3줄
        CODE_LINES.forEach(function (line, k) {
          var hi = isHi(k, st.code);
          var col = COLS[k < ROWS_PER_COL ? 0 : 1];
          var row = k < ROWS_PER_COL ? k : k - ROWS_PER_COL;
          var y = top + row * lh;
          if (hi) {
            svgRoot.appendChild(core.svg('rect', {
              x: col.x - 6, y: y - 12, width: col.w - 4, height: 16, rx: 3,
              fill: C.accentSoft
            }));
            svgRoot.appendChild(core.svgText(col.x - 2, y, '▶', { 'font-size': 9, fill: C.accent }));
          }
          svgRoot.appendChild(core.svgText(col.x + 14, y, line, {
            'font-size': 11.5, 'font-family': MONO,
            fill: hi ? C.fg : C.soft, 'font-weight': hi ? 700 : 400,
            'xml:space': 'preserve', style: 'white-space:pre'
          }));
        });

        f.setCaption(st.cap);
      }

      core.player(mountEl, { total: STEPS.length, render: render, autoMs: 1900 });
    }
  };
})(this);
