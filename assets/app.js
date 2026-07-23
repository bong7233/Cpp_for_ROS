/* app.js — 라우팅, 목차, 검색, 진도, 테마, 위젯 마운트, 용어 사전 */
(function () {
  'use strict';

  var BOOK = window.BOOK || { toc: [], docs: {}, glossary: [] };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var LS = {
    get: function (k, d) {
      try { var v = localStorage.getItem('cppbook:' + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('cppbook:' + k, JSON.stringify(v)); } catch (e) { /* 사생활 모드 등 */ }
    }
  };

  /* ---------- 평탄화된 챕터 목록 ---------- */
  var CHAPTERS = [];
  BOOK.toc.forEach(function (part) {
    (part.chapters || []).forEach(function (ch) {
      CHAPTERS.push({
        id: ch.id, title: ch.title, num: ch.num, desc: ch.desc || '',
        partId: part.id, partTitle: part.title, partNum: part.num
      });
    });
  });
  var BY_ID = {};
  CHAPTERS.forEach(function (c, i) { c.index = i; BY_ID[c.id] = c; });

  /* ---------- 진도 ---------- */
  var done = LS.get('done', {});
  function isDone(id) { return !!done[id]; }
  function setDone(id, v) {
    if (v) done[id] = 1; else delete done[id];
    LS.set('done', done);
    renderProgress();
    syncTocDone();
  }
  function doneCount() { return CHAPTERS.filter(function (c) { return isDone(c.id); }).length; }

  function renderProgress() {
    var total = CHAPTERS.length || 1;
    var n = doneCount();
    var pct = Math.round(n / total * 100);
    var fg = $('.ps-fg');
    if (fg) fg.style.strokeDashoffset = String(100 - pct);
    $('#ps-pct').textContent = pct + '%';
    $('#ps-sub').textContent = n + ' / ' + CHAPTERS.length + ' 절 완료';
  }

  function syncTocDone() {
    $$('.toc-link').forEach(function (a) {
      a.classList.toggle('done', isDone(a.dataset.id));
    });
    $$('.toc-part').forEach(function (el) {
      var links = $$('.toc-link', el);
      var d = links.filter(function (a) { return isDone(a.dataset.id); }).length;
      var c = $('.toc-part-count', el);
      if (c) c.textContent = d + '/' + links.length;
    });
  }

  /* ---------- 목차 ---------- */
  function buildToc() {
    var collapsed = LS.get('collapsed', {});
    var html = BOOK.toc.map(function (part) {
      if (!part.chapters || !part.chapters.length) return '';
      var isCol = !!collapsed[part.id];
      var links = part.chapters.map(function (ch) {
        return '<a class="toc-link" href="#/' + ch.id + '" data-id="' + ch.id + '" data-search="' +
          escAttr((ch.num + ' ' + ch.title).toLowerCase()) + '">' +
          '<span class="toc-num">' + ch.num + '</span>' +
          '<span class="toc-text">' + escHtml(ch.title) + '</span></a>';
      }).join('');
      return '<div class="toc-part' + (isCol ? ' collapsed' : '') + '" data-part="' + part.id + '">' +
        '<button class="toc-part-head" type="button">' +
        '<span class="toc-caret"><svg viewBox="0 0 10 10"><path d="M1 3l4 4 4-4z"/></svg></span>' +
        '<span class="toc-part-title">' + escHtml(part.title) + '</span>' +
        '<span class="toc-part-count"></span>' +
        '</button><div class="toc-part-body">' + links + '</div></div>';
    }).join('');
    $('#toc').innerHTML = html || '<div class="toc-empty">아직 목차가 없습니다.</div>';

    $$('.toc-part-head').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var part = btn.closest('.toc-part');
        var col = part.classList.toggle('collapsed');
        var c = LS.get('collapsed', {});
        if (col) c[part.dataset.part] = 1; else delete c[part.dataset.part];
        LS.set('collapsed', c);
      });
    });
    syncTocDone();
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

  /* 목차 필터 */
  function initTocFilter() {
    var input = $('#toc-filter');
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) {
        $$('.toc-link').forEach(function (a) { a.style.display = ''; });
        $$('.toc-part').forEach(function (p) { p.style.display = ''; });
        return;
      }
      $$('.toc-part').forEach(function (p) {
        p.classList.remove('collapsed');
        var any = false;
        $$('.toc-link', p).forEach(function (a) {
          var hit = a.dataset.search.indexOf(q) !== -1;
          a.style.display = hit ? '' : 'none';
          if (hit) any = true;
        });
        p.style.display = any ? '' : 'none';
      });
    });
  }

  /* ---------- 라우팅 ---------- */
  function currentRoute() {
    // 브라우저는 한글 앵커를 퍼센트 인코딩해 저장한다. getElementById 는
    // 디코딩된 원문 id 를 찾으므로 여기서 되돌려 놔야 한다.
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('#');
    return { id: decode(parts[0]), anchor: decode(parts[1]) };
  }

  function decode(s) {
    if (!s) return '';
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function render() {
    var r = currentRoute();
    closeNav();

    if (r.id === 'glossary') {
      renderGlossary();
      document.title = '용어 사전 — C++ 완전 정복';
      highlightToc(null);
      scrollToTop();
      return;
    }
    if (!r.id || !BY_ID[r.id]) {
      renderHome();
      document.title = 'C++ 완전 정복 — 언어 코어부터 ROS 2 로봇 제어까지';
      highlightToc(null);
      scrollToTop();
      return;
    }
    renderChapter(BY_ID[r.id], r.anchor);
  }

  function renderHome() {
    var totalWords = 0;
    Object.keys(BOOK.docs).forEach(function (k) { totalWords += (BOOK.docs[k] || '').length; });
    var pages = Math.round(totalWords / 1800);
    var partsHtml = BOOK.toc.map(function (part) {
      var chs = part.chapters || [];
      var d = chs.filter(function (c) { return isDone(c.id); }).length;
      var pct = chs.length ? Math.round(d / chs.length * 100) : 0;
      var ready = chs.filter(function (c) { return BOOK.docs[c.id]; }).length;
      var badge = !chs.length ? '<span class="pc-badge">준비 중</span>'
        : ready < chs.length ? '<span class="pc-badge wip">집필 중 ' + ready + '/' + chs.length + '</span>'
        : '<span class="pc-badge ok">' + chs.length + '절</span>';
      var href = chs.length ? '#/' + chs[0].id : '#/';
      return '<a class="part-card" href="' + href + '">' +
        '<div class="pc-top"><span class="pc-kicker">' + escHtml(part.num || '') + '</span>' + badge + '</div>' +
        '<div class="pc-title">' + escHtml(part.title) + '</div>' +
        '<div class="pc-desc">' + escHtml(part.desc || '') + '</div>' +
        '<div class="pc-bar"><i style="width:' + pct + '%"></i></div>' +
        '</a>';
    }).join('');

    var last = LS.get('last', null);
    var resume = last && BY_ID[last]
      ? '<a class="btn-primary" href="#/' + last + '">이어서 읽기 → ' + escHtml(BY_ID[last].title) + '</a>'
      : (CHAPTERS[0] ? '<a class="btn-primary" href="#/' + CHAPTERS[0].id + '">처음부터 시작하기</a>' : '');

    $('#content').innerHTML =
      '<div class="home-hero">' +
      '<div class="home-kicker">' + (BOOK.meta && BOOK.meta.std || 'C++20') + ' 기준 · 인터랙티브 가이드북</div>' +
      '<h1 class="home-title">C++ 완전 정복</h1>' +
      '<p class="home-sub">컴파일 모델부터 메모리와 소유권, 동시성, 그리고 ROS 2로 로봇을 움직이는 데까지. ' +
      '조작할 수 있는 시각 위젯으로 공간적 개념을 몸에 새기고, 코드는 당신의 IDE에서 직접 친다.</p>' +
      '<div class="home-stats">' +
      stat(BOOK.toc.length, '부(Part)') +
      stat(CHAPTERS.length, '절(Chapter)') +
      stat('~' + pages.toLocaleString(), '페이지 분량') +
      stat(doneCount(), '완료한 절') +
      '</div>' +
      '<div class="home-cta">' + resume +
      '<button class="btn-ghost" id="home-search">🔍 전체 검색</button></div>' +
      '</div>' +
      '<h2 class="hd hd2" id="parts">구성</h2>' +
      '<div class="part-grid">' + partsHtml + '</div>';

    $('#pager').innerHTML = '';
    $('#outline-list').innerHTML = '';
    $('#outline').classList.add('hidden');
    var hs = $('#home-search');
    if (hs) hs.addEventListener('click', openSearch);
  }

  function stat(n, l) {
    return '<div class="stat"><div class="stat-num">' + n + '</div><div class="stat-lbl">' + l + '</div></div>';
  }

  function renderChapter(ch, anchor) {
    var src = BOOK.docs[ch.id];
    LS.set('last', ch.id);

    if (!src) {
      $('#content').innerHTML =
        '<div class="ch-meta"><span class="ch-part">' + escHtml(ch.partTitle) + '</span></div>' +
        '<h1 class="hd hd1">' + escHtml(ch.num + ' ' + ch.title) + '</h1>' +
        '<div class="callout callout-warn"><div class="co-head"><span class="co-icon">🚧</span>' +
        '<span class="co-label">아직 집필 전</span></div><div class="co-body"><p>' +
        escHtml(ch.desc || '이 절은 다음 단계에서 채웁니다.') + '</p></div></div>';
      $('#outline-list').innerHTML = '';
      $('#outline').classList.add('hidden');
      renderPager(ch);
      highlightToc(ch.id);
      document.title = ch.num + ' ' + ch.title + ' — C++ 완전 정복';
      scrollToTop();
      return;
    }

    var res = window.MD.render(src);
    var words = window.MD.toText(src).length;
    var minutes = Math.max(1, Math.round(words / 500));

    $('#content').innerHTML =
      '<div class="ch-meta">' +
      '<span class="ch-part">' + escHtml(ch.partTitle) + '</span>' +
      '<span class="ch-dot">·</span>' +
      '<span class="ch-read">읽는 데 약 ' + minutes + '분</span>' +
      '</div>' + res.html +
      '<div id="done-bar"><button id="btn-done" type="button"></button></div>';

    // 아웃라인
    if (res.headings.length > 1) {
      $('#outline-list').innerHTML = res.headings.map(function (h) {
        return '<a class="outline-link lvl' + h.level + '" href="#/' + ch.id + '#' + h.id + '" data-target="' + h.id + '">' +
          escHtml(h.text) + '</a>';
      }).join('');
      $('#outline').classList.remove('hidden');
    } else {
      $('#outline-list').innerHTML = '';
      $('#outline').classList.add('hidden');
    }

    renderPager(ch);
    highlightToc(ch.id);
    bindDoneButton(ch);
    mountWidgets($('#content'));
    document.title = ch.num + ' ' + ch.title + ' — C++ 완전 정복';

    if (anchor && scrollToAnchor(anchor)) return;
    scrollToTop();
  }

  /* ---------- 위젯 마운트 ---------- */
  // 렌더러(markdown.js)는 자리만 만든다. 실제 마운트는 챕터가 DOM에 들어간
  // 뒤에 해야 위젯이 자기 크기를 측정할 수 있어서 여기서 한다.
  function mountWidgets(root) {
    $$('.widget-mount', root).forEach(function (el) {
      var type = el.dataset.widgetType;
      var reg = (window.WIDGETS || {})[type];
      var params = {};
      var raw = el.dataset.widgetParams || '';
      if (raw.trim()) {
        try { params = JSON.parse(raw); }
        catch (err) {
          el.innerHTML = '<div class="widget-fallback widget-error">⚠️ 위젯 <code>' + escHtml(type) +
            '</code> 파라미터 JSON 오류: ' + escHtml(String(err.message || err)) + '</div>';
          return;
        }
      }
      if (!reg || typeof reg.mount !== 'function') {
        // 콘텐츠가 위젯보다 먼저 쓰인 경우(마일스톤 순서상 정상) — 조용히 자리 표시.
        el.innerHTML = '<div class="widget-fallback">🧩 인터랙티브 위젯 <code>' + escHtml(type) + '</code> — 구현 예정</div>';
        return;
      }
      try {
        el.innerHTML = '';
        reg.mount(el, params);
        el.classList.add('widget-ready');
      } catch (err) {
        el.innerHTML = '<div class="widget-fallback widget-error">⚠️ 위젯 <code>' + escHtml(type) +
          '</code> 마운트 실패: ' + escHtml(String(err.message || err)) + '</div>';
      }
    });
  }

  /* ---------- 용어 사전 ---------- */
  function renderGlossary() {
    var terms = (BOOK.glossary || []).slice();
    // 가나다·알파벳 혼합 정렬 — localeCompare 가 한글을 앞에, 라틴을 뒤에 둔다.
    terms.sort(function (a, b) { return a.term.localeCompare(b.term, 'ko'); });

    var rows = terms.map(function (t) {
      var ch = BY_ID[t.chapter];
      var link = ch
        ? '<a class="gl-src" href="#/' + ch.id + '">' + escHtml(ch.num + ' ' + ch.title) + '</a>'
        : '';
      return '<div class="gl-row" data-search="' + escAttr((t.term + ' ' + t.def).toLowerCase()) + '">' +
        '<div class="gl-term">' + escHtml(t.term) + '</div>' +
        '<div class="gl-def">' + escHtml(t.def) + ' ' + link + '</div></div>';
    }).join('');

    $('#content').innerHTML =
      '<div class="ch-meta"><span class="ch-part">참고 자료</span></div>' +
      '<h1 class="hd hd1">용어 사전</h1>' +
      '<p>이 책에서 처음 정의한 용어를 모았다. 항목을 클릭하면 최초 정의 챕터로 이동한다.</p>' +
      '<input id="gl-filter" type="search" placeholder="용어 검색… (예: vtable, RAII)" autocomplete="off" spellcheck="false">' +
      (terms.length
        ? '<div id="gl-list">' + rows + '</div>'
        : '<div class="callout callout-note"><div class="co-head"><span class="co-icon">📌</span>' +
          '<span class="co-label">아직 비어 있음</span></div><div class="co-body"><p>용어는 챕터 집필과 동시에 쌓인다.</p></div></div>');

    $('#pager').innerHTML = '';
    $('#outline-list').innerHTML = '';
    $('#outline').classList.add('hidden');

    var inp = $('#gl-filter');
    if (inp) inp.addEventListener('input', function () {
      var q = inp.value.trim().toLowerCase();
      $$('.gl-row').forEach(function (row) {
        row.style.display = !q || row.dataset.search.indexOf(q) !== -1 ? '' : 'none';
      });
    });
  }

  // 라우트 이동은 항상 즉시 이동해야 한다. CSS 의 scroll-behavior: smooth 가
  // 걸려 있으면 인자 두 개짜리 scrollTo(0, 0) 는 애니메이션으로 처리되고,
  // 일부 환경에서는 아예 무시된다.
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // scrollIntoView() 는 sticky 헤더에 가려지는 데다 smooth 와 겹치면 무동작인
  // 환경이 있다. 목표 위치를 직접 계산해서 옮긴다.
  //
  // 최초 로드 때는 브라우저가 '#/id#anchor' 를 자기 방식대로 조각으로 해석하려다
  // 실패하고 맨 위로 되돌린다. 그래서 다음 프레임과 load 이후에 한 번 더 적용한다.
  function scrollToAnchor(anchor) {
    if (!document.getElementById(anchor)) return false;
    function go() {
      var el = document.getElementById(anchor);
      if (!el) return;
      var bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 52;
      var top = el.getBoundingClientRect().top + window.scrollY - bar - 14;
      window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    }
    go();
    requestAnimationFrame(go);
    if (document.readyState !== 'complete') window.addEventListener('load', go, { once: true });
    return true;
  }

  function bindDoneButton(ch) {
    var btn = $('#btn-done');
    function paint() {
      var d = isDone(ch.id);
      btn.classList.toggle('done', d);
      btn.textContent = d ? '✓ 이 절을 완료했습니다 (되돌리기)' : '이 절을 완료로 표시';
    }
    paint();
    btn.addEventListener('click', function () {
      setDone(ch.id, !isDone(ch.id));
      paint();
    });
  }

  function renderPager(ch) {
    var prev = CHAPTERS[ch.index - 1];
    var next = CHAPTERS[ch.index + 1];
    var html = '';
    html += prev
      ? '<a class="pager-link prev" href="#/' + prev.id + '"><span class="pager-dir">← 이전</span>' +
        '<span class="pager-title">' + escHtml(prev.num + ' ' + prev.title) + '</span></a>'
      : '<span class="pager-link pager-spacer"></span>';
    html += next
      ? '<a class="pager-link next" href="#/' + next.id + '"><span class="pager-dir">다음 →</span>' +
        '<span class="pager-title">' + escHtml(next.num + ' ' + next.title) + '</span></a>'
      : '<span class="pager-link pager-spacer"></span>';
    $('#pager').innerHTML = html;
  }

  function highlightToc(id) {
    $$('.toc-link').forEach(function (a) {
      var on = a.dataset.id === id;
      a.classList.toggle('active', on);
      if (on) {
        var part = a.closest('.toc-part');
        if (part) part.classList.remove('collapsed');
        var box = $('#toc');
        var top = a.offsetTop - box.clientHeight / 2;
        if (a.offsetTop < box.scrollTop || a.offsetTop > box.scrollTop + box.clientHeight - 40) {
          box.scrollTop = Math.max(0, top);
        }
      }
    });
  }

  /* ---------- 검색 ---------- */
  var INDEX = null;
  function buildIndex() {
    if (INDEX) return INDEX;
    INDEX = [];
    CHAPTERS.forEach(function (ch) {
      var src = BOOK.docs[ch.id];
      if (!src) return;
      // 절(h2) 단위로 쪼개 색인한다 — 결과가 문서 전체가 아니라 해당 절로 바로 가도록.
      var sections = splitSections(src);
      sections.forEach(function (sec) {
        var text = window.MD.toText(sec.body);
        INDEX.push({
          chId: ch.id, chNum: ch.num, chTitle: ch.title, partTitle: ch.partTitle,
          anchor: sec.id, title: sec.title || (ch.num + ' ' + ch.title),
          text: text, lower: text.toLowerCase(),
          titleLower: (ch.num + ' ' + ch.title + ' ' + (sec.title || '')).toLowerCase()
        });
      });
    });
    return INDEX;
  }

  function splitSections(src) {
    var lines = src.split('\n');
    var out = [];
    var cur = { title: '', id: '', body: [] };
    var inFence = false;
    lines.forEach(function (ln) {
      if (/^\s*(?:```|~~~)/.test(ln)) inFence = !inFence;
      var m = !inFence && /^##\s+(.*)$/.exec(ln);
      if (m) {
        if (cur.body.length) out.push({ title: cur.title, id: cur.id, body: cur.body.join('\n') });
        var t = m[1].replace(/\s*\{#([\w-]+)\}\s*$/, '');
        var idm = /\{#([\w-]+)\}\s*$/.exec(m[1]);
        cur = { title: t, id: idm ? idm[1] : window.MD.slugify(t), body: [] };
      } else {
        cur.body.push(ln);
      }
    });
    if (cur.body.length) out.push({ title: cur.title, id: cur.id, body: cur.body.join('\n') });
    return out;
  }

  function search(q) {
    var idx = buildIndex();
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var hits = [];
    idx.forEach(function (e) {
      var score = 0;
      var ok = terms.every(function (t) {
        var inTitle = e.titleLower.indexOf(t) !== -1;
        var pos = e.lower.indexOf(t);
        if (inTitle) score += 12;
        if (pos !== -1) {
          score += 3;
          // 등장 횟수 (상한을 둬서 긴 절이 무조건 이기지 않게)
          var c = 0, p = pos;
          while (p !== -1 && c < 8) { c++; p = e.lower.indexOf(t, p + t.length); }
          score += c;
        }
        return inTitle || pos !== -1;
      });
      if (ok) hits.push({ e: e, score: score, term: terms[0] });
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, 40);
  }

  function snippet(text, term) {
    var i = text.toLowerCase().indexOf(term);
    if (i === -1) return escHtml(text.slice(0, 130));
    var s = Math.max(0, i - 55);
    var frag = text.slice(s, s + 165);
    return (s > 0 ? '… ' : '') + escHtml(frag).replace(new RegExp('(' + escRe(term) + ')', 'ig'), '<mark>$1</mark>') + ' …';
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var searchSel = 0;
  function runSearch() {
    var q = $('#search-input').value.trim();
    var box = $('#search-results');
    if (!q) { box.innerHTML = '<div class="sr-empty">키워드를 입력하세요.</div>'; return; }
    var hits = search(q);
    if (!hits.length) { box.innerHTML = '<div class="sr-empty">‘' + escHtml(q) + '’ 에 대한 결과가 없습니다.</div>'; return; }
    searchSel = 0;
    box.innerHTML = hits.map(function (h, i) {
      var e = h.e;
      var href = '#/' + e.chId + (e.anchor ? '#' + e.anchor : '');
      return '<a class="sr-item' + (i === 0 ? ' sel' : '') + '" href="' + href + '">' +
        '<div class="sr-crumb">' + escHtml(e.partTitle + ' › ' + e.chNum + ' ' + e.chTitle) + '</div>' +
        '<div class="sr-title">' + escHtml(e.title) + '</div>' +
        '<div class="sr-snip">' + snippet(e.text, h.term) + '</div></a>';
    }).join('');
    box.scrollTop = 0;
  }

  function moveSel(d) {
    var items = $$('.sr-item');
    if (!items.length) return;
    items[searchSel].classList.remove('sel');
    searchSel = (searchSel + d + items.length) % items.length;
    items[searchSel].classList.add('sel');
    items[searchSel].scrollIntoView({ block: 'nearest' });
  }

  function openSearch() {
    $('#search-overlay').hidden = false;
    var inp = $('#search-input');
    inp.focus(); inp.select();
    if (!$('#search-results').innerHTML) runSearch();
  }
  function closeSearch() { $('#search-overlay').hidden = true; }

  /* ---------- 내비 (모바일) ---------- */
  function openNav() { document.body.classList.add('nav-open'); }
  function closeNav() { document.body.classList.remove('nav-open'); }

  /* ---------- 테마 / 글자 크기 ---------- */
  function initTheme() {
    var t = LS.get('theme', 'auto');
    document.documentElement.dataset.theme = t;
    $('#btn-theme').addEventListener('click', function () {
      var order = ['auto', 'light', 'dark'];
      var cur = document.documentElement.dataset.theme;
      var next = order[(order.indexOf(cur) + 1) % order.length];
      document.documentElement.dataset.theme = next;
      LS.set('theme', next);
      $('#btn-theme').title = '테마: ' + ({ auto: '시스템', light: '밝게', dark: '어둡게' })[next];
    });
  }

  var SIZES = [15, 16, 17, 18, 19];
  function initFont() {
    var i = LS.get('fontIdx', 1);
    apply(i);
    $('#btn-font').addEventListener('click', function () {
      i = (i + 1) % SIZES.length;
      apply(i);
      LS.set('fontIdx', i);
    });
    function apply(k) {
      document.documentElement.style.setProperty('--fs-root', SIZES[k] + 'px');
      $('#btn-font').title = '글자 크기: ' + SIZES[k] + 'px';
    }
  }

  /* ---------- 읽기 진행 바 + 아웃라인 스파이 ---------- */
  function initScrollSpy() {
    var fill = $('#scrollbar-progress-fill');
    var ticking = false;
    function update() {
      ticking = false;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      fill.style.width = (h > 0 ? Math.min(100, window.scrollY / h * 100) : 0) + '%';

      var links = $$('.outline-link');
      if (!links.length) return;
      var best = null;
      links.forEach(function (a) {
        var el = document.getElementById(a.dataset.target);
        if (!el) return;
        if (el.getBoundingClientRect().top <= 90) best = a;
      });
      links.forEach(function (a) { a.classList.toggle('active', a === best); });
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ---------- 이벤트 ---------- */
  function initEvents() {
    $('#btn-menu').addEventListener('click', function () {
      document.body.classList.toggle('nav-open');
    });
    $('#scrim').addEventListener('click', closeNav);
    $('#btn-search').addEventListener('click', openSearch);
    $('#search-overlay').addEventListener('click', function (e) {
      if (e.target === $('#search-overlay')) closeSearch();
    });
    $('#search-input').addEventListener('input', runSearch);
    $('#search-input').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter') {
        var sel = $('.sr-item.sel');
        if (sel) { location.hash = sel.getAttribute('href'); closeSearch(); }
      }
    });
    $('#search-results').addEventListener('click', function (e) {
      if (e.target.closest('.sr-item')) closeSearch();
    });

    $('#btn-reset').addEventListener('click', function () {
      if (!confirm('학습 진도를 모두 지울까요? 되돌릴 수 없습니다.')) return;
      done = {}; LS.set('done', done);
      renderProgress(); syncTocDone(); render();
    });

    // 코드 복사
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.code-copy');
      if (!btn) return;
      var fig = btn.closest('.code-block');
      var raw = $('.code-raw', fig);
      var text = raw ? raw.value : '';
      var ok = function () {
        btn.textContent = '복사됨 ✓';
        btn.classList.add('copied');
        setTimeout(function () { btn.textContent = '복사'; btn.classList.remove('copied'); }, 1400);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(ok, function () { legacyCopy(raw, ok); });
      } else {
        legacyCopy(raw, ok);
      }
    });

    // 제목 앵커 복사
    document.addEventListener('click', function (e) {
      var a = e.target.closest('.anchor');
      if (!a) return;
      e.preventDefault();
      var r = currentRoute();
      location.hash = '#/' + r.id + '#' + a.dataset.anchor;
    });

    window.addEventListener('hashchange', render);

    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') {
        if (!$('#search-overlay').hidden) { closeSearch(); return; }
        if (document.body.classList.contains('nav-open')) { closeNav(); return; }
      }
      if (typing) return;
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'k')) { e.preventDefault(); openSearch(); }
      else if (e.key === '[') { var p = $('.pager-link.prev'); if (p && p.href) location.hash = p.getAttribute('href'); }
      else if (e.key === ']') { var n = $('.pager-link.next'); if (n && n.href) location.hash = n.getAttribute('href'); }
    });
  }

  function legacyCopy(raw, ok) {
    if (!raw) return;
    raw.hidden = false;
    raw.select();
    try { document.execCommand('copy'); ok(); } catch (err) { alert('복사에 실패했습니다. 직접 선택해 주세요.'); }
    raw.hidden = true;
  }

  /* ---------- 시작 ---------- */
  function init() {
    // SPA 라우터가 스크롤을 직접 관리한다. 브라우저의 자동 복원을 켜 두면
    // 새로고침 때 우리가 옮긴 위치를 덮어써 버린다.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    buildToc();
    initTocFilter();
    initTheme();
    initFont();
    initEvents();
    initScrollSpy();
    renderProgress();
    render();
    document.body.classList.add('ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
