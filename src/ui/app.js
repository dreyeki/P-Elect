// @ts-check
import { el, html, raw, esc, delegate } from '../util/dom.js';
import { word, fill05 } from '../util/scale.js';
import * as F from '../util/format.js';
import { ROLE_NAME } from '../core/GameState.js';

export const app = {
  data: null, state: null, page: 'turn', pageArg: null,
  onAction: null,          // 由 main.js 注入
};

const NAV = [
  { id: 'turn', ico: '🏠', name: '首頁' },
  { id: 'politics', ico: '🏛️', name: '政治' },
  { id: 'data', ico: '📊', name: '數據' },
  { id: 'map', ico: '🗺️', name: '選區' },
  { id: 'team', ico: '👥', name: '團隊' },
  { id: 'finance', ico: '💰', name: '財務' },
  { id: 'profile', ico: '👤', name: '個人' },
];

const pages = {};
export function registerPage(id, fn) { pages[id] = fn; }

export function go(page, arg = null) {
  app.page = page; app.pageArg = arg;
  render();
  el('view').scrollTop = 0;
  window.scrollTo(0, 0);
}

export function render() {
  const s = app.state;
  if (!s) return;
  el('topbar').innerHTML = topbar(s);
  el('navbar').innerHTML = navbar(s);
  const fn = pages[app.page] ?? pages.turn;
  el('view').innerHTML = fn(s, app.data, app.pageArg);
}

function topbar(s) {
  const p = s.player;
  const ap = p.ap ?? 2;
  const dots = Array.from({ length: Math.max(ap, p.apUsed) }, (_, i) =>
    `<i class="${i < ap - p.apUsed ? 'on' : ''}"></i>`).join('');
  const office = p.office ? p.office.name : ROLE_NAME[p.role];
  const fat = s.player.fatigueRaw / 24;
  return html`
    <div class="tb-row">
      <span class="tb-date">${F.dateLabel(s.meta.year, s.meta.month, s.meta.scale, s.meta.weekIndex)}</span>
      <span class="tb-role">${office}${s.player.party ? '・' + (app.data.byId.party[s.player.party]?.shortName ?? '') : '・無黨籍'}</span>
    </div>
    <div class="tb-meta">
      <span>行動 <span class="ap-dots">${raw(dots)}</span></span>
      <span>政治資本 <b class="num">${raw(F.int(p.politicalCapital))}</b></span>
      <span>疲勞 <b class="${raw(fat >= 3 ? 'tone-bad' : fat >= 2 ? 'tone-warn' : 'tone-ok')}">${word('fatigue', fat)}</b></span>
      ${s.meta.scale === 'week' ? raw('<span class="chip warn">選戰期</span>') : raw('')}
    </div>`;
}

function navbar(s) {
  const pend = s.pendingEvents.length + s.finance.pending.length + (s.flags.recruitOffer ? 1 : 0);
  return NAV.map((n) => html`
    <button data-nav="${n.id}" class="${raw(app.page === n.id ? 'on' : '')}">
      <span class="ico">${n.ico}${raw(n.id === 'turn' && pend ? '<span class="dot"></span>' : '')}</span>
      <span>${n.name}</span>
    </button>`).join('');
}

/* ── Modal ── */
let modalStack = [];
export function openModal(inner, opts = {}) {
  const root = el('modalRoot');
  modalStack.push(inner);
  root.innerHTML = `<div class="modal-bd" data-modal-bd><div class="modal">${inner}</div></div>`;
  if (opts.onMount) opts.onMount(root);
}
export function closeModal() { modalStack = []; el('modalRoot').innerHTML = ''; }
export function isModalOpen() { return !!el('modalRoot').firstChild; }

export function toast(msg, ms = 2600) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

export function confirmModal(title, body, okText, onOk) {
  openModal(html`
    <div class="modal-h">${title}</div>
    <div class="modal-b">${body}</div>
    <div class="btn-row">
      <button class="btn primary" data-act="confirm-ok">${okText}</button>
      <button class="btn ghost" data-act="modal-close">再想想</button>
    </div>`);
  app._confirmCb = onOk;
}

/* ── 全域事件委派 ── */
export function bindEvents(handler) {
  document.body.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { closeModal(); go(nav.dataset.nav); return; }
    const bd = e.target.closest('[data-modal-bd]');
    const inModal = e.target.closest('.modal');
    if (bd && !inModal) { closeModal(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'modal-close') { closeModal(); return; }
    if (a === 'confirm-ok') { const cb = app._confirmCb; closeModal(); cb?.(); return; }
    handler(a, act.dataset, act);
  });
  document.body.addEventListener('change', (e) => {
    const f = e.target.closest('[data-change]');
    if (f) handler(f.dataset.change, { ...f.dataset, value: f.value }, f);
  });
}

export const partyColor = (pid) => {
  const p = app.data?.byId.party[pid];
  return p?.color ?? (app.state?.parties[pid]?.color) ?? 'var(--ind)';
};
export const partyName = (pid) => app.state?.parties[pid]?.shortName ?? app.data?.byId.party[pid]?.shortName ?? pid;
