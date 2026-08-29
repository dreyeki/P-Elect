// @ts-check
import { clamp, clamp05, clampBi, sigmoid } from '../core/Formula.js';
import { N_AXIS, N_IDENT, N_CHINA, CHINA_KEYS } from '../core/Pops.js';
import { valueModifiers } from './EconomySystem.js';

export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  const P = state.pops;
  const districts = data.districts.districts;
  const strata = data.pops.strata;
  const gens = data.pops.generations;
  const nP = data.partyIds.length;
  const vm = valueModifiers(state, data);
  const TP = data.tuning?.pop ?? {};
  const inflAcc = state.flags.inflAcc ?? 1;
  const drift = (TP.ideologyDriftRate ?? 0.025) * scaleMult;
  const cnDrift = (TP.chinaDriftRate ?? 0.02) * scaleMult;
  const solRate = (TP.solConvergeRate ?? 0.12) * scaleMult;
  const SOL_CAL = TP.solCalibration ?? -0.34;
  const TEMP = TP.softmaxTemperature ?? 4.2;
  const CN_W = TP.chinaWeight ?? 1.15;

  // 各黨的 13 軸平台與議題評價，先攤平成陣列以避免內圈查表
  const platform = data.partyIds.map((pid) => data.axisIds.map((a) => state.parties[pid].platform[a] ?? 0));
  // 各黨的兩岸七維立場。統獨是選民最在意的一件事，所以它單獨算一次距離。
  const cnPlat = data.partyIds.map((pid) => {
    const cs = state.parties[pid].chinaStance ?? {};
    return CHINA_KEYS.map((k) => cs[k] ?? 0);
  });
  const cnWeight = CHINA_KEYS.map((k) => data.china.dims.find((x) => x.id === k)?.weight ?? 0.5);
  const cnWSum = cnWeight.reduce((a, b) => a + b, 0) * 10;
  // 政黨規模：選民多半不會把票投給沒有機會當選的政黨。
  // 沒有這一項，七個黨會被 softmax 攤平成各佔一成幾，跟真實民調差很遠。
  const scale = data.partyIds.map((pid) => state.parties[pid].scale ?? 0.15);
  // 政黨在藍綠光譜上的位置，正規化到 -1~1。
  // 選區的政治底色會直接吸引同色的政黨——沒有這一項，金門的藍營只會有五成，而不是七成。
  const partyLean = data.partyIds.map((pid) => clamp((state.parties[pid].platform.unification ?? 0) / 4, -1, 1));
  const LEAN_PULL = TP.districtLeanPull ?? 0.30;
  // 第三個維度：立場居中的政黨，強弱跟藍綠光譜幾乎無關，
  // 它跟都市化與年輕受薪人口的密度有關。沒有這一項，新竹的白營會被低估四個百分點。
  const WHITE_PULL = TP.districtWhitePull ?? 0.42;
  const partyCentrism = data.partyIds.map((pid) => {
    const u = state.parties[pid].platform.unification ?? 0;
    return Math.max(0, 1 - Math.abs(u) / 2.2);   // 立場越中間，越吃這一項
  });
  // 指數大於一：中間選區的效果溫和，深藍深綠的鐵票區才會拉開差距
  const LEAN_EXP = TP.districtLeanExponent ?? 1.0;
  const identAppeal = data.partyIds.map((pid) => {
    const ia = state.parties[pid].identityAppeal ?? {};
    return [ia.localist ?? 0, ia.chinese ?? 0, ia.dual ?? 0, ia.apathetic ?? 0];
  });
  const perf = data.partyIds.map((pid) => state.parties[pid].issuePerformance ?? {});
  const heatW = {};
  for (const iss of data.issueIds) heatW[iss] = 1 + state.issues[iss] * 0.12;

  // ── 性別落差：女性 = base + gap，男性 = base − gap
  const G = data.pops.gender;
  const genderGap = data.axisIds.map((a) => G.ideologyGap[a] ?? 0);
  const cnGenderGap = CHINA_KEYS.map((k) => G.__cnGap?.[k] ?? (data.china.genderShift[k] ?? 0));
  const genMult = gens.map((g) => G.gapByGeneration[g.id] ?? 1);
  const issueGap = G.issueWeightGap ?? {};

  // 國家價值觀當前值
  const natVal = data.axisIds.map((a) => state.values[a]);
  const mediaFrame = state.flags.mediaFrame ?? {};
  const cnFrame = state.flags.chinaFrame ?? {};
  // 世界局勢會直接改寫「中國有多強」跟「美國會不會來」這兩件事的社會共識
  const chn = state.world.CHN ?? { cycle: 0, stance: 0, militaryPressure: 2 };
  const usa = state.world.USA ?? { cycle: 0, stance: 0 };
  const cnAnchor = {
    friendly: -chn.militaryPressure * 0.35 + chn.stance * 0.3,
    strength: chn.cycle * 3.2 + chn.militaryPressure * 0.4,
    morality: chn.stance * 0.45 - chn.militaryPressure * 0.25,
    culture: 0,
    openness: chn.stance * 0.3,
    usTrust: usa.stance * 0.5 + usa.cycle * 1.4,
    japanTrust: (state.world.JPN?.stance ?? 1) * 0.4,
  };

  const rawM = new Float64Array(nP), rawF = new Float64Array(nP);
  let solSum = 0, solW = 0;
  const stratSol = {}, stratW = {};
  const natM = new Float64Array(nP), natF = new Float64Array(nP);
  let wM = 0, wF = 0;
  const cnSum = new Float64Array(N_CHINA);
  let cnW = 0;

  for (let i = 0; i < P.n; i++) {
    const d = districts[P.district[i]];
    const region = data.byId.region[d.regionId];
    const s = strata[P.stratum[i]];
    const gm = genMult[P.gen[i]];

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
      + SOL_CAL
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

    // ── 兩岸七維漂移。錨點是世界局勢加上媒體框架，不是政黨說了算。
    for (let k = 0; k < N_CHINA; k++) {
      const key = CHINA_KEYS[k];
      const cur = P.china[i * N_CHINA + k];
      const anchor = cur * 0.62 + (cnAnchor[key] ?? 0) * 0.24 + (cnFrame[key] ?? 0) * 0.14;
      P.china[i * N_CHINA + k] = clampBi(cur + (anchor - cur) * cnDrift);
      cnSum[k] += P.china[i * N_CHINA + k] * P.size[i];
    }
    cnW += P.size[i];

    // 七維會折算回 unification 那條總軸，讓細部立場真的影響國家定位
    const T2U = data.china.toUnification;
    let u = 0;
    for (let k = 0; k < N_CHINA; k++) u += P.china[i * N_CHINA + k] * (T2U[CHINA_KEYS[k]] ?? 0);
    u *= T2U.scale ?? 0.6;
    const ui = data.axisIds.indexOf('unification');
    P.ideology[i * N_AXIS + ui] = clampBi(P.ideology[i * N_AXIS + ui] * 0.86 + u * 0.14);

    // ── 政黨支持度：男女各算一次，再按比例混合
    const fS = P.femaleShare[i], mS = 1 - fS;
    for (let p = 0; p < nP; p++) {
      let distM = 0, distF = 0;
      for (let a = 0; a < N_AXIS; a++) {
        const base = P.ideology[i * N_AXIS + a];
        const g = genderGap[a] * gm;
        distM += Math.abs(base - g - platform[p][a]);
        distF += Math.abs(base + g - platform[p][a]);
      }
      const fitM = 1 - distM / (N_AXIS * 5);
      const fitF = 1 - distF / (N_AXIS * 5);

      // 兩岸立場單獨算一次加權距離，權重由 china.json 的 dims[].weight 決定
      let cdM = 0, cdF = 0;
      for (let k = 0; k < N_CHINA; k++) {
        const base = P.china[i * N_CHINA + k];
        const g = cnGenderGap[k] * gm;
        cdM += Math.abs(base - g - cnPlat[p][k]) * cnWeight[k];
        cdF += Math.abs(base + g - cnPlat[p][k]) * cnWeight[k];
      }
      const cfitM = 1 - cdM / cnWSum;
      const cfitF = 1 - cdF / cnWSum;

      let perfM = 0, perfF = 0;
      for (const iss of data.issueIds) {
        const w = (s.issueWeights[iss] ?? 0) * heatW[iss] * ((perf[p][iss] ?? 0) / 5);
        const g = issueGap[iss] ?? 1;
        perfF += w * g; perfM += w / g;
      }
      let ident = 0;
      for (let k = 0; k < N_IDENT; k++) ident += P.identity[i * N_IDENT + k] * identAppeal[p][k];
      const incumbent = data.partyIds[p] === state.central.government.presidentParty
        ? clamp((state.flags.solTrend ?? 0) < 0 ? 1 : 0, 0, 1) : 0;
      const grass = state.districts[d.id].grassroots[data.partyIds[p]] ?? 0;
      const common = 0.12 * ident + 0.08 * (grass / 5) - 0.07 * incumbent + 0.62 * scale[p]
        + LEAN_PULL * Math.sign(d.lean) * Math.pow(Math.abs(d.lean) / 5, LEAN_EXP) * partyLean[p]
        + WHITE_PULL * (d.whiteLean ?? 0) * partyCentrism[p];
      rawM[p] = 0.20 * fitM + CN_W * 0.14 * cfitM + 0.24 * perfM + common;
      rawF[p] = 0.20 * fitF + CN_W * 0.14 * cfitF + 0.24 * perfF + common;
    }
    softmaxInto(rawM, nP, TEMP);
    softmaxInto(rawF, nP, TEMP);

    let topP = 0, topV = -1;
    for (let p = 0; p < nP; p++) {
      const v = rawM[p] * mS + rawF[p] * fS;
      P.support[i * nP + p] = v;
      natM[p] += rawM[p] * P.size[i] * mS;
      natF[p] += rawF[p] * P.size[i] * fS;
      if (v > topV) { topV = v; topP = p; }
    }
    wM += P.size[i] * mS; wF += P.size[i] * fS;

    // ── 熱情度
    let dist = 0;
    for (let a = 0; a < N_AXIS; a++) dist += Math.abs(P.ideology[i * N_AXIS + a] - platform[topP][a]);
    const fitTop = 1 - dist / (N_AXIS * 5);
    const eTarget = 5 * clamp(fitTop, 0, 1) * (0.6 + 0.4 * P.sol[i] / 5);
    P.enthusiasm[i] = clamp05(P.enthusiasm[i] + (eTarget - P.enthusiasm[i]) * (TP.enthusiasmRate ?? 0.15) * scaleMult);

    // ── 激進度
    const expected = 2.6 + P.awareness[i] * 0.15;
    P.militancy[i] = clamp05(P.militancy[i]
      + ((expected - P.sol[i]) * (P.awareness[i] / 5) * (TP.militancyRate ?? 0.08)
        - (TP.militancyDecay ?? 0.04)) * scaleMult);

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
  state.flags.genderSupport = {
    male: Object.fromEntries(data.partyIds.map((pid, p) => [pid, natM[p] / Math.max(1, wM)])),
    female: Object.fromEntries(data.partyIds.map((pid, p) => [pid, natF[p] / Math.max(1, wF)])),
  };
  state.flags.chinaMood = Object.fromEntries(CHINA_KEYS.map((k, i) => [k, cnSum[i] / Math.max(1, cnW)]));
  return {};
}

function softmaxInto(arr, n, temp) {
  let mx = -Infinity;
  for (let p = 0; p < n; p++) if (arr[p] > mx) mx = arr[p];
  let sum = 0;
  for (let p = 0; p < n; p++) { const e = Math.exp((arr[p] - mx) * temp); arr[p] = e; sum += e; }
  for (let p = 0; p < n; p++) arr[p] /= sum;
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

/**
 * 一段論述打進 POP 的兩岸態度。
 * 理由對得上的人被說服的幅度是對不上的人的五倍——
 * 講經濟的話對只在乎安全的人來說，就只是背景噪音。
 */
export function pushChinaArgument(state, data, arg, opts = {}) {
  const P = state.pops;
  const A = data.china.argumentPower;
  const ri = ['economy', 'regime', 'ethnic', 'security', 'democracy'].indexOf(arg.reason);
  const ki = CHINA_KEYS.indexOf(arg.dim ?? 'friendly');
  if (ki < 0) return { moved: 0 };
  const dir = arg.direction ?? 1;
  const power = (arg.power ?? 0.6) * (opts.mult ?? 1);
  const filter = opts.districtIndex;
  let moved = 0, w = 0;
  for (let i = 0; i < P.n; i++) {
    if (filter != null && P.district[i] !== filter) continue;
    const on = P.chinaReason[i] === ri;
    const step = clamp(power * (on ? A.onReason : A.offReason)
      * (1 + P.awareness[i] * A.awarenessFactor) * 0.1, 0, A.maxStepPerTurn);
    const before = P.china[i * N_CHINA + ki];
    P.china[i * N_CHINA + ki] = clampBi(before + dir * step);
    moved += Math.abs(P.china[i * N_CHINA + ki] - before) * P.size[i];
    w += P.size[i];
  }
  return { moved: moved / Math.max(1, w) };
}

/** 全國兩岸態度的人口加權平均，供民調的國家認同題組使用 */
export function chinaMood(state) {
  const P = state.pops;
  const out = new Float64Array(N_CHINA);
  let w = 0;
  for (let i = 0; i < P.n; i++) {
    for (let k = 0; k < N_CHINA; k++) out[k] += P.china[i * N_CHINA + k] * P.size[i];
    w += P.size[i];
  }
  return Object.fromEntries(CHINA_KEYS.map((k, i) => [k, out[i] / Math.max(1, w)]));
}

/** 某個範圍內的 POP 索引 */
export function popsInDistrict(state, data, districtId) {
  const di = data.districts.districts.findIndex((d) => d.id === districtId);
  const out = [];
  const P = state.pops;
  for (let i = 0; i < P.n; i++) if (P.district[i] === di) out.push(i);
  return out;
}
