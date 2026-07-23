/* frame-transform-3d.js — 좌표 프레임(TF) 트리와 회전/이동 변환 조작 위젯
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget frame-transform-3d
 *   { "interactive": "base_link" }        // 슬라이더로 조작할 프레임 이름
 *   :::
 *   프레임 트리를 직접 줄 수도 있다:
 *   { "frames": [ {"name":"base_link","parent":"world","xyz":[0,0,60],"rpy":[0,0,0]},
 *                 {"name":"lidar","parent":"base_link","xyz":[40,0,30],"rpy":[0,0,0]} ],
 *     "interactive": "base_link" }
 *
 * 구현 기법 결정 (CLAUDE.md §5 는 "순수 WebGL vs CSS 3D — 난이도 보고 판단"으로
 * 위임했다): 둘 다 아니고 "JS 수동 투영 + SVG"를 쓴다. 이 위젯이 그릴 것은
 * 선분(축·연결선)과 라벨뿐이라 셰이더도 z-buffer 도 필요 없다 — 3D 점을
 * 직교 투영으로 2D 에 내리는 함수 하나면 기존 위젯들과 같은 SVG 스택으로
 * 끝나고, 의존성 제로 원칙과 테마 색상 처리(themeColor)도 공짜로 계승한다.
 *
 * 좌표계는 로보틱스 관례(REP-103)를 따른다: x 전방, y 좌측, z 상방.
 * 축 색도 관례대로 x=빨강, y=초록, z=파랑 (RViz 와 동일) — Part IX·X 에서
 * RViz 화면과 이 위젯이 같은 문법으로 읽히게 하기 위해서다.
 *
 * 다른 위젯들과 같은 "조작형"이다: 상태(프레임 트리 + 카메라) → render()
 * 전체 재그리기. 회전 슬라이더가 rpy 를 바꾸면 4x4 동차 변환을 다시 합성해
 * 자식 프레임까지 통째로 따라 움직이는 것 — "변환은 곱으로 전파된다" — 이
 * 이 위젯의 존재 이유다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  var W = 900, H = 460;
  var DEG = Math.PI / 180;

  /* ---------- 최소 행렬 도구 (4x4 동차 변환, 행 우선) ---------- */

  function ident() {
    return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  }

  function mul(a, b) {
    var r = new Array(16);
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++) {
        var s = 0;
        for (var k = 0; k < 4; k++) s += a[i*4+k] * b[k*4+j];
        r[i*4+j] = s;
      }
    return r;
  }

  // roll(x) → pitch(y) → yaw(z) 순 외인성 회전 = Rz·Ry·Rx (URDF/tf2 관례)
  function fromXyzRpy(xyz, rpy) {
    var cr = Math.cos(rpy[0]), sr = Math.sin(rpy[0]);
    var cp = Math.cos(rpy[1]), sp = Math.sin(rpy[1]);
    var cy = Math.cos(rpy[2]), sy = Math.sin(rpy[2]);
    return [
      cy*cp, cy*sp*sr - sy*cr, cy*sp*cr + sy*sr, xyz[0],
      sy*cp, sy*sp*sr + cy*cr, sy*sp*cr - cy*sr, xyz[1],
      -sp,   cp*sr,            cp*cr,            xyz[2],
      0, 0, 0, 1
    ];
  }

  function apply(m, p) {
    return {
      x: m[0]*p.x + m[1]*p.y + m[2]*p.z + m[3],
      y: m[4]*p.x + m[5]*p.y + m[6]*p.z + m[7],
      z: m[8]*p.x + m[9]*p.y + m[10]*p.z + m[11]
    };
  }

  /* ---------- 기본 시나리오: 헥사포드의 몸통-센서 트리 ---------- */
  var DEFAULT_FRAMES = [
    { name: 'base_link', parent: 'world', xyz: [0, 0, 60], rpy: [0, 0, 0] },
    { name: 'lidar',     parent: 'base_link', xyz: [50, 0, 35], rpy: [0, 0, 0] },
    { name: 'leg_coxa',  parent: 'base_link', xyz: [45, 40, -10], rpy: [0, 0, 30 * DEG] }
  ];

  function mount(mountEl, params) {
    params = params || {};
    var frames = (params.frames && params.frames.length ? params.frames : DEFAULT_FRAMES)
      .map(function (fr) {
        return {
          name: fr.name, parent: fr.parent || 'world',
          xyz: (fr.xyz || [0, 0, 0]).slice(),
          rpy: (fr.rpy || [0, 0, 0]).slice()
        };
      });
    var interactive = params.interactive || frames[0].name;

    // 카메라: 방위각/고도각 궤도 + 직교 투영
    var cam = { az: -35 * DEG, el: 22 * DEG, scale: 1.6 };

    var f = core.frame(mountEl, {
      icon: '🧭',
      title: '좌표 프레임과 변환 — ' + core.esc(interactive) + ' 를 움직여 보라 (드래그로 시점 회전)'
    });

    var svgEl = core.svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%',
      style: 'display:block; touch-action:none; cursor:grab;'
    });
    f.body.appendChild(svgEl);

    /* ---------- 슬라이더: interactive 프레임의 x/y/yaw ---------- */
    var target = frames.find(function (fr) { return fr.name === interactive; }) || frames[0];

    function mkRow(labelText, min, max, val, unit) {
      var row = core.el('div', 'widget-controls');
      var s = core.el('input', 'w-slider');
      s.type = 'range'; s.min = min; s.max = max; s.step = 1; s.value = val;
      var lab = core.el('span', 'w-step-label');
      row.appendChild(core.el('span', 'w-step-label', labelText));
      row.appendChild(s); row.appendChild(lab);
      return { row: row, slider: s, label: lab, unit: unit };
    }

    var cx = mkRow('이동 x', -100, 100, target.xyz[0], 'mm');
    var cy2 = mkRow('이동 y', -100, 100, target.xyz[1], 'mm');
    var cyaw = mkRow('회전 yaw(z축)', -180, 180, target.rpy[2] / DEG, '°');
    mountEl.appendChild(cx.row);
    mountEl.appendChild(cy2.row);
    mountEl.appendChild(cyaw.row);

    var btnReset = core.el('button', 'w-btn', '초기 자세로');
    var resetRow = core.el('div', 'widget-controls');
    resetRow.appendChild(btnReset);
    mountEl.appendChild(resetRow);
    var init = { xyz: target.xyz.slice(), rpy: target.rpy.slice() };

    /* ---------- 투영 ---------- */
    function project(p) {
      // 카메라 궤도 회전(방위각 → 고도각) 후 직교 투영. z 는 화면 위쪽.
      var ca = Math.cos(cam.az), sa = Math.sin(cam.az);
      var ce = Math.cos(cam.el), se = Math.sin(cam.el);
      var x1 = ca * p.x - sa * p.y;
      var y1 = sa * p.x + ca * p.y;
      var z1 = p.z;
      var y2 = ce * y1;              // 화면 가로
      var z2 = ce * z1 - se * x1;    // 화면 세로 성분에 깊이 섞기
      var sx = W / 2 + y2 * cam.scale;
      var sy = H / 2 + 40 - (z2 + se * 0 ) * cam.scale;
      // 깊이(정렬용): 카메라에서 먼 정도
      var depth = ce * x1 + se * z1;
      return { x: sx, y: sy, depth: depth };
    }

    /* ---------- 월드 변환 계산 ---------- */
    function worldTransforms() {
      var T = { world: ident() };
      // 부모가 먼저 계산되도록 반복 해석 (트리가 얕아서 단순 반복로 충분)
      var remaining = frames.slice();
      var guard = 0;
      while (remaining.length && guard++ < 100) {
        remaining = remaining.filter(function (fr) {
          if (T[fr.parent]) {
            T[fr.name] = mul(T[fr.parent], fromXyzRpy(fr.xyz, fr.rpy));
            return false;
          }
          return true;
        });
      }
      return T;
    }

    /* ---------- 그리기 ---------- */
    var AXIS_LEN = 34;
    var AXES = [
      { v: { x: AXIS_LEN, y: 0, z: 0 }, color: '#d64545', label: 'x' },
      { v: { x: 0, y: AXIS_LEN, z: 0 }, color: '#2e9e57', label: 'y' },
      { v: { x: 0, y: 0, z: AXIS_LEN }, color: '#2f6fed', label: 'z' }
    ];

    function render() {
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      var cMuted = core.themeColor('--fg-muted', '#888');
      var cFg = core.themeColor('--fg', '#333');

      // 바닥 격자 (world z=0 평면) — 공간감의 기준
      var g = core.svg('g');
      for (var i = -2; i <= 2; i++) {
        var a1 = project({ x: i * 60, y: -120, z: 0 });
        var a2 = project({ x: i * 60, y: 120, z: 0 });
        var b1 = project({ x: -120, y: i * 60, z: 0 });
        var b2 = project({ x: 120, y: i * 60, z: 0 });
        g.appendChild(core.svg('line', { x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y, stroke: cMuted, 'stroke-width': 0.6, opacity: 0.35 }));
        g.appendChild(core.svg('line', { x1: b1.x, y1: b1.y, x2: b2.x, y2: b2.y, stroke: cMuted, 'stroke-width': 0.6, opacity: 0.35 }));
      }
      svgEl.appendChild(g);

      var T = worldTransforms();

      // 부모→자식 연결선 (프레임 원점끼리 점선)
      frames.forEach(function (fr) {
        var po = apply(T[fr.parent], { x: 0, y: 0, z: 0 });
        var co = apply(T[fr.name], { x: 0, y: 0, z: 0 });
        var p1 = project(po), p2 = project(co);
        svgEl.appendChild(core.svg('line', {
          x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
          stroke: cMuted, 'stroke-width': 1.3, 'stroke-dasharray': '5 4', opacity: 0.8
        }));
      });

      // 각 프레임의 삼색 축 + 이름표 (world 포함)
      var names = ['world'].concat(frames.map(function (fr) { return fr.name; }));
      names.forEach(function (name) {
        var M = T[name];
        var o = apply(M, { x: 0, y: 0, z: 0 });
        var po = project(o);
        AXES.forEach(function (ax) {
          var tip = apply(M, ax.v);
          var pt = project(tip);
          svgEl.appendChild(core.svg('line', {
            x1: po.x, y1: po.y, x2: pt.x, y2: pt.y,
            stroke: ax.color, 'stroke-width': name === interactive ? 3 : 2,
            'stroke-linecap': 'round'
          }));
          svgEl.appendChild(core.svgText(pt.x + 3, pt.y - 3, ax.label,
            { 'font-size': 11, fill: ax.color, 'font-weight': 600 }));
        });
        svgEl.appendChild(core.svg('circle', {
          cx: po.x, cy: po.y, r: name === interactive ? 5 : 3.5,
          fill: cFg
        }));
        svgEl.appendChild(core.svgText(po.x + 8, po.y + 14, name, {
          'font-size': 13, fill: cFg,
          'font-weight': name === interactive ? 700 : 400
        }));
      });

      // 라벨·캡션
      cx.label.textContent = target.xyz[0].toFixed(0) + 'mm';
      cy2.label.textContent = target.xyz[1].toFixed(0) + 'mm';
      cyaw.label.textContent = (target.rpy[2] / DEG).toFixed(0) + '°';

      var Mi = T[interactive];
      function n(v) { return (Math.abs(v) < 1e-9 ? 0 : v).toFixed(2); }
      f.setCaption(
        '<b>' + core.esc(interactive) + '</b> 의 부모 기준 변환이 바뀌면 그 <b>자식 프레임 전부</b>가 따라 움직인다 — ' +
        '변환은 트리를 따라 곱으로 전파된다(T<sub>world→c</sub> = T<sub>world→p</sub> · T<sub>p→c</sub>). ' +
        'world 기준 회전 행렬: [' +
        n(Mi[0]) + ' ' + n(Mi[1]) + ' ' + n(Mi[2]) + ' | ' +
        n(Mi[4]) + ' ' + n(Mi[5]) + ' ' + n(Mi[6]) + ' | ' +
        n(Mi[8]) + ' ' + n(Mi[9]) + ' ' + n(Mi[10]) + '], 이동: (' +
        n(Mi[3]) + ', ' + n(Mi[7]) + ', ' + n(Mi[11]) + ')');
    }

    /* ---------- 입력 배선 ---------- */
    cx.slider.addEventListener('input', function () { target.xyz[0] = +cx.slider.value; render(); });
    cy2.slider.addEventListener('input', function () { target.xyz[1] = +cy2.slider.value; render(); });
    cyaw.slider.addEventListener('input', function () { target.rpy[2] = +cyaw.slider.value * DEG; render(); });
    btnReset.addEventListener('click', function () {
      target.xyz = init.xyz.slice(); target.rpy = init.rpy.slice();
      cx.slider.value = target.xyz[0]; cy2.slider.value = target.xyz[1];
      cyaw.slider.value = target.rpy[2] / DEG;
      render();
    });

    // 드래그로 카메라 궤도 회전
    var drag = null;
    svgEl.addEventListener('pointerdown', function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, az: cam.az, el: cam.el };
      svgEl.setPointerCapture(ev.pointerId);
      svgEl.style.cursor = 'grabbing';
    });
    svgEl.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      cam.az = drag.az + (ev.clientX - drag.x) * 0.008;
      cam.el = Math.max(-1.4, Math.min(1.4, drag.el + (ev.clientY - drag.y) * 0.008));
      render();
    });
    svgEl.addEventListener('pointerup', function () {
      drag = null; svgEl.style.cursor = 'grab';
    });

    render();
  }

  WIDGETS['frame-transform-3d'] = { mount: mount };
})(this);
