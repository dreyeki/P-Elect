// @ts-check
/**
 * 總統、行政院長與大法官。
 * 通過一條爭議法案不等於事情結束——在野方還可以聲請釋憲。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { makePolitician } from './NameGen.js';
import { applyEffects } from './Effects.js';

/** 開局建立憲政機關 */
export function init(state, data, rng) {
  const cfg = data.constitution;
  const rulingParty = state.central.government.presidentParty;
  const pres = makePolitician(data, rng, { party: rulingParty, birthYear: 2026 - rng.int(58, 70), fame: 5 });
  const premier = makePolitician(data, rng, { party: rulingParty, birthYear: 2026 - rng.int(55, 68), fame: 4 });

  state.presidency = {
    name: pres.name, party: rulingParty, id: pres.id,
    approval: 44,
    termStart: cfg.presidency.currentTermStart,
    termEnd: cfg.presidency.currentTermStart + cfg.presidency.termYears,
    term: 2,
    premier: { name: premier.name, party: rulingParty, approval: 38, since: 2025 },
  };

  // 十五位大法官，任期交錯，提名者分屬歷任不同總統。
  // 提名者的傾向會留下痕跡，但總統也常任命共識型人選，所以組成不會一面倒。
  const justices = [];
  for (let i = 0; i < cfg.court.seats; i++) {
    const nomYear = 2018 + Math.floor(i / 4) * 2;
    const nomParty = nomYear >= 2016 ? rulingParty : 'CRP';
    const j = makePolitician(data, rng, { party: null, birthYear: 2026 - rng.int(52, 68) });
    const consensus = rng.bool(0.38);   // 共識型人選，看不太出提名者的顏色
    const tilt = consensus ? 0 : (nomParty === 'CRP' ? 1 : -1);
    justices.push({
      id: j.id, name: j.name, birthYear: j.birthYear,
      nominatedBy: nomParty, nominatedYear: nomYear,
      termEnd: nomYear + cfg.court.termYears,
      // 大法官不是政黨代理人，但提名者的傾向確實會留下痕跡
      ideology: Object.fromEntries(data.axisIds.map((a) => [
        a, clampBi(rng.normal(tilt * (a === 'unification' ? 0.9 : a === 'progressivism' ? -0.7 * tilt : 0), 1.5)),
      ])),
      independence: clamp05(rng.range(1.5, 4.5)),
    });
  }
  state.court = { justices, pendingReviews: [], history: [] };
}

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const news = [];
  const cfg = data.constitution;
  if (!state.court) return { news };

  // 總統滿意度跟著民生與經濟走
  const pres = state.presidency;
  if (pres) {
    const target = clamp(42 + (state.flags.solTrend ?? 0) * 260
      + (state.central.fiscal.gdpGrowth - 0.03) * 90
      - (state.central.fiscal.inflation - 0.02) * 350, 12, 78);
    pres.approval = clamp(pres.approval + (target - pres.approval) * 0.08 * scaleMult, 5, 92);
    pres.premier.approval = clamp(pres.premier.approval + (target - 6 - pres.premier.approval) * 0.08 * scaleMult, 5, 88);
    state.central.government.presidentApproval = pres.approval;
    state.central.government.premierApproval = pres.premier.approval;
  }

  // 大法官任期到了要補提名
  if (state.meta.month === 9 && state.meta.scale === 'month') {
    for (const j of state.court.justices) {
      if (state.meta.year >= j.termEnd && !j.vacantSince) j.vacantSince = state.meta.year;
    }
    const vacant = state.court.justices.filter((j) => j.vacantSince);
    if (vacant.length && !state.flags.courtNomination) {
      if (state.player.role === 'president') {
        state.flags.courtNomination = { count: vacant.length };
        news.push({ kind: 'court', text: `司法院有 ${vacant.length} 位大法官任期屆滿，提名權在你手上。這幾個人選會影響往後八年每一條爭議法案的命運。` });
      } else {
        // NPC 總統自己補
        for (const j of vacant) fillSeat(state, data, rng, j, pres?.party ?? 'PDA');
        news.push({ kind: 'court', text: `總統府今天公布新任大法官人選並送請立法院同意，在野黨已經表示將嚴格審查，聽證會的日期還沒排定。` });
      }
    }
  }

  // 釋憲案審理
  for (const r of [...state.court.pendingReviews]) {
    r.turnsLeft -= scaleMult;
    if (r.turnsLeft > 0) continue;
    const verdict = rule(state, data, r, rng);
    state.court.pendingReviews = state.court.pendingReviews.filter((x) => x !== r);
    state.court.history.push({ ...r, verdict: verdict.kind, turn: state.meta.turn });
    news.push({ kind: 'court', text: verdict.text });
  }
  return { news };
}

function fillSeat(state, data, rng, seat, byParty) {
  const j = makePolitician(data, rng, { party: null, birthYear: state.meta.year - rng.int(50, 64) });
  const tilt = byParty === 'CRP' ? 1 : byParty === 'PDA' ? -1 : 0;
  Object.assign(seat, {
    id: j.id, name: j.name, birthYear: j.birthYear,
    nominatedBy: byParty, nominatedYear: state.meta.year,
    termEnd: state.meta.year + data.constitution.court.termYears,
    ideology: Object.fromEntries(data.axisIds.map((a) => [
      a, clampBi(rng.normal(tilt * (a === 'unification' ? 0.9 : 0), 1.5))])),
    independence: clamp05(rng.range(1.5, 4.5)),
    vacantSince: null,
  });
}

/** 在野方聲請釋憲 */
export function petition(state, data, lawId, rng) {
  const law = data.byId.law[lawId];
  const cfg = data.constitution.review;
  if (law.controversy < cfg.controversyNeeded) return null;
  const total = Object.values(state.legislature).reduce((a, b) => a + b, 0) || 113;
  const oppo = Object.entries(state.legislature)
    .filter(([pid]) => pid !== state.player.party && pid !== state.central.government.presidentParty)
    .reduce((a, [, n]) => a + n, 0);
  if (oppo / total < cfg.petitionThreshold) return null;
  if (!rng.bool(0.35 + law.controversy * 0.05)) return null;

  const review = {
    lawId, lawName: law.name, tier: state.laws[lawId],
    prevTier: state.flags['prevTier_' + lawId] ?? law.defaultTier,
    turnsLeft: cfg.turnsToRule, filedTurn: state.meta.turn,
  };
  state.court.pendingReviews.push(review);
  return review;
}

/** 大法官依組成傾向判決 */
function rule(state, data, review, rng) {
  const law = data.byId.law[review.lawId];
  const tier = law.tiers[review.tier];
  const pressure = tier.effects?.valuePressure ?? {};
  let uphold = 0, strike = 0;

  for (const j of state.court.justices) {
    let align = 0;
    for (const ax in pressure) align += Math.sign(pressure[ax]) * (j.ideology[ax] ?? 0) * 0.35;
    // 獨立性高的大法官比較不受立場影響，更看程序與比例原則
    const proc = (j.independence - 2.5) * 0.4 - law.controversy * 0.12;
    const score = align + proc + rng.normal(0, 0.8);
    if (score >= 0) uphold++; else strike++;
  }

  const need = data.constitution.court.majorityNeeded;
  if (strike >= need) {
    state.modifiers.removeBySource('law:' + review.lawId);
    state.laws[review.lawId] = review.prevTier;
    applyEffects(state, data, law.tiers[review.prevTier].effects, {
      source: 'law:' + review.lawId, label: law.name, duration: -1,
    });
    state.central.society.socialTrust = clamp05(state.central.society.socialTrust - 0.3);
    if (state.player.party === state.central.government.presidentParty) {
      state.player.partyPrestige = clamp05(state.player.partyPrestige - 0.5);
    }
    return {
      kind: 'unconstitutional',
      text: `憲法法庭今天宣告《${law.name}》修正條文違憲，以 ${strike} 比 ${uphold} 認定其牴觸憲法保障，`
        + `該條文自即日起失效，法制退回修法之前的狀態。行政部門在記者會上表示尊重，但臉色都很難看。`,
    };
  }
  if (strike >= 6) {
    state.central.society.socialTrust = clamp05(state.central.society.socialTrust - 0.15);
    return {
      kind: 'conditional',
      text: `憲法法庭做出合憲但限期檢討的裁判，以 ${uphold} 比 ${strike} 的票數勉強讓《${law.name}》存活下來，`
        + `但要求主管機關在兩年內修正部分條文，這件事等於還沒有真正結束。`,
    };
  }
  return {
    kind: 'constitutional',
    text: `憲法法庭以 ${uphold} 比 ${strike} 認定《${law.name}》修正條文合憲，聲請的立委今天沒有出面說明，`
      + `這場憲政攻防到此告一段落，輸的一方在輿論上並不好看。`,
  };
}

/** 大法官組成的整體傾向，供 UI 顯示 */
export function courtLean(state, data) {
  if (!state.court) return 0;
  const js = state.court.justices;
  let sum = 0;
  for (const j of js) sum += j.ideology.unification ?? 0;
  return clampBi(sum / Math.max(1, js.length));
}

export function nominateJustice(state, data, seatIdx, leaning, rng) {
  const seat = state.court.justices[seatIdx];
  if (!seat?.vacantSince) return { ok: false, msg: '這個席次目前沒有出缺。' };
  const total = Object.values(state.legislature).reduce((a, b) => a + b, 0) || 113;
  const mine = state.legislature[state.player.party] ?? 0;
  const support = mine / total + (leaning === 'moderate' ? 0.22 : 0.02);
  if (!rng.bool(clamp(support * 1.4, 0.1, 0.95))) {
    state.player.politicalCapital = Math.max(0, state.player.politicalCapital - 30);
    return { ok: false, msg: '立法院否決了你的提名。在野黨把整場聽證會變成一次公開處刑，這個席次還是空著。' };
  }
  fillSeat(state, data, rng, seat,
    leaning === 'moderate' ? null : (state.player.party ?? 'PDA'));
  state.flags.courtNomination = null;
  return { ok: true, msg: `${seat.name}通過立法院同意，正式就任大法官。這一票會留在憲法法庭裡八年。` };
}
