// @ts-check
import { html, raw, esc } from '../util/dom.js';
import { word, biWord, axisWord, fill05, fillBi, toneOf } from '../util/scale.js';
import * as F from '../util/format.js';

export const card = (title, body, extra = '') => `
  <section class="card">
    ${title ? `<div class="card-h"><span class="card-t">${esc(title)}</span>${extra}</div>` : ''}
    ${body ?? ''}
  </section>`;

export const row = (k, v, cls = '') =>
  `<div class="row"><span class="row-k">${k}</span><span class="row-v ${cls}">${v ?? ''}</span></div>`;

/** 抽象量：只顯示四字語詞 + 條 */
export function wordRow(label, scaleId, value, bipolar = false) {
  const w = bipolar ? biWord(scaleId, value) : word(scaleId, value);
  const pct = bipolar ? fillBi(value) : fill05(value);
  const tone = toneOf(value, bipolar);
  return html`<div class="row" style="display:block">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span class="row-k">${label}</span>
      <span class="word ${raw(tone)}">${w}</span>
    </div>
    <div class="bar"><i style="width:${raw(pct.toFixed(1))}%"></i></div>
  </div>`;
}

export const tile = (k, v, sub = '', cls = '') => html`
  <div class="tile"><div class="tile-k">${k}</div>
  <div class="tile-v ${raw(cls)}">${raw(v)}</div>
  ${sub ? raw(`<div class="tile-k" style="margin-top:3px">${esc(sub)}</div>`) : raw('')}</div>`;

export function wordTile(k, scaleId, value, bipolar = false) {
  const w = bipolar ? biWord(scaleId, value) : word(scaleId, value);
  return html`<div class="tile"><div class="tile-k">${k}</div>
    <div class="tile-v sm word ${raw(toneOf(value, bipolar))}">${w}</div>
    <div class="bar"><i style="width:${raw((bipolar ? fillBi(value) : fill05(value)).toFixed(1))}%"></i></div></div>`;
}

export function axisBar(negName, posName, value) {
  const pos = fillBi(value);
  return html`<div class="axis">
    <div class="axis-h"><span>${negName}</span><span>${posName}</span></div>
    <div class="axis-track"><i style="left:${raw(pos.toFixed(1))}%"></i></div>
    <div class="axis-t">${axisWord(negName, posName, value)}</div>
  </div>`;
}

export const pips = (v, max = 5) => html`<div class="pips">${
  raw(Array.from({ length: max }, (_, i) => `<i class="${i < Math.round(v) ? 'on' : ''}"></i>`).join(''))}</div>`;

export function attrLine(name, scaleId, value) {
  return html`<div class="attrline">
    <span class="an">${name}</span>
    <span class="aw ${raw(toneOf(value))}">${word(scaleId, value)}</span>
    <span class="ab">${raw(pips(value))}</span>
  </div>`;
}

export const chip = (t, cls = '') => html`<span class="chip ${raw(cls)}">${t}</span>`;

export function newsItem(n) {
  return html`<div class="news k-${raw(n.kind ?? 'x')}"><div class="news-t">${n.text}</div></div>`;
}

export function seatChart(rows, partyColor) {
  const total = rows.reduce((a, r) => a + r[1], 0) || 1;
  const bars = rows.map(([pid, n]) =>
    `<i class="bg-${pid}" style="width:${(n / total * 100).toFixed(2)}%;background:${partyColor(pid)}"></i>`).join('');
  const legend = rows.map(([pid, n]) =>
    `<span><em style="background:${partyColor(pid)}"></em>${esc(pid)} ${n}</span>`).join('');
  return html`<div class="seatchart">${raw(bars)}</div><div class="legend">${raw(legend)}</div>`;
}

/** 影響預告：只給方向，不給數字 */
const EFF_LABEL = {
  'player.fame': '知名度', 'player.integrity': '清廉', 'player.stigma': '汙名',
  'player.favorNational': '民心', 'player.partyPrestige': '黨內聲望',
  'player.politicalCapital': '政治資本', 'player.funds': '競選經費',
  'player.personalAssets': '私產', 'player.fatigue': '疲勞',
  'central.fiscal.gdpGrowth': '經濟', 'central.fiscal.unemployment': '失業',
  'central.fiscal.inflation': '物價', 'central.energy.reserveMargin': '供電',
  'central.defense.readiness': '戰備', 'central.society.socialTrust': '社會信任',
  grassroots: '基層組織', corpMood: '企業', popMood: '民意', popSoL: '生活',
  issueHeat: '議題熱度', valuePressure: '社會風向', world: '國際',
};
const STRATA_NAME = {
  farmer: '農漁民', bluecollar: '藍領', service: '服務業', whitecollar: '白領',
  techpro: '專業技術', smallbiz: '小企業', capitalist: '大資本',
  publicsvc: '軍公教', student: '學生', retiree: '退休族', _all: '全民',
};

export function effectPreview(eff) {
  if (!eff) return '';
  const out = [];
  const push = (label, v) => {
    if (Math.abs(v) < 1e-6) return;
    const arrow = v > 0 ? (Math.abs(v) > 0.5 ? '↑↑' : '↑') : (Math.abs(v) > 0.5 ? '↓↓' : '↓');
    out.push(`<span class="eff ${v > 0 ? 'up' : 'down'}">${esc(label)}${arrow}</span>`);
  };
  for (const k in eff.player ?? {}) {
    const label = EFF_LABEL['player.' + k];
    if (!label) continue;
    const v = eff.player[k];
    const norm = k === 'politicalCapital' ? v / 60 : k === 'funds' ? v / 1e6
      : k === 'personalAssets' ? v / 1e7 : v;
    push(label, k === 'stigma' ? -Math.abs(norm) : norm);
  }
  for (const k in eff.popMood ?? {}) push((STRATA_NAME[k] ?? k) + '好感', eff.popMood[k]);
  for (const k in eff.popSoL ?? {}) push((STRATA_NAME[k] ?? k) + '生活', eff.popSoL[k]);
  for (const k in eff.corpMood ?? {}) push('企業', eff.corpMood[k]);
  for (const k in eff.grassroots ?? {}) push('基層組織', eff.grassroots[k]);
  for (const k in eff.central ?? {}) { const l = EFF_LABEL['central.' + k]; if (l) push(l, k.includes('unemploy') ? -eff.central[k] : eff.central[k]); }
  for (const k in eff.valuePressure ?? {}) push('社會風向', eff.valuePressure[k]);
  if (eff.tagGain?.length) out.push('<span class="eff">留下印象</span>');
  return out.length ? `<div class="opt-e">${[...new Set(out)].slice(0, 6).join('')}</div>` : '';
}

/** 排序過的鍵值列表 */
export function kvList(items) {
  return items.map(([k, v, cls]) => row(k, v, cls ?? '')).join('');
}

export { F, word, biWord, axisWord, esc, html, raw };
