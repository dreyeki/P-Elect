// @ts-check
/**
 * POP 以 SoA（Structure of Arrays）儲存。
 * 195 選區 × 10 階層 × 3 世代 = 5850 個 POP，
 * 用物件陣列會讓每回合的迴圈慢上一個數量級，也讓存檔膨脹到十幾 MB。
 *
 * 性別刻意不切成兩份 POP。切開會讓 POP 數與存檔同時翻倍，
 * 換來的資訊卻只有一個：男女在同一群人裡的比例。
 * 所以每個 POP 帶一個女性比例，算支持度時用同一組意識形態
 * 加減性別落差算兩次，再按比例混合——結果一樣，成本少一半。
 */
import { clamp, clamp05, clampBi } from './Formula.js';

export const N_AXIS = 13;
export const N_IDENT = 4;
export const N_CHINA = 7;

/** 與 data/china.json 的 dims 順序必須一致 */
export const CHINA_KEYS = ['friendly', 'strength', 'morality', 'culture', 'openness', 'usTrust', 'japanTrust'];
export const REASON_KEYS = ['economy', 'regime', 'ethnic', 'security', 'democracy'];

export class Pops {
  constructor(n, nParty) {
    this.n = n;
    this.nParty = nParty;
    this.district = new Int16Array(n);     // 選區索引
    this.stratum = new Int8Array(n);
    this.gen = new Int8Array(n);
    this.chinaReason = new Int8Array(n);   // 兩岸態度的主要理由
    this.size = new Float32Array(n);
    this.femaleShare = new Float32Array(n);
    this.income = new Float32Array(n);
    this.employment = new Float32Array(n);
    this.sol = new Float32Array(n);
    this.awareness = new Float32Array(n);
    this.militancy = new Float32Array(n);
    this.enthusiasm = new Float32Array(n);
    this.turnoutBase = new Float32Array(n);
    this.playerFavor = new Float32Array(n);
    this.ideology = new Float32Array(n * N_AXIS);
    this.china = new Float32Array(n * N_CHINA);
    this.support = new Float32Array(n * nParty);
    this.identity = new Float32Array(n * N_IDENT);
  }
  ax(i, a) { return this.ideology[i * N_AXIS + a]; }
  setAx(i, a, v) { this.ideology[i * N_AXIS + a] = clampBi(v); }
  cn(i, k) { return this.china[i * N_CHINA + k]; }
  setCn(i, k, v) { this.china[i * N_CHINA + k] = clampBi(v); }
  sup(i, p) { return this.support[i * this.nParty + p]; }
  setSup(i, p, v) { this.support[i * this.nParty + p] = v; }
  ident(i, k) { return this.identity[i * N_IDENT + k]; }

  /**
   * 存檔。
   *
   * 這裡做了一件事：把有界的量化成一個位元組再存。
   * 意識形態是 −5~5，用 Int8 乘以 12 的解析度是 0.083——
   * 遠比玩家看得到的四字語詞細，卻只佔原本四分之一的空間。
   * 沒有這一步，五千八百個 POP 的存檔會超過瀏覽器的容量上限。
   */
  toJSON() {
    // 分段轉字元，一次性展開 20 萬個 float 會炸掉呼叫堆疊
    const b64 = (ta) => {
      const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
      let s = '';
      for (let i = 0; i < u.length; i += 8192) {
        s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
      }
      return btoa(s);
    };
    const out = { n: this.n, nParty: this.nParty, q: 1, f: {} };
    for (const k of FIELDS) {
      const spec = QUANT[k];
      if (!spec) { out.f[k] = b64(this[k]); continue; }
      const src = this[k];
      const dst = spec.signed ? new Int8Array(src.length) : new Uint8Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const v = Math.round(src[i] * spec.mul);
        dst[i] = spec.signed ? clamp(v, -127, 127) : clamp(v, 0, 255);
      }
      out.f[k] = b64(dst);
    }
    return out;
  }
  static fromJSON(o) {
    const p = new Pops(o.n, o.nParty);
    const un = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
    for (const k in o.f) {
      if (!(k in p)) continue;
      const buf = un(o.f[k]);
      const spec = o.q ? QUANT[k] : null;
      if (!spec) { p[k] = new (p[k].constructor)(buf); continue; }
      const src = spec.signed ? new Int8Array(buf) : new Uint8Array(buf);
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] / spec.mul;
      p[k] = dst;
    }
    return p;
  }
}

/**
 * 量化規格。mul 是放大倍率，signed 表示要用 Int8 而不是 Uint8。
 * 只有真的需要完整精度的欄位（人口、所得）留在 Float32。
 */
const QUANT = {
  ideology: { mul: 12, signed: true },      // −5~5，解析度 0.083
  china: { mul: 12, signed: true },         // −5~5
  playerFavor: { mul: 12, signed: true },   // −5~5
  support: { mul: 250, signed: false },     // 0~1，解析度 0.4%
  identity: { mul: 250, signed: false },    // 0~1
  femaleShare: { mul: 250, signed: false }, // 0~1
  employment: { mul: 250, signed: false },  // 0~1
  turnoutBase: { mul: 250, signed: false }, // 0~1
  sol: { mul: 50, signed: false },          // 0~5，解析度 0.02
  awareness: { mul: 50, signed: false },
  militancy: { mul: 50, signed: false },
  enthusiasm: { mul: 50, signed: false },
};

const FIELDS = ['district', 'stratum', 'gen', 'chinaReason', 'size', 'femaleShare', 'income',
  'employment', 'sol', 'awareness', 'militancy', 'enthusiasm', 'turnoutBase', 'playerFavor',
  'ideology', 'china', 'support', 'identity'];

/** 依 lean 在綠→中→藍之間內插認同分佈 */
function identityForLean(cfg, lean) {
  const t = (lean + 5) / 10; // 0 綠 → 1 藍
  const a = t < 0.5 ? cfg.green : cfg.neutral;
  const b = t < 0.5 ? cfg.neutral : cfg.blue;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const out = {};
  for (const k of ['localist', 'chinese', 'dual', 'apathetic']) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}

/** 兩岸七維同樣依 lean 內插 */
function chinaForLean(cfg, lean) {
  const t = (lean + 5) / 10;
  const a = t < 0.5 ? cfg.green : cfg.neutral;
  const b = t < 0.5 ? cfg.neutral : cfg.blue;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const out = {};
  for (const k of CHINA_KEYS) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}

/**
 * 抽一個兩岸態度的主要理由。
 * 理由不決定立場，只決定什麼樣的說法打得動這個人——
 * 主張友中有利經濟的跟主張抗中才保得住經濟的，在這裡是同一類。
 */
function pickReason(cn, stratumId, genId, rng) {
  const aff = cn.reasonAffinity;
  const w = REASON_KEYS.map((r) => {
    const base = cn.reasons.find((x) => x.id === r)?.share ?? 0.2;
    return base * (aff.byStratum[stratumId]?.[r] ?? 1) * (aff.byGeneration[genId]?.[r] ?? 1);
  });
  const sum = w.reduce((a, b) => a + b, 0);
  let roll = rng.next() * sum;
  for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll <= 0) return i; }
  return 0;
}

/** 建立全部 POP。rng 用於初始擾動（受種子控制）。 */
export function buildPops(data, rng) {
  const districts = data.districts.districts;
  const strata = data.pops.strata;
  const gens = data.pops.generations;
  const partyIds = data.partyIds;
  const n = districts.length * strata.length * gens.length;
  const P = new Pops(n, partyIds.length);
  const identCfg = data.pops.identityByLean;
  const IDENT_KEYS = ['localist', 'chinese', 'dual', 'apathetic'];
  const cn = data.china;
  const G = data.pops.gender;

  let i = 0;
  districts.forEach((d, di) => {
    const region = data.byId.region[d.regionId];
    const shares = data.pops.strataShareByUrbanity[String(clamp(d.urbanity, 0, 5))];
    const idm = identityForLean(identCfg, d.lean);
    const cnBase = chinaForLean(cn.baseByLean, d.lean);
    const incomeScale = (region.economy.perCapitaIncome / 700000) * (0.9 + d.urbanity * 0.045);
    const unemp = region.economy.unemployment;

    strata.forEach((s, si) => {
      gens.forEach((g, gi) => {
        const size = Math.max(120, d.population * shares[s.id] * g.share * rng.range(0.93, 1.07));
        P.district[i] = di; P.stratum[i] = si; P.gen[i] = gi;
        P.size[i] = size;
        P.femaleShare[i] = clamp((G.femaleShareByStratum[s.id] ?? G.femaleShareBase)
          + (g.id === 'senior' ? 0.03 : 0) + rng.range(-0.02, 0.02), 0.05, 0.95);
        P.income[i] = s.baseIncome * incomeScale * rng.range(0.95, 1.05)
          * (g.id === 'youth' ? 0.72 : g.id === 'senior' ? 0.88 : 1.08);
        P.employment[i] = clamp(1 - unemp * (s.id === 'bluecollar' ? 1.6 : s.id === 'student' ? 3.2 : 1)
          * rng.range(0.85, 1.15), 0.5, 0.995);
        P.awareness[i] = clamp05(s.awareness + g.awarenessShift + d.urbanity * 0.12 + rng.range(-0.4, 0.4));
        P.militancy[i] = clamp05(rng.range(0.2, 1.4));
        P.enthusiasm[i] = clamp05(2 + rng.range(-0.6, 0.8));
        P.turnoutBase[i] = clamp(s.turnoutBase + g.turnoutShift + rng.range(-0.03, 0.03), 0.35, 0.92);
        P.playerFavor[i] = 0;
        P.chinaReason[i] = pickReason(cn, s.id, g.id, rng);

        data.axisIds.forEach((axId, ai) => {
          const base = (s.ideology[axId] ?? 0) + (g.ideologyShift[axId] ?? 0);
          const leanPull = axId === 'unification' ? d.lean * 0.55
            : axId === 'progressivism' ? -d.lean * 0.18
              : axId === 'genderRoles' ? -d.lean * 0.14
                : axId === 'marketFreedom' ? d.lean * 0.12 : 0;
          P.setAx(i, ai, base + leanPull + rng.range(-0.7, 0.7));
        });

        CHINA_KEYS.forEach((k, ki) => {
          const v = (cnBase[k] ?? 0)
            + (cn.stratumShift[s.id]?.[k] ?? 0)
            + (cn.generationShift[g.id]?.[k] ?? 0)
            + rng.range(-0.6, 0.6);
          P.setCn(i, ki, v);
        });

        IDENT_KEYS.forEach((k, ki) => { P.identity[i * N_IDENT + ki] = idm[k]; });

        // 初始生活水準：由所得與該縣市房價負擔粗估
        const burden = clamp((region.economy.housingPriceIndex / 100) * 260000 / (P.income[i]), 0.05, 0.95);
        P.sol[i] = clamp05(1.1 + Math.log10(P.income[i] / 300000 + 1) * 3.2 - burden * 1.5
          + (region.infrastructure.medical + region.infrastructure.education) * 0.08 + rng.range(-0.25, 0.25));

        i++;
      });
    });
  });
  return P;
}
