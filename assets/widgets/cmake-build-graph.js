/* cmake-build-graph.js — 소스 → 오브젝트 → 링크로 이어지는 CMake 타겟 의존 그래프
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget cmake-build-graph
 *   {}
 *   :::
 *   (파라미터 없이도 동작 — 시나리오가 하나뿐이라 스텝 플레이어만 있으면 된다)
 *
 * 왜 시나리오가 하나뿐인가: 이 위젯의 목적은 "CMake의 빌드 단위는 파일이 아니라
 * 타겟이다"라는 단일 개념을 보여주는 것이다. 정적 라이브러리 타겟 하나(ik_solver)와
 * 그걸 링크하는 실행파일 타겟 하나(hex_control)만으로 컴파일→아카이브→링크라는
 * 세 종류의 빌드 단계와 target_link_libraries가 만드는 타겟 간 의존성을 전부
 * 보여줄 수 있다 — 타겟을 더 늘려도 같은 메커니즘이 반복될 뿐이라 오히려 요점을 흐린다.
 *
 * 왜 스텝마다 상태를 전부 다시 그리는가: widget-core의 계약과 동일 — render(i)가
 * i만 보고 그릴 수 있어야 슬라이더 임의 접근·되감기가 공짜로 따라온다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  var W = 940, H = 480;
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var GREEN = '#2fae6e';

  /* ---------- 레이아웃 상수 ---------- */

  var BOX_TOP = 16, BOX_H = 300;
  var LIBBOX = { x: 16, y: BOX_TOP, w: 280, h: BOX_H, label: '타겟: ik_solver (STATIC 라이브러리)' };
  var EXEBOX = { x: 312, y: BOX_TOP, w: 612, h: BOX_H, label: '타겟: hex_control (EXECUTABLE)' };

  var SRC2 = { x: 36, y: BOX_TOP + 36, w: 240, h: 40, text: 'ik_solver.cpp' };
  var OBJ2 = { x: 36, y: BOX_TOP + 130, w: 240, h: 40, text: 'ik_solver.cpp.o' };
  var LIB  = { x: 36, y: BOX_TOP + 224, w: 240, h: 54, text: 'libik_solver.a' };

  var SRC1 = { x: 332, y: BOX_TOP + 36, w: 270, h: 40, text: 'main.cpp' };
  var SRC3 = { x: 622, y: BOX_TOP + 36, w: 280, h: 40, text: 'sensor_driver.cpp' };
  var OBJ1 = { x: 332, y: BOX_TOP + 130, w: 270, h: 40, text: 'main.cpp.o' };
  var OBJ3 = { x: 622, y: BOX_TOP + 130, w: 280, h: 40, text: 'sensor_driver.cpp.o' };
  var EXE  = { x: 332, y: BOX_TOP + 224, w: 570, h: 54, text: 'hex_control' };

  var CODE_Y = BOX_TOP + BOX_H + 16;
  var CODE_H = H - CODE_Y - 8;

  var CODE_LINES = [
    'add_library(ik_solver STATIC ik_solver.cpp)',
    'add_executable(hex_control main.cpp sensor_driver.cpp)',
    'target_link_libraries(hex_control PRIVATE ik_solver)'
  ];

  /* ---------- 스텝 시퀀스 ---------- */

  var STEPS = [
    { code: -1, src2: false, obj2: false, lib: false, src13: false, obj13: false, exe: false,
      arrow: {}, tag: null,
      cap: '소스 파일 3개(<code>main.cpp</code>, <code>ik_solver.cpp</code>, <code>sensor_driver.cpp</code>)가 있다. ' +
           'CMake는 이걸 파일 하나하나가 아니라 <b>타겟</b> 단위로 묶어 관리한다 — 이 예제는 타겟이 정확히 2개(라이브러리 하나, 실행파일 하나)다.' },

    { code: 0, src2: true, obj2: false, lib: false, src13: false, obj13: false, exe: false,
      arrow: {}, tag: null,
      cap: '<code>add_library(ik_solver STATIC ik_solver.cpp)</code> — 이 한 줄이 <code>ik_solver</code>라는 이름의 새 타겟을 선언하고, ' +
           '그 타겟이 <code>ik_solver.cpp</code> 하나로 만들어진다는 것을 CMake에 알려준다.' },

    { code: 0, src2: true, obj2: true, lib: false, src13: false, obj13: false, exe: false,
      arrow: { s2o2: true }, tag: null,
      cap: 'CMake가 생성한 빌드 스크립트가 실제로 <code>g++ -c ik_solver.cpp -o ik_solver.cpp.o</code>를 실행한다 — ' +
           '컴파일러 플래그와 호출 순서는 사람이 아니라 CMake가 계산한다.' },

    { code: 0, src2: true, obj2: true, lib: true, src13: false, obj13: false, exe: false,
      arrow: { s2o2: true, o2lib: true }, tag: null,
      cap: '오브젝트 파일을 아카이버(<code>ar rcs libik_solver.a ik_solver.cpp.o</code>)로 묶어 정적 라이브러리를 만든다. ' +
           '이 <code>.a</code> 파일 자체가 <code>ik_solver</code> 타겟의 결과물이다.' },

    { code: 1, src2: true, obj2: true, lib: true, src13: true, obj13: false, exe: false,
      arrow: { s2o2: true, o2lib: true }, tag: null,
      cap: '<code>add_executable(hex_control main.cpp sensor_driver.cpp)</code> — 두 번째 타겟 <code>hex_control</code>을 선언한다. ' +
           '이 타겟은 아직 <code>ik_solver</code>에 대해 아무것도 모른다.' },

    { code: 1, src2: true, obj2: true, lib: true, src13: true, obj13: true, exe: false,
      arrow: { s2o2: true, o2lib: true, s1o1: true, s3o3: true }, tag: null,
      cap: '<code>main.cpp</code>와 <code>sensor_driver.cpp</code>가 각각 오브젝트 파일로 컴파일된다 — ' +
           '두 타겟의 컴파일 단계는 서로 독립적이라 순서와 무관하게(병렬로도) 진행될 수 있다.' },

    { code: 2, src2: true, obj2: true, lib: true, src13: true, obj13: true, exe: false,
      arrow: { s2o2: true, o2lib: true, s1o1: true, s3o3: true, lib2exe: true }, tag: null,
      cap: '<code>target_link_libraries(hex_control PRIVATE ik_solver)</code> — <code>hex_control</code> 타겟이 ' +
           '<code>ik_solver</code> 타겟에 링크 의존성을 갖는다고 선언한다. <code>PRIVATE</code>는 이 의존성이 ' +
           '<code>hex_control</code>을 다시 쓰는 다른 타겟에는 전파되지 않는다는 뜻이다.' },

    { code: 2, src2: true, obj2: true, lib: true, src13: true, obj13: true, exe: true,
      arrow: { s2o2: true, o2lib: true, s1o1: true, s3o3: true, lib2exe: true, o1exe: true, o3exe: true },
      tag: '✓ hex_control 빌드 완료',
      cap: '링커(<code>ld</code>)가 <code>main.cpp.o</code>, <code>sensor_driver.cpp.o</code>, <code>libik_solver.a</code> ' +
           '셋을 하나로 합쳐 최종 실행파일 <code>hex_control</code>을 만든다 — <code>target_link_libraries</code> 한 줄이 ' +
           '이 링크 순서와 플래그를 전부 대신 계산해 준 결과다.' },

    { code: -1, src2: true, obj2: true, lib: true, src13: true, obj13: true, exe: true,
      arrow: { s2o2: true, o2lib: true, s1o1: true, s3o3: true, lib2exe: true, o1exe: true, o3exe: true },
      tag: '✓ hex_control 빌드 완료',
      cap: '전체 그래프: 소스 3개 → 오브젝트 3개 → (아카이브 1개 + 링크 1개) → 타겟 2개. ' +
           '<b>CMakeLists.txt 세 줄이 이 그래프 전체를 선언한다</b> — 파일이 아니라 타겟이 빌드의 단위라는 것이 이 위젯의 요점이다.' }
  ];

  /* ---------- 마운트 ---------- */

  WIDGETS['cmake-build-graph'] = {
    mount: function (mountEl, params) {
      params = params || {};
      var uid = 'cbg' + Math.random().toString(36).slice(2, 8);

      var f = core.frame(mountEl, {
        icon: '🏗️',
        title: params.title || 'CMake 빌드 그래프 — 소스에서 실행파일까지, 타겟은 어떻게 이어지는가'
      });

      var stage = core.el('div', 'widget-stage');
      var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
      stage.appendChild(svgRoot);
      f.body.appendChild(stage);

      function isHi(k, code) {
        if (code === undefined || code < 0) return false;
        if (Array.isArray(code)) return code.indexOf(k) >= 0;
        return code === k;
      }

      /* ----- 그리기 헬퍼 ----- */

      function container(root, rect, C) {
        root.appendChild(core.svg('rect', {
          x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: 8,
          fill: 'none', stroke: C.border, 'stroke-dasharray': '3 4'
        }));
        root.appendChild(core.svgText(rect.x + rect.w / 2, rect.y + 20, rect.label, {
          'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 700, fill: C.mute
        }));
      }

      function fileBox(root, box, kind, C, active) {
        var palette = {
          src: { fill: C.bg, stroke: C.borderStrong, fg: C.fg },
          obj: { fill: C.sunken, stroke: C.borderStrong, fg: C.soft },
          out: { fill: C.accentSoft, stroke: C.accent, fg: C.fg }
        }[kind];
        root.appendChild(core.svg('rect', {
          x: box.x, y: box.y, width: box.w, height: box.h, rx: 7,
          fill: active ? palette.fill : 'none',
          stroke: active ? palette.stroke : C.border,
          'stroke-width': active ? 1.4 : 1,
          'stroke-dasharray': active ? null : '3 3'
        }));
        if (active) {
          root.appendChild(core.svgText(box.x + box.w / 2, box.y + box.h / 2 + 4, box.text, {
            'text-anchor': 'middle', 'font-size': 12, 'font-family': MONO,
            'font-weight': kind === 'out' ? 700 : 400, fill: palette.fg
          }));
        }
      }

      function flowArrow(root, x1, y1, x2, y2, label, hi, uid2, C) {
        var mx1 = x1, my1 = (y1 + y2) / 2, mx2 = x2, my2 = my1;
        var d = 'M' + x1 + ',' + y1 + ' C' + mx1 + ',' + my1 + ' ' + mx2 + ',' + my2 + ' ' + x2 + ',' + y2;
        var color = hi ? C.accent : C.mute;
        if (hi) {
          root.appendChild(core.svg('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 6, opacity: 0.15 }));
        }
        root.appendChild(core.svg('path', {
          d: d, fill: 'none', stroke: color, 'stroke-width': hi ? 2.4 : 1.3,
          'marker-end': 'url(#' + uid2 + (hi ? '-ah' : '-am') + ')'
        }));
        if (label && hi) {
          root.appendChild(core.svgText((x1 + x2) / 2, (y1 + y2) / 2 - 4, label, {
            'text-anchor': 'middle', 'font-size': 9.5, 'font-family': MONO, 'font-weight': 700, fill: color
          }));
        }
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

        var defs = core.svg('defs');
        [['-am', C.mute], ['-ah', C.accent]].forEach(function (m) {
          defs.appendChild(core.svg('marker', {
            id: uid + m[0], viewBox: '0 0 10 10', refX: 8, refY: 5,
            markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
          }, [core.svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: m[1] })]));
        });
        svgRoot.appendChild(defs);

        // 1) 타겟 컨테이너 2개
        container(svgRoot, LIBBOX, C);
        container(svgRoot, EXEBOX, C);

        // 2) ik_solver 타겟 내부
        fileBox(svgRoot, SRC2, 'src', C, st.src2);
        fileBox(svgRoot, OBJ2, 'obj', C, st.obj2);
        fileBox(svgRoot, LIB, 'out', C, st.lib);
        if (st.src2 && st.obj2) {
          flowArrow(svgRoot, SRC2.x + SRC2.w / 2, SRC2.y + SRC2.h, OBJ2.x + OBJ2.w / 2, OBJ2.y, 'g++ -c', st.arrow.s2o2, uid, C);
        }
        if (st.obj2 && st.lib) {
          flowArrow(svgRoot, OBJ2.x + OBJ2.w / 2, OBJ2.y + OBJ2.h, LIB.x + LIB.w / 2, LIB.y, 'ar rcs', st.arrow.o2lib, uid, C);
        }

        // 3) hex_control 타겟 내부
        fileBox(svgRoot, SRC1, 'src', C, st.src13);
        fileBox(svgRoot, SRC3, 'src', C, st.src13);
        fileBox(svgRoot, OBJ1, 'obj', C, st.obj13);
        fileBox(svgRoot, OBJ3, 'obj', C, st.obj13);
        fileBox(svgRoot, EXE, 'out', C, st.exe);
        if (st.src13 && st.obj13) {
          flowArrow(svgRoot, SRC1.x + SRC1.w / 2, SRC1.y + SRC1.h, OBJ1.x + OBJ1.w / 2, OBJ1.y, 'g++ -c', st.arrow.s1o1, uid, C);
          flowArrow(svgRoot, SRC3.x + SRC3.w / 2, SRC3.y + SRC3.h, OBJ3.x + OBJ3.w / 2, OBJ3.y, 'g++ -c', st.arrow.s3o3, uid, C);
        }
        if (st.obj13 && st.exe) {
          flowArrow(svgRoot, OBJ1.x + OBJ1.w / 2, OBJ1.y + OBJ1.h, EXE.x + EXE.w * 0.25, EXE.y, null, st.arrow.o1exe, uid, C);
          flowArrow(svgRoot, OBJ3.x + OBJ3.w / 2, OBJ3.y + OBJ3.h, EXE.x + EXE.w * 0.75, EXE.y, 'ld', st.arrow.o3exe, uid, C);
        }

        // 4) 타겟 간 의존성 (target_link_libraries) — 컨테이너 경계를 넘는 화살표
        if (st.lib && st.obj13) {
          flowArrow(svgRoot, LIB.x + LIB.w, LIB.y + LIB.h / 2, EXE.x, EXE.y + EXE.h / 2,
            'target_link_libraries', st.arrow.lib2exe, uid, C);
        }

        if (st.tag) {
          svgRoot.appendChild(core.svgText(EXE.x + EXE.w - 8, EXE.y + EXE.h + 18, st.tag, {
            'text-anchor': 'end', 'font-size': 11.5, 'font-weight': 700, fill: GREEN
          }));
        }

        // 5) CMakeLists.txt 코드 패널
        svgRoot.appendChild(core.svg('rect', {
          x: 10, y: CODE_Y, width: W - 20, height: CODE_H, rx: 8, fill: C.sunken, stroke: C.border
        }));
        svgRoot.appendChild(core.svgText(22, CODE_Y + 18, 'CMakeLists.txt', {
          'font-size': 10.5, 'font-weight': 700, fill: C.mute
        }));
        var lh = 22, top = CODE_Y + 40;
        CODE_LINES.forEach(function (line, k) {
          var hi = isHi(k, st.code);
          var y = top + k * lh;
          if (hi) {
            svgRoot.appendChild(core.svg('rect', {
              x: 16, y: y - 14, width: W - 32, height: 19, rx: 3, fill: C.accentSoft
            }));
            svgRoot.appendChild(core.svgText(20, y, '▶', { 'font-size': 9, fill: C.accent }));
          }
          svgRoot.appendChild(core.svgText(38, y, line, {
            'font-size': 12, 'font-family': MONO,
            fill: hi ? C.fg : C.soft, 'font-weight': hi ? 700 : 400
          }));
        });

        f.setCaption(st.cap);
      }

      core.player(mountEl, { total: STEPS.length, render: render, autoMs: 2000 });
    }
  };
})(this);
