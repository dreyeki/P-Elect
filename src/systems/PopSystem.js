// @ts-check
import { clamp, clamp05, clampBi, sigmoid, softmax } from '../core/Formula.js';
import { N_AXIS, N_IDENT } from '../core/Pops.js';
import { valueModifiers } from './EconomySystem.js';

export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  const P = state.pops;
  const districts = data.districts.districts;
  const strata = data.pops.strata;
  const nP = data.partyIds.length;
  const vm = valueModifiers(state, data);
  const inflAcc = state.flags.inflAcc ?? 1;
  const drift = 0.025 * scaleMult;
  const solRate = 0.12 * scaleMult;

  // 各黨的 8 軸平台與議題評價，先攤平成陣列以避免內圈查表
  const platform = data.partyIds.map((pid) => data.axisIds.map((a) => state.parties[pid].platform[a] ?? 0));
  // 政黨規模：選民多半不會把票投給沒有機會當選的政黨。
  // 沒有這一項，七個黨會被 softmax 攤平成各佔一成幾，跟真實民調差很遠。
  const scale = data.partyIds.map((pid) => state.parties[pid].scale ?? 0.15);
  const identAppeal = data.partyIds.map((pid) => {
    const ia = state.parties[pid].identityAppeal ?? {};
    return [ia.localist ?? 0, ia.chinese ?? 0, ia.dual ?? 0, ia.apathetic ?? 0];
  });
  const perf = data.partyIds.map((pid) => state.parties[pid].issuePerformance ?? {});
  const heatW = {};
  for (const iss of data.issueIds) heatW[iss] = 1 + state.issues[iss] * 0.12;

  // 國家價值觀當前值
  const natVal = data.axisIds.map((a) => state.values[a]);
  const mediaFrame = state.flags.mediaFrame ?? {};

  const raw = new Float64Array(nP);
  let solSum = 0, solW = 0;
  const stratSol = {}, stratW = {};

  for (let i = 0; i < P.n; i++) {
    const d = districts[P.district[i]];
    const region = data.byId.region[d.regionId];
    const s = strata[P.stratum[i]];

    // ── 所得隨該縣市經濟成長，扣除通膨後才是實質購買力
    P.income[i] *= 1 + (region.economy.gdpGrowth * 0.55) / 12 * scaleMult;
    const realIncome = P.income[i] / inflAcc;
    const burden = clamp(region.economy.housingPriceIndex / 100 * 300000 / Math.max(1, realIncome), 0.04, 0.95);
    const svc = (region.infrastructure.medical + region.infrastructure.education
      + region.infrastructure.transport + region.infrastructure.digital) / 20;
    const env = 1 - clamp(region.economy.sectors.petrochemical + region.economy.sectors.steel, 0, 0.5);
    const target = 5 * sigmoid(
      0.32 * (Math.log10(realIncome / 260000 + 1) * 2.4 - 0.9)
      + 0.20 * (P.employment[i] - 0.9) * 6
      + 0.18 * (0.55 - burden) * 3
      + 0.16 * (svc - 0.55) * 3
      + 0.08 * (env - 0.85) * 4
      + 0.06 * (2 - state.central.society.crimeRate / 100) * 1.2
      + (vm.publicServiceAccess ?? 0) * 0.12
      - 0.34
    );
    P.sol[i] = clamp05(P.sol[i] + (target - P.sol[i]) * solRate);

    // ── 意識形態漂移
    for (let a = 0; a < N_AXIS; a++) {
      const axId = data.axisIds[a];
      const structural = s.ideology[axId] ?? 0;
      const pull = 0.45 * structural + 0.25 * natVal[a] + 0.20 * (mediaFrame[axId] ?? 0) + 0.10 * d.lean * (a === 1 ? 0.5 : 0);
      const cur = P.ideology[i * N_AXIS + a];
      P.ideology[i * N_AXIS + a] = clampBi(cur + (pull - cur) * drift);
    }

    // ── 政黨支持度
    for (let p = 0; p < nP; p++) {
      let dist = 0;
      for (let a = 0; a < N_AXIS; a++) dist += Math.abs(P.ideology[i * N_AXIS + a] - platform[p][a]);
      const fit = 1 - dist / 40;
      let performance = 0;
      for (const iss of data.issueIds) {
        performance += (s.issueWeights[iss] ?? 0) * heatW[iss] * ((perf[p][iss] ?? 0) / 5);
      }
      let ident = 0;
      for (let k = 0; k < N_IDENT; k++) ident += P.identity[i * N_IDENT + k] * identAppeal[p][k];
      const incumbent = data.partyIds[p] === state.central.government.presidentParty
        ? clamp((state.flags.solTrend ?? 0) < 0 ? 1 : 0, 0, 1) : 0;
      const grass = state.districts[d.id].grassroots[data.partyIds[p]] ?? 0;
      raw[p] = 0.30 * fit + 0.24 * performance + 0.12 * ident + 0.08 * (grass / 5)
        - 0.07 * incumbent + 0.62 * scale[p];
    }
    // softmax（就地展開，避免物件配置）
    let mx = -Infinity;
    for (let p = 0; p < nP; p++) if (raw[p] > mx) mx = raw[p];
    let sum = 0;
    for (let p = 0; p < nP; p++) { const e = Math.exp((raw[p] - mx) * 4.2); raw[p] = e; sum += e; }
    let topP = 0, topV = -1;
    for (let p = 0; p < nP; p++) {
      const v = raw[p] / sum;
      P.support[i * nP + p] = v;
      if (v > topV) { topV = v; topP = p; }
    }

    // ── 熱情度
    let dist = 0;
    for (let a = 0; a < N_AXIS; a++) dist += Math.abs(P.ideology[i * N_AXIS + a] - platform[topP][a]);
    const fitTop = 1 - dist / 40;
    const eTarget = 5 * clamp(fitTop, 0, 1) * (0.6 + 0.4 * P.sol[i] / 5);
    P.enthusiasm[i] = clamp05(P.enthusiasm[i] + (eTarget - P.enthusiasm[i]) * 0.15 * scaleMult);

    // ── 激進度
    const expected = 2.6 + P.awareness[i] * 0.15;
    P.militancy[i] = clamp05(P.militancy[i]
      + ((expected - P.sol[i]) * (P.awareness[i] / 5) * 0.08 - 0.04) * scaleMult);

    solSum += P.sol[i] * P.size[i]; solW += P.size[i];
    const sid = s.id;
    stratSol[sid] = (stratSol[sid] ?? 0) + P.sol[i] * P.size[i];
    stratW[sid] = (stratW[sid] ?? 0) + P.size[i];
  }

  const avgSol = solSum / Math.max(1, solW);
  state.flags.solTrend = avgSol - (state.flags.avgSol ?? avgSol);
  state.flags.avgSol = avgSol;
  state.flags.stratSol = Object.fromEntries(Object.keys(stratSol).map((k) => [k, stratSol[k] / stratW[k]]));
  state.flags.inflAcc = inflAcc * (1 + state.central.fiscal.inflation / 12 * scaleMult);
  return {};
}

/** 全國政黨支持度（人口加權），供民調與不分區使用 */
export function nationalSupport(state, data) {
  const P = state.pops, nP = data.partyIds.length;
  const out = new Float64Array(nP);
  let w = 0;
  for (let i = 0; i < P.n; i++) {
    const s = P.size[i];
    for (let p = 0; p < nP; p++) out[p] += P.support[i * nP + p] * s;
    w += s;
  }
  const res = {};
  data.partyIds.forEach((pid, p) => (res[pid] = out[p] / Math.max(1, w)));
  return res;
}

/** 某個範圍內的 POP 索引 */
export function popsInDistrict(state, data, districtId) {
  const di = data.districts.districts.findIndex((d) => d.id === districtId);
  const out = [];
  const P = state.pops;
  for (let i = 0; i < P.n; i++) if (P.district[i] === di) out.push(i);
  return out;
}
