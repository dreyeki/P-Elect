// @ts-check
/**
 * 提案修法。
 *
 * 三件事在這裡發生，而且它們對應到三個不同的現實：
 *
 *   1. **提案權附著在職位上。** 一個沒有職位的人不能提案，這不是遊戲在刁難他，
 *      是憲法與地方制度法就是這樣寫的。他能做的事情叫做建議。
 *   2. **一次只能推一案。** 一個會期能排上議程的案子有限，你自己提兩案
 *      就是自己跟自己搶。所以每一次提案都是取捨，而且要跟別人的案子競爭。
 *   3. **起始只有你自己支持。** 一個剛送進程序的案子，除了提案人以外
 *      沒有任何人有義務表態。支持要一個一個去要。
 *
 * 遊說的設計是這個系統的重點：同黨與他黨不是數字大小的差別，是兩件不同的事。
 * 同黨的遊說是在跟黨團要一個位子，一次談完通常就定了；
 * 他黨的遊說是在要求對方在一件他們已經表過態的事情上改變立場，
 * 而在這裡改變立場的代價從來不是被說服。
 */
import { clamp, clamp05 } from '../core/Formula.js';
import { teamBonus } from './TeamSystem.js';
import { applyEffects } from './Effects.js';
import { grow } from './DistrictSystem.js';

/* ─────────── 提案權 ─────────── */

export function scopeOf(state, data) {
  return data.proposals?.scopes?.[state.player.role] ?? null;
}
export function canPropose(state, data) { return !!scopeOf(state, data); }

/** 現在能不能提案，以及為什麼不能 */
export function proposeState(state, data) {
  const scope = scopeOf(state, data);
  if (!scope) return { ok: false, why: data.proposals.noRightText };
  if (state.proposal && !state.proposal.resolved) {
    return { ok: false, why: `你手上的《${state.proposal.targetName}》還在程序裡。同時推兩案，等於自己跟自己搶那幾個位子。` };
  }
  return { ok: true, scope };
}

/** 這個議事機關的席次組成 */
function seatsOf(state, data, scope, regionId) {
  if (scope.seatSource === 'legislature') return { ...state.legislature };
  const region = state.regions[regionId ?? state.player.office?.regionId
    ?? data.byId.district[state.player.homeDistrict]?.regionId];
  return { ...(region?.politics?.councilComposition ?? {}) };
}

/* ─────────── 提案 ─────────── */

export function propose(state, data, kind, targetId, targetTier, rng, regionId = null) {
  const st = proposeState(state, data);
  if (!st.ok) return { ok: false, msg: st.why };
  const scope = st.scope;
  if (kind !== scope.kind) {
    return { ok: false, msg: scope.kind === 'law'
      ? '你的提案權在立法院，地方自治條例不是你能提的。'
      : '你的提案權在議會，中央法律不是你能提的。' };
  }

  const target = kind === 'law' ? data.byId.law[targetId] : data.byId.bill[targetId];
  if (!target) return { ok: false, msg: '找不到這個法案。' };
  const rid = regionId ?? state.player.office?.regionId
    ?? data.byId.district[state.player.homeDistrict]?.regionId;
  const cur = kind === 'law' ? state.laws[targetId] : state.localBills[rid]?.[targetId];
  if (cur === targetTier) return { ok: false, msg: '這已經是現行的規定了，沒有修正的必要。' };

  const P = data.proposals;
  const seats = seatsOf(state, data, scope, rid);
  const myParty = state.player.party;

  // 起始只有你自己支持。這個 0 不是佔位符，是這個系統的核心：
  // 一個剛送進程序的案子，除了提案人以外沒有人有義務表態。
  const support = {};
  for (const pid in seats) support[pid] = 0;

  const quality = clamp(0.45 + state.player.attrs.judgment * 0.08
    + teamBonus(state, data, 'lawQuality')
    + (state.flags['draft_' + targetId] ?? 0) * 0.06
    + (state.flags.draftBank > 0 ? 0.12 : 0), 0, 1.3);

  state.proposal = {
    id: `PROP_${state.meta.turn}_${targetId}`,
    kind, targetId, targetTier, regionId: rid,
    targetName: target.name,
    tierName: target.tiers[targetTier].name,
    bodyName: scope.name,
    viaExecutive: !!scope.viaExecutive,
    startTurn: state.meta.turn,
    lobbyUntil: state.meta.turn + (P.lobby.windowTurns ?? 3),
    support, seats, lobbied: [], myParty,
    quality, pcSpent: 0,
    rivals: makeRivals(data, rng),
    stage: 'lobby', resolved: false, log: [],
  };
  if (state.flags.draftBank > 0) state.flags.draftBank -= 1;

  return {
    ok: true, proposal: state.proposal,
    msg: scope.viaExecutive
      ? `《${target.name}》修正草案由你的機關送進${scope.name}。接下來三個回合是拉票的時間，現在支持這個案子的只有你自己。`
      : `《${target.name}》修正案已經送進${scope.name}。接下來三個回合是拉票的時間，現在支持這個案子的只有你自己。`,
  };
}

function makeRivals(data, rng) {
  const P = data.proposals;
  const [lo, hi] = P.agenda.rivalCount ?? [3, 6];
  const n = rng.int(lo, hi);
  return rng.shuffle([...P.rivals]).slice(0, n).map((r) => ({
    title: r.title,
    weight: rng.range(r.weight[0], r.weight[1]),
  }));
}

/* ─────────── 遊說 ─────────── */

export function lobbyOpen(state, data) {
  const pr = state.proposal;
  if (!pr || pr.resolved || pr.stage !== 'lobby') return false;
  return state.meta.turn <= pr.lobbyUntil;
}

/** 可以去談的黨團，以及每一個的現況 */
export function lobbyTargets(state, data) {
  const pr = state.proposal;
  if (!pr) return [];
  return Object.keys(pr.seats)
    .filter((pid) => pr.seats[pid] > 0)
    .sort((a, b) => pr.seats[b] - pr.seats[a])
    .map((pid) => ({
      pid,
      seats: pr.seats[pid],
      own: pid === pr.myParty,
      support: pr.support[pid] ?? 0,
      done: pr.lobbied.includes(pid),
    }));
}

export function lobby(state, data, partyId, rng) {
  const pr = state.proposal;
  if (!lobbyOpen(state, data)) return { ok: false, msg: '拉票的時間已經過了，接下來就看排不排得上議程。' };
  if (!(partyId in pr.support)) return { ok: false, msg: '這個黨在這個議事機關裡沒有席次。' };

  const L = data.proposals.lobby;
  const p = state.player;
  const own = partyId === pr.myParty;
  const party = state.parties[partyId];
  const repeat = pr.lobbied.filter((x) => x === partyId).length;
  const decay = Math.pow(L.repeatPenalty ?? 0.35, repeat);

  let gain, text;
  if (own) {
    // 同黨的遊說是在跟黨團要一個會期裡的位子。一次談完通常就定了。
    gain = (L.ownParty.baseGain
      + p.attrs.sociability * (L.ownParty.perSociability ?? 0)
      + p.partyPrestige * (L.ownParty.perPrestige ?? 0)
      + (party?.cohesion ?? 3) * (L.ownParty.perCohesion ?? 0)) * decay;
    const cold = p.partyPrestige < (L.ownParty.coldPrestige ?? 1.5) && repeat === 0;
    if (cold) gain *= (L.ownParty.coldMult ?? 0.72);
    text = cold ? L.ownParty.textCold : L.ownParty.text;
    pr.support[partyId] = clamp(pr.support[partyId] + gain, 0, L.ownParty.maxSupport ?? 0.94);
  } else {
    // 他黨的遊說是在要求對方改變一個他們已經表過態的立場。
    // 上限刻意壓得很低——這裡改變立場的代價從來不是被說服。
    const friendly = friendlyWith(state, pr.myParty, partyId);
    gain = (L.otherParty.baseGain
      + p.attrs.eloquence * (L.otherParty.perEloquence ?? 0)
      + (friendly ? (L.otherParty.friendlyBonus ?? 0) : 0)) * decay;
    text = friendly ? L.otherParty.textFriendly
      : gain > 0.09 ? L.otherParty.textSome : L.otherParty.text;
    pr.support[partyId] = clamp(pr.support[partyId] + gain, 0, L.otherParty.maxSupport ?? 0.35);
  }

  pr.lobbied.push(partyId);
  const detail = repeat > 0 ? '\n\n' + L.repeatText : '';
  return {
    ok: true, own, gain,
    party: party?.shortName ?? partyId,
    support: pr.support[partyId],
    msg: text + detail,
  };
}

/** 兩個黨在統獨與經濟上站不站同一邊 */
function friendlyWith(state, a, b) {
  if (!a || !b) return false;
  const pa = state.parties[a]?.platform, pb = state.parties[b]?.platform;
  if (!pa || !pb) return false;
  const same = Math.sign(pa.unification ?? 0) === Math.sign(pb.unification ?? 0);
  const close = Math.abs((pa.unification ?? 0) - (pb.unification ?? 0)) < 2.5;
  return same && close;
}

/* ─────────── 排議程 ─────────── */

/** 目前的競爭力，畫面上要看得到，玩家才知道自己排不排得上 */
export function agendaScore(state, data) {
  const pr = state.proposal;
  if (!pr) return 0;
  const A = data.proposals.agenda;
  const total = Object.values(pr.seats).reduce((a, b) => a + b, 0) || 1;
  const backed = Object.entries(pr.support)
    .reduce((a, [pid, f]) => a + f * (pr.seats[pid] ?? 0), 0) / total;
  return backed * (A.supportWeight ?? 1.15)
    + (pr.quality / 1.3) * (A.qualityWeight ?? 0.3)
    + (state.player.partyPrestige / 5) * (A.prestigeWeight ?? 0.15)
    + pr.pcSpent / (A.pcPerPoint ?? 40) * 0.05;
}

/** 花政治資本去搶那個位子 */
export function pushAgenda(state, amount) {
  const pr = state.proposal;
  if (!pr || pr.resolved) return { ok: false, msg: '你手上沒有在跑的案子。' };
  const spend = Math.min(amount, state.player.politicalCapital);
  if (spend <= 0) return { ok: false, msg: '你的政治資本不夠。' };
  state.player.politicalCapital -= spend;
  pr.pcSpent += spend;
  return { ok: true, msg: `你把 ${spend} 點政治資本用在這個案子上。這種錢花掉就是花掉了，不會有人記得。` };
}

export function cancel(state, data) {
  const pr = state.proposal;
  if (!pr || pr.resolved) return { ok: false, msg: '你手上沒有在跑的案子。' };
  state.player.partyPrestige = clamp05(state.player.partyPrestige - (data.proposals.cancel.prestigeCost ?? 0.25));
  state.proposal = null;
  return { ok: true, msg: data.proposals.cancel.text };
}

/* ─────────── 建議（沒有提案權的人） ─────────── */

export function suggest(state, data, issueId, rng) {
  const S = data.proposals.suggest;
  const p = state.player;
  state.suggestions ??= [];
  const text = rng.pick(S.texts);
  p.fame = clamp05(p.fame + (S.fameGain ?? 0.06));
  if (issueId && state.issues[issueId] != null) {
    state.issues[issueId] = clamp(state.issues[issueId] + (S.salienceGain ?? 0.35), 0, 5);
  }
  const chance = clamp((S.adoptChanceBase ?? 0.08) + p.fame * (S.adoptChancePerFame ?? 0.035), 0, 0.6);
  state.suggestions.push({
    issueId, turn: state.meta.turn,
    until: state.meta.turn + (S.adoptWindowTurns ?? 8),
    chance, resolved: false,
  });
  return { ok: true, msg: text, chance };
}

/* ─────────── 每回合 ─────────── */

export function tick(state, ctx) {
  const { data, rng } = ctx;
  const news = [];
  const P = data.proposals;

  /* 提案：遊說期結束就排議程 */
  const pr = state.proposal;
  if (pr && !pr.resolved && pr.stage === 'lobby' && state.meta.turn > pr.lobbyUntil) {
    const score = agendaScore(state, data);
    // 所有案子一起排隊，前幾名才進得去。輸掉不是被否決，
    // 只是這個會期沒有位子——這在真實的議事機關裡是最常見的死法。
    const slots = P.agenda.slots ?? 3;
    const rank = pr.rivals.filter((r) => r.weight > score).length + 1;
    const won = rank <= slots;
    pr.rank = rank;
    pr.stage = won ? 'agenda' : 'shelved';
    pr.resolved = !won;
    pr.agendaScore = score;
    news.push({ kind: 'law', text: (won ? P.agenda.wonText : P.agenda.lostText)
      + `（《${pr.targetName}》，競爭力 ${(score * 100).toFixed(0)}，在 ${pr.rivals.length + 1} 個案子裡排第 ${pr.rank}，這個會期有 ${slots} 個位子）` });
    if (won) handoff(state, data, pr);
  }

  /* 地方案排上議程之後很快就表決 */
  if (pr && !pr.resolved && pr.stage === 'vote' && state.meta.turn >= pr.voteTurn) {
    const res = resolveLocal(state, data, pr, rng);
    if (res) news.push({ kind: 'law', text: res.text });
    state.flags.proposalSupport = null;
  }

  /* 建議：有機會被別人撿走 */
  for (const s of state.suggestions ?? []) {
    if (s.resolved) continue;
    if (state.meta.turn > s.until) {
      s.resolved = true;
      news.push({ kind: 'law', text: P.suggest.ignoredText });
      continue;
    }
    if (rng.bool(s.chance / 8)) {
      s.resolved = true;
      s.adopted = true;
      state.player.fame = clamp05(state.player.fame + 0.12);
      state.player.politicalCapital += 8;
      news.push({ kind: 'law', text: P.suggest.adoptedText });
    }
  }
  if (state.suggestions?.length > 12) {
    state.suggestions = state.suggestions.filter((s) => !s.resolved).slice(-12);
  }
  return { news };
}

/**
 * 排上議程之後交給原本的表決流程。
 * 遊說換來的支持會直接變成表決時的加成——
 * 那些答應要幫你講話的人，到了那一天要真的按下去。
 */
function handoff(state, data, pr) {
  state.flags.proposalSupport = { ...pr.support };

  if (pr.kind === 'law') {
    // 中央的案子走原本那條有六個關卡的程序，遊說換來的支持在最後表決時兌現
    state.session.billsInProgress.push({
      id: pr.id, lawId: pr.targetId, targetTier: pr.targetTier,
      stage: 0, proposer: 'player', quality: pr.quality,
      startTurn: state.meta.turn, pcSpent: pr.pcSpent,
      fromProposal: pr.id, log: [],
    });
    pr.stage = 'inProgress';
  } else {
    // 地方議會沒有那麼多關，排上議程之後很快就表決
    pr.stage = 'vote';
    pr.voteTurn = state.meta.turn + 1;
  }
}

/**
 * 地方議案的表決。
 * 議會的程序比立法院短很多，排上議程之後下一次會期就會處理掉。
 */
function resolveLocal(state, data, pr, rng) {
  const region = state.regions[pr.regionId];
  const bill = data.byId.bill[pr.targetId];
  if (!region || !bill) { pr.resolved = true; return null; }
  const comp = pr.seats;
  const total = Object.values(comp).reduce((a, b) => a + b, 0) || 1;
  const mayorParty = region.politics.mayorParty;
  let yes = 0;
  const parts = [];
  for (const pid in comp) {
    let p = 0.42 + (pr.support[pid] ?? 0) * 0.55;
    if (pid === mayorParty && pr.viaExecutive) p += 0.12;
    p -= (bill.controversy ?? 2) * 0.03;
    p += pr.quality * 0.08;
    p += pr.pcSpent / 60 * 0.04;
    let partyYes = 0;
    for (let i = 0; i < comp[pid]; i++) if (rng.bool(clamp(p, 0.03, 0.97))) partyYes++;
    yes += partyYes;
    if (comp[pid] >= 3) parts.push(`${state.parties[pid]?.shortName ?? '無黨籍'} ${partyYes}/${comp[pid]}`);
  }
  const passed = yes > total / 2;
  pr.resolved = true;
  pr.stage = passed ? 'passed' : 'failed';
  if (passed) {
    state.modifiers.removeBySource(`bill:${pr.regionId}:${pr.targetId}`);
    state.localBills[pr.regionId][pr.targetId] = pr.targetTier;
    applyEffects(state, data, bill.tiers[pr.targetTier].effects, {
      source: `bill:${pr.regionId}:${pr.targetId}`, label: bill.name,
      regionId: pr.regionId, regionKey: pr.regionId, duration: -1,
    });
    const g = bill.tiers[pr.targetTier].effects?.grassrootsEffect ?? 0;
    if (g) for (const d of Object.values(state.districts)) {
      if (d.regionId === pr.regionId) grow(state, d.id, g);
    }
    region.finance.debt -= bill.tiers[pr.targetTier].cost?.annual ?? 0;
    state.player.partyPrestige = clamp05(state.player.partyPrestige + 0.25);
    state.player.careerLog.push({ turn: state.meta.turn, kind: 'law',
      text: `推動《${bill.name}》改為「${bill.tiers[pr.targetTier].name}」` });
  } else {
    state.player.partyPrestige = clamp05(state.player.partyPrestige - 0.15);
  }
  return {
    passed, yes, total,
    text: passed
      ? `《${bill.name}》在議會以 ${yes} 比 ${total - yes} 通過，改為「${bill.tiers[pr.targetTier].name}」（${parts.join('、')}）。那些答應要支持你的人，今天真的按了下去。`
      : `《${bill.name}》在議會遭到否決，票數是 ${yes} 比 ${total - yes}（${parts.join('、')}）。有幾位在遊說期答應過你的人，今天沒有進場。`,
  };
}

/**
 * 表決的時候，某個黨團的贊成傾向要調整多少。
 *
 * 這裡有一個負數，而那個負數才是重點：
 * 一個沒有被遊說過的黨團不會給你一半的票。舊的模型讓每個黨從五成起跳，
 * 等於你什麼都不做就有半個院支持你——那不是議事機關的樣子。
 *
 * 現在沒談過的人往下掉，談過的人按照支持度往上加。
 * 所以一個案子能不能過，看的是提案人在那三個回合裡真的去談了幾個人。
 */
export function lobbyBonus(state, partyId, data) {
  const s = state.flags.proposalSupport;
  if (!s) return 0;
  const V = data?.proposals?.vote ?? {};
  const support = s[partyId] ?? 0;
  return support * (V.supportToVote ?? 0.58) - (V.unlobbiedPenalty ?? 0.19);
}
