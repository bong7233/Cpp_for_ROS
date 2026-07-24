/* kinematics-chain.js — 링크-조인트 체인의 순기구학/역기구학 조작 위젯
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget kinematics-chain
 *   { "mode": "fk" }                // "fk"(기본) | "ik"
 *   { "mode": "ik", "l1": 80, "l2": 128 }
 *   :::
 *
 * 이 위젯은 pointer-diagram 과 같은 "조작형"이다. 운동학의 핵심 난점은
 * 정해진 순서 재생이 아니라 "각도를 내가 돌리면 발끝이 어디로 가는가"(FK),
 * "발끝을 내가 끌면 각도가 어떻게 풀리는가"(IK)라는 양방향 감각이므로,
 * 슬라이더·드래그 입력 → 상태 → SVG 전체 재그리기의 순수 render() 로 만든다.
 * 증분 갱신을 피하는 이유는 다른 위젯들과 같다: 상태-화면 불일치 버그 차단.
 *
 * 링크 길이 기본값 80/128mm 는 본문(8.3 reach.cpp, Part IX)의 헥사포드
 * femur/tibia 스펙과 일치시킨다 — 위젯과 본문 코드가 같은 로봇을 말하게.
 *
 * IK 는 2링크 평면 해석해를 쓴다:
 *   cos(θ2) = (x²+y²-l1²-l2²) / (2·l1·l2)   — 범위 밖이면 도달 불가
 *   θ1 = atan2(y,x) − atan2(l2·sin(θ2), l1+l2·cos(θ2))
 * elbow-up/down 두 해가 존재하는 것 자체가 학습 포인트라 토글로 노출한다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  var W = 900, H = 430;
  // 화면 좌표: 고관절(원점)을 왼쪽 위쪽에 두고, x 오른쪽 / y 아래쪽(로봇 다리가
  // 아래로 늘어지는 쪽이 양수) — 수학 좌표를 뒤집지 않아 각도 부호가 직관과 맞는다.
  var OX = 300, OY = 130, SCALE = 1.05;

  var DEG = Math.PI / 180;

  function fk(l1, l2, t1, t2) {
    var kx = l1 * Math.cos(t1), ky = l1 * Math.sin(t1);
    return {
      knee: { x: kx, y: ky },
      foot: { x: kx + l2 * Math.cos(t1 + t2), y: ky + l2 * Math.sin(t1 + t2) }
    };
  }

  // 반환: null(도달 불가) 또는 {t1, t2}
  function ik(l1, l2, x, y, elbowUp) {
    var d2 = x * x + y * y;
    var c2 = (d2 - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    if (c2 < -1 || c2 > 1) return null;
    var t2 = Math.acos(c2);
    if (elbowUp) t2 = -t2;
    var t1 = Math.atan2(y, x) - Math.atan2(l2 * Math.sin(t2), l1 + l2 * Math.cos(t2));
    return { t1: t1, t2: t2 };
  }

  function toScreen(p) { return { x: OX + p.x * SCALE, y: OY + p.y * SCALE }; }
  function fromScreen(sx, sy) { return { x: (sx - OX) / SCALE, y: (sy - OY) / SCALE }; }

  function fmtDeg(rad) { return (rad / DEG).toFixed(1) + '°'; }

  function mount(mountEl, params) {
    params = params || {};
    var l1 = +params.l1 || 80;    // femur
    var l2 = +params.l2 || 128;   // tibia
    var mode = params.mode === 'ik' ? 'ik' : 'fk';

    var st = {
      mode: mode,
      t1: 35 * DEG, t2: 55 * DEG,          // FK 상태 (IK 성공 시에도 여기 반영)
      target: null,                         // IK 목표점 (작업공간 좌표)
      elbowUp: false,
      reachable: true,
      trace: []                             // 발끝 궤적 (최근 N점)
    };
    // IK 초기 목표점: 현재 FK 자세의 발끝
    st.target = fk(l1, l2, st.t1, st.t2).foot;

    var f = core.frame(mountEl, {
      icon: '🦿',
      title: '운동학 체인 (FK/IK) · femur ' + l1 + 'mm / tibia ' + l2 + 'mm'
    });

    var svgEl = core.svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      width: '100%',
      style: 'display:block; touch-action:none;'
    });
    f.body.appendChild(svgEl);

    /* ---------- 컨트롤 ---------- */
    var controls = core.el('div', 'widget-controls');

    var btnMode = core.el('button', 'w-btn primary',
      st.mode === 'ik' ? 'FK 모드로' : 'IK 모드로');
    var btnElbow = core.el('button', 'w-btn', '무릎 방향 전환');
    var btnTrace = core.el('button', 'w-btn', '궤적 지우기');

    function mkSlider(min, max, val) {
      var s = core.el('input', 'w-slider');
      s.type = 'range'; s.min = min; s.max = max; s.step = 1; s.value = val;
      return s;
    }
    var s1 = mkSlider(-90, 120, st.t1 / DEG);
    var s2 = mkSlider(-150, 150, st.t2 / DEG);
    var lab1 = core.el('span', 'w-step-label');
    var lab2 = core.el('span', 'w-step-label');

    var row1 = core.el('div', 'widget-controls');
    row1.appendChild(core.el('span', 'w-step-label', 'θ1(고관절)'));
    row1.appendChild(s1); row1.appendChild(lab1);
    row1.appendChild(core.el('span', 'w-step-label', 'θ2(무릎)'));
    row1.appendChild(s2); row1.appendChild(lab2);

    controls.appendChild(btnMode);
    controls.appendChild(btnElbow);
    controls.appendChild(btnTrace);
    mountEl.appendChild(row1);
    mountEl.appendChild(controls);

    /* ---------- 그리기 ---------- */
    function render() {
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

      var cLink = core.themeColor('--fg', '#333');
      var cAccent = core.themeColor('--accent', '#2f6fed');
      var cMuted = core.themeColor('--fg-muted', '#888');
      var cWarn = '#d64545';
      var cOk = '#2e9e57';

      // 작업공간(도달 가능 환형 영역): |l1-l2| <= r <= l1+l2
      var g = core.svg('g');
      g.appendChild(core.svg('circle', {
        cx: OX, cy: OY, r: (l1 + l2) * SCALE,
        fill: 'none', stroke: cMuted, 'stroke-dasharray': '6 5', 'stroke-width': 1.2, opacity: 0.6
      }));
      g.appendChild(core.svg('circle', {
        cx: OX, cy: OY, r: Math.abs(l1 - l2) * SCALE,
        fill: 'none', stroke: cMuted, 'stroke-dasharray': '3 5', 'stroke-width': 1, opacity: 0.5
      }));
      g.appendChild(core.svgText(OX + (l1 + l2) * SCALE - 4, OY - 8, '도달 한계 r = l1+l2',
        { 'text-anchor': 'end', 'font-size': 12, fill: cMuted }));
      g.appendChild(core.svgText(OX + Math.abs(l1 - l2) * SCALE + 6, OY + 16, '내측 한계 |l1−l2|',
        { 'font-size': 12, fill: cMuted, opacity: 0.8 }));
      svgEl.appendChild(g);

      // 몸통(고정 베이스) 표시
      svgEl.appendChild(core.svg('rect', {
        x: OX - 46, y: OY - 22, width: 46, height: 44, rx: 6,
        fill: 'none', stroke: cMuted, 'stroke-width': 1.5
      }));
      svgEl.appendChild(core.svgText(OX - 23, OY + 4, '몸통', {
        'text-anchor': 'middle', 'font-size': 12, fill: cMuted
      }));

      // 발끝 궤적
      if (st.trace.length > 1) {
        var d = st.trace.map(function (p, i) {
          var s = toScreen(p);
          return (i ? 'L' : 'M') + s.x.toFixed(1) + ' ' + s.y.toFixed(1);
        }).join(' ');
        svgEl.appendChild(core.svg('path', {
          d: d, fill: 'none', stroke: cAccent, 'stroke-width': 1.4, opacity: 0.45
        }));
      }

      var pose = fk(l1, l2, st.t1, st.t2);
      var hip = toScreen({ x: 0, y: 0 });
      var knee = toScreen(pose.knee);
      var foot = toScreen(pose.foot);

      // 링크 두 개
      [[hip, knee], [knee, foot]].forEach(function (seg, i) {
        svgEl.appendChild(core.svg('line', {
          x1: seg[0].x, y1: seg[0].y, x2: seg[1].x, y2: seg[1].y,
          stroke: cLink, 'stroke-width': 7 - i * 1.5, 'stroke-linecap': 'round'
        }));
      });
      svgEl.appendChild(core.svgText((hip.x + knee.x) / 2 + 10, (hip.y + knee.y) / 2 - 8,
        'femur ' + l1, { 'font-size': 12, fill: cLink }));
      svgEl.appendChild(core.svgText((knee.x + foot.x) / 2 + 10, (knee.y + foot.y) / 2 - 8,
        'tibia ' + l2, { 'font-size': 12, fill: cLink }));

      // 각도 호: θ1 은 수평 기준, θ2 는 femur 연장선 기준
      function arc(cx, cy, r, a0, a1, color) {
        var large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
        var sweep = a1 > a0 ? 1 : 0;
        var p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
        var p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
        return core.svg('path', {
          d: 'M' + p0.x.toFixed(1) + ' ' + p0.y.toFixed(1) +
             ' A' + r + ' ' + r + ' 0 ' + large + ' ' + sweep + ' ' +
             p1.x.toFixed(1) + ' ' + p1.y.toFixed(1),
          fill: 'none', stroke: color, 'stroke-width': 2
        });
      }
      svgEl.appendChild(core.svg('line', {
        x1: hip.x, y1: hip.y, x2: hip.x + 46, y2: hip.y,
        stroke: cMuted, 'stroke-width': 1, 'stroke-dasharray': '4 3'
      }));
      svgEl.appendChild(arc(hip.x, hip.y, 30, 0, st.t1, cAccent));
      svgEl.appendChild(core.svgText(hip.x + 40, hip.y + (st.t1 > 0 ? 26 : -14),
        'θ1 = ' + fmtDeg(st.t1), { 'font-size': 13, fill: cAccent, 'font-weight': 600 }));
      svgEl.appendChild(arc(knee.x, knee.y, 24, st.t1, st.t1 + st.t2, cAccent));
      svgEl.appendChild(core.svgText(knee.x + 14, knee.y + 30,
        'θ2 = ' + fmtDeg(st.t2), { 'font-size': 13, fill: cAccent, 'font-weight': 600 }));

      // 관절
      [[hip, 9], [knee, 7]].forEach(function (j) {
        svgEl.appendChild(core.svg('circle', {
          cx: j[0].x, cy: j[0].y, r: j[1],
          fill: core.themeColor('--bg', '#fff'), stroke: cLink, 'stroke-width': 2.5
        }));
      });

      // 발끝
      svgEl.appendChild(core.svg('circle', {
        cx: foot.x, cy: foot.y, r: 6.5, fill: cAccent
      }));
      svgEl.appendChild(core.svgText(foot.x + 12, foot.y + 4,
        '발끝 (' + pose.foot.x.toFixed(1) + ', ' + pose.foot.y.toFixed(1) + ')',
        { 'font-size': 13, fill: cAccent, 'font-weight': 600 }));

      // IK 모드: 목표점 십자 + 상태
      if (st.mode === 'ik' && st.target) {
        var t = toScreen(st.target);
        var col = st.reachable ? cOk : cWarn;
        svgEl.appendChild(core.svg('line', { x1: t.x - 10, y1: t.y, x2: t.x + 10, y2: t.y, stroke: col, 'stroke-width': 2.5 }));
        svgEl.appendChild(core.svg('line', { x1: t.x, y1: t.y - 10, x2: t.x, y2: t.y + 10, stroke: col, 'stroke-width': 2.5 }));
        svgEl.appendChild(core.svg('circle', { cx: t.x, cy: t.y, r: 13, fill: 'none', stroke: col, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }));
        svgEl.appendChild(core.svgText(t.x + 16, t.y - 12,
          st.reachable ? '목표' : '도달 불가',
          { 'font-size': 13, fill: col, 'font-weight': 700 }));
      }

      // 라벨/캡션 동기화
      lab1.textContent = fmtDeg(st.t1);
      lab2.textContent = fmtDeg(st.t2);
      s1.value = st.t1 / DEG;
      s2.value = st.t2 / DEG;

      if (st.mode === 'fk') {
        f.setCaption(
          '<b>FK</b> — 각도가 입력, 발끝이 출력이다. ' +
          '발끝 x = l1·cosθ1 + l2·cos(θ1+θ2) = <b>' + pose.foot.x.toFixed(1) + '</b>, ' +
          'y = l1·sinθ1 + l2·sin(θ1+θ2) = <b>' + pose.foot.y.toFixed(1) + '</b>. ' +
          '슬라이더로 관절을 돌려 보라 — 답은 항상 하나로 정해진다.');
      } else {
        f.setCaption(st.reachable
          ? ('<b>IK</b> — 발끝이 입력, 각도가 출력이다. 목표를 <b>드래그</b>해 보라. ' +
             'cosθ2 = (x²+y²−l1²−l2²)/(2·l1·l2) → θ2 = ' + fmtDeg(st.t2) +
             ', θ1 = ' + fmtDeg(st.t1) + '. 같은 목표에 무릎 방향이 다른 <b>두 해</b>가 있다 — 버튼으로 전환해 보라.')
          : ('<b>도달 불가</b> — 목표가 작업공간(점선 원환) 밖이다. ' +
             'cosθ2 가 [−1, 1] 범위를 벗어나면 acos 이 해를 주지 않는다. ' +
             'IK 코드는 이 경우를 반드시 처리해야 한다(값 클램프, 이전 자세 유지, 에러 반환 중 택일).'));
      }
    }

    function pushTrace() {
      var foot = fk(l1, l2, st.t1, st.t2).foot;
      var last = st.trace[st.trace.length - 1];
      if (!last || Math.hypot(foot.x - last.x, foot.y - last.y) > 1.5) {
        st.trace.push(foot);
        if (st.trace.length > 400) st.trace.shift();
      }
    }

    /* ---------- 입력 배선 ---------- */
    // 슬라이더는 언제나 FK 입력이다 — IK 모드 중에 만지면 FK 모드로 전환한다
    function toFk() {
      if (st.mode !== 'fk') { st.mode = 'fk'; btnMode.innerHTML = 'IK 모드로'; }
    }
    s1.addEventListener('input', function () {
      toFk(); st.t1 = +s1.value * DEG; pushTrace(); render();
    });
    s2.addEventListener('input', function () {
      toFk(); st.t2 = +s2.value * DEG; pushTrace(); render();
    });

    btnMode.addEventListener('click', function () {
      st.mode = st.mode === 'ik' ? 'fk' : 'ik';
      btnMode.innerHTML = st.mode === 'ik' ? 'FK 모드로' : 'IK 모드로';
      if (st.mode === 'ik') {
        st.target = fk(l1, l2, st.t1, st.t2).foot;
        st.reachable = true;
      }
      render();
    });

    btnElbow.addEventListener('click', function () {
      st.elbowUp = !st.elbowUp;
      if (st.mode === 'ik' && st.target) solveTo(st.target);
      else { st.t2 = -st.t2; pushTrace(); }
      render();
    });

    btnTrace.addEventListener('click', function () { st.trace = []; render(); });

    function solveTo(p) {
      st.target = p;
      var sol = ik(l1, l2, p.x, p.y, st.elbowUp);
      if (sol) {
        st.reachable = true;
        st.t1 = sol.t1; st.t2 = sol.t2;
        pushTrace();
      } else {
        st.reachable = false;   // 자세는 이전 해를 유지한다 — 실전 IK 의 흔한 선택
      }
    }

    // IK 드래그: SVG 좌표로 변환해 매 이동마다 해를 다시 푼다
    var dragging = false;
    function evtPoint(ev) {
      var r = svgEl.getBoundingClientRect();
      var sx = (ev.clientX - r.left) * (W / r.width);
      var sy = (ev.clientY - r.top) * (H / r.height);
      return fromScreen(sx, sy);
    }
    svgEl.addEventListener('pointerdown', function (ev) {
      if (st.mode !== 'ik') return;
      dragging = true;
      svgEl.setPointerCapture(ev.pointerId);
      solveTo(evtPoint(ev)); render();
    });
    svgEl.addEventListener('pointermove', function (ev) {
      if (!dragging || st.mode !== 'ik') return;
      solveTo(evtPoint(ev)); render();
    });
    svgEl.addEventListener('pointerup', function () { dragging = false; });

    render();
  }

  WIDGETS['kinematics-chain'] = { mount: mount };
})(this);
