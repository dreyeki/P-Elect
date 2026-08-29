// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { sectorCycles } from './WorldSystem.js';

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const cyc = sectorCycles(state);
  const c = state.central;
  const news = [];
  const TE = data.tuning?.economy ?? {};

  // ── 中央：通膨與匯率
  const importCost = (-state.world.MEA.cycle * 0.012) + (31.2 - c.monetary.exchangeRateUSD) * -0.0006;
  const demandPull = c.fiscal.gdpGrowth * 0.28 + c.monetary.m2Growth * 0.12;
  const wageCost = state.modifiers.get('econ.wageCost', 0) * 0.02;
  const expected = c.fiscal.inflation * 0.35;
  const inflTarget = (TE.inflationBase ?? 0.012) + 0.40 * importCost + 0.30 * demandPull + 0.20 * wageCost + 0.10 * expected;
  c.fiscal.inflation = clamp(c.fiscal.inflation
    + (inflTarget - c.fiscal.inflation) * (TE.inflationBlendRate ?? 0.22) * scaleMult,
    -0.02, 0.16);
  c.monetary.exchangeRateUSD = clamp(c.monetary.exchangeRateUSD
    - state.world.GLOBAL.cycle * 0.12 * scaleMult + rng.normal(0, 0.06) * scaleMult, 27, 37);

  // ── 各縣市
  let gdpTotal = 0, popTotal = 0, unempWeighted = 0;
  const valueMods = valueModifiers(state, data);

  for (const r of Object.values(state.regions)) {
    let sectorTerm = 0;
    for (const s in r.economy.sectors) sectorTerm += r.economy.sectors[s] * (cyc[s] ?? 0);

    const infra = (r.infrastructure.transport + r.infrastructure.energy + r.infrastructure.digital) / 15;
    const labor = r.population.ageStructure.working * (1 - r.economy.unemployment);
    const corpMood = avgCorpMood(state, r.id);
    const disruption = state.modifiers.get(`region.${r.id}.disruption`, 0);

    // 全球科技週期是這一輪台灣經濟最大的槓桿，直接進到每個縣市的成長率
    const boom = state.world.GLOBAL.cycle * (TE.boomCoefficient ?? 0.078);
    const growth = (TE.baseGrowth ?? 0.012)
      + boom
      + sectorTerm
      + (infra - 0.6) * 0.010
      + (labor - 0.6) * 0.020
      + corpMood * 0.0022
      + (valueMods.gdpGrowth ?? 0)
      + state.modifiers.get('econ.gdpGrowthBonus', 0)
      - disruption * 0.01
      + rng.normal(0, 0.0025);

    const blend = (TE.growthBlendRate ?? 0.22) * scaleMult;
    r.economy.gdpGrowth = clamp(r.economy.gdpGrowth * (1 - blend) + growth * blend, -0.08, 0.18);
    r.economy.gdp *= 1 + r.economy.gdpGrowth / 12 * scaleMult;

    // 高成長會壓低失業率，但台灣的結構性失業有下限，不會因為景氣好就趨近於零
    const targetUnemp = clamp((TE.unemploymentBase ?? 0.0375)
      - (r.economy.gdpGrowth - 0.025) * (TE.unemploymentGrowthCoupling ?? 0.07)
      + state.modifiers.get('econ.unemployment', 0), TE.unemploymentFloor ?? 0.026, 0.16);
    r.economy.unemployment += (targetUnemp - r.economy.unemployment) * 0.12 * scaleMult;

    r.economy.perCapitaIncome *= 1 + (r.economy.gdpGrowth * 0.55 - c.fiscal.inflation * 0.25) / 12 * scaleMult;

    // 房價：由所得、建設、住宅供給與囤房稅推動
    const housingPressure = (r.economy.perCapitaIncome / 700000) * 0.6
      + r.infrastructure.transport * 0.05 - r.infrastructure.housing * 0.09
      + state.modifiers.get('econ.housingPrice', 0) * 0.1;
    r.economy.housingPriceIndex = clamp(r.economy.housingPriceIndex
      + (housingPressure - 0.35) * 0.9 * scaleMult, 40, 420);
    r.economy.rentBurden = clamp(0.16 + r.economy.housingPriceIndex / 100 * 0.13, 0.10, 0.75);

    // 人口
    const p = r.population;
    const attract = r.economy.gdpGrowth * 60000 - (r.economy.housingPriceIndex - 100) * 22;
    p.netMigration = Math.round(p.netMigration * 0.85 + attract * 0.15);
    const born = p.total * p.birthRate / 12 * scaleMult;
    const died = p.total * p.deathRate / 12 * scaleMult;
    p.total = Math.max(5000, p.total + born - died + p.netMigration / 12 * scaleMult);
    p.ageStructure.elder = clamp(p.ageStructure.elder + 0.00022 * scaleMult, 0.05, 0.45);
    p.ageStructure.working = clamp(1 - p.ageStructure.elder - p.ageStructure.young, 0.35, 0.75);

    // 地方財政
    r.finance.ownRevenue *= 1 + r.economy.gdpGrowth / 12 * scaleMult;
    r.finance.personnelCost *= 1 + 0.0015 * scaleMult;
    const gap = (r.finance.personnelCost + r.finance.debt * 0.012)
      - (r.finance.ownRevenue + r.finance.allocationFund + r.finance.subsidy);
    if (gap > 0) r.finance.debt += gap / 12 * scaleMult;

    gdpTotal += r.economy.gdp;
    popTotal += p.total;
    unempWeighted += r.economy.unemployment * p.total;
  }

  c.fiscal.gdp = gdpTotal;
  c.fiscal.unemployment = unempWeighted / Math.max(1, popTotal);
  c.fiscal.gdpGrowth = clamp(Object.values(state.regions)
    .reduce((a, r) => a + r.economy.gdpGrowth * r.economy.gdp, 0) / Math.max(1, gdpTotal), -0.09, 0.12);
  c.society.agingRatio = Object.values(state.regions)
    .reduce((a, r) => a + r.population.ageStructure.elder * r.population.total, 0) / Math.max(1, popTotal);
  c.society.housingAffordability = clamp(
    Object.values(state.regions).reduce((a, r) => a + r.economy.housingPriceIndex * r.population.total, 0)
    / Math.max(1, popTotal) / 100 * 5.9, 3, 25);
  c.society.giniIndex = clamp(c.society.giniIndex + (valueMods.giniPerYear ?? 0) / 12 * scaleMult, 0.22, 0.6);

  // ── 能源
  const e = c.energy;
  const demand = 1 + (c.fiscal.gdpGrowth - 0.02) * 1.4 + (state.meta.month >= 6 && state.meta.month <= 9 ? 0.05 : 0);
  e.reserveMargin = clamp(e.reserveMargin + (0.10 / demand - e.reserveMargin) * 0.10 * scaleMult
    + rng.normal(0, 0.004) * scaleMult, 0, 0.4);
  e.tpecDeficit += (3.4 - e.electricityPrice) * 22 * scaleMult;

  if (e.reserveMargin < 0.06 && rng.bool(0.25 * scaleMult)) {
    news.push({ kind: 'energy', text: `全國備轉容量率跌至 ${(e.reserveMargin * 100).toFixed(1)}%，工商團體要求主管機關儘速說明供電調度的具體規劃。` });
  }
  return { news };
}

function avgCorpMood(state, regionId) {
  let sum = 0, w = 0;
  for (const c of Object.values(state.corporations)) {
    const emp = c.employees[regionId] ?? 0;
    if (emp > 0) { sum += c.mood * emp; w += emp; }
  }
  return w > 0 ? sum / w : 0;
}

/** 把 8 軸價值觀的 bracket 修正彙總成一組係數 */
export function valueModifiers(state, data) {
  const out = {};
  for (const ax of data.values.axes) {
    const v = state.values[ax.id];
    const br = ax.brackets.find((b) => v >= b.range[0] && v <= b.range[1]);
    if (!br) continue;
    for (const k in br.modifiers) out[k] = (out[k] ?? 0) + br.modifiers[k];
  }
  return out;
}
