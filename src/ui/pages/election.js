// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, row, tile } from '../components.js';
import { barRows } from '../charts.js';
import * as F from '../../util/format.js';
import { word, biWord } from '../../util/scale.js';
import { partyColor } from '../app.js';

/**
 * 競選行動。cost 是「議員層級」的基準價，
 * 實際花費會乘上該場選舉的 costMult——立委是議員的三點六倍，總統是四十五倍。
 * 一場議員選戰打滿大約一百到三百萬，立委兩百萬到兩千萬，跟現實對得上。
 */
export const CAMPAIGN_ACTIONS = [
  { id: 'street', name: '掃街拜票', ap: 1, cost: 30000, fatigue: 12,
    desc: '一條街一條街走，握到手酸為止。最便宜也最紮實的辦法。' },
  { id: 'motorcade', name: '車隊掃街', ap: 1, cost: 80000, fatigue: 14,
    desc: '宣傳車配旗隊繞遍全區，聲音大、觸及廣，鄰居可能會有意見。' },
  { id: 'phonebank', name: '電話拜票', ap: 1, cost: 50000, fatigue: 8,
    desc: '志工一通一通打，效率不高，但打得到的都是會出門投票的人。' },
  { id: 'temple', name: '拜廟與地方拜會', ap: 1, cost: 60000, fatigue: 12,
    desc: '長輩看的是你有沒有來，不是你講了什麼。' },
  { id: 'billboard', name: '廣告看板', ap: 1, cost: 250000, fatigue: 4,
    desc: '路口大看板一掛就是一整個選季，看板本身就是一種「他真的有在選」的訊號。',
    lasting: true },
  { id: 'rally', name: '大型造勢', ap: 2, cost: 450000, fatigue: 20,
    desc: '把場子做大，讓支持者覺得自己不孤單。下雨就慘了。' },
  { id: 'tv', name: '電視廣告', ap: 1, cost: 600000, fatigue: 5,
    desc: '砸錢買曝光，最快也最貴的辦法。' },
  { id: 'online', name: '網路投放', ap: 1, cost: 120000, fatigue: 5,
    desc: '精準打到年輕人，單位成本比電視低得多。' },
  { id: 'pr', name: '媒體公關', ap: 1, cost: 150000, fatigue: 6,
    desc: '請公關公司安排專訪、餵新聞稿、處理負面。花的是錢，買的是版面的角度。' },
  { id: 'debate', name: '政見發表', ap: 1, cost: 40000, fatigue: 12,
    desc: '中間選民會看，講好講壞差很多。' },
  { id: 'negative', name: '負面文宣', ap: 1, cost: 200000, fatigue: 12,
    desc: '打對手，也一定會濺到自己身上。' },
  { id: 'allocate', name: '配票操作', ap: 2, cost: 100000, fatigue: 15,
    desc: '複數選區才用得上，算錯就一起落選。' },
];

/** 這場選舉裡某個行動的實際花費 */
export function actionCost(run, a) {
  return Math.round(a.cost * (run?.level?.costMult ?? 1) / 1000) * 1000;
}

export function electionPage(s, data) {
  const e = s.election;
  if (!e) return card('選舉', '<div class="xs muted">目前沒有選舉。選前兩個月時間會自動變成一週一回合，到時候這裡才會亮起來。</div>');
  if (e.phase === 'decide') return decidePhase(s, data, e);
  if (e.phase === 'primary') return primaryPhase(s, data, e);
  if (e.phase === 'campaign') return campaignPhase(s, data, e);
  if (e.phase === 'result') return resultPhase(s, data, e);
  return '';
}

function decidePhase(s, data, e) {
  return card('要不要出來選', `
    <div class="small dim" style="line-height:1.8;margin-bottom:12px">
      登記期限就要到了。以你現在的知名度與資源，能選的位子有這些。不選也是一種選擇，
      有些人就是靠著等對的那一次，一路等到最後。
    </div>
    ${e.options.map((r, i) => `
      <button class="opt" data-act="pick-run" data-idx="${i}">
        <div class="opt-t">${esc(r.name)}</div>
        <div class="opt-h">保證金 ${esc(F.money(r.level.deposit ?? 0))}${r.level.system === 'SNTV' ? '・複數選區單記不可讓渡' : ''}</div>
      </button>`).join('')}
    <button class="opt" data-act="pick-run" data-idx="-1">
      <div class="opt-t">這一次先不選</div>
      <div class="opt-h">把資源留到下一次，繼續經營基層。</div>
    </button>`);
}

function primaryPhase(s, data, e) {
  const pri = e.primary;
  // 還沒開票：看清楚對手是誰，還有幾天可以去談
  if (pri && e.primaryWon === undefined) {
    const party = s.parties[s.player.party];
    const rivals = pri.rivals.map((r) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="row-k"><b>${esc(r.name)}</b></span>
          <span class="row-v xs">${esc(r.factionName)}</span>
        </div>
        <div class="xs muted" style="margin-top:3px">${esc(r.desc)}</div>
      </div>`).join('');
    const left = pri.lobbyBudget - pri.lobbied.length;
    const facs = party.factions.map((f) => {
      const done = pri.lobbied.includes(f.id);
      return `<button class="btn ${done ? 'ghost' : ''} xs" data-act="primary-lobby" data-id="${esc(f.id)}"
        ${done || left <= 0 ? 'disabled' : ''} style="padding:6px 11px">
        ${esc(f.name)}　<span class="muted">${esc(biWord('favor', f.favor))}</span></button>`;
    }).join('');
    return html`
      ${card(`${e.run.name}　黨內初選`, `
        <div class="small dim" style="line-height:1.8">${esc(pri.msg)}</div>`)}
      ${card('跟你搶的人', rivals)}
      ${card(`去談（還能跑 ${left} 個地方）`, `
        <div class="xs muted" style="line-height:1.7;margin-bottom:8px">
          每談一個派系要花 40 政治資本，成不成要看對方對你的好感。
          談成了，他們的票就是你的；談不成，那杯茶你也喝了。
        </div>
        <div class="btn-row" style="margin:0">${facs}</div>`)}
      ${card('', `<button class="btn primary full" data-act="primary-vote">開票</button>`)}`;
  }

  const field = e.primaryField ? barRows(e.primaryField.map((x) => ({
    label: x.name, value: x.share * 100, text: (x.share * 100).toFixed(1) + '%',
    color: x.isPlayer ? 'var(--gold)' : 'var(--line-2)',
  }))) : '';

  return html`
    ${card('初選結果', field + `
      <div class="small dim" style="line-height:1.8;margin-top:10px">${esc(e.primaryMsg ?? '')}</div>`)}
    ${card('', e.primaryWon === false ? `
      <div class="btn-row">
        <button class="btn" data-act="primary-accept">接受結果，留下來輔選</button>
        <button class="btn danger" data-act="primary-bolt">脫黨參選</button>
      </div>
      <button class="btn ghost full" data-act="primary-quit" style="margin-top:8px">心灰意冷</button>
      <div class="xs muted" style="margin-top:8px;line-height:1.7">
        沒有人規定你一定要繼續。有些人是在這種晚上決定不做了的，
        而且他們多半不是輸給對手，是輸給那個要再來一次的念頭。
      </div>` : `<button class="btn primary full" data-act="primary-next">進入選戰</button>`)}`;
}

function campaignPhase(s, data, e) {
  const left = (s.player.ap ?? 2) - s.player.apUsed;
  const poll = e.poll ?? [];
  return html`
    ${card(e.run.name, `
      ${row('競選經費', `<span class="num ${s.finance.campaign < 300000 * (e.run.level.costMult ?? 1) ? 'tone-warn' : ''}">${F.money(s.finance.campaign)}</span>`)}
      ${row('這個層級的行情', `<span class="small">${esc(e.run.level.budgetGuide ?? '')}</span>`)}
      ${row('已經花掉', `<span class="num">${F.money(e.spent ?? 0)}</span>`)}
      ${row('距離投票', `<span class="num">${e.weeksLeft} 週</span>`)}
      ${row('動員強度', `<span class="word">${esc(word('grassroots', e.mobilization ?? 0))}</span>`)}`)}

    ${card('選情預估', poll.length ? barRows(poll.map((p) => ({
      label: p.name, value: p.share * 100, text: (p.share * 100).toFixed(1) + '%',
      color: p.isPlayer ? 'var(--gold)' : partyColor(p.party),
    }))) + `<div class="xs muted" style="margin-top:8px;line-height:1.7">
        這只是估算。投票日當天還有一個誰也算不準的數字，通常是往上爆冷，不是往下。</div>`
      : '<div class="xs muted">還沒有民調。</div>')}

    ${card(`競選行動（剩 ${left} 點）`, CAMPAIGN_ACTIONS.map((a) => {
      const cost = actionCost(e.run, a);
      const dis = a.ap > left || s.finance.campaign < cost;
      return `<button class="opt ${dis ? 'locked' : ''}" data-act="campaign-action" data-id="${a.id}" ${dis ? 'disabled' : ''}>
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <span class="opt-t">${esc(a.name)}</span>
          <span class="xs muted">${a.ap} AP・${F.money(cost)}</span>
        </div>
        <div class="opt-h">${esc(a.desc)}</div></button>`;
    }).join('') + `<button class="btn primary full" data-act="end-turn" style="margin-top:6px">結束這一週</button>`)}`;
}

function resultPhase(s, data, e) {
  const r = e.outcome;
  const my = r.results.find((x) => x.candidate.isPlayer);
  return html`
    ${card('', `<div class="result-big">
      <div class="rb ${r.won ? 'tone-good' : 'tone-bad'}">${r.won ? '當　選' : '落　選'}</div>
      <div class="small muted" style="margin-top:8px">${esc(e.run.name)}</div>
      <div class="num" style="margin-top:6px">${F.int(my?.votes ?? 0)} 票　${((my?.share ?? 0) * 100).toFixed(2)}%</div>
    </div>`)}
    ${card('開票結果', barRows(r.results.map((x) => ({
      label: x.candidate.isPlayer ? s.player.name : x.candidate.name,
      value: x.share * 100, text: (x.share * 100).toFixed(1) + '%',
      color: x.candidate.isPlayer ? 'var(--gold)' : partyColor(x.candidate.party),
    }))))}
    ${card('', `<div class="small dim" style="line-height:1.8">${esc(e.resultText ?? '')}</div>
      <button class="btn primary full" data-act="close-election" style="margin-top:12px">繼續</button>`)}`;
}
