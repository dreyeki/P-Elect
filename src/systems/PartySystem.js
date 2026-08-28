// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { nationalSupport } from './PopSystem.js';

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const news = [];
  const support = nationalSupport(state, data);

  for (const p of Object.values(state.parties)) {
    // 團結度：受民調、內部派系落差影響
    const spread = p.factions.length
      ? Math.max(...p.factions.map((f) => f.favor)) - Math.min(...p.factions.map((f) => f.favor)) : 0;
    const target = clamp05(3 + (support[p.id] - 0.2) * 6 - spread * 0.25);
    p.cohesion = clamp05(p.cohesion + (target - p.cohesion) * 0.03 * scaleMult);
    p.publicImage = clamp05(p.publicImage + ((support[p.id] * 12) - p.publicImage) * 0.02 * scaleMult);
    p.support = support[p.id];

    // 議題評價：跟著執政表現與 POP 生活水準走
    const inPower = p.id === state.central.government.presidentParty;
    for (const iss of data.issueIds) {
      const drift = inPower ? (state.flags.solTrend ?? 0) * 3 : -(state.flags.solTrend ?? 0) * 0.8;
      p.issuePerformance[iss] = clampBi(p.issuePerformance[iss] + drift * 0.05 * scaleMult
        + rng.normal(0, 0.02) * scaleMult);
    }

    // 派系好感自然回歸
    for (const f of p.factions) f.favor *= 1 - 0.004 * scaleMult;

    // 分裂
    if (p.cohesion <= 1 && p.factions.length > 1) {
      const rebel = p.factions.find((f) => f.favor <= -4);
      if (rebel && rng.bool(0.10 * scaleMult)) {
        splitParty(state, data, p, rebel, news);
      }
    }
  }
  return { news };
}

function splitParty(state, data, party, faction, news) {
  const newId = party.id + '_S';
  if (state.parties[newId]) return;
  const seats = Math.round(party.legislatorSeats * faction.seatShare);
  party.legislatorSeats -= seats;
  party.factions = party.factions.filter((f) => f !== faction);
  const renorm = party.factions.reduce((a, f) => a + f.seatShare, 0) || 1;
  party.factions.forEach((f) => (f.seatShare /= renorm));

  const platform = { ...party.platform };
  for (const k in faction.ideologyShift) platform[k] = clampBi((platform[k] ?? 0) + faction.ideologyShift[k]);

  state.parties[newId] = {
    id: newId, name: faction.name + '聯盟', shortName: faction.name.slice(0, 2),
    color: '#8a8f98', platform, identityAppeal: { ...party.identityAppeal },
    legislatorSeats: seats, treasury: Math.round(party.treasury * 0.1),
    cohesion: 4, publicImage: 2,
    issuePerformance: { ...party.issuePerformance },
    factions: [{ ...faction, seatShare: 1, favor: 3, trust: 3 }],
  };
  data.partyIds.push(newId);
  state.legislature[newId] = seats;
  state.legislature[party.id] = Math.max(0, (state.legislature[party.id] ?? 0) - seats);
  for (const d of Object.values(state.districts)) {
    d.grassroots[newId] = clamp05((d.grassroots[party.id] ?? 0) * 0.3);
    d.grassroots[party.id] = clamp05((d.grassroots[party.id] ?? 0) * 0.7);
  }
  news.push({ kind: 'party', text: `${party.name}正式分裂，${faction.name}在今天上午宣布另組新黨，帶走了 ${seats} 席立委與大批地方樁腳，政壇的板塊在一個早上就重新排列了。` });
}

export function factionOf(state, partyId, factionId) {
  return state.parties[partyId]?.factions.find((f) => f.id === factionId);
}

export function shiftFactionFavor(state, partyId, factionId, delta) {
  const f = factionOf(state, partyId, factionId);
  if (f) f.favor = clampBi(f.favor + delta);
}

/** 依派系立場，判斷玩家投票會讓哪些派系高興 */
export function reactToVote(state, data, lawId, tierIndex) {
  const pid = state.player.party;
  if (!pid) return;
  const law = data.byId.law[lawId];
  const tier = law.tiers[tierIndex];
  const party = state.parties[pid];
  const partyStance = tier.partyStance?.[pid] ?? 0;
  for (const f of party.factions) {
    let bias = 0;
    for (const ax in f.ideologyShift) {
      bias += (tier.effects?.valuePressure?.[ax] ?? 0) * Math.sign(f.ideologyShift[ax]) * 0.3;
    }
    f.favor = clampBi(f.favor + clamp(partyStance * 0.2 + bias, -0.6, 0.6));
  }
}

/** 黨職挑戰 */
export function challengeLeadership(state, data, level, rng) {
  const p = state.player;
  const party = state.parties[p.party];
  if (!party) return { ok: false, msg: '你沒有政黨，沒有黨職可以挑戰。' };
  const facSum = party.factions.reduce((a, f) => a + (f.favor / 5) * f.seatShare, 0);
  const score = p.partyPrestige / 5 * 0.35 + clamp(facSum, -1, 1) * 0.35
    + p.fame / 5 * 0.15 + (p.favorNational + 5) / 10 * 0.15 - p.stigma / 5 * 0.10;
  const need = { caucus: 0.35, viceChair: 0.5, chair: 0.62 }[level] ?? 0.6;
  const roll = score + rng.normal(0, 0.08);
  if (roll >= need) {
    state.flags.partyOffice = level;
    p.partyPrestige = clamp05(p.partyPrestige + 1);
    return { ok: true, msg: level === 'chair' ? '你當選黨主席。今晚的中常會上，所有人都站起來鼓掌，但你認得出哪幾雙眼睛沒有在笑。' : '你拿下了這個黨職，黨團的座位表明天就會重排。' };
  }
  p.partyPrestige = clamp05(p.partyPrestige - 0.5);
  return { ok: false, msg: '你輸了這場黨內選舉。輸的不只是票數，還有接下來兩年別人看你的眼神。' };
}
