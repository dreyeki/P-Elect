// @ts-check
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp05 = (v) => clamp(v, 0, 5);
export const clampBi = (v) => clamp(v, -5, 5);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const round2 = (v) => Math.round(v * 100) / 100;

/** 慢速收斂：把 cur 往 target 拉 rate 的比例 */
export const approach = (cur, target, rate) => cur + (target - cur) * rate;

export function softmax(scores, temp = 1) {
  const keys = Object.keys(scores);
  let max = -Infinity;
  for (const k of keys) if (scores[k] > max) max = scores[k];
  let sum = 0;
  const out = {};
  for (const k of keys) { const e = Math.exp((scores[k] - max) * temp); out[k] = e; sum += e; }
  for (const k of keys) out[k] /= sum;
  return out;
}

export function normalizeObj(o) {
  let s = 0;
  for (const k in o) s += o[k];
  if (s <= 0) return o;
  const out = {};
  for (const k in o) out[k] = o[k] / s;
  return out;
}

/** 兩組 8 軸座標的加權距離，回傳 0（完全一致）～1（完全相反） */
export function axisDistance(a, b, weights = null) {
  const keys = Object.keys(a);
  let d = 0, w = 0;
  for (const k of keys) {
    const wk = weights?.[k] ?? 1;
    d += Math.abs((a[k] ?? 0) - (b[k] ?? 0)) * wk;
    w += wk;
  }
  return w > 0 ? d / (w * 10) : 0;
}

/** 依巢狀路徑取值 / 設值，供 effects 的扁平路徑使用 */
export function getPath(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) { if (cur == null) return undefined; cur = cur[seg]; }
  return cur;
}
export function addPath(obj, path, delta) {
  const segs = path.split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  const last = segs[segs.length - 1];
  cur[last] = (cur[last] ?? 0) + delta;
  return cur[last];
}
