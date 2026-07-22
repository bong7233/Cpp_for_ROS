/* demo.js — 위젯 구현의 레퍼런스 (파이프라인 검증용이자 새 위젯의 템플릿)
 *
 * 콘텐츠 쪽 사용법:
 *   ::: widget demo
 *   { "values": [3, 1, 4, 1, 5], "title": "값이 쌓이는 과정" }
 *   :::
 *
 * 새 위젯을 만들 때 이 파일을 복사해서 시작한다. 지켜야 할 계약은
 * widget-core.js 상단 주석 참고.
 */
(function (global) {
  'use strict';

  var WIDGETS = global.WIDGETS;
  var core = WIDGETS._core;

  WIDGETS['demo'] = {
    mount: function (mountEl, params) {
      var values = Array.isArray(params.values) && params.values.length
        ? params.values : [3, 1, 4, 1, 5];

      var f = core.frame(mountEl, { icon: '🧪', title: params.title || '데모 위젯' });

      // 스테이지: 스텝마다 막대가 하나씩 나타난다.
      var W = 560, H = 180, PAD = 18;
      var stage = core.el('div', 'widget-stage');
      var svgRoot = core.svg('svg', { viewBox: '0 0 ' + W + ' ' + H });
      stage.appendChild(svgRoot);
      f.body.appendChild(stage);

      var maxV = Math.max.apply(null, values);
      var barW = (W - PAD * 2) / values.length;

      // render(i)는 i 까지의 상태를 처음부터 다시 그린다. 증분 갱신보다 느리지만
      // 이 크기(수십 개 요소)에서는 차이가 없고, "스텝 = 상태의 순수 함수"가
      // 유지돼 되감기 버그가 원천적으로 없다.
      function render(i) {
        while (svgRoot.firstChild) svgRoot.removeChild(svgRoot.firstChild);
        var accent = core.themeColor('--accent', '#2f6fed');
        var mute = core.themeColor('--fg-mute', '#7b8496');
        for (var k = 0; k <= i && k < values.length; k++) {
          var h = (values[k] / maxV) * (H - 60);
          svgRoot.appendChild(core.svg('rect', {
            x: PAD + k * barW + 6, y: H - 30 - h,
            width: barW - 12, height: h, rx: 4,
            fill: k === i ? accent : 'color-mix(in srgb, ' + accent + ' 45%, transparent)'
          }));
          svgRoot.appendChild(core.svgText(
            PAD + k * barW + barW / 2, H - 12, String(values[k]),
            { 'text-anchor': 'middle', 'font-size': 12, fill: mute }
          ));
        }
        f.setCaption('스텝 <code>' + (i + 1) + '</code> — 값 <code>' + values[i] +
          '</code> 이(가) 추가됐다. 슬라이더나 버튼으로 아무 스텝에나 이동할 수 있다.');
      }

      core.player(mountEl, { total: values.length, render: render });
    }
  };
})(this);
