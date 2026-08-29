// @ts-check
/**
 * 半導體產業。
 *
 * 這個產業佔台灣出口超過四成、佔加權指數超過四成，
 * 把它壓成一個 sectors.semiconductor 的小數是嚴重的失真。
 * 所以它在這裡被拆成五個版圖，各自有技術、產能、獲利率與研發強度，
 * 而且它們的移動速度以年為單位——不會因為誰喊了一句口號就改變。
 */
import { clamp, clamp05 } from '../core/Formula.js';

export function init(state, data) {
  state.semi = {};
  for (const s of data.semiconductor.segments) {
    state.semi[s.id] = {
      id: s.id,
      globalShare: s.globalShare,
      techLevel: s.techLevel,
      margin: s.margin,
      rndIntensity: s.rndIntensity,
      exportShare: s.exportShare,
      employment: s.employment,
      capexShare: s.capexShare,
      chinaExposure: s.chinaExposure,
      usExposure: s.usExposure,
      cycle: 0,
      revenue: 0,
      profit: 0,
    };
  }
  recompute(state, data);
}

export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  if (!state.semi) return {};
  const news = [];
  const t = state.meta.turn;
  const V = state.values;
  const L = data.semiconductor.policyLevers;
  const yearly = scaleMult / 12;

  for (const seg of data.semiconductor.segments) {
    const s = state.semi[seg.id];
    const c = data.semiconductor.cycle[seg.id];
    // 景氣循環：記憶體的振幅是代工的三倍，這是這個產業的常識
    s.cycle = c.amplitude * Math.sin(2 * Math.PI * (t / c.period + c.phase));

    // 價值觀對產業的長期作用。一年才動這麼多，急不得。
    s.techLevel = clamp(s.techLevel
      + (V.investmentPriority ?? 0) * L.investmentPriority.techLevel * yearly, 0, 5);
    s.rndIntensity = clamp(s.rndIntensity
      + (V.investmentPriority ?? 0) * L.investmentPriority.rndIntensity * yearly, 0.01, 0.4);
    s.margin = clamp(s.margin
      + ((V.environment ?? 0) * L.environment.margin
        + (V.marketFreedom ?? 0) * L.marketFreedom.margin
        + (V.equality ?? 0) * L.equality.margin) * yearly, 0.02, 0.7);
    s.capexShare = clamp(s.capexShare
      + ((V.fiscalExpansion ?? 0) * L.fiscalExpansion.capex
        + (V.environment ?? 0) * L.environment.capex) * yearly, 0.02, 0.9);
    s.employment = Math.round(s.employment * (1
      + ((V.investmentPriority ?? 0) * L.investmentPriority.employment
        + (V.equality ?? 0) * L.equality.employment) * yearly));
    s.chinaExposure = clamp(s.chinaExposure + (V.unification ?? 0) * L.unification.chinaExposure * yearly, 0.02, 0.8);
    s.usExposure = clamp(s.usExposure + (V.unification ?? 0) * L.unification.usExposure * yearly, 0.02, 0.8);

    // 技術領先會慢慢轉成市佔，落後也會慢慢流失
    const drift = (s.techLevel - seg.techLevel) * 0.004 * yearly * 12;
    s.globalShare = clamp(s.globalShare + drift, 0.005, 0.95);
  }
  recompute(state, data);
  return { news };
}

/** 由五個版圖回算整體的產值、獲利與出口貢獻 */
function recompute(state, data) {
  const gdp = state.central.fiscal.gdp || 25000000;
  let rev = 0, prof = 0, rnd = 0, emp = 0, exp = 0;
  for (const seg of data.semiconductor.segments) {
    const s = state.semi[seg.id];
    // 產值以出口佔比為錨，乘上景氣循環
    s.revenue = gdp * s.exportShare * 0.42 * (1 + s.cycle);
    s.profit = s.revenue * s.margin;
    rev += s.revenue; prof += s.profit;
    rnd += s.revenue * s.rndIntensity;
    emp += s.employment;
    exp += s.exportShare;
  }
  state.flags.semiTotals = {
    revenue: rev, profit: prof, rnd, employment: emp,
    exportShare: exp,
    gdpShare: rev / Math.max(1, gdp),
    avgTech: data.semiconductor.segments.reduce((a, seg) =>
      a + state.semi[seg.id].techLevel * state.semi[seg.id].exportShare, 0) / Math.max(0.01, exp),
    cycle: data.semiconductor.segments.reduce((a, seg) =>
      a + state.semi[seg.id].cycle * state.semi[seg.id].exportShare, 0) / Math.max(0.01, exp),
  };
}

/** 目前有哪些風險已經亮起來了 */
export function activeRisks(state, data) {
  const out = [];
  const T = state.flags.semiTotals ?? {};
  for (const r of data.semiconductor.risks) {
    const th = r.threshold;
    let hit = false;
    if (th.rndIntensity != null) {
      hit = data.semiconductor.segments.some((s) => state.semi[s.id].rndIntensity < th.rndIntensity);
    }
    if (th.reserveMargin != null) hit = hit || state.central.energy.reserveMargin < th.reserveMargin;
    if (th.reservoir != null) hit = hit || (state.flags.reservoir ?? 62) < th.reservoir;
    if (th.usRelation != null) hit = hit || state.central.diplomacy.usRelation < th.usRelation;
    if (th.corpMood != null) {
      const moods = Object.values(state.corporations).filter((c) => c.sector === 'semiconductor');
      const avg = moods.reduce((a, c) => a + c.mood, 0) / Math.max(1, moods.length);
      hit = hit || avg < th.corpMood;
    }
    if (hit) out.push(r);
  }
  return out;
}

/** 給資料頁用的一份完整快照 */
export function snapshot(state, data) {
  return data.semiconductor.segments.map((seg) => {
    const s = state.semi[seg.id];
    return {
      id: seg.id, name: seg.name, shortName: seg.shortName, desc: seg.desc,
      corps: seg.corps.map((c) => data.byId.corp[c]?.name).filter(Boolean),
      globalShare: s.globalShare, techLevel: s.techLevel, margin: s.margin,
      rndIntensity: s.rndIntensity, employment: s.employment,
      revenue: s.revenue, profit: s.profit, cycle: s.cycle,
      chinaExposure: s.chinaExposure, usExposure: s.usExposure,
    };
  });
}
