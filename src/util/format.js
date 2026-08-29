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

/**
 * 以億為輸入單位的大數字，輸出成台灣人真的會講的量詞。
 *
 * 台灣沒有人用「十億」當單位——報紙寫的是「三兆兩千億」，
 * 主計總處寫的也是「兆」。一萬億以上就換成兆，剩下的尾數才用億，
 * 一億以下才降到萬。這個函式的輸入是「億元」，因為財政與產值的
 * 資料本來就是以億為單位存的，換算放在這裡比散在各頁面安全。
 */
export function yiBig(vInYi, opt = {}) {
  const unit = opt.unit ?? '元';
  const n = vInYi ?? 0;
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10000) {
    const zhao = Math.floor(abs / 10000);
    const rest = Math.round(abs - zhao * 10000);
    // 尾數不到一千億就不寫，「三兆」比「三兆七億」好讀也更接近實際用法
    if (rest < 1000) return `${neg}${nf.format(zhao)} 兆${unit}`;
    return `${neg}${nf.format(zhao)} 兆 ${nf.format(rest)} 億${unit}`;
  }
  if (abs >= 1) return `${neg}${nf.format(Math.round(abs))} 億${unit}`;
  return `${neg}${nf.format(Math.round(abs * 10000))} 萬${unit}`;
}

/** 舊介面：輸入是十億元，內部換算成億再交給 yiBig */
export const bil = (v) => yiBig((v ?? 0) * 10);

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

/**
 * 選區名稱加代稱。
 *
 * 「臺北市第五選舉區」沒有人這樣講話，大家講的是中正萬華。
 * 正式名稱要留著，因為公文、選票與新聞稿上寫的是那個；
 * 括號裡的代稱才是玩家腦袋裡真正用來定位的那一組字。
 */
export function distName(d, opt = {}) {
  if (!d) return '';
  const alias = d.alias;
  if (!alias || alias === d.name) return d.name;
  if (opt.aliasOnly) return alias;
  return `${d.name}(${alias})`;
}
