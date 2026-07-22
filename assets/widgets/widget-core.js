/* widget-core.js — 인터랙티브 위젯 공통 기반 (의존성 없음)
 *
 * 모든 위젯은 이 파일이 제공하는 헬퍼 위에서 구현한다.
 *
 * 위젯 등록 계약:
 *   WIDGETS['<type>'] = { mount: function (mountEl, params) { ... } };
 *   - mountEl: 빈 .widget-mount div (app.js 가 내용을 비운 뒤 넘긴다)
 *   - params : 콘텐츠의 ::: widget 블록 안 JSON (없으면 {})
 *   - 마운트는 동기적으로 완료한다. 외부 리소스 로드 금지 (오프라인 원칙).
 *
 * 왜 requestAnimationFrame 연속 재생이 아니라 스텝 기반인가:
 * 학습 위젯의 목적은 "지금 정확히 무슨 일이 일어났는가"를 멈춰서 읽는 것이다.
 * 각 스텝을 인덱스 i 의 순수 함수 render(i) 로 그리면 되감기·임의 접근(슬라이더)·
 * 상태 재현이 공짜로 따라온다. 연속 애니메이션은 그게 안 된다. 자동 재생은
 * 단지 setInterval 로 스텝을 넘겨주는 겉껍데기일 뿐이다.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS = global.WIDGETS || {};
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- DOM 헬퍼 ---------- */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function svg(tag, attrs, children) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  function svgText(x, y, str, attrs) {
    var t = svg('text', Object.assign({ x: x, y: y }, attrs || {}));
    t.textContent = str;
    return t;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 표준 위젯 프레임 ---------- */
  // head(아이콘+제목) / body(스테이지) / caption(현재 스텝 설명) / controls(재생 조작)
  // 구조를 통일하면 독자가 위젯마다 조작법을 새로 배울 필요가 없다.
  function frame(mountEl, opts) {
    opts = opts || {};
    var head = el('div', 'widget-head',
      '<span class="w-icon">' + (opts.icon || '🧩') + '</span><span>' + esc(opts.title || '') + '</span>');
    var body = el('div', 'widget-body');
    var caption = el('div', 'w-caption');
    mountEl.appendChild(head);
    mountEl.appendChild(body);
    mountEl.appendChild(caption);
    return {
      mount: mountEl,
      body: body,
      caption: caption,
      setCaption: function (html) { caption.innerHTML = html || ''; }
    };
  }

  /* ---------- 스텝 플레이어 ---------- */
  // opts: { total: 스텝 수(상태는 0..total-1), render(i), autoMs(자동재생 간격, 기본 1200) }
  // 반환: { index, goto(i), next, prev, controls(DOM), destroy }
  function player(mountEl, opts) {
    var total = Math.max(1, opts.total | 0);
    var autoMs = opts.autoMs || 1200;
    var idx = 0;
    var timer = null;

    var controls = el('div', 'widget-controls');
    var btnFirst = el('button', 'w-btn', '⏮ 처음');
    var btnPrev = el('button', 'w-btn', '◀ 이전');
    var btnPlay = el('button', 'w-btn primary', '▶ 재생');
    var btnNext = el('button', 'w-btn', '다음 ▶');
    var slider = el('input', 'w-slider');
    slider.type = 'range'; slider.min = 0; slider.max = total - 1; slider.value = 0;
    var label = el('span', 'w-step-label');

    [btnFirst, btnPrev, btnPlay, btnNext, slider, label].forEach(function (b) {
      controls.appendChild(b);
    });
    mountEl.appendChild(controls);

    function paint() {
      slider.value = idx;
      label.textContent = (idx + 1) + ' / ' + total;
      btnFirst.disabled = idx === 0;
      btnPrev.disabled = idx === 0;
      btnNext.disabled = idx === total - 1;
      opts.render(idx);
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; btnPlay.innerHTML = '▶ 재생'; }
    }

    function goto(i) {
      idx = Math.max(0, Math.min(total - 1, i | 0));
      paint();
    }

    btnFirst.addEventListener('click', function () { stop(); goto(0); });
    btnPrev.addEventListener('click', function () { stop(); goto(idx - 1); });
    btnNext.addEventListener('click', function () { stop(); goto(idx + 1); });
    slider.addEventListener('input', function () { stop(); goto(+slider.value); });
    btnPlay.addEventListener('click', function () {
      if (timer) { stop(); return; }
      if (idx === total - 1) goto(0);            // 끝에서 재생 누르면 처음부터
      btnPlay.innerHTML = '⏸ 멈춤';
      timer = setInterval(function () {
        if (idx >= total - 1) { stop(); return; }
        goto(idx + 1);
      }, autoMs);
    });

    paint();

    return {
      get index() { return idx; },
      goto: goto, next: function () { goto(idx + 1); }, prev: function () { goto(idx - 1); },
      stop: stop, controls: controls,
      destroy: stop
    };
  }

  /* ---------- 색상 토큰 ---------- */
  // CSS 변수를 읽어 라이트/다크 테마 어느 쪽에서도 위젯 색이 맞게 한다.
  function themeColor(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  WIDGETS._core = {
    el: el, svg: svg, svgText: svgText, esc: esc,
    frame: frame, player: player, themeColor: themeColor,
    SVG_NS: SVG_NS
  };
})(this);
