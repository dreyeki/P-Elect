// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, row, wordRow, tile, wordTile } from '../components.js';
import { seatChart } from '../components.js';
import * as F from '../../util/format.js';
import { word, biWord } from '../../util/scale.js';
import { seatSummary, inSession } from '../../systems/LegislatureSystem.js';
import { revenue, expenditure } from '../../systems/BudgetSystem.js';
import { partyColor } from '../app.js';

export function politicsPage(s, data, tab = 'overview') {
  const t = tab ?? 'overview';
  const tabs = [['overview', '概況'], ['laws', '法案'], ['factions', '派系'], ['budget', '預算'], ['interp', '質詢']];
  const nav = `<div class="btn-row" style="margin:0 0 12px">${tabs.map(([id, n]) =>
    `<button class="btn ${t === id ? 'primary' : 'ghost'}" data-act="politics-tab" data-id="${id}">${n}</button>`).join('')}</div>`;
  const body = { overview, laws, factions, budget, interp }[t](s, data);
  return nav + body;
}

function overview(s, data) {
  const sum = seatSummary(s);
  const rows = sum.rows;
  const ruling = s.central.government.presidentParty;
  return html`
    ${card('立法院', `
      ${seatChart(rows, partyColor)}
      <div class="row"><span class="row-k">總席次</span><span class="row-v num">${sum.total}</span></div>
      <div class="row"><span class="row-k">執政黨</span><span class="row-v p-${ruling}">${esc(s.parties[ruling]?.name ?? '無')}</span></div>
      <div class="row"><span class="row-k">政治結構</span><span class="row-v ${sum.divided ? 'tone-warn' : 'tone-ok'}">${sum.divided ? '朝小野大' : '完全執政'}</span></div>
      <div class="row"><span class="row-k">會期</span><span class="row-v">${inSession(s) ? '開議中' : '休會中'}</span></div>`)}

    ${card('政黨', Object.values(s.parties).filter((p) => (s.legislature[p.id] ?? 0) > 0 || p.support > 0.02)
      .sort((a, b) => (b.support ?? 0) - (a.support ?? 0)).map((p) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="row-k"><b class="p-${p.id}" style="color:${p.color}">${esc(p.name)}</b>
            <span class="xs muted">${s.legislature[p.id] ?? 0} 席</span></span>
          <span class="row-v num">${((p.support ?? 0) * 100).toFixed(1)}%</span>
        </div>
        <div class="xs muted" style="margin-top:2px">團結度 ${esc(word('cohesion', p.cohesion))}・形象 ${esc(word('publicImage', p.publicImage))}</div>
      </div>`).join(''))}

    ${card('進行中的法案', s.session.billsInProgress.length
      ? s.session.billsInProgress.map((b) => {
        const law = data.byId.law[b.lawId];
        const STAGES = ['提案', '一讀付委', '委員會審查', '黨團協商', '二讀', '三讀'];
        return `<div class="row" style="display:block">
          <div style="display:flex;justify-content:space-between">
            <span class="row-k">《${esc(law.name)}》→ ${esc(law.tiers[b.targetTier].name)}</span>
            <span class="row-v xs">${esc(STAGES[Math.min(b.stage, 5)])}</span>
          </div>
          <div class="bar"><i style="width:${(Math.min(b.stage, 6) / 6 * 100).toFixed(0)}%"></i></div>
          <button class="btn ghost xs" data-act="push-bill" data-id="${esc(b.id)}" style="margin-top:6px;padding:5px 10px">
            花 50 政治資本催一下</button>
        </div>`;
      }).join('')
      : '<div class="xs muted">目前沒有你提的法案在程序中。法案要一關一關走，急不得。</div>')}
  `;
}

function laws(s, data) {
  const cats = {};
  for (const l of data.laws.laws) (cats[l.category] ??= []).push(l);
  const CAT = { fiscal: '財政與稅制', labor: '勞動', welfare: '社福', industry: '產業', energy: '能源', defense: '國防', crossStrait: '兩岸', polity: '政治體制', society: '社會' };
  return Object.entries(cats).map(([c, ls]) => card(CAT[c] ?? c, ls.map((l) => {
    const cur = s.laws[l.id];
    return `<button class="lawrow" data-act="open-law" data-id="${esc(l.id)}" style="width:100%;text-align:left">
      <span class="ln"><span class="lt">${esc(l.name)}</span>
        <span class="lc">現行：${esc(l.tiers[cur].name)}</span></span>
      <span class="chip">爭議 ${esc(word('issueHeat', l.controversy))}</span>
    </button>`;
  }).join(''))).join('');
}

export function lawModal(s, data, lawId, pick) {
  const l = data.byId.law[lawId];
  const cur = s.laws[lawId];
  const tiers = l.tiers.map((t, i) => `
    <button class="tier ${i === cur ? 'cur' : ''} ${i === pick ? 'pick' : ''}"
      data-act="law-pick" data-id="${esc(lawId)}" data-idx="${i}">${esc(t.name)}</button>`).join('');
  const sel = pick != null ? l.tiers[pick] : null;
  return html`
    <div class="modal-h">《${l.name}》</div>
    <div class="modal-b">${l.desc}</div>
    <div class="sec-t">檔位</div>
    <div class="tiers">${raw(tiers)}</div>
    ${raw(sel ? `<div class="card" style="margin-top:12px">
      <div class="card-t">${esc(sel.name)}</div>
      <div class="small dim" style="margin-top:6px;line-height:1.7">${esc(sel.desc)}</div>
      ${lawEffectSummary(sel, data)}
    </div>` : '')}
    <div class="btn-row">
      ${raw(pick != null && pick !== cur
    ? `<button class="btn primary" data-act="propose-law" data-id="${esc(lawId)}" data-idx="${pick}">提出修正案</button>` : '')}
      <button class="btn ghost" data-act="modal-close">關閉</button>
    </div>`;
}

const STRATA_NAME = { farmer: '農漁民', bluecollar: '藍領', service: '服務業', whitecollar: '白領', techpro: '專業技術', smallbiz: '小企業', capitalist: '大資本', publicsvc: '軍公教', student: '學生', retiree: '退休族', _all: '全民' };

function lawEffectSummary(tier, data) {
  const e = tier.effects ?? {};
  const good = [], bad = [];
  for (const k in e.popSoL ?? {}) (e.popSoL[k] > 0 ? good : bad).push(STRATA_NAME[k] ?? k);
  const parts = [];
  if (good.length) parts.push(`<div class="xs" style="color:var(--good);margin-top:8px">受益：${good.join('、')}</div>`);
  if (bad.length) parts.push(`<div class="xs" style="color:var(--bad)">受害：${bad.join('、')}</div>`);
  const stance = tier.partyStance ?? {};
  const sup = Object.entries(stance).filter(([, v]) => v > 0.15).map(([k]) => k);
  const opp = Object.entries(stance).filter(([, v]) => v < -0.15).map(([k]) => k);
  if (sup.length || opp.length) {
    parts.push(`<div class="xs muted" style="margin-top:6px">可能支持：${sup.join('、') || '無'}｜可能反對：${opp.join('、') || '無'}</div>`);
  }
  return parts.join('');
}

function factions(s, data) {
  const pid = s.player.party;
  if (!pid) return card('派系', '<div class="xs muted">你沒有政黨。無黨籍的好處是誰都不欠，壞處是誰都不欠你。</div>');
  const p = s.parties[pid];
  return card(`${p.name} 派系`, p.factions.map((f) => `
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k"><b>${esc(f.name)}</b> <span class="xs muted">${(f.seatShare * 100).toFixed(0)}%</span></span>
        <span class="row-v word">${esc(biWord('favor', f.favor))}</span>
      </div>
      <div class="bar"><i style="width:${((f.favor + 5) / 10 * 100).toFixed(0)}%"></i></div>
      <div class="xs muted" style="margin-top:5px;line-height:1.6">${esc(f.desc ?? '')}</div>
      <button class="btn ghost xs" data-act="visit-faction" data-id="${esc(f.id)}"
        style="margin-top:7px;padding:5px 10px">拜會（1 AP）</button>
    </div>`).join('')) + card('黨職', `
      <div class="row"><span class="row-k">目前黨職</span><span class="row-v">${esc(s.flags.partyOffice ?? '無')}</span></div>
      <div class="row"><span class="row-k">黨內聲望</span><span class="row-v word">${esc(word('partyPrestige', s.player.partyPrestige))}</span></div>
      <div class="btn-row">
        <button class="btn" data-act="challenge" data-id="caucus">挑戰黨團總召</button>
        <button class="btn" data-act="challenge" data-id="viceChair">挑戰副主席</button>
        <button class="btn" data-act="challenge" data-id="chair">挑戰黨主席</button>
      </div>`);
}

function budget(s, data) {
  const rev = revenue(s, data);
  const exp = expenditure(s, data);
  const c = s.central;
  return html`
    ${card('中央財政', `
      <div class="grid2">
        ${tile('歲入', `<span class="num">${F.yi(rev.total)}</span>`)}
        ${tile('歲出', `<span class="num">${F.yi(exp.total)}</span>`)}
        ${tile('國債餘額', `<span class="num">${F.yi(c.fiscal.debtOutstanding)}</span>`)}
        ${tile('債務佔 GDP', `<span class="num">${((c.fiscal.debtToGdp ?? 0) * 100).toFixed(1)}%</span>`,
      `上限 ${(c.fiscal.debtCeilingRatio * 100).toFixed(1)}%`)}
      </div>`)}
    ${card('歲出配置', exp.rows.map((r) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between">
          <span class="row-k">${esc(r.name)}</span>
          <span class="row-v num">${(r.share * 100).toFixed(1)}%　${F.yi(r.amount)}</span>
        </div>
        <input type="range" min="0" max="35" step="0.5" value="${(r.share * 100).toFixed(1)}"
          data-change="budget-slide" data-id="${esc(r.id)}" style="width:100%;margin-top:5px">
      </div>`).join('') + `<button class="btn primary full" data-act="budget-apply" style="margin-top:10px">送出預算案</button>`)}
    ${card('特別預算', data.budget.specialBudgets.map((sb) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between">
          <span class="row-k">${esc(sb.name)}</span>
          <span class="row-v num">${F.yi(sb.amount)}</span>
        </div>
        <div class="xs muted">${sb.years} 年期，全數舉債支應。</div>
        ${s.flags['sb_' + sb.id] ? '<div class="xs" style="color:var(--good)">執行中</div>'
      : `<button class="btn ghost xs" data-act="special-budget" data-id="${esc(sb.id)}" style="margin-top:6px;padding:5px 10px">編列</button>`}
      </div>`).join(''))}`;
}

function interp(s, data) {
  const canRun = ['councilor', 'legislator'].includes(s.player.role);
  const prep = s.flags.interpPrep ?? 0;
  return html`
    ${card('質詢', canRun ? `
      <div class="row"><span class="row-k">準備程度</span><span class="row-v word">${esc(word('prep', prep))}</span></div>
      <div class="small muted" style="margin:8px 0;line-height:1.7">
        選一個議題、選一種風格，然後賭上你的口才與判斷。有些風格你做不出來，那不是能力問題，是性格問題。
      </div>
      <button class="btn primary full" data-act="open-interp">上質詢台</button>`
    : '<div class="xs muted">你現在的身分沒有質詢權。等你選上議員或立委再說。</div>')}
    ${card('承諾清單', s.promises.length
      ? s.promises.map((p) => `<div class="row">
          <span class="row-k">${esc(p.text)}</span>
          <span class="row-v xs ${s.meta.turn > p.deadline - 3 ? 'tone-warn' : ''}">
            還有 ${Math.max(0, p.deadline - s.meta.turn)} 回合</span></div>`).join('')
      : '<div class="xs muted">你目前沒有欠任何人一句話。這在這一行是難得的事。</div>')}`;
}
