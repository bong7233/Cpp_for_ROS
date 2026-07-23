/* highlight.js — 의존성 없는 소형 구문 강조기
 * 지원: cpp, c, cmake, bash, console, python, js, json, yaml, sql, text
 * 사용: HL.highlight(code, lang) -> HTML 문자열
 */
(function (global) {
  'use strict';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var PY_KW = 'False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield';
  var PY_SOFT = 'match|case|type';
  var PY_BUILTIN = 'abs|aiter|anext|all|any|ascii|bin|bool|breakpoint|bytearray|bytes|callable|chr|classmethod|compile|complex|delattr|dict|dir|divmod|enumerate|eval|exec|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|locals|map|max|memoryview|min|next|object|oct|open|ord|pow|print|property|range|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|vars|zip|__import__';
  var PY_SELF = 'self|cls|NotImplemented|Ellipsis|__name__|__main__|__file__|__doc__';
  var PY_EXC = 'BaseException|Exception|ArithmeticError|AssertionError|AttributeError|BlockingIOError|BrokenPipeError|BufferError|BytesWarning|ChildProcessError|ConnectionError|ConnectionAbortedError|ConnectionRefusedError|ConnectionResetError|DeprecationWarning|EOFError|EnvironmentError|FileExistsError|FileNotFoundError|FloatingPointError|FutureWarning|GeneratorExit|IOError|ImportError|ImportWarning|IndentationError|IndexError|InterruptedError|IsADirectoryError|KeyError|KeyboardInterrupt|LookupError|MemoryError|ModuleNotFoundError|NameError|NotADirectoryError|NotImplementedError|OSError|OverflowError|PendingDeprecationWarning|PermissionError|ProcessLookupError|RecursionError|ReferenceError|ResourceWarning|RuntimeError|RuntimeWarning|StopAsyncIteration|StopIteration|SyntaxError|SyntaxWarning|SystemError|SystemExit|TabError|TimeoutError|TypeError|UnboundLocalError|UnicodeDecodeError|UnicodeEncodeError|UnicodeError|UnicodeTranslateError|UnicodeWarning|UserWarning|ValueError|Warning|ZeroDivisionError|ExceptionGroup|BaseExceptionGroup';

  var RULES = {};

  RULES.python = [
    [/^#[^\n]*/, 'c'],
    // triple-quoted (접두사 포함)
    [/^(?:[rRbBuUfF]{0,3})(?:"""[\s\S]*?"""|'''[\s\S]*?''')/, 's'],
    // single-line strings
    [/^(?:[rRbBuUfF]{0,3})(?:"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')/, 's'],
    [/^@[A-Za-z_][\w.]*/, 'd'],
    [/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][+-]?\d+)?[jJ]?|\d[\d_]*\.?(?:[eE][+-]?\d+)?[jJ]?)\b/, 'n'],
    [new RegExp('^(?:' + PY_KW + ')\\b'), 'k'],
    [new RegExp('^(?:' + PY_SOFT + ')(?=\\s+[\\w\\[({"\'-])'), 'k'],
    [new RegExp('^(?:' + PY_EXC + ')\\b'), 't'],
    [new RegExp('^(?:' + PY_SELF + ')\\b'), 'v'],
    [new RegExp('^(?:' + PY_BUILTIN + ')\\b'), 'b'],
    [/^[A-Z]\w*(?=[\s.,)\]:=]|$)/, 't'],
    [/^[A-Za-z_]\w*(?=\s*\()/, 'f'],
    [/^[A-Za-z_]\w*/, null],
    [/^\s+/, null],
    [/^[^\w\s]/, 'o']
  ];

  var JS_KW = 'await|async|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|from|as|get|set';
  RULES.js = [
    [/^\/\/[^\n]*/, 'c'],
    [/^\/\*[\s\S]*?\*\//, 'c'],
    [/^`(?:\\[\s\S]|[^`\\])*`/, 's'],
    [/^"(?:\\[\s\S]|[^"\\\n])*"|^'(?:\\[\s\S]|[^'\\\n])*'/, 's'],
    [/^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?n?)\b/, 'n'],
    [new RegExp('^(?:' + JS_KW + ')\\b'), 'k'],
    [/^(?:true|false|null|undefined|NaN|Infinity)\b/, 'b'],
    [/^(?:console|document|window|Math|JSON|Object|Array|String|Number|Boolean|Promise|Map|Set|Symbol|RegExp|Date|Error)\b/, 't'],
    [/^[A-Za-z_$][\w$]*(?=\s*\()/, 'f'],
    [/^[A-Za-z_$][\w$]*/, null],
    [/^\s+/, null],
    [/^[^\w\s$]/, 'o']
  ];
  RULES.ts = RULES.js;
  RULES.javascript = RULES.js;

  RULES.bash = [
    [/^#[^\n]*/, 'c'],
    [/^"(?:\\[\s\S]|[^"\\])*"|^'[^']*'/, 's'],
    [/^\$\{[^}]*\}|^\$[A-Za-z_]\w*|^\$\d/, 'v'],
    [/^(?:^|(?<=\s))-{1,2}[A-Za-z][\w-]*/, 'd'],
    [/^\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|in|export|local|source|set|echo|cd|exit)\b/, 'k'],
    [/^\b(?:g\+\+|gcc|clang\+\+|clang|clang-tidy|clang-format|gdb|make|cmake|ctest|ninja|python|python3|pip|git|docker|apt|apt-get|sudo|colcon|ros2|rosdep|vcpkg|conan|perf|valgrind|curl|wget|source|ldd|nm|objdump|strace)\b/, 'f'],
    [/^\b\d+\b/, 'n'],
    [/^[A-Za-z_][\w-]*/, null],
    [/^\s+/, null],
    [/^[^\w\s]/, 'o']
  ];
  RULES.sh = RULES.bash;
  RULES.shell = RULES.bash;

  RULES.json = [
    [/^"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/, 'a'],
    [/^"(?:\\[\s\S]|[^"\\])*"/, 's'],
    [/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'n'],
    [/^\b(?:true|false|null)\b/, 'b'],
    [/^\s+/, null],
    [/^[^\s]/, 'o']
  ];

  RULES.yaml = [
    [/^#[^\n]*/, 'c'],
    [/^(?:^|(?<=\n))\s*[-\w.$/]+(?=\s*:)/, 'a'],
    [/^"(?:\\[\s\S]|[^"\\])*"|^'[^']*'/, 's'],
    [/^\b(?:true|false|null|yes|no|on|off|~)\b/, 'b'],
    [/^-?\d+(?:\.\d+)?\b/, 'n'],
    [/^[\w.\/-]+/, null],
    [/^\s+/, null],
    [/^[^\w\s]/, 'o']
  ];

  var CPP_KW = 'alignas|alignof|and|asm|auto|bool|break|case|catch|char|char8_t|char16_t|char32_t|class|concept|const|consteval|constexpr|constinit|const_cast|continue|co_await|co_return|co_yield|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|false|final|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|not|nullptr|operator|or|override|private|protected|public|register|reinterpret_cast|requires|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|true|try|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|wchar_t|while';
  // 자주 등장하는 표준 타입은 타입 색으로 칠한다 — 예제 코드의 골격이 잘 보이게.
  var CPP_STD_TYPE = 'size_t|ptrdiff_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|intptr_t|uintptr_t|string|string_view|vector|array|span|map|set|unordered_map|unordered_set|deque|list|pair|tuple|optional|variant|expected|function|unique_ptr|shared_ptr|weak_ptr|thread|jthread|mutex|atomic|future|promise|byte';
  RULES.cpp = [
    [/^\/\/[^\n]*/, 'c'],
    [/^\/\*[\s\S]*?\*\//, 'c'],
    [/^#\s*\w+(?:[ \t]+<[^>\n]+>)?/, 'd'],
    [/^(?:L|u8?|U)?"(?:\\[\s\S]|[^"\\\n])*"(?:sv|s)?|^(?:L|u8?|U)?'(?:\\[\s\S]|[^'\\\n])*'/, 's'],
    [/^R"([^(\s]*)\(([\s\S]*?)\)\1"/, 's'],
    [/^(?:0[xX][0-9a-fA-F']+|0[bB][01']+|\d[\d']*\.?\d*(?:[eE][+-]?\d+)?[fFuUlLzZ]*)\b/, 'n'],
    [new RegExp('^(?:' + CPP_KW + ')\\b'), 'k'],
    [/^std\b/, 'b'],
    [new RegExp('^(?:' + CPP_STD_TYPE + ')\\b(?!\\s*\\()'), 't'],
    [/^[A-Za-z_]\w*(?=\s*[<(])/, 'f'],
    [/^[A-Za-z_]\w*/, null],
    [/^\s+/, null],
    [/^[^\w\s]/, 'o']
  ];
  RULES.c = RULES.cpp;

  RULES.cmake = [
    [/^#[^\n]*/, 'c'],
    [/^"(?:\\[\s\S]|[^"\\])*"/, 's'],
    [/^\$\{[^}]*\}|^\$<[^>]*>/, 'v'],
    [/^\b(?:if|elseif|else|endif|foreach|endforeach|while|endwhile|function|endfunction|macro|endmacro|return|break|continue|include|option|set|unset|list|string|math|message|project|cmake_minimum_required)\b/i, 'k'],
    [/^\b(?:PUBLIC|PRIVATE|INTERFACE|REQUIRED|STATIC|SHARED|MODULE|IMPORTED|ALIAS|COMPONENTS|VERSION|LANGUAGES|ON|OFF|TRUE|FALSE|NOT|AND|OR|STREQUAL|DEFINED|TARGET|EXISTS)\b/, 'b'],
    [/^[A-Za-z_][\w.-]*(?=\s*\()/, 'f'],
    [/^\b\d+(?:\.\d+)*\b/, 'n'],
    [/^[A-Za-z_][\w.\/-]*/, null],
    [/^\s+/, null],
    [/^[^\w\s]/, 'o']
  ];

  RULES.xml = [
    [/^<!--[\s\S]*?-->/, 'c'],
    [/^<\/?[\w:-]+|^\/?>|^>/, 'k'],
    [/^"[^"]*"|^'[^']*'/, 's'],
    [/^[\w:-]+(?==)/, 'a'],
    [/^\s+/, null],
    [/^[^<>\s]+/, null],
    [/^[^\w\s]/, 'o']
  ];

  RULES.sql = [
    [/^--[^\n]*/, 'c'],
    [/^'(?:''|[^'])*'/, 's'],
    [/^\b\d+(?:\.\d+)?\b/, 'n'],
    [/^\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|DROP|ALTER|AND|OR|NOT|NULL|AS|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END|WITH|PRIMARY|KEY|FOREIGN|REFERENCES)\b/i, 'k'],
    [/^[A-Za-z_]\w*/, null],
    [/^\s+/, null],
    [/^[^\w\s]/, 'o']
  ];

  var ALIASES = {
    py: 'python', python3: 'python', pycon: 'python', ipython: 'python',
    'c++': 'cpp', cxx: 'cpp', yml: 'yaml', zsh: 'bash', jsonc: 'json'
  };

  function tokenize(code, rules) {
    var out = '';
    var pos = 0;
    var guard = 0;
    while (pos < code.length && guard++ < 500000) {
      var rest = code.slice(pos);
      var matched = false;
      for (var i = 0; i < rules.length; i++) {
        var m = rules[i][0].exec(rest);
        if (m && m[0].length > 0) {
          var cls = rules[i][1];
          var text = esc(m[0]);
          out += cls ? '<span class="hl-' + cls + '">' + text + '</span>' : text;
          pos += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out += esc(code[pos]);
        pos++;
      }
    }
    return out;
  }

  // 대화형 세션은 프롬프트와 출력을 구분해서 칠한다.
  function highlightRepl(code) {
    return code.split('\n').map(function (line) {
      var m = /^(\s*)(>>>|\.\.\.)(\s?)([\s\S]*)$/.exec(line);
      if (m) {
        return m[1] + '<span class="hl-prompt">' + m[2] + '</span>' + m[3] +
          tokenize(m[4], RULES.python);
      }
      if (line.trim() === '') return '';
      return '<span class="hl-out">' + esc(line) + '</span>';
    }).join('\n');
  }

  // 터미널 세션 — `$ 명령` 줄은 셸 규칙으로 칠하고 나머지는 출력으로 흐리게.
  // 컴파일러 에러·ASan 리포트를 "실제 출력 그대로" 보여줄 때(STYLE.md §4-2)
  // 명령과 출력이 한 블록에 섞이므로 이 구분이 필요하다.
  function highlightConsole(code) {
    return code.split('\n').map(function (line) {
      var m = /^(\s*)(\$)(\s?)([\s\S]*)$/.exec(line);
      if (m) {
        return m[1] + '<span class="hl-prompt">' + m[2] + '</span>' + m[3] +
          tokenize(m[4], RULES.bash);
      }
      if (line.trim() === '') return '';
      return '<span class="hl-out">' + esc(line) + '</span>';
    }).join('\n');
  }

  function highlight(code, lang) {
    lang = (lang || '').toLowerCase().trim();
    lang = ALIASES[lang] || lang;
    if (lang === 'repl' || lang === 'pyrepl') return highlightRepl(code);
    if (lang === 'console') return highlightConsole(code);
    var rules = RULES[lang];
    if (!rules) return esc(code);
    return tokenize(code, rules);
  }

  global.HL = { highlight: highlight, escape: esc, languages: Object.keys(RULES) };
})(this);
