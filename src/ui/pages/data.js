// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, tile, wordTile, axisBar, row } from '../components.js';
import { lineChart, radar, barRows } from '../charts.js';
import * as F from '../../util/format.js';
import { word, biWord } from '../../util/scale.js';
import { bracketOf, isConsensus } from '../../systems/ValueSystem.js';

export function dataPage(s, data, tab = 'macro') {
  const t = tab ?? 'macro';
  const tabs = [['macro', '總體'], ['pops', '民生'], ['values', '價值觀'], ['world', '世界'], ['history', '走勢']];
  const nav = `<div class="tabrow">${tabs.map(([id, n]) =>
    `<button class="btn ${t === id ? 'primary' : 'ghost'}" data-act="data-tab" data-id="${id}">${n}</button>`).join('')}</div>`;
  return nav + { macro, pops, values, world, history }[t](s, data);
}

function macro(s, data) {
  const c = s.central;
  return html`
    ${card('經濟', `<div class="grid2">
      ${tile('國內生產毛額', `<span class="num">${F.bil(c.fiscal.gdp)}</span>`)}
      ${tile('經濟成長率', `<span class="num ${c.fiscal.gdpGrowth > 0.02 ? 'tone-good' : c.fiscal.gdpGrowth < 0 ? 'tone-bad' : ''}">${(c.fiscal.gdpGrowth * 100).toFixed(2)}%</span>`)}
      ${tile('失業率', `<span class="num ${c.fiscal.unemployment > 0.05 ? 'tone-bad' : 'tone-ok'}">${(c.fiscal.unemployment * 100).toFixed(2)}%</span>`)}
      ${tile('通貨膨脹', `<span class="num ${c.fiscal.inflation > 0.03 ? 'tone-warn' : ''}">${(c.fiscal.inflation * 100).toFixed(2)}%</span>`)}
      ${tile('加權指數', `<span class="num">${F.int(c.stockIndex)}</span>`)}
      ${tile('匯率', `<span class="num">${c.monetary.exchangeRateUSD.toFixed(2)}</span>`, '新台幣兌美元')}
    </div>`)}
    ${card('能源', `
      ${row('備轉容量率', `<span class="num ${c.energy.reserveMargin < 0.07 ? 'tone-bad' : 'tone-ok'}">${(c.energy.reserveMargin * 100).toFixed(1)}%</span>`)}
      ${row('電價', `<span class="num">${c.energy.electricityPrice.toFixed(2)} 元／度</span>`)}
      ${row('再生能源佔比', `<span class="num">${(c.energy.mix.renewable * 100).toFixed(1)}%</span>`)}
      ${row('台灣電能公司累虧', `<span class="num">${F.yi(c.energy.tpecDeficit)}</span>`)}`)}
    ${card('國防與外交', `<div class="grid2">
      ${wordTile('戰備', 'readiness', c.defense.readiness)}
      ${wordTile('不對稱戰力', 'readiness', c.defense.asymmetricCapability)}
      ${wordTile('對美關係', 'relation', c.diplomacy.usRelation, true)}
      ${wordTile('兩岸關係', 'relation', c.diplomacy.prcRelation, true)}
      ${wordTile('對日關係', 'relation', c.diplomacy.japanRelation, true)}
      ${tile('國防預算佔比', `<span class="num">${(c.defense.budgetRatio * 100).toFixed(2)}%</span>`)}
    </div>`)}
    ${card('社會', `
      ${row('總生育率', `<span class="num">${c.society.birthRate.toFixed(2)}</span>`)}
      ${row('高齡人口比', `<span class="num">${(c.society.agingRatio * 100).toFixed(1)}%</span>`)}
      ${row('吉尼係數', `<span class="num">${c.society.giniIndex.toFixed(3)}</span>`)}
      ${row('房價所得比', `<span class="num">${c.society.housingAffordability.toFixed(1)}</span>`)}
      ${row('健保財務', `<span class="word">${esc(word('sol', c.society.healthcareSustainability))}</span>`)}
      ${row('年金永續', `<span class="word">${esc(word('sol', c.society.pensionSustainability))}</span>`)}
      ${row('社會信任', `<span class="word">${esc(word('sol', c.society.socialTrust))}</span>`)}`)}`;
}

function pops(s, data) {
  const st = s.flags.stratSol ?? {};
  const items = data.pops.strata.map((x) => ({
    label: x.name, value: st[x.id] ?? 0,
    text: word('sol', st[x.id] ?? 0),
    color: (st[x.id] ?? 0) >= 3.5 ? 'var(--good)' : (st[x.id] ?? 0) >= 2.5 ? 'var(--ok)' : (st[x.id] ?? 0) >= 1.5 ? 'var(--mid)' : 'var(--bad)',
  }));
  const heat = data.issues.issues.map((i) => ({
    label: i.name, value: s.issues[i.id],
    text: word('issueHeat', s.issues[i.id]),
    color: s.issues[i.id] >= 4 ? 'var(--bad)' : s.issues[i.id] >= 3 ? 'var(--warn)' : 'var(--accent)',
  })).sort((a, b) => b.value - a.value);
  return html`
    ${card('各階層生活水準', barRows(items, { min: 5 })
      + `<div class="xs muted" style="margin-top:8px;line-height:1.7">
        這十群人的日子過得怎麼樣，決定了他們投票的時候會不會出門。</div>`)}
    ${card('議題熱度', barRows(heat, { min: 5 }))}`;
}

function values(s, data) {
  return card('國家價值觀', data.values.axes.map((ax) => {
    const v = s.values[ax.id];
    const br = bracketOf(data, ax.id, v);
    const locked = isConsensus(s, ax.id);
    return axisBar(ax.negName, ax.posName, v)
      + (br?.desc ? `<div class="xs muted" style="margin:-4px 0 12px;line-height:1.65">${esc(br.desc)}</div>` : '')
      + (locked ? `<div class="xs" style="color:var(--gold);margin:-8px 0 12px">這件事已經沒什麼人在爭了。</div>` : '');
  }).join('')) + card('', `<div class="xs muted" style="line-height:1.8">
    每一條軸每個月最多只會移動一點點。要讓一條軸跨過一整級，大概需要四到五年的持續施力——
    法案、教育、媒體、還有你反覆講的那些話。</div>`);
}

function world(s, data) {
  const items = Object.values(s.world).slice(0, 13).map((b) => ({ label: b.name, value: b.stance }));
  return html`
    ${card('對台友好程度', radar(items))}
    ${card('十五個區塊', Object.values(s.world).map((b) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="row-k"><b>${esc(b.name)}</b></span>
          <span class="row-v word">${esc(biWord('relation', b.stance))}</span>
        </div>
        <div class="xs muted" style="margin-top:3px">
          經貿 ${esc(word('reach', b.economicLink))}${b.militaryPressure > 0 ? `・軍事壓力 ${esc(word('issueHeat', b.militaryPressure))}` : ''}・景氣 ${b.cycle > 0.2 ? '看好' : b.cycle < -0.2 ? '低迷' : '持平'}
        </div>
      </div>`).join(''))}`;
}

function history(s, data) {
  const h = s.history;
  if (h.length < 2) return card('走勢', '<div class="xs muted">還沒有累積足夠的年度資料。等過幾年再回來看。</div>');
  const labels = h.map((x) => String(x.year));
  return html`
    ${card('支持度', lineChart([{ data: h.map((x) => x.approval), color: 'var(--accent)' }], { labels, min: 0, max: 100 }))}
    ${card('全國生活水準', lineChart([{ data: h.map((x) => x.sol), color: 'var(--good)' }], { labels, min: 0, max: 5 }))}
    ${card('失業率', lineChart([{ data: h.map((x) => x.unemployment * 100), color: 'var(--warn)' }], { labels }))}
    ${card('加權指數', lineChart([{ data: h.map((x) => x.stockIndex), color: 'var(--gold)' }], { labels }))}
    ${card('國債佔 GDP', lineChart([{ data: h.map((x) => x.debtToGdp * 100), color: 'var(--bad)' }], { labels }))}`;
}
