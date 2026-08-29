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

/**
 * 男女差距的呈現。
 *
 * 「進盟 女+5.5」比「進盟 男 46.9 女 52.4 −5.5」好讀太多：
 * 玩家想知道的是哪一邊比較挺、差多少，而不是兩個要自己相減的數字。
 * 差距小於 flat 個百分點就不給方向，因為那個大小的差在民調誤差裡看不出來。
 */
export function genderLean(malePct, femalePct, flat = 0.3) {
  const gap = (malePct ?? 0) - (femalePct ?? 0);
  const amount = Math.abs(gap);
  if (amount < flat) return { side: null, amount, text: '幾無差異', cls: 'g-none' };
  const male = gap > 0;
  return {
    side: male ? 'male' : 'female',
    amount,
    text: `${male ? '男' : '女'}+${amount.toFixed(1)}`,
    cls: male ? 'g-m' : 'g-f',
  };
}
