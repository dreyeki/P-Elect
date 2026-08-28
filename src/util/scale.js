// @ts-check
/**
 * 四字語詞刻度。這是本遊戲的呈現核心：
 * 抽象數值在引擎內部是 float，到玩家眼前一律是四個字。
 */
import { clamp } from '../core/Formula.js';

let SC = null;
export function initScales(json) { SC = json; }
export function scalesReady() { return !!SC; }

/** 0~5 的線性刻度 */
export function word(scaleId, value) {
  const arr = SC?.linear?.[scaleId];
  if (!arr) return String(Math.round(value ?? 0));
  return arr[clamp(Math.round(value ?? 0), 0, arr.length - 1)];
}

/** −5~+5 的雙極刻度 */
export function biWord(scaleId, value) {
  const arr = SC?.bipolar?.[scaleId];
  if (!arr) return String(Math.round(value ?? 0));
  return arr[clamp(Math.round((value ?? 0) + 5), 0, arr.length - 1)];
}

/** 軸向：方向詞・強度詞 */
export function axisWord(negName, posName, value) {
  const v = value ?? 0;
  const mag = clamp(Math.round(Math.abs(v)), 0, 5);
  const int = SC?.intensity?.[mag] ?? '';
  if (mag === 0) return int;
  return (v < 0 ? negName : posName) + '・' + int;
}

/** 變動的語詞呈現 */
export function deltaWord(delta) {
  const d = SC?.delta;
  if (!d) return '';
  if (delta >= 1.5) return d.up2;
  if (delta >= 0.5) return d.up1;
  if (delta <= -1.5) return d.down2;
  if (delta <= -0.5) return d.down1;
  if (Math.abs(delta) > 0.05) return d.flux;
  return null;
}

/** 0~5 值 → 0~100 的填充百分比，供進度條使用 */
export const fill05 = (v) => clamp((v ?? 0) / 5, 0, 1) * 100;
export const fillBi = (v) => clamp(((v ?? 0) + 5) / 10, 0, 1) * 100;

/** 抽象量的色階類別 */
export function toneOf(v, bipolar = false) {
  const n = bipolar ? (v + 5) / 2 : v;
  if (n >= 4) return 'tone-good';
  if (n >= 3) return 'tone-ok';
  if (n >= 2) return 'tone-mid';
  if (n >= 1) return 'tone-warn';
  return 'tone-bad';
}
