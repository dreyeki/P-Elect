// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, row, wordRow, tile, effectPreview, chip } from '../components.js';
import * as F from '../../util/format.js';
import { word } from '../../util/scale.js';
import { ACTIONS, apOf } from '../../systems/CharacterSystem.js';
import { app } from '../app.js';

export function turnPage(s, data) {
  const pend = pending(s, data);
  const news = s.news.slice(0, 14);
  const approval = s.flags.approval ?? 50;

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

    ${card('民調與風向', `
      <div class="grid3">
        ${tile('支持度', `<span class="num">${approval.toFixed(1)}%</span>`)}
        ${tile('全國生活水準', `<span class="word">${word('sol', s.flags.avgSol ?? 2)}</span>`, '', 'sm')}
        ${tile('最熱議題', `<span class="word">${esc(hottest(s, data))}</span>`, '', 'sm')}
      </div>`)}

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
  const grid = ACTIONS.map((a) => {
    const dis = blocked || a.ap > left;
    return `<button class="actbtn ${dis ? 'locked' : ''}" data-act="do-action" data-id="${a.id}"
      title="${esc(a.desc)}" ${dis ? 'disabled' : ''}>
      <span class="an">${esc(a.name)}</span><span class="aa">${a.ap}</span>
    </button>`;
  }).join('');
  const hint = blocked ? '你在住院，這個月什麼都做不了。'
    : left <= 0 ? '這個月的時間已經用完了。' : ACTIONS[0].desc;
  return `<div class="actgrid">${grid}</div>
    <div class="xs muted" id="actHint" style="margin-top:8px;line-height:1.6">${esc(hint)}</div>
    <button class="btn primary full" data-act="end-turn" style="margin-top:10px">結束這個回合</button>`;
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
