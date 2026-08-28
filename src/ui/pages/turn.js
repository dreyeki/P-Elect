// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, row, wordRow, tile, effectPreview, chip } from '../components.js';
import * as F from '../../util/format.js';
import { word } from '../../util/scale.js';
import { ACTIONS, apOf, actionState, lockedActions } from '../../systems/CharacterSystem.js';
import { latestPublic, latestAny } from '../../systems/PollSystem.js';
import { biWord } from '../../util/scale.js';
import { app } from '../app.js';

export function turnPage(s, data) {
  const pend = pending(s, data);
  const news = s.news.slice(0, 14);

  return html`
    ${raw(s.player.hospitalTurns > 0 ? card('', `
      <div style="text-align:center;padding:6px 0">
        <div class="tile-v tone-bad">你正在住院</div>
        <div class="small muted" style="margin-top:6px;line-height:1.7">
          醫生要你把行程全部推掉，接下來 ${s.player.hospitalTurns} 個回合由團隊代理。
          支持者送來的花把病房堆滿了，對手則在這段時間往前走了一大步。
        </div>
      </div>`) : '')}

    ${raw(pend.length ? card(`待決事項 ${pend.length}`, pend.join('')) : '')}

    ${card('本回合行動', actionList(s, data), `<span class="xs muted">剩 ${apOf(s, data) - s.player.apUsed} 點</span>`)}

    ${card('民調與風向', pollBlock(s, data))}

    ${card('新聞', news.length ? news.map(newsRow).join('') : '<div class="xs muted">這個月島上很安靜，沒有什麼值得上報的事。</div>')}
  `;
}

function newsRow(n) {
  return `<div class="news k-${esc(n.kind ?? 'x')}"><div class="news-t">${esc(n.text)}</div></div>`;
}

function pending(s, data) {
  const out = [];
  for (const ev of s.pendingEvents) {
    out.push(`<button class="pending" data-act="open-event" data-id="${esc(ev.id)}">
      <span class="pi">${icon(ev.category)}</span>
      <span><span class="ph">${esc(ev.headline)}</span>
      <span class="pb">${esc(ev.body.slice(0, 46))}…</span></span></button>`);
  }
  for (const d of s.finance.pending) {
    out.push(`<button class="pending" data-act="open-donation" data-id="${esc(d.id)}">
      <span class="pi">💰</span>
      <span><span class="ph">${esc(d.donorName)} 政治獻金 ${esc(F.money(d.amount))}</span>
      <span class="pb">${d.condition ? esc(d.condition.desc) : '對方表示沒有任何附帶條件。'}</span></span></button>`);
  }
  for (const inv of (s.invitations ?? []).slice(0, 2)) {
    const show = data.byId.show[inv.showId];
    out.push(`<button class="pending" data-act="open-shows">
      <span class="pi">🎙️</span>
      <span><span class="ph">${esc(show.name)} 發來通告</span>
      <span class="pb">這集要談${esc(inv.topicName)}，還有 ${inv.expiresIn} 個回合可以答應。</span></span></button>`);
  }
  if (s.flags.recruitOffer) {
    const r = s.flags.recruitOffer;
    out.push(`<button class="pending" data-act="open-recruit">
      <span class="pi">🧑‍💼</span>
      <span><span class="ph">${esc(r.name)} 想來當你的${esc(r.roleName)}</span>
      <span class="pb">能力 ${esc(word('ability', r.ability))}，月薪開 ${esc(F.money(r.salary))}。</span></span></button>`);
  }
  if (s.election?.phase === 'decide') {
    out.push(`<button class="pending" data-act="nav-election">
      <span class="pi">🗳️</span>
      <span><span class="ph">選舉登記就要截止了</span>
      <span class="pb">你必須決定這一次要不要出來選，選哪一個位子。</span></span></button>`);
  }
  return out;
}

const ICONS = { economy: '📈', energy: '⚡', crossStrait: '🌊', disaster: '🌀', society: '🏙️', scandal: '🔍', party: '🏳️', personal: '🏠', world: '🌏', law: '📜' };
const icon = (c) => ICONS[c] ?? '📰';

function actionList(s, data) {
  const left = apOf(s, data) - s.player.apUsed;
  const blocked = s.player.hospitalTurns > 0;
  const open = ACTIONS.filter((a) => actionState(s, data, a).unlocked);
  const grid = open.map((a) => {
    const dis = blocked || a.ap > left;
    return `<button class="actbtn ${dis ? 'locked' : ''}" data-act="do-action" data-id="${a.id}"
      title="${esc(a.desc)}" ${dis ? 'disabled' : ''}>
      <span class="an">${esc(a.name)}</span><span class="aa">${a.ap}</span>
    </button>`;
  }).join('');
  const locked = lockedActions(s, data);
  const lockedBlock = locked.length ? `
    <details class="lockbox">
      <summary>還沒解鎖的 ${locked.length} 項</summary>
      ${locked.map((x) => `<div class="lockrow"><b>${esc(x.a.name)}</b><span>${esc(x.st.why ?? '')}</span></div>`).join('')}
    </details>` : '';
  const hint = blocked ? '你在住院，這個月什麼都做不了。'
    : left <= 0 ? '這個月的時間已經用完了。' : open[0].desc;
  return `<div class="actgrid">${grid}</div>
    <div class="xs muted" style="margin-top:8px;line-height:1.6">${esc(hint)}</div>
    ${lockedBlock}
    <button class="btn primary full" data-act="end-turn" style="margin-top:10px">結束這個回合</button>`;
}

/** 民調要有人做才有。沒人做的時候，這一格就該老實承認自己不知道。 */
function pollBlock(s, data) {
  const pub = latestPublic(s);
  const any = latestAny(s);
  const idx = any ? (s.polls ?? []).indexOf(any) : -1;
  const ago = any ? s.meta.turn - any.turn : null;
  const hot = hottest(s, data);

  if (!any) {
    return `<div class="small muted" style="line-height:1.8">
      最近沒有任何一家民調公司做過調查，你手上也沒有自己的數字。
      在這一行，不知道自己站在哪裡，比站得不好還危險。</div>
      <div class="grid2" style="margin-top:10px">
        ${tile('最熱議題', `<span class="word">${esc(hot)}</span>`, '', 'sm')}
        ${tile('本月新聞', `<span class="num">${s.news.filter((n) => n.turn === s.meta.turn - 1).length}</span>`, '則')}
      </div>
      <button class="btn full" data-act="open-commission" style="margin-top:10px">花錢做一份自己的民調</button>`;
  }

  const mine = any.playerListed
    ? `<span class="num">${any.playerApproval.toFixed(1)}%</span>`
    : '<span class="small muted">未列入</span>';
  const src = `${any.pollsterShort}${any.internal ? '（內參）' : ''}・${ago === 0 ? '本回合' : ago + ' 回合前'}・${any.scopeName}`;

  return `<div class="grid3">
      ${tile('你的支持度', mine, esc(src), 'sm')}
      ${tile('總統滿意度', `<span class="num">${any.presidentApproval.toFixed(0)}%</span>`, '', 'sm')}
      ${tile('最熱議題', `<span class="word">${esc(hot)}</span>`, '', 'sm')}
    </div>
    ${!any.playerListed ? `<div class="xs muted" style="margin-top:8px;line-height:1.7">
      你的知名度還不夠讓民調公司把你放進題目裡。想被問到，得先讓人記得你的名字。</div>` : ''}
    ${any.internal ? '' : `<div class="xs muted" style="margin-top:8px;line-height:1.7">
      這是公開民調，帶著${any.bias > 1 ? '偏藍' : any.bias < -1 ? '偏綠' : '中性'}的房效應與 ±${any.error.toFixed(1)}% 的誤差。想要準的，得自己花錢。</div>`}
    <div class="btn-row">
      <button class="btn ghost" data-act="open-poll" data-idx="${idx}">看這份民調</button>
      <button class="btn ghost" data-act="open-commission">委託內參民調</button>
    </div>`;
}

function hottest(s, data) {
  let best = null, v = -1;
  for (const i of data.issues.issues) if (s.issues[i.id] > v) { v = s.issues[i.id]; best = i; }
  return best ? `${best.name}・${word('issueHeat', v)}` : '無';
}

/** 事件 Modal */
export function eventModal(ev, s) {
  const opts = ev.options.map((o) => `
    <button class="opt" data-act="pick-option" data-ev="${esc(ev.id)}" data-idx="${o.idx}">
      <div class="opt-t">${esc(o.text)}</div>
      ${o.hint ? `<div class="opt-h">${esc(o.hint)}</div>` : ''}
      ${effectPreview(o.effects)}
    </button>`).join('');
  return `<div class="modal-h">${esc(ev.headline)}</div>
    <div class="modal-b">${esc(ev.body)}</div>${opts}`;
}
