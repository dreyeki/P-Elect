// @ts-check
const nf = new Intl.NumberFormat('zh-TW');

export const int = (v) => nf.format(Math.round(v ?? 0));
export const pct = (v, d = 1) => ((v ?? 0) * 100).toFixed(d) + '%';
export const pctPoint = (v, d = 1) => (v ?? 0).toFixed(d) + '%';

/** 新台幣：自動選擇 元 / 萬 / 億 */
export function money(v) {
  const n = Math.round(v ?? 0);
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(abs >= 1e9 ? 0 : 2) + ' 億元';
  if (abs >= 1e4) return (n / 1e4).toFixed(abs >= 1e6 ? 0 : 1) + ' 萬元';
  return nf.format(n) + ' 元';
}
/** 億元為單位的財政數字 */
export const yi = (v) => nf.format(Math.round(v ?? 0)) + ' 億';
/** 十億新台幣為單位的 GDP */
export const bil = (v) => nf.format(Math.round(v ?? 0)) + ' 十億';

export function signed(v, d = 0) {
  const n = v ?? 0;
  return (n > 0 ? '+' : '') + (d ? n.toFixed(d) : nf.format(Math.round(n)));
}

export function dateLabel(year, month, scale, weekIndex) {
  if (scale === 'week') return `${year} 年 ${month} 月 第 ${(weekIndex ?? 0) + 1} 週`;
  return `${year} 年 ${month} 月`;
}

export function ageOf(state) {
  return state.meta.year - state.player.birthYear;
}
