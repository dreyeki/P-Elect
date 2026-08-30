// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { applyEffects, bumpCounter } from './Effects.js';
import { reactToVote } from './PartySystem.js';
import { teamBonus } from './TeamSystem.js';
import { isConsensus } from './ValueSystem.js';
import { nationalSupport } from './PopSystem.js';
import { petition } from './CourtSystem.js';
import { lobbyBonus } from './ProposalSystem.js';

export const STAGES = ['提案', '一讀付委', '委員會審查', '黨團協商', '二讀', '三讀', '公布施行'];

export function inSession(state) {
  const m = state.meta.month;
  return (m >= 2 && m <= 5) || (m >= 9 && m <= 12);
}

export function propose(state, data, lawId, targetTier) {
  const law = data.byId.law[lawId];
  if (!law) return { ok: false, msg: '找不到這條法律。' };
  if (state.laws[lawId] === targetTier) return { ok: false, msg: '這已經是現行的規定了，沒有修正的必要。' };
  if (state.session.billsInProgress.some((b) => b.lawId === lawId)) {
    return { ok: false, msg: '這條法律已經有一個修正案在程序中了。' };
  }
  const bill = {
    id: `BILL_${state.meta.turn}_${lawId}`,
    lawId, targetTier, stage: 0,
    proposer: 'player',
    quality: clamp(0.5 + state.player.attrs.judgment * 0.08 + teamBonus(state, data, 'lawQuality')
      + (state.flags['draft_' + lawId] ?? 0) * 0.06, 0, 1.2),
    startTurn: state.meta.turn,
    pcSpent: 0,
    log: [],
  };
  state.session.billsInProgress.push(bill);
  return { ok: true, bill, msg: `《${law.name}》修正案已經送進程序，接下來每一關都要有人幫你頂住。` };
}

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const news = [];
  if (!inSession(state)) return { news };
  if (state.meta.scale === 'week' && !rng.bool(0.35)) return { news };

  for (const bill of [...state.session.billsInProgress]) {
    const law = data.byId.law[bill.lawId];
    bill.stage += 1;
    if (bill.stage === 3 && law.controversy < 3) bill.stage = 4;      // 不爭議法案跳過協商

    if (bill.stage >= 5) {
      const res = vote(state, data, bill, rng);
      bill.log.push(res.msg);
      if (res.passed) {
        enact(state, data, bill);
        news.push({ kind: 'law', text: `《${law.name}》修正案三讀通過，改為「${law.tiers[bill.targetTier].name}」，${res.detail}` });
        const rev = petition(state, data, bill.lawId, rng);
        if (rev) {
          news.push({ kind: 'court', text: `在野立委今天完成連署，就《${law.name}》修正條文向憲法法庭聲請釋憲。這件事在裁判出來之前都不算定案。` });
        }
        bumpCounter(state, data, 'policyDelivered');
        state.player.partyPrestige = clamp05(state.player.partyPrestige + 0.3);
      } else {
        news.push({ kind: 'law', text: `《${law.name}》修正案在表決中遭到否決，${res.detail}` });
        state.player.partyPrestige = clamp05(state.player.partyPrestige - 0.2);
      }
      state.session.billsInProgress = state.session.billsInProgress.filter((b) => b !== bill);
      // 這一案結束了，遊說換來的支持不該被下一案沿用
      if (bill.fromProposal) {
        state.flags.proposalSupport = null;
        if (state.proposal?.id === bill.fromProposal) state.proposal = null;
      }
    } else if (bill.stage === 3) {
      news.push({ kind: 'law', text: `《${law.name}》修正案進入黨團協商，依規定要先經過一個月的冷凍期，各方都在利用這段時間拉票。` });
    }
  }
  return { news };
}

/** 計算通過機率與結果 */
export function vote(state, data, bill, rng) {
  const law = data.byId.law[bill.lawId];
  const tier = law.tiers[bill.targetTier];
  const total = Object.values(state.legislature).reduce((a, b) => a + b, 0) || 113;
  const support = nationalSupport(state, data);
  let yes = 0, detailParts = [];

  for (const pid in state.legislature) {
    const seats = state.legislature[pid];
    if (!seats) continue;
    // 無黨籍不是一個政黨，state.parties 裡沒有它。
    // 那兩三席在表決裡是真的存在的，所以給一組中間值：沒有黨紀，也沒有黨團立場。
    const party = state.parties[pid] ?? { shortName: '無黨籍', cohesion: 0.5, factions: [] };
    let p = 0.5 + (tier.partyStance?.[pid] ?? 0) * 0.45;
    // 民意壓力
    p += (support[pid] ?? 0) * 0.1;
    // 遊說期答應要幫你講話的人，到了表決那一天要真的按下去。
    // 換算成投票傾向的時候打對折——答應歸答應，按鈕還是他自己按的。
    p += lobbyBonus(state, pid, data);
    // 玩家的派系動員
    if (pid === state.player.party) {
      const mob = party.factions.reduce((a, f) => a + clamp(f.favor / 5, -1, 1) * f.seatShare, 0);
      p += mob * 0.28;
      p += bill.quality * 0.12;
      p += Math.min(0.18, bill.pcSpent / 50 * 0.03);
    }
    // 爭議度與社會共識
    p -= law.controversy * 0.03;
    for (const ax in tier.effects?.valuePressure ?? {}) {
      if (isConsensus(state, ax) && Math.sign(tier.effects.valuePressure[ax]) === Math.sign(state.values[ax])) p += 0.15;
    }
    // 跑票
    const defect = 1 - party.cohesion / 5;
    p = clamp(p, 0.02, 0.98);
    let partyYes = 0;
    for (let i = 0; i < seats; i++) {
      const pp = clamp(p + rng.normal(0, defect * 0.35), 0, 1);
      if (rng.bool(pp)) partyYes++;
    }
    yes += partyYes;
    if (seats >= 5) detailParts.push(`${party.shortName ?? pid} ${partyYes}/${seats}`);
  }
  const passed = yes > total / 2;
  return {
    passed, yes, total,
    msg: `表決 ${yes} 比 ${total - yes}`,
    detail: `贊成 ${yes} 票、反對 ${total - yes} 票（${detailParts.join('、')}）。`,
  };
}

function enact(state, data, bill) {
  const law = data.byId.law[bill.lawId];
  const oldTier = state.laws[bill.lawId];
  state.flags['prevTier_' + bill.lawId] = oldTier;   // 釋憲被撤銷時要退回這裡
  // 撤掉舊檔位的持續修正
  state.modifiers.removeBySource('law:' + bill.lawId);
  state.laws[bill.lawId] = bill.targetTier;
  applyEffects(state, data, law.tiers[bill.targetTier].effects, {
    source: 'law:' + bill.lawId, label: law.name, duration: -1,
  });
  reactToVote(state, data, bill.lawId, bill.targetTier);
  // 標籤計數
  if (law.category === 'labor' && bill.targetTier > oldTier) bumpCounter(state, data, 'proLaborVote');
  if (law.category === 'fiscal' && bill.targetTier < oldTier) bumpCounter(state, data, 'proBizVote');
  state.player.careerLog.push({ turn: state.meta.turn, kind: 'law', text: `推動《${law.name}》改為「${law.tiers[bill.targetTier].name}」` });
}

/** 花政治資本強推 */
export function pushBill(state, billId, pc) {
  const b = state.session.billsInProgress.find((x) => x.id === billId);
  if (!b) return false;
  const spend = Math.min(pc, state.player.politicalCapital);
  state.player.politicalCapital -= spend;
  b.pcSpent += spend;
  return true;
}

/** 立法院席次結構（每次選舉後重算） */
export function seatSummary(state) {
  const total = Object.values(state.legislature).reduce((a, b) => a + b, 0);
  const rows = Object.entries(state.legislature)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const ruling = state.legislature[state.central.government.presidentParty] ?? 0;
  return { total, rows, divided: ruling <= total / 2 };
}
