// @ts-check
/**
 * 同一張選票上的其他人。
 *
 * 台灣的選舉是綁在一起投的：地方選舉那一天，選民手上會拿到縣市長、議員、
 * 鄉鎮市長、村里長好幾張票；中央選舉那一天則是總統、區域立委、政黨票。
 *
 * 這個系統存在的理由不是「把它們列出來好看」，是**下層級的結果
 * 很大程度取決於上層級**。台灣人管這個叫母雞帶小雞：
 * 縣市長選情好的那一邊，議員會多上幾席；總統大勝的那一年，立委席次會跟著翻過去。
 *
 * 所以流程是兩段的：
 *   1. 玩家那一場開票**之前**，先把排在他上面的那幾場跑完，
 *      把領先幅度換算成加成，讓玩家自己的票也吃到（或被拖累）。
 *   2. 玩家開完票之後，再把排在他下面的那幾場跑完，那幾場吃玩家這一場的結果。
 *
 * 這樣玩家在開票畫面上看到的東西才是誠實的：
 * 他這一席有一部分不是他自己贏來的。
 */
import { clamp, clamp05 } from '../core/Formula.js';
import { makePolitician } from './NameGen.js';
import { nationalSupport } from './PopSystem.js';
import { scopeDistricts, levelExistsIn } from './ElectionSystem.js';

/** 這一天的選票上，排在最前面的是哪一場 */
export function topOfTicket(data, sched) {
  const order = data.elections.sameDay?.ticketOrder ?? [];
  for (const t of order) if (sched?.types?.includes(t)) return t;
  return null;
}

function orderIndex(data, type) {
  const order = data.elections.sameDay?.ticketOrder ?? [];
  const i = order.indexOf(type);
  return i < 0 ? 99 : i;
}

/** 這一場選舉的範圍：總統是全國，縣市長是縣市，其餘看玩家的家鄉 */
function scopeFor(state, data, type) {
  const homeD = data.byId.district[state.player.homeDistrict];
  if (type === 'president' || type === 'partyList') return { id: 'NATION', name: '全國' };
  if (type === 'mayor') {
    const r = data.byId.region[homeD.regionId];
    return { id: homeD.regionId, name: r?.name ?? '' };
  }
  if (type === 'legislator') {
    const ld = data.elections.legislatorDistricts.find((l) =>
      l.parts.some((x) => x.districtId === homeD.id));
    return { id: ld?.id ?? homeD.id, name: ld?.name ?? homeD.name };
  }
  return { id: homeD.id, name: homeD.name };
}

/**
 * 某個範圍裡的政黨支持度。
 * 這是給玩家沒有參選的那幾場用的——不逐個候選人算，
 * 因為玩家看不到那些人的臉，他只在乎哪一邊贏了幾席。
 */
function partyShareIn(state, data, type, scopeId) {
  if (scopeId === 'NATION') return nationalSupport(state, data);
  const P = state.pops, nP = data.partyIds.length;
  const parts = scopeDistricts(data, type === 'legislator' ? 'legislator' : type, scopeId);
  const inScope = new Set(parts.map((p) => p.districtId));
  const acc = new Float64Array(nP);
  let w = 0;
  for (let i = 0; i < P.n; i++) {
    const d = data.districts.districts[P.district[i]];
    if (!inScope.has(d.id)) continue;
    const s = P.size[i];
    for (let p = 0; p < nP; p++) acc[p] += P.support[i * nP + p] * s;
    w += s;
  }
  const out = {};
  data.partyIds.forEach((pid, p) => (out[pid] = acc[p] / Math.max(1, w)));
  return out;
}

/** 這個層級有幾席 */
function seatsFor(state, data, type, scopeId) {
  if (type === 'councilor') return state.regions[scopeId]?.councilSeats
    ?? data.byId.region[scopeId]?.councilSeats ?? 1;
  if (type === 'partyList') return 34;
  if (type === 'legislator') return 1;
  return 1;
}

/**
 * 跑一場玩家沒有參選的選舉。
 * 單一席次的看誰的票最多，複數席次的按得票比例分席。
 */
function simulateRace(state, data, type, rng, coattail) {
  const lv = data.elections.levels[type];
  if (!lv) return null;
  // 直轄市與省轄市底下是區，區長是派任的。那一天他們手上就是少兩張票，
  // 開票畫面上也不該冒出一場不存在的鄉鎮市長選舉。
  const homeD = data.byId.district[state.player.homeDistrict];
  if (!levelExistsIn(data, lv, homeD?.regionId)) return null;
  const scope = scopeFor(state, data, type);
  const share = { ...partyShareIn(state, data, type, scope.id) };

  // 母雞帶小雞：上層級贏家的領先幅度傳導下來
  if (coattail?.party && coattail.shift) {
    const c = data.elections.sameDay?.coattail ?? {};
    const rate = c[coattail.topType]?.[type] ?? 0;
    const shift = clamp(coattail.shift * rate, -(c.maxShift ?? 0.14), c.maxShift ?? 0.14);
    if (shift) {
      share[coattail.party] = Math.max(0.01, (share[coattail.party] ?? 0) + shift);
      // 從別人身上等比例扣回來，總和才不會爆掉
      const others = Object.keys(share).filter((k) => k !== coattail.party);
      const pool = others.reduce((a, k) => a + share[k], 0) || 1;
      for (const k of others) share[k] = Math.max(0.005, share[k] - shift * (share[k] / pool));
    }
  }

  // 每一場都有自己的雜訊，不然同一天的每一場看起來會像同一場
  for (const k in share) share[k] = Math.max(0.002, share[k] * rng.range(0.9, 1.1));
  const sum = Object.values(share).reduce((a, b) => a + b, 0) || 1;
  for (const k in share) share[k] /= sum;

  const ranked = Object.entries(share).sort((a, b) => b[1] - a[1]);
  const seats = seatsFor(state, data, type, scope.id);
  const winnerParty = ranked[0][0];

  const out = {
    type, name: `${scope.name}${lv.name}`, levelName: lv.name, scopeName: scope.name,
    seats, winnerParty,
    winnerName: makePolitician(data, rng, { party: winnerParty, fame: rng.int(2, 4) }).name,
    share: ranked[0][1],
    margin: ranked[0][1] - (ranked[1]?.[1] ?? 0),
    isPlayerRace: false,
  };
  // 複數席次的選舉，玩家在乎的是席次怎麼分，不是誰第一名
  if (seats > 1) {
    out.seatSplit = ranked
      .map(([pid, s]) => ({ pid, seats: Math.round(s * seats) }))
      .filter((x) => x.seats > 0);
    const got = out.seatSplit.reduce((a, x) => a + x.seats, 0);
    if (got !== seats && out.seatSplit.length) out.seatSplit[0].seats += seats - got;
  }
  return out;
}

/**
 * 玩家那一場之前先跑完的：排在他上面的那幾場。
 * 回傳的 coattail 會被 computeVotes 讀走，
 * 所以玩家自己的票也會吃到（或被拖累）這個結果。
 */
export function runAbove(state, data, run, sched, rng) {
  const races = [];
  const top = topOfTicket(data, sched);
  state.flags.coattail = null;
  if (!top || !sched) return { races, coattail: null, top };

  const myIdx = orderIndex(data, run.type);
  const above = (data.elections.sameDay?.ticketOrder ?? [])
    .filter((t) => sched.types.includes(t) && orderIndex(data, t) < myIdx);

  let coattail = null;
  for (const t of above) {
    const r = simulateRace(state, data, t, rng, coattail);
    if (!r) continue;
    races.push(r);
    // 只有這一天的第一場（總統或縣市長）會帶動下面全部
    if (t === top) coattail = { topType: t, topName: r.name, party: r.winnerParty, shift: r.margin };
  }
  state.flags.coattail = coattail;
  return { races, coattail, top };
}

/**
 * 玩家開完票之後才跑的：排在他下面的那幾場。
 * 如果玩家自己就是這一天的第一場，帶動下面的就是他自己的結果。
 */
export function runBelow(state, data, run, outcome, sched, rng, above) {
  const races = [];
  if (!sched) return races;
  const top = above?.top ?? topOfTicket(data, sched);
  let coattail = above?.coattail ?? null;

  if (run.type === top) {
    const me = outcome.results.find((r) => r.candidate.isPlayer);
    const second = outcome.results.find((r) => !r.candidate.isPlayer);
    const winner = outcome.won ? (state.player.party ?? 'IND') : (second?.candidate?.party ?? 'IND');
    const margin = Math.abs((me?.share ?? 0) - (second?.share ?? 0));
    coattail = { topType: top, topName: run.name, party: winner, shift: margin, fromPlayer: true };
    state.flags.coattail = coattail;
  }

  const myIdx = orderIndex(data, run.type);
  const below = (data.elections.sameDay?.ticketOrder ?? [])
    .filter((t) => sched.types.includes(t) && orderIndex(data, t) > myIdx);
  for (const t of below) {
    const r = simulateRace(state, data, t, rng, coattail);
    if (r) races.push(r);
  }
  return races;
}

/**
 * 一句話講清楚這一天的母雞帶小雞。
 * 玩家最需要知道的是：他這一席有沒有一部分不是他自己贏來的。
 */
export function coattailText(state, data, run, outcome, coattail) {
  const T = data.elections.sameDay?.text ?? {};
  if (!coattail || coattail.fromPlayer || !coattail.topName) return '';
  const myParty = state.player.party;
  const partyName = data.byId.party[coattail.party]?.shortName ?? '無黨籍';
  const lines = [];

  if (coattail.shift < 0.04) lines.push((T.coattailWeak ?? '').replace('{top}', coattail.topName));
  else if (myParty && coattail.party === myParty) {
    lines.push((T.coattailStrong ?? '').replace('{top}', coattail.topName));
    if (outcome?.won) {
      lines.push((T.playerLifted ?? '')
        .replace('{party}', partyName).replace('{top}', coattail.topName));
    }
  } else if (myParty) {
    lines.push((T.coattailAgainst ?? '').replace('{top}', coattail.topName));
    if (!outcome?.won) {
      lines.push((T.playerDragged ?? '')
        .replace('{party}', data.byId.party[myParty]?.shortName ?? '你的黨')
        .replace('{top}', coattail.topName));
    }
  } else {
    lines.push((T.coattailWeak ?? '').replace('{top}', coattail.topName));
  }
  return lines.filter(Boolean).join('\n\n');
}

/** 表決用不到，但開票畫面要：這個政黨在這一場拿到的加成 */
export function coattailBonus(state, data, type, partyId) {
  const c = state.flags?.coattail;
  if (!c || c.party !== partyId) return 0;
  const table = data.elections.sameDay?.coattail ?? {};
  const rate = table[c.topType]?.[type] ?? 0;
  return clamp(c.shift * rate, -(table.maxShift ?? 0.14), table.maxShift ?? 0.14);
}
