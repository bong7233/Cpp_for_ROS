/* thread-timeline.js — 스레드 인터리빙 타임라인 (Part VI 동시성)
 *
 * counter++ 가 load/add/store 3개 기계 연산으로 쪼개지기 때문에
 * 스레드 2개가 섞이면 갱신이 증발할 수 있다는 것을 스텝 재생으로 보여준다.
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget thread-timeline
 *   { "scenario": "race" }        // "race" | "race-lucky" | "mutex"
 *   :::
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  var RED = '#d93838';               // 레이스 = 위험. 테마와 무관하게 항상 빨강.
  var GREEN = '#1f9d55';
  var T2COL = '#d97706';             // T1(파랑=accent)과 색약에도 구분되는 주황.
  var MONO = 'font-family:var(--font-mono)';

  /* 시나리오 = 이벤트 시퀀스. 각 이벤트가 플레이어의 한 스텝.
   * start/end 는 타임라인 칸을 차지하지 않는 서사용 스텝이다. */
  var SCENARIOS = {
    'race': {
      label: '레이스 (깨짐)',
      code: ['counter++;', '= load → add → store'],
      events: [
        { op: 'start', cap: '<code>counter = 0</code>. 두 스레드가 각각 <code>counter++</code> 를 1회 실행한다. <code>counter++</code> 는 사실 load→add→store 3개 기계 연산이다 — 흐린 블록이 앞으로의 인터리빙 순서다.' },
        { t: 'T1', op: 'load', cap: 'T1이 counter(<code>0</code>)를 자기 레지스터로 읽었다. 메모리는 아직 그대로다.' },
        { t: 'T2', op: 'load', cap: 'T2도 counter를 읽었다 — T1이 store 하기 <b>전</b>이라 T2 역시 <code>0</code>을 본다. 여기서 이미 사고가 예약됐다.' },
        { t: 'T1', op: 'add', cap: 'T1이 레지스터에서 0+1=<code>1</code> 을 계산했다. 메모리의 counter는 여전히 0.' },
        { t: 'T2', op: 'add', cap: 'T2도 자기 레지스터에서 0+1=<code>1</code>. 두 스레드 모두 "1을 쓰겠다"고 준비 중이다.' },
        { t: 'T1', op: 'store', cap: 'T1이 <code>counter = 1</code> 을 메모리에 썼다. 여기까지는 정상처럼 보인다.' },
        { t: 'T2', op: 'store', race: true, cap: 'T2가 <code>counter = 1</code> 을 <b>덮어썼다</b> — T1의 +1 이 사라졌다! 두 번 증가했는데 결과는 1.' },
        { op: 'end', cap: '기대값 <code>2</code>, 실제값 <code>1</code>. counter++ 가 원자적이지 않아서 갱신 하나가 조용히 증발했다. 이것이 데이터 레이스다.' }
      ]
    },
    'race-lucky': {
      label: '레이스 (운 좋음)',
      code: ['counter++;', '= load → add → store'],
      events: [
        { op: 'start', cap: '<b>race 시나리오와 완전히 같은 코드</b>다. 이번엔 스케줄러가 우연히 두 스레드를 겹치지 않게 실행할 뿐이다.' },
        { t: 'T1', op: 'load', cap: 'T1이 counter(<code>0</code>)를 레지스터로 읽는다.' },
        { t: 'T1', op: 'add', cap: 'T1이 레지스터에서 0+1=<code>1</code> 을 만든다.' },
        { t: 'T1', op: 'store', cap: 'T1이 <code>counter = 1</code> 저장. T2가 끼어들기 전에 3연산이 전부 끝났다 — 순전히 운이다.' },
        { t: 'T2', op: 'load', cap: 'T2가 counter를 읽으니 이미 <code>1</code>이다. T1의 갱신이 살아남았다.' },
        { t: 'T2', op: 'add', cap: 'T2가 1+1=<code>2</code> 계산.' },
        { t: 'T2', op: 'store', cap: 'T2가 <code>counter = 2</code> 저장. 이번 실행에서는 정답이 나왔다.' },
        { op: 'end', cap: '기대값 <code>2</code>, 실제값 <code>2</code> — 하지만 코드는 같다. 스케줄러 운만 달랐다. <b>그래서 레이스는 테스트로 못 잡는다.</b>' }
      ]
    },
    'mutex': {
      label: '뮤텍스 (해결)',
      code: ['lock; counter++; unlock;', '임계 구역 = 한 번에 한 스레드'],
      events: [
        { op: 'start', cap: '<code>counter++</code> 를 뮤텍스로 감쌌다. lock~unlock 사이(임계 구역)에는 한 번에 한 스레드만 들어간다.' },
        { t: 'T1', op: 'lock', cap: 'T1이 뮤텍스를 획득했다 🔒. 이제 다른 스레드는 이 구역에 못 들어온다.' },
        { t: 'T1', op: 'load', cap: 'T1이 counter(<code>0</code>)를 레지스터로 읽는다 — 락 보호 아래에서.' },
        { t: 'T1', op: 'add', cap: 'T1이 레지스터에서 0+1=<code>1</code> 계산.' },
        { t: 'T2', op: 'wait', cap: 'T2가 lock 을 시도했지만 T1이 보유 중 → <b>블록(대기)</b>. 이 기다림이 곧 안전이다.' },
        { t: 'T1', op: 'store', cap: 'T1이 <code>counter = 1</code> 저장. T2는 여전히 대기 중이라 끼어들 수 없다.' },
        { t: 'T1', op: 'unlock', cap: 'T1이 뮤텍스를 반납했다 🔓. 대기 중이던 T2가 깨어난다.' },
        { t: 'T2', op: 'lock', cap: 'T2가 뮤텍스를 획득했다 🔒. 이제야 임계 구역에 들어간다.' },
        { t: 'T2', op: 'load', cap: 'T2가 counter를 읽으니 <code>1</code> — T1의 갱신이 <b>완성된 뒤</b>에만 읽도록 강제됐다.' },
        { t: 'T2', op: 'add', cap: 'T2가 1+1=<code>2</code> 계산.' },
        { t: 'T2', op: 'store', cap: 'T2가 <code>counter = 2</code> 저장. 덮어쓰기가 원천 차단됐다.' },
        { t: 'T2', op: 'unlock', cap: 'T2가 뮤텍스를 반납했다 🔓.' },
        { op: 'end', cap: '기대값 <code>2</code>, 실제값 <code>2</code>. 뮤텍스가 load→add→store 를 하나의 원자적 덩어리로 만들었다. 대가는 T2의 대기 시간.' }
      ]
    }
  };

  var OP_LABEL = { load: 'load', add: 'add', store: 'store', lock: 'lock', unlock: 'unlock', wait: '대기' };

  /* 스텝 i 의 상태를 매번 0부터 다시 계산하지 않도록 누적 상태를 미리 배열로 만든다.
   * states[i] = 이벤트 0..i 를 적용한 뒤의 세계. render(i)가 순수 함수로 남는다. */
  function buildStates(events) {
    var counter = 0, reg = { T1: null, T2: null }, owner = null;
    return events.map(function (e) {
      var race = false;
      switch (e.op) {
        case 'load':   reg[e.t] = counter; break;
        case 'add':    reg[e.t] += 1; break;
        case 'store':  counter = reg[e.t]; race = !!e.race; break;
        case 'lock':   owner = e.t; break;
        case 'unlock': owner = null; break;
      }
      return { counter: counter, reg: { T1: reg.T1, T2: reg.T2 }, owner: owner, race: race };
    });
  }

  function buildWidget(mountEl, key) {
    var scn = SCENARIOS[key];
    var events = scn.events;
    var states = buildStates(events);
    var hasMutex = events.some(function (e) { return e.op === 'lock'; });

    // 타임라인 칸 배치: start/end 를 뺀 이벤트가 순서대로 한 칸씩 차지한다.
    var nCols = 0;
    events.forEach(function (e) {
      if (e.op !== 'start' && e.op !== 'end') e._col = nCols++;
    });
    // 대기 블록은 같은 스레드의 다음 이벤트(락 획득) 직전 칸까지 이어진다 —
    // "블록된 채 시간이 흐른다"를 폭으로 보여주기 위해.
    events.forEach(function (e, idx) {
      if (e.op !== 'wait') return;
      e._span = 1;
      for (var j = idx + 1; j < events.length; j++) {
        if (events[j].t === e.t && events[j]._col !== undefined) {
          e._span = events[j]._col - e._col; break;
        }
      }
    });
    // 락 보유 구간(밑줄 띠): lock~unlock 칸 범위.
    var holds = [], open = {};
    events.forEach(function (e, idx) {
      if (e.op === 'lock') open[e.t] = { t: e.t, c1: e._col, step: idx };
      else if (e.op === 'unlock' && open[e.t]) {
        open[e.t].c2 = e._col; holds.push(open[e.t]); delete open[e.t];
      }
    });

    var f = core.frame(mountEl, {
      icon: '🧵',
      title: '스레드 타임라인 — counter++ 는 왜 깨지는가'
    });

    // 시나리오 전환 버튼 — 현재 것만 primary, 누르면 통째로 재마운트.
    var bar = core.el('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;';
    Object.keys(SCENARIOS).forEach(function (k) {
      var b = core.el('button', 'w-btn' + (k === key ? ' primary' : ''), core.esc(SCENARIOS[k].label));
      b.addEventListener('click', function () {
        if (k === key) return;
        pl.destroy();                        // 자동재생 타이머 정리 후 재마운트
        mountEl.innerHTML = '';
        buildWidget(mountEl, k);
      });
      bar.appendChild(b);
    });
    f.body.appendChild(bar);

    var W = 900, H = 380;
    var stage = core.el('div', 'widget-stage');
    var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
    stage.appendChild(svgRoot);
    f.body.appendChild(stage);

    // 마운트마다 고유한 패턴 id — 한 페이지에 위젯이 여러 개 떠도 안 섞이게.
    var pid = 'tt-hatch-' + Math.random().toString(36).slice(2, 8);

    var X0 = 110, X1 = 745;                  // 타임라인 가로 범위
    var colW = (X1 - X0) / nCols;
    var LANE = { T1: 140, T2: 232 };         // 각 레인의 상단 y
    var TCOL;                                 // 스레드 색 (렌더마다 테마에서 다시 읽음)

    function colX(c) { return X0 + c * colW + 3; }

    function box(x, y, w, h, attrs) {
      return core.svg('rect', Object.assign({ x: x, y: y, width: w, height: h, rx: 7 }, attrs));
    }

    function render(i) {
      while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);
      var accent = core.themeColor('--accent', '#2f6fed');
      var fg = core.themeColor('--fg', '#1c1f26');
      var soft = core.themeColor('--fg-soft', '#4a5160');
      var mute = core.themeColor('--fg-mute', '#7b8496');
      var border = core.themeColor('--border-strong', '#cfd4de');
      var sunken = core.themeColor('--bg-sunken', '#eef0f4');
      TCOL = { T1: accent, T2: T2COL };

      var st = states[i];
      var ev = events[i];
      var isEnd = ev.op === 'end';

      // 빗금 패턴(대기 칸) — 외부 이미지 없이 <defs><pattern> 으로.
      svgRoot.appendChild(core.svg('defs', null, [
        core.svg('pattern', {
          id: pid, width: 7, height: 7,
          patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
        }, [
          core.svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: mute, 'stroke-width': 2, opacity: 0.55 })
        ])
      ]));

      /* ---- 좌상단: 실행 중인 코드 ---- */
      svgRoot.appendChild(core.svgText(20, 32, scn.code[0], { 'font-size': 13, fill: fg, 'font-weight': 700, style: MONO }));
      svgRoot.appendChild(core.svgText(20, 50, scn.code[1], { 'font-size': 11, fill: mute, style: MONO }));

      /* ---- 상단: 공유 상태 패널 ---- */
      var cbX = hasMutex ? 300 : 365;
      var raceNow = st.race && !isEnd;
      svgRoot.appendChild(box(cbX, 12, 170, 50, {
        fill: raceNow ? 'color-mix(in srgb, ' + RED + ' 16%, transparent)' : sunken,
        stroke: raceNow ? RED : border, 'stroke-width': raceNow ? 2.5 : 1.2
      }));
      svgRoot.appendChild(core.svgText(cbX + 85, 28, '공유 변수 (메모리)', { 'text-anchor': 'middle', 'font-size': 10, fill: mute }));
      svgRoot.appendChild(core.svgText(cbX + 85, 50, 'counter = ' + st.counter, {
        'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700,
        fill: raceNow ? RED : fg, style: MONO
      }));
      if (raceNow) {
        svgRoot.appendChild(core.svgText(cbX + 85, 78, 'T1의 +1 이 사라졌다!', { 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: RED }));
      }
      if (hasMutex) {
        var owner = st.owner;
        svgRoot.appendChild(box(520, 12, 200, 50, {
          fill: owner ? 'color-mix(in srgb, ' + TCOL[owner] + ' 14%, transparent)' : sunken,
          stroke: owner ? TCOL[owner] : border, 'stroke-width': owner ? 1.8 : 1.2
        }));
        svgRoot.appendChild(core.svgText(620, 28, '뮤텍스', { 'text-anchor': 'middle', 'font-size': 10, fill: mute }));
        svgRoot.appendChild(core.svgText(620, 50,
          owner ? '🔒 보유: ' + owner : '🔓 풀림',
          { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: owner ? TCOL[owner] : soft, style: MONO }));
      }

      /* ---- 현재 스텝 칸 하이라이트 (세로 띠) ---- */
      if (ev._col !== undefined) {
        var hw = colW * (ev._span || 1);
        svgRoot.appendChild(core.svg('rect', {
          x: colX(ev._col) - 3, y: 128, width: hw, height: 192, rx: 8,
          fill: core.themeColor('--accent-soft', '#eaf1fe'), opacity: 0.8
        }));
      }

      /* ---- 스레드 레인 2개 ---- */
      ['T1', 'T2'].forEach(function (th) {
        var y = LANE[th];
        svgRoot.appendChild(box(X0 - 6, y, X1 - X0 + 12, 52, { fill: sunken, opacity: 0.45, stroke: 'none' }));
        svgRoot.appendChild(core.svgText(24, y + 32, th, { 'font-size': 13, 'font-weight': 700, fill: TCOL[th], style: MONO }));
        // 스레드별 레지스터 — "메모리와 별개의 사본"이 레이스의 원흉임을 상시 노출.
        var rv = st.reg[th];
        svgRoot.appendChild(box(762, y + 8, 126, 36, { fill: sunken, stroke: TCOL[th], 'stroke-width': 1.2, opacity: 0.95 }));
        svgRoot.appendChild(core.svgText(825, y + 31, 'reg = ' + (rv === null ? '?' : rv), {
          'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: fg, style: MONO
        }));
      });

      /* ---- 락 보유 구간 밑줄 띠 ---- */
      holds.forEach(function (hd) {
        var x = colX(hd.c1), w = colX(hd.c2) + colW - 6 - x;
        svgRoot.appendChild(core.svg('rect', {
          x: x, y: LANE[hd.t] + 45, width: w, height: 4, rx: 2,
          fill: TCOL[hd.t], opacity: i >= hd.step ? 0.85 : 0.2
        }));
      });

      /* ---- 연산 블록 ---- */
      events.forEach(function (e, k) {
        if (e._col === undefined) return;
        var y = LANE[e.t];
        var span = e._span || 1;
        var x = colX(e._col), w = colW * span - 6;
        var cur = k === i, future = k > i;
        var c = e.race ? RED : TCOL[e.t];          // 덮어쓰는 store 는 항상 빨강
        var g = core.svg('g', { opacity: future ? 0.3 : 1 });

        if (e.op === 'wait') {
          g.appendChild(core.svg('rect', { x: x, y: y + 6, width: w, height: 38, rx: 6, fill: sunken }));
          g.appendChild(core.svg('rect', {
            x: x, y: y + 6, width: w, height: 38, rx: 6,
            fill: 'url(#' + pid + ')',
            stroke: cur ? fg : mute, 'stroke-width': cur ? 2.5 : 1.2, 'stroke-dasharray': cur ? null : '4 3'
          }));
        } else {
          // lock/unlock 은 배경을 진하게 — "여기부터 보호 구간"이 칸 자체로 읽히게.
          var mix = (e.op === 'lock' || e.op === 'unlock') ? 55 : (cur ? 45 : 26);
          g.appendChild(core.svg('rect', {
            x: x, y: y + 6, width: w, height: 38, rx: 6,
            fill: 'color-mix(in srgb, ' + c + ' ' + mix + '%, transparent)',
            stroke: cur ? fg : c, 'stroke-width': cur ? 2.5 : 1.2
          }));
        }
        g.appendChild(core.svgText(x + w / 2, y + 30, OP_LABEL[e.op], {
          'text-anchor': 'middle', 'font-size': 11, 'font-weight': cur ? 700 : 500,
          fill: e.race ? (future ? RED : fg) : fg, style: MONO
        }));
        svgRoot.appendChild(g);
      });

      /* ---- 시간축 칸 번호 ---- */
      for (var c = 0; c < nCols; c++) {
        svgRoot.appendChild(core.svgText(colX(c) + (colW - 6) / 2, 310, String(c + 1), { 'text-anchor': 'middle', 'font-size': 10, fill: mute }));
      }
      svgRoot.appendChild(core.svgText(X0 - 14, 310, '시간 →', { 'text-anchor': 'end', 'font-size': 10, fill: mute }));

      /* ---- 하단: 결과 요약 ---- */
      var fin = states[states.length - 1].counter;
      if (isEnd) {
        var ok = fin === 2;
        var rc = ok ? GREEN : RED;
        svgRoot.appendChild(box(295, 328, 310, 44, {
          fill: 'color-mix(in srgb, ' + rc + ' 12%, transparent)', stroke: rc, 'stroke-width': 2
        }));
        svgRoot.appendChild(core.svgText(450, 355,
          '기대값 2 · 실제값 ' + fin + (ok ? ' ✓' : ' ✗'),
          { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: rc, style: MONO }));
      } else {
        svgRoot.appendChild(core.svgText(450, 355, '기대값 2 · 실제값 ?', { 'text-anchor': 'middle', 'font-size': 12, fill: mute, style: MONO }));
      }

      var badge = ev.t ? '<code>' + ev.t + '</code> ' : '';
      f.setCaption(badge + ev.cap);
    }

    var pl = core.player(mountEl, { total: events.length, render: render, autoMs: 1400 });
  }

  WIDGETS['thread-timeline'] = {
    mount: function (mountEl, params) {
      var key = params && SCENARIOS[params.scenario] ? params.scenario : 'race';
      buildWidget(mountEl, key);
    }
  };
})(this);
