// @ts-check
import { clamp, clampBi } from '../core/Formula.js';
import { sectorCycles } from './WorldSystem.js';

export function tick(state, ctx) {
  const { rng, scaleMult, data } = ctx;
  const cyc = sectorCycles(state);
  const news = [];
  let index = 0;

  for (const c of Object.values(state.corporations)) {
    const cycle = cyc[c.sector] ?? 0;
    const fxBoost = c.exportDependency * (state.central.monetary.exchangeRateUSD - 31.2) * 0.004;
    const energyCost = -(state.central.energy.electricityPrice - 3.15) * 0.02;
    const drift = cycle * 0.9 + fxBoost + energyCost + rng.normal(0, 0.012);

    c.marketCap = Math.max(20, c.marketCap * (1 + drift * scaleMult));
    // 態度：受景氣、法規負擔、政府關係影響，緩慢回歸
    const regBurden = state.modifiers.get('corp.regBurden', 0);
    const target = clampBi(cycle * 6 - regBurden + (c.stateOwned ? 1 : 0));
    c.mood = clampBi(c.mood + (target - c.mood) * 0.05 * scaleMult);

    if (c.mood <= -3 && rng.bool(0.04 * scaleMult)) {
      const rid = Object.keys(c.employees)[0];
      const r = state.regions[rid];
      if (r) {
        const cut = Math.round(c.employees[rid] * 0.12);
        c.employees[rid] -= cut;
        r.economy.unemployment = clamp(r.economy.unemployment + cut / r.population.total * 2.2, 0.01, 0.2);
        news.push({ kind: 'corp', text: `${c.name}宣布調整在${r.name}的產線配置，初估將有 ${cut.toLocaleString()} 個工作機會受到影響，地方政府已表示將協助勞工轉介。` });
      }
    } else if (c.mood >= 3 && rng.bool(0.035 * scaleMult)) {
      const rid = rng.pick(Object.keys(c.employees));
      const r = state.regions[rid];
      if (r) {
        c.employees[rid] += Math.round(c.employees[rid] * 0.08);
        r.economy.gdpGrowth += 0.002;
        news.push({ kind: 'corp', text: `${c.name}宣布在${r.name}加碼投資，新的產能規劃預計在三年內完成，地方首長親自出席了動土儀式。` });
      }
    }
    index += c.marketCap * c.weightInIndex;
  }
  const base = data.corporations.corporations.reduce((a, c) => a + c.marketCap * c.weightInIndex, 0);
  state.central.stockIndex = Math.round((data.tuning?.economy?.stockIndexBase ?? 45300) * (index / base));
  return { news };
}
