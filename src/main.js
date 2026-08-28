// @ts-check
import { loadData } from './data/loader.js';
import { initScales, word } from './util/scale.js';
import { createGame } from './core/GameState.js';
import { advance } from './core/TurnEngine.js';
import { Rng, randomSeedString } from './core/Rng.js';
import { el, html, raw, esc } from './util/dom.js';
import * as F from './util/format.js';
import * as SaveMgr from './save/SaveManager.js';

import { app, registerPage, render, go, openModal, closeModal, toast, bindEvents, confirmModal, partyColor } from './ui/app.js';
import { turnPage, eventModal } from './ui/pages/turn.js';
import { politicsPage, lawModal } from './ui/pages/politics.js';
import { dataPage } from './ui/pages/data.js';
import { mapPage } from './ui/pages/map.js';
import { teamPage, financePage, profilePage } from './ui/pages/misc.js';
import { setupPage, setupDraft } from './ui/pages/setup.js';
import { electionPage, CAMPAIGN_ACTIONS } from './ui/pages/election.js';

import * as Events from './systems/EventSystem.js';
import * as Char from './systems/CharacterSystem.js';
import * as Fin from './systems/FinanceSystem.js';
import * as Team from './systems/TeamSystem.js';
import * as Legis from './systems/LegislatureSystem.js';
import * as Council from './systems/CouncilSystem.js';
import * as Budget from './systems/BudgetSystem.js';
import * as Party from './systems/PartySystem.js';
import * as Interp from './systems/InterpellationSystem.js';
import * as Media from './systems/MediaSystem.js';
import * as District from './systems/DistrictSystem.js';
import * as Election from './systems/ElectionSystem.js';
import { applyEffects, bumpCounter } from './systems/Effects.js';
import { clamp, clamp05, clampBi } from './core/Formula.js';

let DATA = null;
const ui = { politicsTab: 'overview', dataTab: 'macro', mapMode: 'favor', mapArg: null, lawPick: {} };

/* ─────────── 啟動 ─────────── */
(async function boot() {
  try {
    DATA = await loadData((p, name) => {
      el('bootBar').style.width = (p * 100).toFixed(0) + '%';
      el('bootMsg').textContent = `正在載入 ${name} …`;
    });
    initScales(DATA.scales);
    app.data = DATA;
    registerPages();
    bindEvents(handle);
    document.documentElement.dataset.fs = localStorage.getItem('p-election:fs') ?? 'm';

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    el('boot').hidden = true;
    el('app').hidden = false;
    const auto = SaveMgr.load('auto');
    if (auto) { app.state = auto; go('turn'); toast('已讀取上次的自動存檔。'); }
    else showSetup();
  } catch (e) {
    console.error(e);
    el('bootMsg').textContent = '載入失敗：' + e.message;
  }
})();

function registerPages() {
  registerPage('turn', (s, d) => s.election?.phase && s.election.phase !== 'idle' ? electionPage(s, d) : turnPage(s, d));
  registerPage('politics', (s, d) => politicsPage(s, d, ui.politicsTab));
  registerPage('data', (s, d) => dataPage(s, d, ui.dataTab));
  registerPage('map', (s, d) => mapPage(s, d, ui.mapArg ?? { mode: ui.mapMode }));
  registerPage('team', teamPage);
  registerPage('finance', financePage);
  registerPage('profile', profilePage);
  registerPage('setup', () => setupPage(DATA));
}

function showSetup() {
  app.state = null;
  el('topbar').innerHTML = '';
  el('navbar').innerHTML = '';
  el('view').innerHTML = setupPage(DATA);
  app.page = 'setup';
}

/* ─────────── 事件分派 ─────────── */
function handle(act, ds) {
  const s = app.state;
  const fns = {
    /* 建角 */
    'setup-step': () => { setupDraft.step = clamp(+ds.id, 0, 4); reSetup(); },
    'setup-start': () => { setupDraft.startId = ds.id; reSetup(); },
    'setup-bg': () => { setupDraft.backgroundId = ds.id; reSetup(); },
    'setup-district': () => { setupDraft.homeDistrict = ds.id; reSetup(); },
    'setup-name': () => { setupDraft.name = ds.value; },
    'setup-gender': () => { setupDraft.gender = ds.value; },
    'setup-edu': () => { setupDraft.education = ds.value; },
    'setup-region': () => { setupDraft.homeRegion = ds.value; setupDraft.homeDistrict = null; reSetup(); },
    'setup-ideo': () => { setupDraft.ideology[ds.id] = +ds.value; reSetup(); },
    'setup-seed': () => { setupDraft.seedStr = ds.value.toUpperCase(); },
    'reroll-seed': () => { setupDraft.seedStr = randomSeedString(); reSetup(); },
    'start-game': startGame,
    'load-game': () => {
      const st = SaveMgr.load(ds.id);
      if (!st) return toast('那個欄位是空的。');
      app.state = st; go('turn'); toast('讀檔完成。');
    },
    'import-save': () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = async () => {
        try { app.state = await SaveMgr.importFile(inp.files[0]); go('turn'); toast('存檔匯入完成。'); }
        catch (e) { toast('這個檔案讀不起來：' + e.message); }
      };
      inp.click();
    },

    /* 回合 */
    'end-turn': endTurn,
    'do-action': () => doAction(ds.id),
    'open-event': () => {
      const ev = s.pendingEvents.find((e) => e.id === ds.id);
      if (ev) openModal(eventModal(ev, s));
    },
    'pick-option': () => {
      const ev = s.pendingEvents.find((e) => e.id === ds.ev);
      if (!ev) return closeModal();
      Events.resolve(s, DATA, ev, +ds.idx);
      s.pendingEvents = s.pendingEvents.filter((e) => e !== ev);
      closeModal(); render();
    },
    'open-donation': () => go('finance'),
    'open-recruit': () => go('team'),
    'nav-election': () => go('turn'),

    /* 政治 */
    'politics-tab': () => { ui.politicsTab = ds.id; render(); },
    'open-law': () => { ui.lawPick[ds.id] = s.laws[ds.id]; openModal(lawModal(s, DATA, ds.id, ui.lawPick[ds.id])); },
    'law-pick': () => { ui.lawPick[ds.id] = +ds.idx; openModal(lawModal(s, DATA, ds.id, +ds.idx)); },
    'propose-law': (d) => proposeLaw(d),
    'push-bill': () => {
      if (s.player.politicalCapital < 50) return toast('政治資本不夠。');
      Legis.pushBill(s, ds.id, 50);
      toast('你動用了人脈跟資源，這個案子的動能明顯不一樣了。'); render();
    },
    'visit-faction': () => doAction('faction', ds.id),
    'challenge': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter++);
      const r = Party.challengeLeadership(s, DATA, ds.id, rng);
      toast(r.msg); render();
    },
    'budget-slide': () => {
      ui.budgetDraft ??= { ...(s.flags.budgetAlloc ?? Object.fromEntries(DATA.budget.categories.map((c) => [c.id, c.share]))) };
      ui.budgetDraft[ds.id] = +ds.value / 100;
    },
    'budget-apply': () => {
      if (!ui.budgetDraft) return toast('你還沒有調整任何科目。');
      Budget.setAllocation(s, DATA, ui.budgetDraft);
      ui.budgetDraft = null;
      toast('預算案已經送出。接下來要看立法院願意讓你砍掉多少。'); render();
    },
    'special-budget': () => { const r = Budget.launchSpecialBudget(s, DATA, ds.id); toast(r.msg); render(); },
    'open-interp': () => openInterp(),
    'interp-style': (d) => runInterp(d),
    'open-bill': (d) => openLocalBill(d),
    'bill-propose': (d) => proposeLocalBill(d),

    /* 數據與地圖 */
    'data-tab': () => { ui.dataTab = ds.id; render(); },
    'map-mode': () => { ui.mapMode = ds.id; ui.mapArg = { mode: ds.id }; render(); },
    'map-back': () => { ui.mapArg = { mode: ui.mapMode }; render(); },
    'open-region': () => { ui.mapArg = { region: ds.id }; app.page = 'map'; render(); },
    'open-district': () => { ui.mapArg = { district: ds.id }; app.page = 'map'; render(); },
    'toggle-office': () => {
      const d = s.districts[ds.id];
      d.serviceOffice = !d.serviceOffice;
      toast(d.serviceOffice ? '服務處掛牌了。從今天起每個月都要付租金跟人事費。' : '服務處收了。地方上的人會記得這件事。');
      render();
    },
    'canvass-here': () => doAction('canvass', ds.id),

    /* 團隊 */
    'hire': () => {
      Team.hire(s, s.flags.recruitOffer);
      toast('他明天就來上班。'); render();
    },
    'decline-hire': () => { s.flags.recruitOffer = null; render(); },
    'train-staff': () => doAction('trainStaff', ds.id),
    'fire-staff': () => confirmModal('請他離開？',
      '被辭退的幕僚不一定會安靜地走。如果他知道太多，這個決定可能會回頭找你。',
      '確定', () => { Team.fire(s, ds.id); toast('他今天下午就把東西收走了。'); render(); }),

    /* 財務 */
    'accept-donation': () => {
      const r = Fin.acceptDonation(s, DATA, ds.id);
      if (r.ok) { toast(`${F.money(r.donation.amount)} 已經進到專戶。`); Team.witnessSecret(s); }
      render();
    },
    'refuse-donation': () => { Fin.refuseDonation(s, DATA, ds.id); toast('你把信封推了回去。對方笑了一下，沒有再說什麼。'); render(); },
    'transfer': () => { const amt = Fin.transferToCampaign(s, +ds.amt); toast(`已轉入 ${F.money(amt)}。`); render(); },

    /* 個人與系統 */
    'save-game': () => { const r = SaveMgr.save(s, ds.id); toast(r.ok ? `已存到欄位${ds.id}（${(r.bytes / 1024 / 1024).toFixed(2)} MB）。` : r.msg); },
    'export-save': () => SaveMgr.exportFile(s),
    'fontsize': () => { document.documentElement.dataset.fs = ds.id; localStorage.setItem('p-election:fs', ds.id); },
    'restart': () => confirmModal('重新開始？', '目前這一局的所有進度都會消失，除非你已經存過檔。', '重新開始', showSetup),

    /* 選舉 */
    'pick-run': (d) => pickRun(d),
    'primary-accept': () => { s.election = null; toast('你留下來輔選。這一次的人情，下一次會有人記得。'); render(); },
    'primary-bolt': boltParty,
    'primary-next': () => { s.election.phase = 'campaign'; updatePoll(); render(); },
    'campaign-action': (d) => campaignAction(d),
    'close-election': () => { s.election = null; go('turn'); },
  };
  (fns[act] ?? ((d) => console.warn('未處理的動作', act, d)))(ds);
}

const reSetup = () => { el('view').innerHTML = setupPage(DATA); };

/* ─────────── 開局 ─────────── */
function startGame() {
  const d = setupDraft;
  if (!d.name.trim() || !d.backgroundId || !d.homeDistrict) return toast('還有必填欄位沒完成。');
  app.state = createGame(DATA, {
    seedStr: d.seedStr || randomSeedString(),
    name: d.name.trim(), gender: d.gender, education: d.education,
    startId: d.startId, backgroundId: d.backgroundId,
    homeDistrict: d.homeDistrict, party: null, ideology: { ...d.ideology },
  });
  go('turn');
  askPartyChoice();
}

function askPartyChoice() {
  const s = app.state;
  const opts = DATA.starts.partyChoice.map((c) => {
    if (c.id === 'independent') {
      return `<button class="opt" data-act="choose-party" data-pid="">
        <div class="opt-t">${esc(c.name)}</div><div class="opt-h">${esc(c.desc)}</div></button>`;
    }
    return c.options.map((pid) => {
      const p = DATA.byId.party[pid];
      return `<button class="opt" data-act="choose-party" data-pid="${pid}">
        <div class="opt-t" style="color:${p.color}">${esc(p.name)}</div>
        <div class="opt-h">${esc(c.name)}｜${esc(c.desc)}</div></button>`;
    }).join('');
  }).join('');
  openModal(`<div class="modal-h">你要靠哪一邊</div>
    <div class="modal-b">這個決定會塑造你接下來八年的整個玩法。大黨有資源但要排隊，小黨出頭快但天花板低，無黨籍什麼都得自己來。</div>${opts}`);
  const orig = handle;
  document.body.addEventListener('click', function once(e) {
    const t = e.target.closest('[data-act="choose-party"]');
    if (!t) return;
    document.body.removeEventListener('click', once);
    const pid = t.dataset.pid || null;
    joinParty(pid);
    closeModal(); render();
  });
}

function joinParty(pid) {
  const s = app.state;
  s.player.party = pid;
  if (!pid) { toast('你決定誰都不靠。'); return; }
  const choice = DATA.starts.partyChoice.find((c) => c.options.includes(pid));
  const p = s.parties[pid];
  p.factions.forEach((f) => { f.favor = 0.5; });
  s.finance.campaign += choice?.effects.campaignFunds ?? 0;
  s.player.partyPrestige = clamp05(s.player.partyPrestige + (choice?.effects.partyPrestige ?? 0));
  s.player.fame = clamp05(s.player.fame + (choice?.effects.fame ?? 0));
  const home = s.districts[s.player.homeDistrict];
  if (home && choice?.effects.grassrootsBonus) home.playerGrassroots = clamp05(home.playerGrassroots + choice.effects.grassrootsBonus);
  s.player.careerLog.push({ turn: 1, kind: 'join', text: `加入${p.name}` });
  toast(`你加入了${p.name}。`);
}

/* ─────────── 回合推進 ─────────── */
function endTurn() {
  const s = app.state;
  if (s.pendingEvents.length) {
    return confirmModal('還有事情沒處理', '待決事項如果不處理，事情會自己往壞的方向走，而且你不會知道原本可以怎樣。', '直接結束回合', () => { s.pendingEvents = []; reallyEnd(); });
  }
  reallyEnd();
}
function reallyEnd() {
  const s = app.state;
  advance(s, DATA);
  checkElection();
  SaveMgr.save(s, 'auto');
  ui.mapArg = { mode: ui.mapMode };
  render();
}

function doAction(id, arg) {
  const s = app.state;
  const r = Char.doAction(s, DATA, id, { arg });
  if (!r.ok) return toast(r.msg);
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const msg = resolveAction(s, id, arg, rng);
  s.meta.rngCounter = rng.counter;
  s.player.ap = Char.apOf(s, DATA);
  toast(msg);
  render();
}

function resolveAction(s, id, arg, rng) {
  const p = s.player;
  switch (id) {
    case 'canvass': {
      const did = arg ?? p.homeDistrict;
      const d = s.districts[did];
      if (!d) return '你不知道要去哪裡跑。';
      const organizer = Team.teamBonus(s, DATA, 'grassrootsGrowth');
      District.grow(s, did, 0.2 + organizer * 0.25);
      d.playerFavor = clampBi(d.playerFavor + 0.25);
      s.finance.campaign -= 30000;
      return `你在${DATA.byId.district[did].name}跑了一整個月，握到的手比講過的話多。`;
    }
    case 'talkshow': {
      const roll = p.attrs.eloquence * 12 + p.attrs.charisma * 6 + rng.range(-20, 20);
      p.fame = clamp05(p.fame + 0.18);
      if (roll > 45) { p.favorNational = clampBi(p.favorNational + 0.3); return '你今天講得很好，片段被剪下來在網路上流傳了一整天。'; }
      if (roll < 15) { p.favorNational = clampBi(p.favorNational - 0.4); bumpCounter(s, DATA, 'interpellationFail'); return '你講錯了一句話，主持人當場愣住，那三秒鐘現在已經是迷因了。'; }
      return '節目平順地錄完，有講到你想講的，也有講到不該講的。';
    }
    case 'presser': {
      const heat = Object.entries(s.issues).sort((a, b) => b[1] - a[1])[0][0];
      const r = Media.pressConference(s, DATA, heat, rng);
      return r.text;
    }
    case 'draftLaw':
      s.flags.draftBank = (s.flags.draftBank ?? 0) + 1;
      return '你把條文從頭到尾改了一遍，這一版禁得起委員會的挑剔。';
    case 'prepQuestion':
      Interp.prepare(s);
      return `你把資料讀熟了。現在的準備程度是「${word('prep', s.flags.interpPrep)}」。`;
    case 'fundraise': {
      const amt = Math.round((rng.range(300000, 1800000) * (0.6 + p.fame * 0.35)) / 10000) * 10000;
      s.finance.campaign += amt;
      if (rng.bool(0.18)) { p.stigma = clamp05(p.stigma + 0.15); return `募到 ${F.money(amt)}。席間有幾個人講的話，你聽了以後假裝沒聽到。`; }
      return `募款餐會辦得還算順利，專戶入帳 ${F.money(amt)}。`;
    }
    case 'faction': {
      if (!p.party) return '你沒有政黨，沒有派系大老可以拜會。';
      const party = s.parties[p.party];
      const fac = arg ? party.factions.find((f) => f.id === arg) : rng.pick(party.factions);
      if (!fac) return '找不到那個派系。';
      fac.favor = clampBi(fac.favor + 0.5);
      if (rng.bool(0.35)) { p.politicalCapital = Math.max(0, p.politicalCapital - 10); return `${fac.name}的前輩很客氣地泡了茶，然後很自然地提起一個人的名字。`; }
      return `你去拜會了${fac.name}，該講的場面話都講了，關係近了一點。`;
    }
    case 'trainStaff': {
      const kind = Team.train(s, arg ?? s.team[0]?.id, rng);
      if (!kind) return '你沒有可以帶的人。';
      return kind === 'ability' ? '他今天問的問題比上個月有深度多了。' : '你們聊到很晚，有些話講開了以後，事情就不一樣了。';
    }
    case 'visit': {
      const d = s.central.diplomacy;
      d.usRelation = clampBi(d.usRelation + 0.2);
      p.fame = clamp05(p.fame + 0.15);
      return '這趟出訪很累，但你回來以後講的話，跟出發前不太一樣了。';
    }
    case 'study': {
      const attr = rng.pick(['eloquence', 'judgment', 'sociability', 'charisma']);
      const NAME = { eloquence: '口才', judgment: '判斷', sociability: '交際', charisma: '魅力' };
      const up = Char.study(s, attr);
      return up ? `你在${NAME[attr]}上明顯進步了，現在是「${word(attr, p.attrs[attr])}」。`
        : '你讀完了一本書。這種累積短期內看不出來，但它一直在那裡。';
    }
    case 'dealmaking': {
      p.politicalCapital = Math.min(999, p.politicalCapital + 35);
      p.stigma = clamp05(p.stigma + 0.2);
      Team.witnessSecret(s);
      return '有些事在檯面上永遠談不成，在檯面下十分鐘就有了結論。房間裡的每個人都記得今天。';
    }
    case 'family':
      s.flags.familyDebt = 0;
      return '你難得跟家人好好吃了一頓飯，沒有人提到選舉。';
    case 'rest':
      return '你把整個月的行程都推掉了。幕僚鬆了一口氣，對手也鬆了一口氣。';
  }
  return '完成了。';
}

/* ─────────── 法案 ─────────── */
function proposeLaw(ds) {
  const s = app.state;
  const r = Legis.propose(s, DATA, ds.id, +ds.idx);
  closeModal();
  if (!r.ok) return toast(r.msg);
  if (s.flags.draftBank > 0) { s.flags.draftBank -= 1; r.bill.quality += 0.15; }
  toast(r.msg); render();
}

/* ─────────── 選舉流程 ─────────── */
function checkElection() {
  const s = app.state;
  const { months, sched } = Election.monthsUntilElection(s, DATA);
  s.flags.monthsToElection = months ?? 99;
  if (!sched) return;
  if (s.election) {
    if (s.election.phase === 'campaign') {
      s.election.weeksLeft -= 1;
      updatePoll();
      if (s.election.weeksLeft <= 0) runElection();
    }
    return;
  }
  if (months !== null && months <= 2 && s.meta.scale === 'week' && !s.flags['elecDone_' + sched.year]) {
    const runs = Election.availableRuns(s, DATA, sched);
    if (!runs.length) { s.flags['elecDone_' + sched.year] = true; return; }
    s.election = { phase: 'decide', sched, options: runs, weeksLeft: 8 };
    go('turn');
  }
}

function pickRun(ds) {
  const s = app.state;
  const idx = +ds.idx;
  if (idx < 0) { s.flags['elecDone_' + s.election.sched.year] = true; s.election = null; toast('你決定這一次先不選。'); return render(); }
  const run = s.election.options[idx];
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const pri = Election.primary(s, DATA, run, rng);
  s.meta.rngCounter = rng.counter;
  s.election.run = run;
  s.election.phase = 'primary';
  s.election.primaryMsg = pri.msg;
  s.election.primaryWon = pri.won;
  if (pri.won) {
    s.finance.campaign -= run.level.deposit ?? 0;
    s.election.opponents = Election.makeOpponents(s, DATA, run, new Rng(s.meta.seed, s.meta.rngCounter++));
  }
  render();
}

function boltParty() {
  const s = app.state;
  s.player.partyPrestige = 0;
  s.player.party = null;
  s.election.primaryWon = true;
  s.election.phase = 'campaign';
  s.election.opponents = Election.makeOpponents(s, DATA, s.election.run, new Rng(s.meta.seed, s.meta.rngCounter++));
  toast('你脫黨參選。黨中央發出了一份措辭嚴厲的聲明。');
  updatePoll(); render();
}

function candidates(s) {
  const me = {
    isPlayer: true, name: s.player.name, party: s.player.party ?? 'IND',
    fame: s.player.fame, stigma: s.player.stigma, attrs: s.player.attrs,
  };
  return [me, ...(s.election.opponents ?? [])];
}

function updatePoll() {
  const s = app.state;
  if (!s.election?.run) return;
  const rng = new Rng(s.meta.seed, 999000 + s.meta.turn);
  const r = Election.computeVotes(s, DATA, s.election.run, candidates(s), rng);
  s.election.poll = r.results.map((x) => ({
    name: x.candidate.isPlayer ? s.player.name : x.candidate.name,
    party: x.candidate.party, share: x.share, isPlayer: !!x.candidate.isPlayer,
  }));
  s.election.mobilization = District.mobilization(s, s.player.homeDistrict, s.player.party);
}

function campaignAction(ds) {
  const s = app.state;
  const a = CAMPAIGN_ACTIONS.find((x) => x.id === ds.id);
  if (!a) return;
  if (s.player.apUsed + a.ap > (s.player.ap ?? 2)) return toast('行動點不夠了。');
  if (s.finance.campaign < a.cost) return toast('專戶裡的錢不夠。');
  s.player.apUsed += a.ap;
  s.finance.campaign -= a.cost;
  s.player.fatigueRaw = clamp(s.player.fatigueRaw + a.fatigue, 0, 120);
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const msg = resolveCampaign(s, a, rng);
  s.meta.rngCounter = rng.counter;
  updatePoll(); toast(msg); render();
}

function resolveCampaign(s, a, rng) {
  const P = s.pops;
  const run = s.election.run;
  const parts = Election.scopeDistricts(DATA, run.type, run.scopeId);
  const dSet = new Set(parts.map((p) => p.districtId));
  const bump = (field, amt, filter) => {
    for (let i = 0; i < P.n; i++) {
      const d = DATA.districts.districts[P.district[i]];
      if (!dSet.has(d.id)) continue;
      if (filter && !filter(i)) continue;
      P[field][i] = clamp05(P[field][i] + amt);
    }
  };
  switch (a.id) {
    case 'street':
      bump('enthusiasm', 0.12);
      for (const id of dSet) { s.districts[id].playerFavor = clampBi(s.districts[id].playerFavor + 0.12); }
      return '你走了一整週的街，鞋底磨平了一層，但有人開始認得你的臉。';
    case 'rally': {
      const rain = rng.bool(0.15);
      if (rain) { bump('enthusiasm', 0.1); return '造勢晚會遇到下雨，來的人比預期少了一半，但留下來的都淋著雨聽完了。'; }
      bump('enthusiasm', 0.4);
      s.player.fame = clamp05(s.player.fame + 0.1);
      return '場子做得很滿，支持者第一次覺得這件事真的有機會。';
    }
    case 'tv':
      s.player.fame = clamp05(s.player.fame + 0.25);
      for (const id of dSet) s.districts[id].playerFavor = clampBi(s.districts[id].playerFavor + 0.2);
      return '廣告開始在各台輪播，你在早餐店的電視上看到自己。';
    case 'online':
      bump('enthusiasm', 0.45, (i) => DATA.genIds[P.gen[i]] === 'youth');
      return '投放打得很準，年輕族群的討論度整個拉起來了。';
    case 'debate': {
      const roll = s.player.attrs.eloquence * 12 + rng.range(-25, 25);
      if (roll > 45) { for (const id of dSet) s.districts[id].playerFavor = clampBi(s.districts[id].playerFavor + 0.45); return '政見發表會你表現得很好，中間選民開始認真考慮這個名字。'; }
      if (roll < 12) { for (const id of dSet) s.districts[id].playerFavor = clampBi(s.districts[id].playerFavor - 0.35); return '你在台上被問倒了，那一段被對手剪成十五秒的影片。'; }
      return '政見會平順地結束，沒有加分也沒有扣分。';
    }
    case 'negative': {
      const opp = s.election.opponents?.[0];
      if (opp) opp.fame = clamp05(opp.fame - 0.3);
      s.player.integrity = clamp05(s.player.integrity - 0.2);
      if (rng.bool(0.3)) { s.player.favorNational = clampBi(s.player.favorNational - 0.4); return '負面文宣被打成抹黑，反彈比預期大，你的團隊連夜在想怎麼收。'; }
      return '文宣打中了對手的痛處，他們今天開了兩場記者會回應。';
    }
    case 'allocate':
      s.flags.allocateBonus = (s.flags.allocateBonus ?? 0) + (rng.bool(0.7) ? 0.03 : -0.04);
      return rng.bool(0.7) ? '配票的號碼發下去了，樁腳說這次算得很準。' : '配票出了一點差錯，有一區的票被切得太碎。';
    case 'temple':
      for (const id of dSet) District.grow(s, id, 0.15);
      bump('enthusiasm', 0.2, (i) => DATA.genIds[P.gen[i]] === 'senior');
      return '你把該拜的廟都拜了，長輩看的是你有沒有來。';
  }
  return '完成了。';
}

function runElection() {
  const s = app.state;
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const run = s.election.run;
  const cands = candidates(s);
  const r = Election.computeVotes(s, DATA, run, cands, rng);
  s.meta.rngCounter = rng.counter;
  const seats = run.level.system === 'SNTV' ? (DATA.byId.district[run.scopeId]?.seats ?? 1) : 1;
  const winners = r.results.slice(0, seats).map((x) => x.candidate);
  const won = winners.some((c) => c.isPlayer);
  const my = r.results.find((x) => x.candidate.isPlayer);
  const outcome = { won, results: r.results };
  Election.applyResult(s, DATA, run, outcome);
  s.flags['elecDone_' + s.election?.sched?.year] = true;
  s.election = {
    phase: 'result', run, outcome,
    resultText: won
      ? `你以 ${F.int(my.votes)} 票當選。開票那天晚上，服務處外面擠滿了人，你講到一半聲音就啞了。`
      : `你以 ${F.int(my.votes)} 票落選，差距是 ${F.int(Math.abs(r.results[0].votes - my.votes))} 票。有些支持者到最後都沒有離開。`,
  };
  render();
}

/* ─────────── 質詢 ─────────── */
function openInterp() {
  const s = app.state;
  const hot = Object.entries(s.issues).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const styles = Interp.STYLES.map((st) => {
    const ok = Interp.styleAvailable(s, st);
    return `<button class="opt ${ok ? '' : 'locked'}" ${ok ? `data-act="interp-style" data-id="${st.id}"` : ''}>
      <div class="opt-t">${esc(st.name)}</div>
      <div class="opt-h">${esc(st.desc)}${ok ? '' : '　（以你現在的氣魄，你做不出這種事）'}</div></button>`;
  }).join('');
  openModal(`<div class="modal-h">上質詢台</div>
    <div class="modal-b">今天最熱的議題是${esc(DATA.byId.issue[hot[0][0]].name)}。
    準備程度：${esc(word('prep', s.flags.interpPrep ?? 0))}。</div>${styles}`);
  s.flags.interpTopic = hot[0][0];
}

function runInterp(ds) {
  const s = app.state;
  const styleId = ds.id;
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const r = Interp.run(s, DATA, styleId, s.flags.interpTopic, rng);
  s.meta.rngCounter = rng.counter;
  if (!r.ok) { toast(r.msg); return; }
  const TITLE = { great: '大成功', good: '成功', draw: '平手', bad: '失敗', terrible: '大失敗' };
  openModal(`<div class="modal-h">${TITLE[r.outcome]}</div>
    <div class="modal-b">${esc(r.text)}</div>
    <button class="btn primary full" data-act="modal-close">好</button>`);
  render();
}

/* ─────────── 地方議案 ─────────── */
function openLocalBill(ds) {
  const s = app.state;
  const { region, id } = ds;
  const b = DATA.byId.bill[id];
  const cur = s.localBills[region][id];
  const tiers = b.tiers.map((t, i) => `
    <button class="tier ${i === cur ? 'cur' : ''}" data-act="bill-propose" data-region="${esc(region)}" data-id="${esc(id)}" data-idx="${i}">
      ${esc(t.name)}</button>`).join('');
  openModal(`<div class="modal-h">《${esc(b.name)}》</div>
    <div class="modal-b">${esc(b.desc)}</div>
    <div class="tiers">${tiers}</div>
    <div class="xs muted" style="margin-top:12px;line-height:1.7">
      點一個檔位就會送進議會表決。議會不是你家開的，通不通過要看席次跟人情。
    </div>
    <div class="btn-row"><button class="btn ghost" data-act="modal-close">關閉</button></div>`);
}

function proposeLocalBill(ds) {
  const s = app.state;
  const { region, id, idx } = ds;
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const r = Council.proposeBill(s, DATA, region, id, +idx, rng);
  s.meta.rngCounter = rng.counter;
  closeModal(); toast(r.msg); render();
}
