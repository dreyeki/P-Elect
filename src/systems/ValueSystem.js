// @ts-check
import { clampBi } from '../core/Formula.js';
import { N_AXIS } from '../core/Pops.js';

const DEFAULT_MAX_STEP = 0.02;   // 月回合每軸最大移動（可由 tuning.json 覆寫）

export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  const TV = data.tuning?.values ?? {};
  const MAX_STEP = TV.maxStepPerTurn ?? DEFAULT_MAX_STEP;
  const P = state.pops;

  // POP 意識形態的人口加權平均
  const sums = new Float64Array(N_AXIS);
  let w = 0;
  for (let i = 0; i < P.n; i++) {
    const s = P.size[i];
    for (let a = 0; a < N_AXIS; a++) sums[a] += P.ideology[i * N_AXIS + a] * s;
    w += s;
  }

  data.axisIds.forEach((axId, a) => {
    const popMean = sums[a] / Math.max(1, w);
    const lawPressure = state.modifiers.get(`value.${axId}`, 0);
    const popPull = (popMean - state.values[axId]) * (TV.popPullCoefficient ?? 0.02);
    const step = clampBi(lawPressure * (TV.lawPressureCoefficient ?? 0.012) + popPull);
    const capped = Math.max(-MAX_STEP, Math.min(MAX_STEP, step)) * scaleMult;
    state.values[axId] = clampBi(state.values[axId] + capped);

    // 社會共識鎖定
    const key = 'consensus_' + axId;
    if (Math.abs(state.values[axId]) >= 4) {
      state.flags[key] = (state.flags[key] ?? 0) + scaleMult;
    } else state.flags[key] = 0;
  });
  return {};
}

export function isConsensus(state, axId, data) { return (state.flags['consensus_' + axId] ?? 0) >= (data?.tuning?.values?.consensusTurns ?? 60); }

/** 目前所在的 bracket，供 UI 說明 */
export function bracketOf(data, axId, value) {
  const ax = data.byId.axis[axId];
  return ax?.brackets.find((b) => value >= b.range[0] && value <= b.range[1]) ?? null;
}
