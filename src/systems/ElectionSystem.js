// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { mobilization } from './DistrictSystem.js';
import { makePolitician } from './NameGen.js';

/** 距離下一場玩家可參與的選舉還有幾個月 */
export function monthsUntilElection(state, data) {
  const { year, month } = state.meta;
  for (const s of data.elections.schedule) {
    const diff = (s.year - year) * 12 + (s.month - month);
    if (diff >= 0) return { months: diff, sched: s };
  }
  return { months: null, sched: null };
}

export function shouldUseWeekScale(state, data) {
  const { months } = monthsUntilElection(state, data);
  return months !== null && months <= data.meta.weekTurnLeadMonths;
}

/** 玩家可參選的職位 */
export function availableRuns(state, data, sched) {
  const p = state.player;
  const out = [];
  const homeD = data.byId.district[p.homeDistrict];
  if (!homeD || !sched) return out;
  const L = data.elections.levels;
  for (const type of sched.types) {
    const lv = L[type];
    if (!lv) continue;
    if ((lv.fameNeed ?? 0) > p.fame) continue;
    if (type === 'councilor') out.push({ type, scopeId: homeD.id, name: `${homeD.name}${lv.name}`, level: lv });
    else if (type === 'mayor') out.push({ type, scopeId: homeD.regionId, name: `${data.byId.region[homeD.regionId].name}${lv.name}`, level: lv });
    else if (type === 'legislator') {
      const ld = data.elections.legislatorDistricts.find((l) => l.parts.some((x) => x.districtId === homeD.id));
      if (ld) out.push({ type, scopeId: ld.id, name: `${ld.name}${lv.name}`, level: lv });
    } else if (type === 'president') out.push({ type, scopeId: 'NATION', name: '總統', level: lv });
    else if (type === 'villageHead' || type === 'townshipHead') out.push({ type, scopeId: homeD.id, name: `${homeD.name}${lv.name}`, level: lv });
  }
  return out;
}

/** 取得某個範圍涵蓋的選區清單與權重 */
export function scopeDistricts(data, type, scopeId) {
  const all = data.districts.districts;
  if (type === 'president') return all.map((d) => ({ districtId: d.id, weight: 1 }));
  if (type === 'mayor') return all.filter((d) => d.regionId === scopeId).map((d) => ({ districtId: d.id, weight: 1 }));
  if (type === 'legislator') {
    const ld = data.elections.legislatorDistricts.find((l) => l.id === scopeId);
    return ld ? ld.parts : [];
  }
  return [{ districtId: scopeId, weight: type === 'villageHead' || type === 'townshipHead' ? 0.25 : 1 }];
}

/** 產生對手 */
export function makeOpponents(state, data, run, rng) {
  const homeD = data.byId.district[run.scopeId] ?? data.byId.district[state.player.homeDistrict];
  const lean = homeD?.lean ?? 0;
  const n = run.type === 'councilor' ? Math.max(3, (homeD?.seats ?? 5) + 3)
    : run.type === 'president' ? 2 : rng.int(1, 3);
  const pool = data.partyIds.filter((p) => state.parties[p] && p !== state.player.party);
  const out = [];
  for (let i = 0; i < n; i++) {
    const party = rng.weighted(pool.map((p) => ({
      p, w: (state.parties[p].support ?? 0.1) * 100 + (p === 'CRP' ? lean * 3 : p === 'PDA' ? -lean * 3 : 0) + 5,
    })), (x) => x.w).p;
    const npc = makePolitician(data, rng, { party, fame: clamp(rng.int(1, 4) + (run.type === 'president' ? 1 : 0), 0, 5) });
    npc.grassroots = clamp05(rng.range(1, 4));
    out.push(npc);
  }
  return out;
}

/**
 * 核心得票計算。
 * 每個候選人、每個選區各擲一次 0.98~1.05 的乘數。
 */
export function computeVotes(state, data, run, candidates, rng) {
  const P = state.pops;
  const nP = data.partyIds.length;
  const parts = scopeDistricts(data, run.type, run.scopeId);
  const partMap = Object.fromEntries(parts.map((p) => [p.districtId, p.weight]));
  const dIndex = {};
  data.districts.districts.forEach((d, i) => (dIndex[i] = d));
  const level = run.level;

  const totals = candidates.map(() => 0);
  const byDistrict = {};

  for (let i = 0; i < P.n; i++) {
    const d = dIndex[P.district[i]];
    const w = partMap[d.id];
    if (!w) continue;

    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci];
      const pIdx = data.partyIds.indexOf(c.party);
      const partySup = pIdx >= 0 ? P.support[i * nP + pIdx] : 0.04;
      const mob = c.isPlayer ? mobilization(state, d.id, c.party) : (c.grassroots ?? 1);
      const personal = personalFactor(state, data, c, d, i);

      const scoreRaw = partySup * 0.55 + personal * 0.30 + (mob / 5) * 0.15;
      // 投票率
      const enth = P.enthusiasm[i];
      const turnout = clamp(
        P.turnoutBase[i]
        * (1 + P.awareness[i] / 5 * 0.15)
        * level.turnoutFactor
        * (1 + mob * 0.04)
        * (0.72 + 0.056 * enth)
        * (state.flags.weatherFactor ?? 1),
        0.15, 0.95);
      const votes = P.size[i] * w * turnout * scoreRaw;
      totals[ci] += votes;
      (byDistrict[d.id] ??= candidates.map(() => 0))[ci] += votes;
    }
  }
  // 正規化 + 每人每區的隨機乘數
  const results = candidates.map((c, ci) => {
    const noise = rng.range(0.98, 1.05);
    return { candidate: c, votes: Math.round(totals[ci] * noise), noise };
  });
  const sum = results.reduce((a, r) => a + r.votes, 0) || 1;
  results.forEach((r) => (r.share = r.votes / sum));
  results.sort((a, b) => b.votes - a.votes);
  return { results, byDistrict };
}

function personalFactor(state, data, c, district, popIdx) {
  const P = state.pops;
  if (c.isPlayer) {
    const p = state.player;
    const dState = state.districts[district.id];
    const home = data.byId.district[p.homeDistrict];
    const geo = district.id === p.homeDistrict ? 1 : district.regionId === home?.regionId ? 0.5 : 0;
    let f = 0.30 * (p.fame / 5)
      + 0.25 * ((dState.playerFavor + 5) / 10)
      + 0.20 * (p.attrs.charisma / 5)
      + 0.15 * geo
      - 0.10 * (p.stigma / 5)
      + 0.05 * ((P.playerFavor[popIdx] + 5) / 10);
    for (const tid of state.tags) {
      const t = data.byId.tag[tid];
      const sid = data.strataIds[P.stratum[popIdx]];
      const pf = t?.effects?.popFavor;
      if (pf) f += ((pf[sid] ?? pf._all ?? 0)) * 0.02;
      if (t?.effects?.moderateVotePenalty) f -= t.effects.moderateVotePenalty * 0.5;
    }
    return clamp(f, 0, 1);
  }
  return clamp(0.30 * (c.fame / 5) + 0.20 * (c.attrs.charisma / 5) + 0.20 * ((c.grassroots ?? 1) / 5)
    + 0.20 * 0.5 - 0.10 * (c.stigma / 5), 0, 1);
}

/** SNTV：複數當選 */
export function resolveSNTV(results, seats) {
  return results.slice(0, seats).map((r) => r.candidate);
}

/** 不分區：政黨票 5% 門檻，最大餘額法 */
export function partyListSeats(support, seatCount = 34, threshold = 0.05) {
  const eligible = Object.entries(support).filter(([, v]) => v >= threshold);
  const total = eligible.reduce((a, [, v]) => a + v, 0) || 1;
  const quotas = eligible.map(([k, v]) => ({ k, exact: (v / total) * seatCount }));
  const out = {};
  let used = 0;
  for (const q of quotas) { out[q.k] = Math.floor(q.exact); used += out[q.k]; }
  quotas.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  let i = 0;
  while (used < seatCount && quotas.length) { out[quotas[i % quotas.length].k]++; used++; i++; }
  return out;
}

/** 黨內初選 */
export function primary(state, data, run, rng) {
  const p = state.player;
  if (!p.party) return { ok: true, won: true, msg: '你沒有政黨，不需要初選，直接登記參選就可以。' };
  const party = state.parties[p.party];
  const d = state.districts[data.byId.district[p.homeDistrict] ? p.homeDistrict : Object.keys(state.districts)[0]];
  const pollScore = ((d?.playerFavor ?? 0) + 5) / 10 * 0.55 + p.fame / 5 * 0.45;
  const facSum = party.factions.reduce((a, f) => a + clamp(f.favor / 5, -1, 1) * f.seatShare, 0);
  const memberScore = p.partyPrestige / 5 * 0.5 + (facSum + 1) / 2 * 0.5;
  const score = pollScore * 0.5 + memberScore * 0.5 - p.stigma / 5 * 0.12;
  const rivalScore = rng.range(0.32, 0.66);
  const won = score + rng.normal(0, 0.06) > rivalScore;
  return {
    ok: true, won, score, rivalScore,
    msg: won
      ? `你在黨內初選中出線，對手在記者會上表示尊重，但握手的時候沒有看你的眼睛。`
      : `你在黨內初選落敗。黨中央希望你留下來輔選，但要不要接受這個安排，決定權在你手上。`,
  };
}

/** 選後結算 */
export function applyResult(state, data, run, outcome) {
  const p = state.player;
  if (outcome.won) {
    p.role = run.type === 'councilor' ? 'councilor' : run.type === 'legislator' ? 'legislator'
      : run.type === 'mayor' ? 'mayor' : run.type === 'president' ? 'president' : 'village';
    p.office = { type: run.type, scopeId: run.scopeId, name: run.name, since: state.meta.turn };
    p.fame = clamp05(p.fame + (run.type === 'president' ? 2 : run.type === 'mayor' ? 1 : 0.5));
    p.careerLog.push({ turn: state.meta.turn, kind: 'win', text: `當選${run.name}` });
    if (run.type === 'president') state.central.government.presidentParty = p.party ?? 'IND';
    if (run.type === 'mayor') state.regions[run.scopeId].politics.mayorParty = p.party ?? 'IND';
  } else {
    p.careerLog.push({ turn: state.meta.turn, kind: 'lose', text: `${run.name}落選` });
    p.fame = clamp05(p.fame - 0.2);
  }
  // 選舉補助款
  const my = outcome.results.find((r) => r.candidate.isPlayer);
  if (my && my.share >= data.elections.subsidyThreshold) {
    state.finance.campaign += my.votes * data.elections.subsidyPerVote;
  }
  state.election = null;
  return outcome;
}
