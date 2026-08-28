// @ts-check
/** 可重現的種子亂數：xorshift128。所有隨機都必須走這裡，存檔才能重現。 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function seedFromString(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0 || 0x9e3779b9;
}

export function randomSeedString(len = 8) {
  let s = '';
  const buf = new Uint32Array(len);
  (globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(buf)
    : buf.forEach((_, i) => (buf[i] = (Math.random() * 0xffffffff) >>> 0)));
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export class Rng {
  constructor(seed, counter = 0) {
    this.seed = seed >>> 0;
    this.counter = 0;
    this._reset();
    for (let i = 0; i < counter; i++) this.next();
  }
  _reset() {
    let s = this.seed;
    const sm = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
  }
  next() {
    this.counter++;
    let t = this.b << 9;
    this.c ^= this.a; this.d ^= this.b;
    this.b ^= this.c; this.a ^= this.d; this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return ((this.a + this.d) >>> 0) / 4294967296;
  }
  /** [min, max) 浮點 */
  range(min, max) { return min + this.next() * (max - min); }
  /** [min, max] 整數 */
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  bool(p = 0.5) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** 依權重挑選，items 為 [{w:number,...}] 或搭配 keyFn */
  weighted(items, keyFn = (x) => x.w) {
    let total = 0;
    for (const it of items) total += Math.max(0, keyFn(it));
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, keyFn(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /** 常態分佈（Box-Muller），供數值擾動用 */
  normal(mean = 0, sd = 1) {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** 建立一個獨立分流，用於不影響主序列的子系統 */
  fork(salt) {
    return new Rng(seedFromString(this.seed + ':' + salt));
  }
  snapshot() { return { seed: this.seed, counter: this.counter }; }
}
