/* markdown.js — 이 책 전용 마크다운 렌더러 (의존성 없음)
 *
 * 지원 문법
 *   # ~ ##### 제목 (자동 앵커)
 *   ```lang title="..." 코드 펜스 (복사 버튼, 라인 강조 {2,4-6})
 *   ::: note|tip|warn|danger|deep|quiz|interview  제목
 *   ::: widget <type>  (다음 줄부터 ::: 까지 JSON 파라미터) — 인터랙티브 위젯 마운트 지점
 *   표, 목록(중첩), 인용, 수평선, 각주 없음
 *   **굵게** *기울임* `코드` ~~취소~~ [링크](url) ![이미지](url)
 *   $수식$ / $$수식$$  -> 스타일된 수식 텍스트 (KaTeX 없이 가독성 유지)
 */
(function (global) {
  'use strict';

  var HL = global.HL;
  var SEP = '\u0000';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~\[\]()]/g, '')
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'sec';
  }

  /* ---------------- 인라인 ---------------- */

  function inline(src) {
    var stash = [];
    function keep(html) {
      stash.push(html);
      return SEP + (stash.length - 1) + SEP;
    }

    // 1) 코드 스팬 보호
    src = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, ticks, code) {
      return keep('<code class="inline-code">' + esc(code.replace(/^ | $/g, '')) + '</code>');
    });

    // 2) 수식 보호
    src = src.replace(/\$\$([^$]+)\$\$/g, function (_, m) {
      return keep('<span class="math math-block">' + esc(m.trim()) + '</span>');
    });
    src = src.replace(/(?<![\\$])\$([^$\n]+?)\$(?!\$)/g, function (_, m) {
      return keep('<span class="math">' + esc(m.trim()) + '</span>');
    });

    // 3) 허용된 인라인 태그만 통과시킨다 (속성 없는 형태만 — 나머지는 전부 이스케이프)
    src = src.replace(/<\/?(?:kbd|sup|sub|small|abbr|br|u|em|strong)\s*\/?>/gi, function (m) {
      return keep(m);
    });

    // 4) 나머지 이스케이프
    src = esc(src);

    // 4) 이미지 / 링크
    src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, alt, url, title) {
      return '<img src="' + url + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + ' loading="lazy">';
    });
    src = src.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, text, url, title) {
      var ext = /^https?:/i.test(url);
      return '<a href="' + url + '"' + (title ? ' title="' + title + '"' : '') +
        (ext ? ' target="_blank" rel="noopener"' : '') + '>' + text + '</a>';
    });

    // 5) 강조
    src = src.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    src = src.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    src = src.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<em>$1</em>');
    src = src.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    src = src.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // 6) 줄바꿈 (두 칸 이상 공백 + 개행)
    src = src.replace(/ {2,}\n/g, '<br>\n');

    // 7) 복원
    return src.replace(new RegExp(SEP + '(\\d+)' + SEP, 'g'), function (_, i) {
      return stash[+i];
    });
  }

  /* ---------------- 코드 블록 ---------------- */

  var codeBlockSeq = 0;

  function parseHighlightSpec(spec) {
    var set = {};
    if (!spec) return set;
    spec.split(',').forEach(function (part) {
      var m = /^(\d+)-(\d+)$/.exec(part.trim());
      if (m) {
        for (var i = +m[1]; i <= +m[2]; i++) set[i] = true;
      } else if (/^\d+$/.test(part.trim())) {
        set[+part.trim()] = true;
      }
    });
    return set;
  }

  function renderCode(code, info) {
    info = (info || '').trim();
    var lang = (info.split(/\s+/)[0] || '').replace(/[{].*/, '');
    var titleMatch = /title="([^"]*)"/.exec(info);
    var hlMatch = /\{([\d,\-\s]+)\}/.exec(info);
    var noLines = /\bnolines\b/.test(info);
    var title = titleMatch ? titleMatch[1] : '';
    var hlSet = parseHighlightSpec(hlMatch ? hlMatch[1] : '');

    var body = code.replace(/\n$/, '');
    var html = HL ? HL.highlight(body, lang) : esc(body);
    var lines = html.split('\n');
    var isRepl = lang === 'repl' || lang === 'pyrepl' || lang === 'console';
    var showLines = !noLines && !isRepl && lines.length > 2;

    var rows = lines.map(function (ln, i) {
      var cls = 'code-line' + (hlSet[i + 1] ? ' code-line-hl' : '');
      return '<span class="' + cls + '">' +
        (showLines ? '<span class="code-ln">' + (i + 1) + '</span>' : '') +
        '<span class="code-tx">' + (ln || ' ') + '</span></span>';
    }).join('');

    var id = 'code-' + (++codeBlockSeq);
    var label = title || (lang ? LANG_LABEL[lang] || lang : '');

    return '<figure class="code-block' + (showLines ? ' has-lines' : '') + '" data-lang="' + esc(lang) + '">' +
      '<figcaption class="code-head">' +
      '<span class="code-title">' + esc(label) + '</span>' +
      '<button class="code-copy" data-target="' + id + '" type="button">복사</button>' +
      '</figcaption>' +
      '<pre class="code-pre"><code id="' + id + '" class="lang-' + esc(lang) + '">' + rows + '</code></pre>' +
      '<textarea class="code-raw" hidden>' + esc(body) + '</textarea>' +
      '</figure>';
  }

  var LANG_LABEL = {
    cpp: 'C++', c: 'C', cmake: 'CMake', bash: 'Shell', sh: 'Shell', console: '터미널',
    python: 'Python', json: 'JSON', yaml: 'YAML', xml: 'XML', js: 'JavaScript',
    text: 'Text', sql: 'SQL'
  };

  /* ---------------- 콜아웃 ---------------- */

  var CALLOUT = {
    note: { icon: '📌', label: '노트' },
    tip: { icon: '💡', label: '팁' },
    warn: { icon: '⚠️', label: '주의' },
    danger: { icon: '🚨', label: '함정' },
    deep: { icon: '🔬', label: '깊이 보기' },
    perf: { icon: '⚡', label: '성능' },
    quiz: { icon: '✏️', label: '연습문제' },
    answer: { icon: '✅', label: '해설' },
    interview: { icon: '🎤', label: '기술면접 포인트' },
    hist: { icon: '📜', label: '배경' }
  };

  /* ---------------- 블록 ---------------- */

  // 목록 마커. 그룹1=들여쓰기, 그룹2=불릿 문자(순서 있는 목록이면 undefined).
  // /g 플래그를 붙이면 lastIndex 가 남아 .test() 가 번갈아 실패하므로 절대 붙이지 말 것.
  var MARKER = /^(\s*)(?:([-*+])|\d+[.)])\s+/;

  function blocks(src, ctx) {
    var lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    var out = [];
    var i = 0;

    function blank(s) { return /^\s*$/.test(s); }

    while (i < lines.length) {
      var line = lines[i];

      if (blank(line)) { i++; continue; }

      // 코드 펜스
      var fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        var marker = fence[2][0];
        var len = fence[2].length;
        var info = fence[3];
        var buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{' + len + ',}\\s*$').test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        i++;
        out.push(renderCode(buf.join('\n'), info));
        continue;
      }

      // 콜아웃 :::
      var co = /^:::\s*([a-z]+)\s*(.*)$/.exec(line);
      if (co) {
        var kind = co[1];
        var coTitle = co[2].trim();
        var depth = 1;
        var cbuf = [];
        i++;
        while (i < lines.length) {
          if (/^:::\s*[a-z]+/.test(lines[i])) depth++;
          else if (/^:::\s*$/.test(lines[i])) { depth--; if (depth === 0) { i++; break; } }
          cbuf.push(lines[i]); i++;
        }
        if (kind === 'widget') {
          // 위젯 마운트 지점. 렌더 단계에서는 자리만 만들고, 실제 마운트는
          // app.js 가 챕터 삽입 후에 한다 — 렌더러가 위젯 구현을 몰라야
          // 위젯을 하나씩 추가할 때 이 파일을 다시 건드리지 않는다.
          var wm = /^([\w-]+)\s*([\s\S]*)$/.exec(coTitle || '');
          var wtype = wm ? wm[1] : '';
          var wjson = (((wm && wm[2]) || '') + '\n' + cbuf.join('\n')).trim();
          out.push('<div class="widget-mount" data-widget-type="' + esc(wtype) + '"' +
            ' data-widget-params="' + esc(wjson) + '">' +
            '<div class="widget-fallback">🧩 인터랙티브 위젯 <code>' + esc(wtype) + '</code> 준비 중</div></div>');
          continue;
        }
        var meta = CALLOUT[kind] || { icon: 'ℹ️', label: kind };
        var inner = blocks(cbuf.join('\n'), ctx);
        if (kind === 'lead') {
          // 챕터 머리말: 아이콘도 라벨도 없는 큰 도입부
          out.push('<div class="ch-lead">' + inner + '</div>');
        } else if (kind === 'answer') {
          out.push('<details class="callout callout-answer"><summary><span class="co-icon">' + meta.icon +
            '</span><span class="co-label">' + (coTitle || meta.label) + '</span></summary>' +
            '<div class="co-body">' + inner + '</div></details>');
        } else {
          out.push('<div class="callout callout-' + kind + '">' +
            '<div class="co-head"><span class="co-icon">' + meta.icon + '</span>' +
            '<span class="co-label">' + esc(coTitle || meta.label) + '</span></div>' +
            '<div class="co-body">' + inner + '</div></div>');
        }
        continue;
      }

      // 제목
      var h = /^(#{1,5})\s+(.*)$/.exec(line);
      if (h) {
        var lvl = h[1].length;
        var text = h[2].replace(/\s+#+\s*$/, '');
        var explicitId = /\{#([\w-]+)\}\s*$/.exec(text);
        var id;
        if (explicitId) { id = explicitId[1]; text = text.replace(/\s*\{#[\w-]+\}\s*$/, ''); }
        else { id = slugify(text); }
        if (ctx && ctx.ids) {
          var base = id, n = 2;
          while (ctx.ids[id]) id = base + '-' + n++;
          ctx.ids[id] = true;
        }
        if (ctx && ctx.headings && lvl >= 2 && lvl <= 3) {
          ctx.headings.push({ level: lvl, id: id, text: text.replace(/[`*]/g, '') });
        }
        out.push('<h' + lvl + ' id="' + id + '" class="hd hd' + lvl + '">' +
          inline(text) +
          '<a class="anchor" href="#" data-anchor="' + id + '" aria-label="이 절 링크">#</a></h' + lvl + '>');
        i++;
        continue;
      }

      // 수평선
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 표
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var head = splitRow(lines[i]);
        var align = splitRow(lines[i + 1]).map(function (c) {
          if (/^:.*:$/.test(c.trim())) return 'center';
          if (/:$/.test(c.trim())) return 'right';
          if (/^:/.test(c.trim())) return 'left';
          return '';
        });
        i += 2;
        var body2 = [];
        while (i < lines.length && /\|/.test(lines[i]) && !blank(lines[i])) { body2.push(splitRow(lines[i])); i++; }
        var t = '<div class="table-wrap"><table><thead><tr>';
        head.forEach(function (c, k) {
          t += '<th' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline(c.trim()) + '</th>';
        });
        t += '</tr></thead><tbody>';
        body2.forEach(function (row) {
          t += '<tr>';
          head.forEach(function (_, k) {
            t += '<td' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline((row[k] || '').trim()) + '</td>';
          });
          t += '</tr>';
        });
        out.push(t + '</tbody></table></div>');
        continue;
      }

      // 인용
      if (/^\s*>/.test(line)) {
        var qbuf = [];
        while (i < lines.length && (/^\s*>/.test(lines[i]) || (!blank(lines[i]) && qbuf.length))) {
          qbuf.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        out.push('<blockquote>' + blocks(qbuf.join('\n'), ctx) + '</blockquote>');
        continue;
      }

      // 목록
      if (MARKER.test(line)) {
        var lm = MARKER.exec(line);
        var baseIndent = lm[1].length;
        var baseOrdered = !lm[2];
        var lbuf = [];
        while (i < lines.length) {
          if (blank(lines[i])) {
            // 다음 비어있지 않은 줄이 여전히 목록/들여쓰기면 계속
            var j = i + 1;
            while (j < lines.length && blank(lines[j])) j++;
            if (j < lines.length && /^(?:\s{2,}|\s*(?:[-*+]|\d+[.)])\s)/.test(lines[j])) { lbuf.push(''); i++; continue; }
            break;
          }
          // 같은 레벨에서 마커 종류가 바뀌면(- → 1.) 별개의 목록이다.
          var mm = MARKER.exec(lines[i]);
          if (mm && mm[1].length === baseIndent && !mm[2] !== baseOrdered) break;
          lbuf.push(lines[i]); i++;
        }
        out.push(renderList(lbuf, ctx));
        continue;
      }

      // 문단
      var pbuf = [];
      while (i < lines.length && !blank(lines[i]) &&
        !/^(#{1,5}\s|:::|\s*(?:`{3,}|~{3,})|\s*>|\s*(?:[-*+]|\d+[.)])\s)/.test(lines[i]) &&
        !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
        pbuf.push(lines[i]); i++;
      }
      if (pbuf.length) out.push('<p>' + inline(pbuf.join('\n')) + '</p>');
      else { out.push('<p>' + inline(lines[i]) + '</p>'); i++; }
    }

    return out.join('\n');
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    var inCode = false;
    for (var k = 0; k < s.length; k++) {
      var ch = s[k];
      if (ch === '`') inCode = !inCode;
      if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
      if (ch === '|' && !inCode) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  function renderList(lines, ctx) {
    var first = /^(\s*)(?:([-*+])|(\d+)[.)])\s+/.exec(lines[0]);
    var indent = first[1].length;
    var ordered = !first[2];
    var start = ordered ? parseInt(first[3], 10) : 1;

    // 이 목록 레벨의 '같은 종류' 마커만 항목 시작으로 인정한다. 더 깊게 들여쓴
    // 줄은 항목 본문으로 넘겨 blocks()가 재귀적으로 중첩 목록을 처리하게 한다.
    var markerRe = new RegExp('^\\s{' + indent + '}' + (ordered ? '\\d+[.)]' : '[-*+]') + '\\s+');
    var items = [];
    var cur = null;
    var contIndent = 0;
    lines.forEach(function (ln) {
      var m = markerRe.exec(ln);
      if (m) {
        if (cur) items.push(cur);
        cur = [ln.slice(m[0].length)];
        contIndent = m[0].length;
      } else if (cur) {
        cur.push(/^\s*$/.test(ln) ? '' : ln.replace(new RegExp('^\\s{0,' + contIndent + '}'), ''));
      }
    });
    if (cur) items.push(cur);

    var html = items.map(function (item) {
      var text = item.join('\n');
      // 체크박스
      var cb = /^\[([ xX])\]\s+([\s\S]*)$/.exec(text);
      var prefix = '';
      if (cb) {
        prefix = '<input type="checkbox" class="task-cb" disabled' + (cb[1].toLowerCase() === 'x' ? ' checked' : '') + '> ';
        text = cb[2];
      }
      var inner = blocks(text, ctx);
      // 단일 문단이면 <p> 벗기기
      var only = /^<p>([\s\S]*)<\/p>$/.exec(inner.trim());
      if (only && !/<p>/.test(only[1])) inner = only[1];
      return '<li>' + prefix + inner + '</li>';
    }).join('');

    return ordered
      ? '<ol' + (start !== 1 ? ' start="' + start + '"' : '') + '>' + html + '</ol>'
      : '<ul>' + html + '</ul>';
  }

  /* ---------------- 공개 API ---------------- */

  function render(src) {
    var ctx = { headings: [], ids: {} };
    var html = blocks(src || '', ctx);
    return { html: html, headings: ctx.headings };
  }

  // 검색 색인용: 마크다운 -> 평문
  function toText(src) {
    return (src || '')
      .replace(/^:::\s*widget[^\n]*\n[\s\S]*?^:::\s*$/gm, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/:::\s*\w+/g, ' ')
      .replace(/^:::\s*$/gm, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  global.MD = { render: render, inline: inline, slugify: slugify, toText: toText };
})(this);
