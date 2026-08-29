// @ts-check
import { loadData } from './data/loader.js';
import { initScales, word, biWord } from './util/scale.js';
import { createGame } from './core/GameState.js';
import { advance } from './core/TurnEngine.js';
import { Rng, randomSeedString } from './core/Rng.js';
import { el, html, raw, esc } from './util/dom.js';
import { row, card } from './ui/components.js';
import * as F from './util/format.js';
import * as SaveMgr from './save/SaveManager.js';

import { app, registerPage, render, go, openModal, closeModal, toast, bindEvents, confirmModal, partyColor } from './ui/app.js';
import { turnPage, eventModal } from './ui/pages/turn.js';
import { politicsPage, lawModal } from './ui/pages/politics.js';
import { dataPage } from './ui/pages/data.js';
import { mapPage } from './ui/pages/map.js';
import { teamPage, financePage, profilePage } from './ui/pages/misc.js';
import { setupPage, setupDraft, ATTRS, initDraft, attrBudget } from './ui/pages/setup.js';
import { electionPage, CAMPAIGN_ACTIONS, actionCost } from './ui/pages/election.js';

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
import * as Poll from './systems/PollSystem.js';
import * as Show from './systems/ShowSystem.js';
import * as Court from './systems/CourtSystem.js';
import * as Theory from './systems/TheorySystem.js';
import * as ImageSys from './systems/ImageSystem.js';
import * as Gov from './systems/GovernmentSystem.js';
import * as Ending from './systems/EndingSystem.js';
import * as People from './systems/PeopleSystem.js';
import * as Canvass from './systems/CanvassSystem.js';
import * as Favor from './systems/FavorSystem.js';
import * as Invite from './systems/InvitationSystem.js';
import * as SocialSys from './systems/SocialSystem.js';
import * as Semi from './systems/SemiconductorSystem.js';
import { applyEffects, bumpCounter } from './systems/Effects.js';
import { clamp, clamp05, clampBi } from './core/Formula.js';

let DATA = null;
const ui = { politicsTab: 'overview', dataTab: 'macro', mapMode: 'favor', mapArg: null, lawPick: {} };

/* ─────────── 啟動 ─────────── */
(async function boot() {
  window.__peBooted = true;
  try {
    DATA = await loadData((p, name) => {
      el('bootBar').style.width = (p * 100).toFixed(0) + '%';
      el('bootMsg').textContent = `正在載入 ${name} …`;
    });
    initScales(DATA.scales);
    initDraft(DATA);
    SaveMgr.setData(DATA);
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
  registerPage('turn', (s, d) => s.flags.retired ? endingPage(s)
    : (s.election?.phase && s.election.phase !== 'idle') ? electionPage(s, d) : turnPage(s, d));
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
  initDraft(DATA);
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
    'setup-step': () => { setupDraft.step = clamp(+ds.id, 0, 5); reSetup(); },
    'setup-start': () => { setupDraft.startId = ds.id; reSetup(); },
    'setup-bg': () => { setupDraft.backgroundId = ds.id; reSetup(); },
    'setup-district': () => { setupDraft.homeDistrict = ds.id; reSetup(); },
    'setup-name': () => { setupDraft.name = ds.value; },
    'setup-gender': () => { setupDraft.gender = ds.value; },
    'setup-edu': () => { setupDraft.education = ds.value; },
    'setup-region': () => { setupDraft.homeRegion = ds.value; setupDraft.homeDistrict = null; reSetup(); },
    'setup-age': () => { setupDraft.age = +ds.value; reSetup(); },
    'setup-partymode': () => {
      setupDraft.partyMode = ds.id;
      // 路線換了，屬性額度也會跟著變，超支的話從最高的那幾項退回來
      const cap = attrBudget(DATA).cap;
      let used = Object.values(setupDraft.attrs).reduce((a, b) => a + b, 0);
      while (used > cap) {
        const k = ATTRS.map(([x]) => x).sort((a, b) => setupDraft.attrs[b] - setupDraft.attrs[a])[0];
        if (setupDraft.attrs[k] <= 0) break;
        setupDraft.attrs[k] -= 1; used -= 1;
      }
      reSetup();
    },
    'setup-reset': () => {
      SaveMgr.clearSetupPrefs();
      initDraft(DATA, { usePrefs: false });
      toast('建角設定已經改回預設值。');
      reSetup();
    },
    'setup-ideo': () => { setupDraft.ideology[ds.id] = +ds.value; reSetup(); },
    'setup-china': () => { setupDraft.china[ds.id] = +ds.value; reSetup(); },
    'attr-up': () => {
      const cap = attrBudget(DATA).cap;
      const max = DATA.tuning?.start?.attributeMax ?? 4;
      const used = Object.values(setupDraft.attrs).reduce((a, b) => a + b, 0);
      if (used < cap && setupDraft.attrs[ds.id] < max) setupDraft.attrs[ds.id] += 1;
      reSetup();
    },
    'attr-down': () => { if (setupDraft.attrs[ds.id] > 0) setupDraft.attrs[ds.id] -= 1; reSetup(); },
    'attr-reset': () => {
      for (const [k] of ATTRS) setupDraft.attrs[k] = 2;
      reSetup();
    },
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
    'do-rest': (d) => doRest(d.id),
    'do-action': () => doAction(ds.id),
    'open-event': () => {
      const ev = s.pendingEvents.find((e) => e.id === ds.id);
      if (ev) openModal(eventModal(ev, s));
    },
    'pick-option': () => {
      const ev = s.pendingEvents.find((e) => e.id === ds.ev);
      if (!ev) return closeModal();
      // 處理一件事就是花掉一段時間。用完了還可以硬撐，但要付疲勞的代價。
      s._apRng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Char.spendAP(s, DATA, 1, 4);
      s.meta.rngCounter = s._apRng.counter; s._apRng = null;
      if (!r.ok) { closeModal(); return toast(r.msg); }
      Events.resolve(s, DATA, ev, +ds.idx);
      s.pendingEvents = s.pendingEvents.filter((e) => e !== ev);
      closeModal();
      if (r.overdraftHit) {
        toast('你硬把這件事排進去了，代價是接下來幾天幾乎沒有闔眼。');
      }
      render();
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

    'gig-accept': () => {
      const g = s.flags.pendingGig;
      if (!g) return closeModal();
      s.canvassGigs ??= [];
      s.canvassGigs.push({ ...g, active: true });
      s.flags.pendingGig = null;
      closeModal();
      toast('從下個月開始，這個場子會固定佔掉你一點行動點。你不用再看一次同樣的場面了。');
      render();
    },
    'gig-decline': () => { s.flags.pendingGig = null; closeModal(); render(); },
    'drop-gig': () => {
      s.canvassGigs = (s.canvassGigs ?? []).filter((g) => g.sceneId !== ds.id);
      toast('你把這個固定場子退掉了。主辦的人在電話裡沒有多說什麼。'); render();
    },

    /* 邀約與社群 */
    'open-invites': () => openInvites(),
    'invite-go': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Invite.attend(s, DATA, ds.id, 'self', null, rng);
      s.meta.rngCounter = rng.counter;
      if (!r.ok) return toast(r.msg);
      const ap = Char.spendAP(s, DATA, DATA.byId.invitation[r.kind.id].ap ?? 1, r.kind.fatigue ?? 6);
      if (!ap.ok) return toast(ap.msg);
      closeModal(); openModal(textModal(r.kind.name, r.text)); render();
    },
    'invite-aide': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Invite.attend(s, DATA, ds.id, 'aide', ds.aide, rng);
      s.meta.rngCounter = rng.counter;
      if (!r.ok) return toast(r.msg);
      closeModal(); openModal(textModal(`${r.aideName}代為出席`, r.text)); render();
    },
    'invite-skip': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Invite.attend(s, DATA, ds.id, 'decline', null, rng);
      s.meta.rngCounter = rng.counter;
      if (!r.ok) return toast(r.msg);
      closeModal(); openModal(textModal('婉拒', r.text)); render();
    },
    'open-stream': () => openStream(ds.id),
    'do-stream': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const fn = ds.id === 'streetSpeech' ? SocialSys.streetSpeech : SocialSys.livestream;
      const r = fn(s, DATA, rng, ds.theory || null);
      s.meta.rngCounter = rng.counter;
      if (!r.ok) return toast(r.msg);
      const ap = Char.commit(s, DATA, ds.id);
      if (!ap.ok) return toast(ap.msg);
      closeModal();
      openModal(textModal(ds.id === 'streetSpeech' ? '街頭宣講' : '直播結束',
        r.text + (r.milestone ? '\n\n' + r.milestone.text : '')
        + `\n\n目前追蹤數：${F.num(r.followers)}`));
      render();
    },

    /* 人情牽制 */
    'open-favor': () => openFavor(ds.id),
    'favor-take': () => {
      const pend = (s.favorPending ?? [])[+ds.id];
      if (!pend) return closeModal();
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Favor.resolveHelp(s, DATA, pend, rng);
      s.meta.rngCounter = rng.counter;
      closeModal(); openModal(textModal('人情', r.msg)); render();
    },
    'favor-answer': () => {
      const pend = (s.favorPending ?? [])[+ds.id];
      if (!pend) return closeModal();
      const r = Favor.resolveRequest(s, DATA, pend, +ds.idx);
      closeModal(); openModal(textModal('請託', r.msg)); render();
    },

    /* 媒體攻擊 */
    'open-attack': () => openAttack(),
    'attack-respond': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Media.respondAttack(s, DATA, ds.id, rng);
      s.meta.rngCounter = rng.counter;
      closeModal(); openModal(textModal('回應', r.msg)); render();
    },

    /* 幕僚收贓款 */
    'open-graft': () => openGraft(),
    'graft-resolve': () => {
      const r = Team.resolveGraft(s, DATA, ds.id);
      closeModal(); openModal(textModal('後續', r.msg)); render();
    },

    /* 初選後續 */
    'open-aftermath': () => openAftermath(),
    'aftermath-pick': () => {
      const kind = s.flags.pendingPrimaryEvent?.kind ?? 'unite';
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Election.resolveAftermath(s, DATA, kind, ds.id, rng);
      s.meta.rngCounter = rng.counter;
      closeModal(); openModal(textModal('後續', r.msg)); render();
    },

    /* 表示反對 */
    'pick-oppose': () => {
      const ev = s.pendingEvents.find((e) => e.id === ds.ev);
      if (!ev) return closeModal();
      s._apRng = new Rng(s.meta.seed, s.meta.rngCounter);
      const ap = Char.spendAP(s, DATA, 1, 4);
      s.meta.rngCounter = s._apRng.counter; s._apRng = null;
      if (!ap.ok) { closeModal(); return toast(ap.msg); }
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const best = (s.theories ?? []).slice().sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
      const tScore = best ? Theory.citeBonus(s, DATA, best.id, 'media') : 0;
      const r = Events.resolveOppose(s, DATA, ev, rng, tScore);
      s.meta.rngCounter = rng.counter;
      s.pendingEvents = s.pendingEvents.filter((e) => e !== ev);
      closeModal(); openModal(textModal('你的表態', r.text)); render();
    },

    /* 審預算 */
    'budget-review': () => {
      const r = Budget.review(s, DATA, ds.id, ds.act);
      toast(r.msg); render();
    },

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

    /* 理論、形象、退場 */
    'open-theory': openTheory,
    'pick-theory': (d) => { doTheory(d.id); },
    'open-image': openImage,
    'set-image': (d) => {
      const paid = Char.commit(s, DATA, 'setImage');
      if (!paid.ok) { closeModal(); return toast(paid.msg); }
      const r = ImageSys.adopt(s, DATA, d.id);
      if (!r.ok) s.player.apUsed = Math.max(0, s.player.apUsed - 1);   // 沒換成就不扣
      closeModal(); toast(r.msg); render();
    },
    'open-retire': openRetire,
    'confirm-retire': doRetire,

    /* 節目與民調 */
    'open-shows': openShows,
    'do-show': (d) => doShow(d.id, d.theory || null),
    'pick-show-theory': (d) => openShowTheory(d.id),
    'open-commission': openCommission,
    'commission-poll': (d) => {
      const paid = Char.commit(s, DATA, 'commissionPoll');
      if (!paid.ok) { closeModal(); return toast(paid.msg); }
      const r = Poll.commission(s, DATA, d.id, d.scope);
      if (!r.ok) s.player.apUsed = Math.max(0, s.player.apUsed - 1);
      closeModal(); toast(r.msg); render();
    },
    'open-poll': (d) => openPoll(+d.idx),

    /* 憲政 */
    'open-court': () => { ui.politicsTab = 'court'; go('politics'); },
    'open-nominate': (d) => openNominate(+d.idx),
    'open-cabinet': openCabinet,
    'nominate': (d) => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Court.nominateJustice(s, DATA, +d.idx, d.lean, rng);
      s.meta.rngCounter = rng.counter;
      closeModal(); toast(r.msg); render();
    },

    /* 選舉 */
    'pick-run': (d) => pickRun(d),
    'primary-accept': () => {
      // 沒有把這一年標記成已結束的話，下一週排程會再偵測到同一場選舉，
      // 於是初選會一直重跳。這就是 0.4 版那個永遠跑不完的九月。
      s.flags['elecDone_' + s.election.sched.year] = true;
      Election.afterPrimaryLoss(s, DATA, new Rng(s.meta.seed, s.meta.rngCounter++));
      s.election = null;
      toast('你留下來輔選。這一次的人情，下一次會有人記得。');
      render();
    },
    'primary-bolt': boltParty,
    'primary-next': () => {
      s.election.phase = 'campaign';
      s.finance.campaign -= s.election.run.level.deposit ?? 0;
      s.election.opponents = Election.makeOpponents(s, DATA, s.election.run, new Rng(s.meta.seed, s.meta.rngCounter++));
      updatePoll(); render();
    },
    'primary-lobby': (d) => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Election.lobbyFaction(s, DATA, s.election.primary, d.id, rng);
      s.meta.rngCounter = rng.counter;
      toast(r.msg); render();
    },
    'primary-vote': () => {
      const rng = new Rng(s.meta.seed, s.meta.rngCounter);
      const r = Election.resolvePrimary(s, DATA, s.election.primary, rng);
      s.meta.rngCounter = rng.counter;
      s.election.primaryWon = r.won;
      s.election.primaryMsg = r.msg;
      s.election.primaryField = r.field;
      render();
    },
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
  // 先把這一局的建角選擇記下來，下一局就從這裡開始
  SaveMgr.saveSetupPrefs(d);
  app.state = createGame(DATA, {
    seedStr: d.seedStr || randomSeedString(),
    name: d.name.trim(), gender: d.gender, education: d.education,
    startId: d.startId, backgroundId: d.backgroundId,
    homeDistrict: d.homeDistrict, party: null,
    ideology: { ...d.ideology }, china: { ...d.china },
    age: d.age,
    baseAttrs: { ...d.attrs },
  });
  // 這一局才剛開始就先存一次。
  // 舊版要等到玩家結束第一個回合才有自動存檔，中間關掉分頁就整局不見了。
  autosave('新的一局已經建立，這一刻就先存好了。');
  go('turn');
  askPartyChoice();
}

/**
 * 自動存檔。
 * 存檔滿了不能只是安靜地失敗——那會讓玩家以為有存到，
 * 直到下一次開啟才發現整局不見了。
 */
function autosave(okMsg) {
  const r = SaveMgr.save(app.state, 'auto');
  if (!r.ok) toast('自動存檔失敗：' + r.msg);
  else if (okMsg) toast(okMsg);
  return r.ok;
}

function askPartyChoice() {
  const s = app.state;
  const mode = setupDraft.partyMode;
  const last = setupDraft.party;
  // 建角時已經選過路線的話，這裡就只問是哪一個黨
  const routes = mode ? DATA.starts.partyChoice.filter((c) => c.id === mode) : DATA.starts.partyChoice;
  const opts = routes.map((c) => {
    if (c.id === 'independent') {
      return `<button class="opt ${last === null && mode === 'independent' ? 'on' : ''}" data-act="choose-party" data-pid="">
        <div class="opt-t">${esc(c.name)}</div><div class="opt-h">${esc(c.desc)}</div></button>`;
    }
    return c.options.map((pid) => {
      const p = DATA.byId.party[pid];
      return `<button class="opt ${last === pid ? 'on' : ''}" data-act="choose-party" data-pid="${pid}">
        <div class="opt-t" style="color:${p.color}">${esc(p.name)}${last === pid ? '　<span class="chip on xs">上一局選的</span>' : ''}</div>
        <div class="opt-h">${esc(c.name)}｜${esc(c.desc)}</div></button>`;
    }).join('');
  }).join('');
  const head = mode
    ? `你在建角的時候選了「${esc(routes[0]?.name ?? '')}」這條路，現在要決定是哪一個。`
    : '這個決定會塑造你接下來八年的整個玩法。大黨有資源但要排隊，小黨出頭快但天花板低，無黨籍什麼都得自己來。';
  openModal(`<div class="modal-h">你要靠哪一邊</div>
    <div class="modal-b">${head}</div>${opts}`);
  const orig = handle;
  document.body.addEventListener('click', function once(e) {
    const t = e.target.closest('[data-act="choose-party"]');
    if (!t) return;
    document.body.removeEventListener('click', once);
    const pid = t.dataset.pid || null;
    joinParty(pid);
    setupDraft.party = pid;
    SaveMgr.saveSetupPrefs(setupDraft);
    autosave();
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
    return confirmModal('還有事情沒處理',
      '待決事項如果不處理，事情會自己往壞的方向走，而且你不會知道原本可以怎樣。',
      '直接結束回合', () => { s.pendingEvents = []; askRest(); });
  }
  askRest();
}

/** 行動點沒用完的時候，那幾天你總得做點什麼 */
const REST_OPTIONS = [
  { id: 'family', name: '回家吃幾頓飯', mult: 1.0,
    text: '你難得跟家人好好吃了幾頓飯，沒有人提到選舉。孩子問你什麼時候可以再一起出去玩，你沒有回答。' },
  { id: 'sleep', name: '睡滿幾天', mult: 1.2,
    text: '你把行程全部推掉，睡到自然醒。助理說這幾天電話少得不太正常，你決定不去想那是為什麼。' },
  { id: 'walk', name: '一個人走走', mult: 0.9,
    text: '你一個人在河堤走了幾個下午。沒有人認出你，也沒有人需要你講什麼，那幾個小時意外地好過。' },
  { id: 'friend', name: '見老朋友', mult: 0.8, sociability: true,
    text: '你跟幾個老朋友喝了酒。他們講的都是跟政治無關的事，你發現自己已經很久沒有這樣聊天了。' },
  { id: 'read', name: '把書讀完', mult: 0.7, theory: true,
    text: '你把擱在桌上很久的那幾本書讀完了。有一段話你抄了下來，總覺得將來用得上。' },
  { id: 'clinic', name: '去看個醫生', mult: 1.4,
    text: '你去做了拖了半年的健康檢查。醫生看著報告皺了一下眉，說沒什麼大問題，但要你少熬夜。' },
];

function askRest() {
  const s = app.state;
  const left = Char.apOf(s, DATA) - s.player.apUsed;
  if (left <= 0 || s.player.hospitalTurns > 0) return reallyEnd();

  const rng = new Rng(s.meta.seed, 700000 + s.meta.turn);
  const picks = rng.shuffle(REST_OPTIONS).slice(0, 3);
  const opts = picks.map((o) => `
    <button class="opt" data-act="do-rest" data-id="${o.id}">
      <div class="opt-t">${esc(o.name)}</div>
      <div class="opt-h">${esc(o.text.slice(0, 34))}…</div>
    </button>`).join('');
  openModal(`<div class="modal-h">這個月還剩下幾天</div>
    <div class="modal-b">你還有 ${left} 點行動點沒用掉。剩下的時間總得做點什麼——
    這一行沒有人真的能休息，但至少可以選擇怎麼耗掉它。</div>
    ${opts}
    <button class="btn ghost full" data-act="do-rest" data-id="none" style="margin-top:6px">
      不休息，直接進下個月</button>`);
}

function doRest(id) {
  const s = app.state;
  const left = Char.apOf(s, DATA) - s.player.apUsed;
  closeModal();
  if (id === 'none') { toast('你把剩下的時間也排滿了行程。'); return reallyEnd(); }
  const o = REST_OPTIONS.find((x) => x.id === id);
  if (o) {
    s.player.fatigueRaw = clamp(s.player.fatigueRaw - 18 * left * o.mult, 0, 120);
    if (o.sociability) s.player.attrs.sociability = clamp05(s.player.attrs.sociability + 0.0);
    if (o.theory && Theory.inProgress(s)) {
      const wip = Theory.inProgress(s);
      wip.progress = Math.min(wip.need - 1, wip.progress + 1);
    }
    toast(o.text);
  }
  reallyEnd();
}
function reallyEnd() {
  const s = app.state;
  advance(s, DATA);
  checkElection();
  autosave();
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
  if (msg) toast(msg);
  if (r.overdraftHit) toast('你把行程硬排了進去，代價是接下來幾天幾乎沒有闔眼。');
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
      const r = Canvass.run(s, DATA, did, rng);
      District.grow(s, did, organizer * (DATA.tuning?.grassroots?.organizerBonus ?? 0.25));
      s.finance.campaign -= 30000;
      showCanvassReport(s, did, rng, r);
      return '';
    }
    case 'invitations':
      openInvites();
      return '';
    case 'livestream':
      openStream('livestream');
      return '';
    case 'streetSpeech':
      openStream('streetSpeech');
      return '';
    case 'talkshow':
      openShows();
      return '';
    case 'showPrep':
      Show.prepare(s);
      return `你把可能被問的都想過一遍了。準備程度：${word('prep', s.flags.showPrep ?? 0)}。`;
    case 'commissionPoll':
      openCommission();
      return '';
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
    case 'theory':
      openTheory();
      return '';
    case 'setImage':
      openImage();
      return '';
    case 'retire':
      openRetire();
      return '';
    case 'dealmaking': {
      p.politicalCapital = Math.min(999, p.politicalCapital + 35);
      p.stigma = clamp05(p.stigma + 0.2);
      Team.witnessSecret(s);
      return '有些事在檯面上永遠談不成，在檯面下十分鐘就有了結論。房間裡的每個人都記得今天。';
    }
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
  const pri = Election.buildPrimary(s, DATA, run, rng);
  s.meta.rngCounter = rng.counter;
  s.election.run = run;
  s.election.primary = pri;
  if (pri.skip) {
    s.election.phase = 'campaign';
    s.election.primaryWon = true;
    s.finance.campaign -= run.level.deposit ?? 0;
    s.election.opponents = Election.makeOpponents(s, DATA, run, new Rng(s.meta.seed, s.meta.rngCounter++));
    updatePoll();
  } else {
    s.election.phase = 'primary';
    s.election.primaryMsg = pri.msg;
  }
  render();
}

function boltParty() {
  const s = app.state;
  const was = s.player.party;
  s.player.partyPrestige = 0;
  s.player.party = null;
  // 退出兩大黨的人，會被該黨親近的媒體同時圍剿好一段時間
  if (was === 'PDA' || was === 'CRP') Media.startBoltBacklash(s, DATA);
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
  const cost = actionCost(s.election?.run, a);
  if (s.player.apUsed + a.ap > (s.player.ap ?? 2)) return toast('行動點不夠了。');
  if (s.finance.campaign < cost) return toast('專戶裡的錢不夠。');
  s.player.apUsed += a.ap;
  s.finance.campaign -= cost;
  s.election.spent = (s.election.spent ?? 0) + cost;
  s.finance.ledger.push({ turn: s.meta.turn, kind: 'out', amount: cost, note: '競選：' + a.name });
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
    case 'motorcade':
      bump('enthusiasm', 0.18);
      for (const id of dSet) s.districts[id].playerFavor = clampBi(s.districts[id].playerFavor + 0.1);
      s.player.fame = clamp05(s.player.fame + 0.06);
      return '宣傳車繞了整個選區一整週，喇叭聲從早響到晚，有人打電話來罵，也有人說終於看到你的名字了。';
    case 'phonebank':
      bump('enthusiasm', 0.3, (i) => P.awareness[i] >= 2.5);
      return '志工打了幾千通電話。接起來的人不多，但接起來的那些，投票日多半真的會出門。';
    case 'billboard': {
      for (const id of dSet) s.districts[id].playerFavor = clampBi(s.districts[id].playerFavor + 0.28);
      s.player.fame = clamp05(s.player.fame + 0.14);
      s.flags.billboardUp = (s.flags.billboardUp ?? 0) + 1;
      return '看板掛上去了。路口那一面特別大，連對手的樁腳都在群組裡轉照片。';
    }
    case 'pr': {
      const roll = s.player.attrs.sociability * 10 + rng.range(-18, 18);
      for (const m of Object.values(s.media)) {
        m.playerRelation = clampBi(m.playerRelation + (roll > 25 ? 0.35 : 0.1));
      }
      s.player.fame = clamp05(s.player.fame + 0.08);
      return roll > 25
        ? '公關公司安排了兩篇專訪跟一支人物影片，這幾天的版面角度明顯對你比較友善。'
        : '公關案子發出去了，效果沒有預期好，但至少負面的那幾則被壓下去一點。';
    }
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

/* ─────────── 政論節目 ─────────── */
function openShows() {
  const s = app.state;
  const invs = s.invitations ?? [];
  if (!invs.length) {
    return openModal(`<div class="modal-h">沒有人找你上節目</div>
      <div class="modal-b">通告不是想上就能上的。等你的名字在圈子裡開始被提起，製作單位自然會打電話來。
      多開幾場記者會、把議題炒熱一點，或是先把知名度做起來。</div>
      <button class="btn primary full" data-act="modal-close">知道了</button>`);
  }
  const prep = s.flags.showPrep ?? 0;
  const list = invs.map((i) => {
    const show = DATA.byId.show[i.showId];
    const media = s.media[show.mediaId];
    const lean = show.bias > 2 ? '深藍' : show.bias > 0 ? '偏藍' : show.bias < -2 ? '深綠' : show.bias < 0 ? '偏綠' : '中間';
    return `<button class="opt" data-act="do-show" data-id="${esc(i.showId)}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span class="opt-t">${esc(show.name)}</span>
        <span class="xs muted">${show.type === 'online' ? '網路直播' : '電視'}・${esc(lean)}</span>
      </div>
      <div class="opt-h">${esc(show.desc)}</div>
      <div class="opt-e">
        <span class="eff">觸及 ${esc(word('reach', show.reach))}</span>
        <span class="eff">難度 ${esc(word('issueHeat', show.difficulty))}</span>
        <span class="eff">主談 ${esc(i.topicName)}</span>
        ${show.fee ? `<span class="eff up">通告費 ${F.money(show.fee)}</span>` : ''}
      </div>
    </button>`;
  }).join('');
  openModal(`<div class="modal-h">手上的通告</div>
    <div class="modal-b">選一個上。你的準備程度是「${esc(word('prep', prep))}」——
    節目難度越高，沒準備就上去的下場越難看。</div>${list}
    <button class="btn ghost full" data-act="modal-close" style="margin-top:6px">這次都不上</button>`);
}

function openShowTheory(showId) {
  const s = app.state;
  const inv = (s.invitations ?? []).find((i) => i.showId === showId);
  const mine = Theory.platformOf(s, DATA);
  if (!mine.length) return doShow(showId, null);
  const list = mine.map((t) => {
    const onTopic = t.def.field === inv?.topic;
    return `<button class="opt" data-act="do-show" data-id="${esc(showId)}" data-theory="${esc(t.id)}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span class="opt-t">${esc(t.def.name)}</span>
        <span class="xs muted">${onTopic ? '正好對題' : '不是今天的題目'}・${esc(word('prep', t.level))}</span>
      </div>
      <div class="opt-h">${esc(t.def.claims[0])}</div>
    </button>`;
  }).join('');
  openModal(`<div class="modal-h">今天要講哪一套</div>
    <div class="modal-b">這集談的是${esc(inv?.topicName ?? '時事')}。
    引用對題的理論效果最好，硬套不對題的也不是不行，只是聽起來會有點勉強。
    講過的理論會更圓熟。</div>${list}
    <button class="btn ghost full" data-act="do-show" data-id="${esc(showId)}" style="margin-top:6px">
      不引用理論，就照自己的話講</button>`);
}

function doShow(showId, theoryId) {
  const s = app.state;
  const paid = Char.commit(s, DATA, 'talkshow');
  if (!paid.ok) { closeModal(); return toast(paid.msg); }
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const r = Show.appear(s, DATA, showId, rng, theoryId);
  s.meta.rngCounter = rng.counter;
  if (!r.ok) { closeModal(); return toast(r.msg); }
  openModal(`<div class="modal-h">${esc(r.show.name)}</div>
    <div style="text-align:center;margin:6px 0 14px">
      <div class="xs muted">表現</div>
      <div class="tile-v ${r.perf >= 4 ? 'tone-good' : r.perf >= 3 ? 'tone-ok' : r.perf >= 2 ? 'tone-mid' : 'tone-bad'}"
        style="font-size:22px">${esc(word('showPerf', r.perf))}</div>
    </div>
    ${r.theory ? `<div class="xs muted" style="text-align:center;margin-bottom:10px">引用了《${esc(r.theory.name)}》</div>` : ''}
    <div class="modal-b">${esc(r.text)}${r.extra ? '<br><br>' + esc(r.extra) : ''}</div>
    ${r.milestone ? `<div class="xs" style="color:var(--good);line-height:1.7;margin-bottom:10px">${esc(r.milestone.text)}</div>` : ''}
    <button class="btn primary full" data-act="modal-close">好</button>`);
  render();
}

/* ─────────── 委託民調 ─────────── */
function openCommission() {
  const s = app.state;
  if (s.flags.commissionedPoll) {
    return openModal(`<div class="modal-h">已經有一份在做了</div>
      <div class="modal-b">你委託的民調還在進行中，下個回合就會交件。同時做兩份沒有意義，也會被人說在洗數據。</div>
      <button class="btn primary full" data-act="modal-close">知道了</button>`);
  }
  const homeD = DATA.byId.district[s.player.homeDistrict];
  const scopes = [
    { id: 'nation', name: '全國', note: '看整體政黨版圖與自己的全國聲量' },
    { id: 'region', name: homeD ? DATA.byId.region[homeD.regionId].name : '本縣市', note: '縣市長選舉或跨選區布局要看這個' },
    { id: 'district', name: homeD?.name ?? '本選區', note: '議員選舉最實用，直接看得到自己在哪個位置' },
  ];
  const rows = DATA.pollsters.pollsters.filter((ps) => ps.commission > 0).map((ps) => {
    const opts = scopes.filter((sc) => ps.scopes.includes(sc.id)).map((sc) => {
      const cost = Math.round(ps.commission * (DATA.pollsters.commissionScopeMult[sc.id] ?? 1));
      const afford = s.finance.campaign >= cost;
      return `<button class="btn ${afford ? '' : 'ghost'} xs" data-act="commission-poll"
        data-id="${esc(ps.id)}" data-scope="${sc.id}" ${afford ? '' : 'disabled'}
        style="padding:5px 10px">${esc(sc.name)} ${F.money(cost)}</button>`;
    }).join('');
    return `<div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k"><b>${esc(ps.short)}</b></span>
        <span class="row-v xs">公信力 ${esc(word('pollTrust', ps.credibility))}・n=${ps.sampleSize}・誤差 ±${(1.96 * Math.sqrt(0.25 / ps.sampleSize) * Math.sqrt(ps.designEffect ?? 1) * 100).toFixed(1)}%</span>
      </div>
      <div class="xs muted" style="margin:3px 0 6px;line-height:1.6">${esc(ps.desc)}</div>
      <div class="btn-row" style="margin:0">${opts}</div>
    </div>`;
  }).join('');
  openModal(`<div class="modal-h">委託內參民調</div>
    <div class="modal-b">公開民調有房效應、有誤差，而且不見得測你想知道的東西。
    自己出錢做的這一份誤差小得多、也不會外流——但錢是從競選專戶出的。
    目前專戶餘額 ${F.money(s.finance.campaign)}。</div>${rows}
    <button class="btn ghost full" data-act="modal-close" style="margin-top:6px">先不做</button>`);
}

function openPoll(idx) {
  const s = app.state;
  const p = (s.polls ?? [])[idx];
  if (!p) return;
  const rows = Object.entries(p.partySupport).filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1]).map(([pid, v]) =>
      `<div class="votebar"><span class="vn" style="color:${partyColor(pid)}">${esc(s.parties[pid]?.shortName ?? pid)}</span>
      <span class="vb"><i style="width:${Math.min(100, v * 2).toFixed(1)}%;background:${partyColor(pid)}"></i></span>
      <span class="vp">${v.toFixed(1)}%</span></div>`).join('');
  const biasWord = p.internal ? '內參，無立場修正'
    : p.bias > 1 ? '讀數偏藍' : p.bias < -1 ? '讀數偏綠' : '立場大致中性';
  openModal(`<div class="modal-h">${esc(p.pollsterName)}</div>
    <div class="modal-b">
      ${p.year} 年 ${p.month} 月・${esc(p.scopeName)}・有效樣本 ${p.sampleSize} 份<br>
      95% 信心水準下最大誤差 ±${p.error.toFixed(1)}%${p.nonSamplingBias > 2 ? '（但這家的非抽樣偏差極高，數字看看就好）' : ''}<br>
      公信力 ${esc(word('pollTrust', p.credibility))}，${esc(biasWord)}。
      ${p.internal ? '這份不會對外公布。' : '這份已經發布，輿論會跟著動。'}
    </div>
    <div class="sec-t">政黨支持度</div>${rows}
    <div class="sec-t">其他</div>
    ${row('總統滿意度', `<span class="num">${p.presidentApproval.toFixed(1)}%</span>`)}
    ${row('你的支持度', p.playerListed
      ? `<span class="num">${p.playerApproval.toFixed(1)}%</span>`
      : '<span class="xs muted">知名度不足，未列入</span>')}
    <button class="btn primary full" data-act="modal-close" style="margin-top:12px">關閉</button>`);
}

function openNominate(idx) {
  const s = app.state;
  const seat = s.court?.justices[idx];
  if (!seat) return;
  const mine = s.legislature[s.player.party] ?? 0;
  const total = Object.values(s.legislature).reduce((a, b) => a + b, 0) || 113;
  openModal(`<div class="modal-h">提名大法官</div>
    <div class="modal-b">
      你在立法院有 ${mine} 席，總額 ${total} 席。同意權在他們手上，不在你手上。<br><br>
      這個人選會在憲法法庭裡待八年。你在任內推的每一條爭議法案，最後都會走到他面前。
    </div>
    <button class="opt" data-act="nominate" data-idx="${idx}" data-lean="ally">
      <div class="opt-t">提名理念相近的人選</div>
      <div class="opt-h">往後八年的釋憲會站在你這邊，但在野黨一定會杯葛，過不過要看你的席次。</div>
    </button>
    <button class="opt" data-act="nominate" data-idx="${idx}" data-lean="moderate">
      <div class="opt-t">提名中間派學者</div>
      <div class="opt-h">好過關得多，形象也加分。代價是他不欠你人情，判起來六親不認。</div>
    </button>
    <button class="btn ghost full" data-act="modal-close" style="margin-top:6px">再想想</button>`);
}

/* ─────────── 跑攤回報：模糊的第一手感覺 ─────────── */
/**
 * 跑攤回報。
 *
 * 上面那一段是這一次實際發生的場景，六十六種文本輪著出；
 * 下面那一段是你自己模糊的感覺，由三十個 POP 算出來再加上雜訊。
 * 兩段都不是民調——想要準確的數字，得花錢請人做。
 */
function showCanvassReport(s, did, rng, res) {
  const dd = DATA.byId.district[did];
  const P = s.pops;
  const di = DATA.districts.districts.findIndex((x) => x.id === did);

  // 這一次你實際碰到的那三十群人
  const met = [];
  for (let i = 0; i < P.n; i++) if (P.district[i] === di) met.push(i);

  let sizeSum = 0, favSum = 0, enthSum = 0, milSum = 0;
  const byStratum = {};
  for (const i of met) {
    const sz = P.size[i];
    sizeSum += sz; favSum += P.playerFavor[i] * sz;
    enthSum += P.enthusiasm[i] * sz; milSum += P.militancy[i] * sz;
    const sid = DATA.strataIds[P.stratum[i]];
    byStratum[sid] ??= { w: 0, fav: 0, mil: 0 };
    byStratum[sid].w += sz;
    byStratum[sid].fav += P.playerFavor[i] * sz;
    byStratum[sid].mil += P.militancy[i] * sz;
  }
  const fav = favSum / sizeSum, enth = enthSum / sizeSum;

  // 感知有誤差。跑得越勤、組織越好，看得越準；但永遠不會是精確的數字。
  const clarity = clamp(0.35 + s.districts[did].playerGrassroots * 0.11
    + s.player.attrs.sociability * 0.05, 0.3, 0.92);
  const blur = (v) => v + rng.normal(0, (1 - clarity) * 1.4);

  const FEEL = [
    '幾乎沒有人想跟你講話，遞出去的名片大多被隨手放在攤子上。',
    '多數人客氣地點了頭，但你看得出來他們並不真的記得你是誰。',
    '有人願意停下來聽你講兩句，也有人擺了擺手就走開了。',
    '不少人主動叫得出你的名字，有幾個還說上次的事情謝謝你。',
    '走到哪裡都有人過來握手，有位阿姨硬塞了一袋水果給你。',
    '整條街的人都在喊你的名字，助理得幫你擋著才走得動。',
  ];
  const HEAT = [
    '但你問到投票的時候，他們的表情立刻淡了下來，說再看看。',
    '講到選舉，多數人只是笑一笑，沒有把話接下去。',
    '有幾個人問了投票日是哪一天，但語氣聽不出來會不會真的去。',
    '好幾位長輩主動說那天一定會去投，還要幫你揪人。',
    '有支持者已經在問要不要幫忙掛看板，那種熱度是裝不出來的。',
    '志工的名單一個早上就滿了，有人自己印了名片在幫你發。',
  ];
  const feelIdx = clamp(Math.round(blur(fav) + 2.5), 0, 5);
  const heatIdx = clamp(Math.round(blur(enth)), 0, 5);

  // 哪一群人特別冷淡或特別熱情，同樣是感覺不是數字
  const rows = Object.entries(byStratum).map(([sid, v]) => ({
    sid, name: DATA.byId.stratum[sid].name,
    fav: blur(v.fav / v.w), mil: v.mil / v.w, share: v.w / sizeSum,
  })).filter((x) => x.share > 0.05).sort((a, b) => b.fav - a.fav);
  const best = rows[0], worst = rows[rows.length - 1];
  const angry = rows.filter((x) => x.mil >= 2.6).sort((a, b) => b.mil - a.mil)[0];

  const lines = [FEEL[feelIdx], HEAT[heatIdx]];
  if (best && worst && best.sid !== worst.sid) {
    lines.push(`${best.name}那邊的反應明顯比較好；${worst.name}的攤位你去了兩次，氣氛都不太熱。`);
  }
  if (angry) {
    lines.push(`有幾位${angry.name}拉著你講了很久，語氣裡的火氣是真的，不是抱怨而已。`);
  }
  if (clarity < 0.5) {
    lines.push('說實話，你還是不太確定自己在這裡到底站在什麼位置——這種事情要蹲得夠久才看得出來。');
  }

  // 表現漂亮的場子，對方會問你要不要固定來
  let gigBlock = '';
  if (res?.gig) {
    s.flags.pendingGig = res.gig;
    gigBlock = `<div class="card tight" style="margin:10px 0">
      <div class="small" style="line-height:1.9">主辦的人在你要走的時候把你叫住，問你以後能不能固定來。
      答應之後這個場子每個月會自動佔掉一點行動點，穩定長基層，你也不用再看一次同樣的場面。</div>
      <div class="btn-row">
        <button class="btn primary" data-act="gig-accept">接下這個固定場子</button>
        <button class="btn ghost" data-act="gig-decline">先不要</button>
      </div></div>`;
  }
  const ms = res?.milestone ? `<div class="xs" style="color:var(--good);line-height:1.7;margin-bottom:8px">${esc(res.milestone.text)}</div>` : '';

  openModal(`<div class="modal-h">${esc(res?.scene?.name ?? dd.name)}・${esc(dd.name)}</div>
    <div class="modal-b" style="line-height:1.95">${esc(res?.lead ?? '')}</div>
    <div class="modal-b" style="line-height:1.95;border-left:3px solid var(--accent);padding-left:10px">${esc(res?.text ?? '')}</div>
    <div class="small" style="line-height:1.9;margin:10px 0">${lines.map(esc).join('<br>')}</div>
    ${ms}${gigBlock}
    <div class="xs muted" style="line-height:1.7;margin-bottom:10px">
      這些都是你自己的感覺，不是民調。想要準確的數字，得花錢請人做。
    </div>
    <button class="btn primary full" data-act="modal-close">好</button>`);
}

/** 一段純文字的結果視窗，很多新系統共用 */
function textModal(title, body) {
  return `<div class="modal-h">${esc(title)}</div>
    <div class="modal-b" style="line-height:1.95;white-space:pre-wrap">${esc(body ?? '')}</div>
    <button class="btn primary full" data-act="modal-close">好</button>`;
}

/* ─────────── 邀約 ─────────── */
function openInvites() {
  const s = app.state;
  const list = s.socialInvites ?? [];
  if (!list.length) return openModal(textModal('邀約', '目前沒有人邀你。這一行的行事曆是別人幫你填滿的，空著就代表還沒有人覺得你該出現。'));
  const aides = Invite.availableAides(s, DATA);
  const body = list.map((inv) => {
    const k = DATA.byId.invitation[inv.kindId];
    const aideBtns = k.aideOk && aides.length
      ? aides.map((a) => `<button class="btn ghost xs" data-act="invite-aide" data-id="${esc(inv.id)}" data-aide="${esc(a.id)}">
          派 ${esc(a.name)}（${esc(a.roleName)}）</button>`).join('')
      : `<span class="xs muted">${k.aideOk ? '沒有可以派的人，助理一個月只能跑一場。' : '這種場合要的是你本人。'}</span>`;
    return `<div class="card tight" style="margin-bottom:10px">
      <div class="small" style="font-weight:700">${esc(k.icon)} ${esc(k.name)}
        <span class="xs muted">還有 ${inv.expiresIn} 回合</span></div>
      <div class="small" style="line-height:1.85;margin:6px 0">${esc(inv.lead)}</div>
      <div class="btn-row">
        <button class="btn primary xs" data-act="invite-go" data-id="${esc(inv.id)}">親自出席（${k.ap} 點）</button>
        <button class="btn ghost xs" data-act="invite-skip" data-id="${esc(inv.id)}">推掉</button>
      </div>
      <div class="btn-row" style="margin-top:4px">${aideBtns}</div>
    </div>`;
  }).join('');
  openModal(`<div class="modal-h">手上的邀約</div>
    <div class="xs muted" style="line-height:1.7;margin-bottom:10px">
      每位助理一個月只能跑一場，派人去的效果大約只有自己到場的一半多一點。
    </div>${body}
    <button class="btn ghost full" data-act="modal-close">先這樣</button>`);
}

/* ─────────── 直播與街頭宣講 ─────────── */
function openStream(kind) {
  const s = app.state;
  const C = kind === 'streetSpeech' ? DATA.social.streetSpeech : DATA.social.livestream;
  const need = C.requires.boldness;
  if (s.player.attrs.boldness < need) {
    return openModal(textModal('還撐不住', kind === 'streetSpeech'
      ? '站在一個沒有人有義務停下來的地方講三十分鐘，你還沒有那個膽子。'
      : '在鏡頭前面撐住三十分鐘的留言攻擊，你還沒有那個膽子。'));
  }
  const ths = (s.theories ?? []).filter((t) => t.done);
  const opts = ths.map((t) => {
    const th = DATA.byId.theory[t.id];
    return `<button class="opt" data-act="do-stream" data-id="${esc(kind)}" data-theory="${esc(t.id)}">
      <div class="opt-t">用「${esc(th.name)}」當主軸</div>
      <div class="opt-h">${esc(th.claims?.[0] ?? th.desc ?? '')}</div></button>`;
  }).join('');
  openModal(`<div class="modal-h">${kind === 'streetSpeech' ? '街頭宣講' : '開直播'}</div>
    <div class="modal-b" style="line-height:1.9">${kind === 'streetSpeech'
      ? '你把音箱架在人行道旁邊，接上麥克風。接下來三十分鐘裡，會有幾個人停下來完全看你講什麼。'
      : '你把手機架好，燈打開，倒數三秒之後就沒有辦法重來了。'}</div>
    ${opts}
    <button class="opt" data-act="do-stream" data-id="${esc(kind)}" data-theory="">
      <div class="opt-t">不帶論述，隨口講</div>
      <div class="opt-h">全靠臨場反應，講得好不好完全看你自己</div></button>
    <button class="btn ghost full" data-act="modal-close">算了</button>`);
}

/* ─────────── 人情牽制 ─────────── */
function openFavor(idx) {
  const s = app.state;
  const pend = (s.favorPending ?? [])[+idx];
  if (!pend) return closeModal();
  if (pend.kind === 'help') {
    return openModal(`<div class="modal-h">${esc(pend.headline)}</div>
      <div class="modal-b" style="line-height:1.95">${esc(pend.body)}</div>
      <button class="btn primary full" data-act="favor-take" data-id="${idx}">收下這份好意</button>`);
  }
  const ev = DATA.favors.requestEvents.find((e) => e.id === pend.eventId);
  const opts = (ev?.options ?? []).map((o, i) =>
    `<button class="opt" data-act="favor-answer" data-id="${idx}" data-idx="${i}">
      <div class="opt-t">${esc(o.text)}</div></button>`).join('');
  openModal(`<div class="modal-h">${esc(pend.headline)}</div>
    <div class="modal-b" style="line-height:1.95">${esc(pend.body)}</div>${opts}`);
}

/* ─────────── 媒體攻擊 ─────────── */
function openAttack() {
  const s = app.state;
  const a = s.mediaAttack;
  if (!a) return closeModal();
  const opts = DATA.reactions.responses.filter((r) =>
    !r.requires?.mediaContacts || (s.player.mediaContacts ?? 0) >= r.requires.mediaContacts)
    .map((r) => `<button class="opt" data-act="attack-respond" data-id="${esc(r.id)}">
      <div class="opt-t">${esc(r.name)}</div><div class="opt-h">${esc(r.hint)}</div></button>`).join('');
  openModal(`<div class="modal-h">${esc(a.headline)}</div>
    <div class="modal-b" style="line-height:1.95">${esc(a.body)}</div>${opts}`);
}

/* ─────────── 幕僚收贓款 ─────────── */
function openGraft() {
  const s = app.state;
  const c = s.flags.graftCase;
  if (!c) return closeModal();
  openModal(`<div class="modal-h">${esc(c.name)}的帳戶裡有一筆說不清楚的錢</div>
    <div class="modal-b" style="line-height:1.95">檢調查到的金額是 ${esc(F.money(c.amount))}，時間從你把他找進來之後不久就開始了。
你把當初面試的紀錄調出來看，他講過的那幾句話現在讀起來有完全不一樣的意思。接下來二十四小時之內你必須決定要怎麼處理，因為記者已經在服務處門口了。</div>
    <button class="opt" data-act="graft-resolve" data-id="fire">
      <div class="opt-t">立刻解職並公開切割</div>
      <div class="opt-h">最快止血，但辦公室裡剩下的人會開始算自己的退路</div></button>
    <button class="opt" data-act="graft-resolve" data-id="report">
      <div class="opt-t">自己把資料送進地檢署，並先行返還</div>
      <div class="opt-h">花錢也丟人，但那些準備寫你的稿子會換一個方向</div></button>
    <button class="opt" data-act="graft-resolve" data-id="cover">
      <div class="opt-t">把人留下來，說事情還沒有查清楚</div>
      <div class="opt-h">在法律上沒有錯，在新聞上完全沒有用</div></button>`);
}

/* ─────────── 初選後續 ─────────── */
function openAftermath() {
  const s = app.state;
  const a = Election.primaryAftermath(s, DATA);
  if (!a) return closeModal();
  const opts = a.options.map((o) =>
    `<button class="opt" data-act="aftermath-pick" data-id="${esc(o.id)}">
      <div class="opt-t">${esc(o.text)}</div><div class="opt-h">${esc(o.hint)}</div></button>`).join('');
  openModal(`<div class="modal-h">${esc(a.headline)}</div>
    <div class="modal-b" style="line-height:1.95">${esc(a.body)}</div>${opts}`);
}

/* ─────────── 組織理論 ─────────── */
function openTheory() {
  const s = app.state;
  const wip = Theory.inProgress(s);
  const mine = Theory.platformOf(s, DATA);

  if (wip) {
    const th = DATA.byId.theory[wip.id];
    return openModal(`<div class="modal-h">${esc(th.name)}</div>
      <div class="modal-b">${esc(th.desc)}</div>
      <div class="row"><span class="row-k">整理進度</span>
        <span class="row-v">${wip.progress} / ${wip.need}</span></div>
      <div class="bar"><i style="width:${(wip.progress / wip.need * 100).toFixed(0)}%"></i></div>
      <button class="btn primary full" data-act="pick-theory" data-id="${esc(wip.id)}" style="margin-top:12px">
        繼續整理（1 AP）</button>
      <button class="btn ghost full" data-act="modal-close" style="margin-top:6px">先放著</button>`);
  }

  const pool = Theory.candidates(s, DATA).slice(0, 6);
  const list = pool.map((t) => `
    <button class="opt" data-act="pick-theory" data-id="${esc(t.id)}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span class="opt-t">${esc(t.name)}</span>
        <span class="xs muted">難度 ${esc(word('issueHeat', t.difficulty))}</span>
      </div>
      <div class="opt-h">${esc(t.desc)}</div>
    </button>`).join('');
  const owned = mine.length ? `<div class="sec-t">你手上的理論</div>` + mine.map((t) => `
    <div class="row"><span class="row-k">${esc(t.def.name)}
      ${t.fromStaff ? `<span class="xs muted">（${esc(t.fromStaff)}整理的）</span>` : ''}</span>
      <span class="row-v xs">用過 ${t.uses} 次・${esc(word('prep', t.level))}</span></div>`).join('') : '';

  openModal(`<div class="modal-h">組織理論</div>
    <div class="modal-b">把零散的想法整理成一套講得出來的東西。
    上節目、選舉提政見、質詢當論據，靠的都是這個。講得越多次，那套東西就越圓熟。</div>
    ${list || '<div class="xs muted">以你現在的判斷力，剩下的理論都還讀不進去。先把判斷練上來。</div>'}
    ${owned}
    <button class="btn ghost full" data-act="modal-close" style="margin-top:8px">關閉</button>`);
}

function doTheory(id) {
  const s = app.state;
  s._apRng = new Rng(s.meta.seed, s.meta.rngCounter);
  const r0 = Char.commit(s, DATA, 'theory');
  s.meta.rngCounter = s._apRng.counter; s._apRng = null;
  if (!r0.ok) { closeModal(); return toast(r0.msg); }
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const r = Theory.research(s, DATA, rng, id);
  s.meta.rngCounter = rng.counter;
  closeModal();
  if (r.milestone) openModal(textModal('整理完成', r.msg + '\n\n' + r.milestone.text));
  else toast(r.msg);
  render();
}

/* ─────────── 主打形象 ─────────── */
function openImage() {
  const s = app.state;
  const cur = s.player.image ? DATA.byId.playerImage[s.player.image] : null;
  const list = ImageSys.available(s, DATA).map(({ img, ok, why }) => `
    <button class="opt ${ok ? '' : 'locked'}" ${ok ? `data-act="set-image" data-id="${esc(img.id)}"` : ''}>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span class="opt-t">${esc(img.name)}${s.player.image === img.id ? '　<span class="chip on">現在主打</span>' : ''}</span>
      </div>
      <div class="opt-h" style="color:var(--fg-2)">「${esc(img.slogan)}」</div>
      <div class="opt-h">${esc(img.desc)}</div>
      ${ok ? '' : `<div class="opt-h" style="color:var(--warn)">${esc(why)}</div>`}
    </button>`).join('');
  const cost = DATA.images.switchCost;
  openModal(`<div class="modal-h">主打形象</div>
    <div class="modal-b">
      ${cur ? `你現在主打的是「${esc(cur.name)}」。換掉要花 ${cost.politicalCapital} 政治資本，
        而且原本相信你的人會失望一次。` : '選民記住一個政治人物，靠的不是六個屬性，是一句話。'}
      <br><br>形象會放大你的優勢，但也會放大對應的弱點——${cur ? esc(ImageSys.backfireText(s, DATA)) : '打清廉的人一旦沾上汙名，跌得比誰都重。'}
    </div>${list}
    <button class="btn ghost full" data-act="modal-close" style="margin-top:6px">先不決定</button>`);
}

/* ─────────── 退出政壇 ─────────── */
function openRetire() {
  const s = app.state;
  openModal(`<div class="modal-h">退出政壇</div>
    <div class="modal-b" style="line-height:1.9">
      把位子交出去，把服務處收掉，把幕僚遣散。<br><br>
      這個決定不能反悔。你會看到自己這些年的結算，還有這個國家在你離開之後變成的樣子——
      不管你喜不喜歡那個樣子。
    </div>
    <button class="btn danger full" data-act="confirm-retire">我決定了</button>
    <button class="btn ghost full" data-act="modal-close" style="margin-top:8px">再撐一陣子</button>`);
}

function doRetire() {
  const s = app.state;
  const rng = new Rng(s.meta.seed, s.meta.rngCounter);
  const sum = Ending.summarize(s, DATA);
  const ep = Ending.epilogue(s, DATA, sum, rng);
  s.meta.rngCounter = rng.counter;
  s.flags.retired = { sum, ep, turn: s.meta.turn };
  closeModal();
  ui.endingView = true;
  go('turn');
}

function endingPage(s) {
  const { sum, ep } = s.flags.retired;
  const paras = ep.paras.map((p) => `
    <div class="row" style="display:block">
      <div class="xs muted">${esc(p.axisName)}</div>
      <div class="small" style="line-height:1.9;margin-top:4px;${p.aligned ? '' : 'color:var(--fg-2)'}">
        ${esc(p.text)}</div>
    </div>`).join('');

  const axisRows = DATA.values.axes.map((ax) => {
    const a = sum.valueStart[ax.id] ?? 0, b = sum.valueEnd[ax.id] ?? 0;
    const d = b - a;
    if (Math.abs(d) < 0.15) return '';
    return `<div class="row"><span class="row-k">${esc(d > 0 ? ax.posName : ax.negName)}</span>
      <span class="row-v xs ${Math.sign(d) === Math.sign(s.player.ideology[ax.id] ?? 0) ? 'tone-ok' : 'tone-warn'}">
      ${d > 0 ? '+' : ''}${d.toFixed(2)}</span></div>`;
  }).join('');

  return html`
    <div style="text-align:center;padding:18px 0 6px">
      <div class="xs muted" style="letter-spacing:.3em">生涯結算</div>
      <div style="font-size:26px;font-weight:800;margin-top:8px">${esc(sum.name)}</div>
      <div class="word ${sum.tier === 'legend' ? 'tone-good' : sum.tier === 'forgotten' ? 'tone-bad' : ''}"
        style="font-size:19px;margin-top:6px">${esc(Ending.TIER_NAME[sum.tier])}</div>
    </div>

    ${card('這些年', `
      ${row('從政年數', `<span class="num">${sum.years} 年</span>`)}
      ${row('最高職位', esc(sum.peakRoleName))}
      ${row('選舉', `<span class="num">${sum.wins} 勝 ${sum.losses} 敗</span>`)}
      ${row('推動的法案', `<span class="num">${sum.laws} 條</span>`)}
      ${row('組織的理論', `<span class="num">${sum.theories} 套</span>`, '')}
      ${row('主打形象', sum.image ? esc(sum.image.name) : '<span class="xs muted">從來沒有立起來過</span>')}
      ${row('清廉印象', `<span class="word">${esc(word('integrity', sum.integrity))}</span>`)}
      ${row('汙名印象', `<span class="word ${sum.stigma >= 3 ? 'tone-bad' : ''}">${esc(word('stigma', sum.stigma))}</span>`)}
      ${row('全國生活水準', `<span class="num">${sum.solDelta >= 0 ? '+' : ''}${sum.solDelta.toFixed(2)}</span>`,
    sum.solDelta >= 0 ? 'tone-ok' : 'tone-bad')}`)}

    ${sum.lawList.length ? card('你留下的條文', sum.lawList.map((l) =>
      `<div class="row"><span class="row-k xs">${esc(l)}</span></div>`).join('')) : ''}

    ${axisRows ? card('這個國家被你推去了哪裡', axisRows) : ''}

    ${card('事後談', `
      <div class="small" style="line-height:2;margin-bottom:14px">${esc(ep.opener)}</div>
      ${paras}
      <div class="small" style="line-height:2;margin-top:14px">${esc(ep.closer)}</div>
      ${ep.regret ? `<div class="small" style="line-height:2;margin-top:14px;color:var(--warn)">${esc(ep.regret)}</div>` : ''}`)}

    ${card('', `<button class="btn primary full" data-act="restart">開始新的一局</button>`)}`;
}

function openCabinet() {
  const s = app.state;
  const rows = Gov.cabinetSummary(s, DATA).map((m) => `
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k"><b>${esc(m.def.name)}</b>
          <span class="xs muted">　${esc(m.name)}${m.isPlayer ? '（你）' : ''}</span></span>
        <span class="row-v num ${m.approval < 25 ? 'tone-bad' : m.approval > 55 ? 'tone-ok' : ''}">${m.approval.toFixed(0)}%</span>
      </div>
      <div class="xs muted" style="margin-top:2px">
        ${esc(m.traitName)}・能力 ${esc(word('ability', m.competence))}・${m.since} 年上任
        ${m.party ? `・<span style="color:${partyColor(m.party)}">${esc(s.parties[m.party]?.shortName ?? '')}</span>` : '・無黨籍'}
      </div>
      <div class="xs muted" style="margin-top:3px;line-height:1.6">${esc(m.def.desc)}</div>
    </div>`).join('');
  openModal(`<div class="modal-h">行政院各部會</div>
    <div class="modal-b">部會首長由行政院長提請總統任命，不需要立法院同意，但每個會期都要站上質詢台。
    滿意度掉太低的部長通常撐不過半年。</div>
    ${rows}
    <button class="btn ghost full" data-act="modal-close" style="margin-top:8px">關閉</button>`);
}
