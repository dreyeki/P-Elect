// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, row, tile } from '../components.js';
import { barRows } from '../charts.js';
import * as F from '../../util/format.js';
import { word, biWord } from '../../util/scale.js';
import { partyColor } from '../app.js';
import * as Election from '../../systems/ElectionSystem.js';

/**
 * 競選行動。cost 是「議員層級」的基準價，
 * 實際花費會乘上該場選舉的 costMult——立委是議員的三點六倍，總統是四十五倍。
 * 一場議員選戰打滿大約一百到三百萬，立委兩百萬到兩千萬，跟現實對得上。
 */
export const CAMPAIGN_ACTIONS = [
  // 掃街拜票的成本是鞋子跟時間，不是錢。破產的候選人如果連街都掃不了，
  // 這場選戰就只剩下按結束這一週這一個選項。
  { id: 'street', name: '掃街拜票', ap: 1, cost: 0, fatigue: 12,
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

/**
 * 黨中央怎麼看這個選區。
 *
 * 這一格要講清楚一件很冷的事：黨部把錢往打得下來的地方倒。
 * 穩贏的不用給，穩輸的給了也是丟到水裡，只有五五波的地方值得投資。
 * 玩家看得到自己被分在哪一級，也就知道為什麼電話沒有人接。
 */
function assessBlock(s, data, e) {
  const A = data.elections.partyAssess;
  if (!A) return '';
  if (!s.player.party) {
    return card(A.text.header, `<div class="xs muted" style="line-height:1.75">${esc(A.text.none)}</div>`);
  }
  const a = Election.assessDistrict(s, data, e.run);
  if (!a) return '';
  const pct = Math.round(a.resource / 1.6 * 100);
  return card(A.text.header, `
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k">這個選區的分級</span>
        <span class="word ${a.tier.tone === 'bad' ? 'tone-bad' : a.tier.tone === 'warn' ? 'tone-warn' : 'tone-ok'}">${esc(a.tier.name)}</span>
      </div>
      <div class="xs muted" style="margin-top:4px;line-height:1.7">${esc(a.tier.desc)}</div>
    </div>
    ${row('估計勝算', `<span class="num">${(a.odds * 100).toFixed(0)}%</span>`)}
    ${row('應選席次', `<span class="num">${a.seats}</span>${a.single
      ? '<span class="xs muted">　贏一票就全拿，黨部的邊際效益最高</span>'
      : '<span class="xs muted">　多一點票只是名次往前挪</span>'}`)}
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k">中央挹注</span>
        <span class="row-v xs ${e.partyFunded ? 'tone-ok' : 'muted'}">${
          e.partyFunded ? '已撥款' : `第 ${A.support.arrivalTurn} 週撥下來`}</span>
      </div>
      <div class="bar b"><i style="width:${pct}%"></i></div>
      <div class="xs muted" style="margin-top:4px;line-height:1.7">${esc(a.tier.note)}</div>
    </div>
    <div class="xs muted" style="margin-top:8px;line-height:1.75">${esc(A.text.explain)}</div>`);
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

    ${raw(assessBlock(s, data, e))}

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
    }).join('') + `<button class="btn primary full" data-act="end-turn" style="margin-top:6px">結束這一週</button>`)}

    ${raw(s.flags?.debug ? card('<span class="tone-bad">調試模式</span>', `
      <div class="xs muted" style="line-height:1.7;margin-bottom:8px">
        直接跳過剩下的週數開票，而且把你排到第一名。
        後面的授職、補助款與生涯紀錄照原本的流程跑，只有票數是假的。
      </div>
      <button class="btn full danger" data-act="dbg-win">強制勝選</button>`) : '')}`;
}

/**
 * 同一天開出來的其他票。
 *
 * 台灣的選舉是綁在一起投的，而下層級的結果很大程度取決於上層級——
 * 縣市長選情好的那一邊，議員會多上幾席。玩家那一席有沒有一部分
 * 不是他自己贏來的，要在同一個畫面上看得到。
 */
function ticketBlock(s, data, e) {
  const races = e.ticket ?? [];
  if (!races.length) return '';
  const myParty = s.player.party;
  const rows = races.map((r) => {
    const party = data.byId.party[r.winnerParty];
    const mine = myParty && r.winnerParty === myParty;
    if (r.seatSplit) {
      const split = r.seatSplit.map((x) => {
        const p = data.byId.party[x.pid];
        return `<span style="color:${partyColor(x.pid)}">${esc(p?.shortName ?? x.pid)} ${x.seats}</span>`;
      }).join('　');
      return `<div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="row-k">${esc(r.name)}</span>
          <span class="row-v xs muted">應選 ${r.seats} 席</span>
        </div>
        <div class="xs" style="margin-top:3px;line-height:1.7">${raw(split)}</div>
      </div>`;
    }
    return `<div class="row">
      <span class="row-k">${esc(r.name)}</span>
      <span class="row-v">
        <span style="color:${partyColor(r.winnerParty)}">${esc(party?.shortName ?? '無黨籍')}</span>
        <span class="${mine ? 'tone-ok' : ''}">${esc(r.winnerName)}</span>
        <span class="xs muted">　${(r.share * 100).toFixed(1)}%</span>
      </span></div>`;
  }).join('');
  return card(data.elections.sameDay?.text?.header ?? '同一天開出來的其他票', rows + `
    <div class="xs muted" style="margin-top:8px;line-height:1.7">
      這幾張票是同一天投的，而且是同一批人投的。上面那一格的氣勢會一路帶到下面幾格，
      這件事在台灣叫母雞帶小雞。
    </div>`);
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
    ${raw(ticketBlock(s, data, e))}
    ${card('', `<div class="small dim" style="line-height:1.8">${esc(e.resultText ?? '')}</div>
      ${e.coattailText ? `<div class="small dim" style="line-height:1.8;margin-top:10px;
        padding-top:10px;border-top:1px solid var(--line);white-space:pre-wrap">${esc(e.coattailText)}</div>` : ''}
      ${e.subsidyText ? `<div class="small dim" style="line-height:1.8;margin-top:10px;
        padding-top:10px;border-top:1px solid var(--line)">${esc(e.subsidyText)}</div>` : ''}
      <button class="btn primary full" data-act="close-election" style="margin-top:12px">繼續</button>`)}`;
}
