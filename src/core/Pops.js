// @ts-check
/**
 * POP 以 SoA（Structure of Arrays）儲存。
 * 195 選區 × 10 階層 × 3 世代 = 5850 個 POP，
 * 用物件陣列會讓每回合的迴圈慢上一個數量級，也讓存檔膨脹到十幾 MB。
 */
import { clamp, clamp05, clampBi } from './Formula.js';

export const N_AXIS = 8;
export const N_IDENT = 4;

export class Pops {
  constructor(n, nParty) {
    this.n = n;
    this.nParty = nParty;
    this.district = new Int16Array(n);     // 選區索引
    this.stratum = new Int8Array(n);
    this.gen = new Int8Array(n);
    this.size = new Float32Array(n);
    this.income = new Float32Array(n);
    this.employment = new Float32Array(n);
    this.sol = new Float32Array(n);
    this.awareness = new Float32Array(n);
    this.militancy = new Float32Array(n);
    this.enthusiasm = new Float32Array(n);
    this.turnoutBase = new Float32Array(n);
    this.playerFavor = new Float32Array(n);
    this.ideology = new Float32Array(n * N_AXIS);
    this.support = new Float32Array(n * nParty);
    this.identity = new Float32Array(n * N_IDENT);
  }
  ax(i, a) { return this.ideology[i * N_AXIS + a]; }
  setAx(i, a, v) { this.ideology[i * N_AXIS + a] = clampBi(v); }
  sup(i, p) { return this.support[i * this.nParty + p]; }
  setSup(i, p, v) { this.support[i * this.nParty + p] = v; }
  ident(i, k) { return this.identity[i * N_IDENT + k]; }

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
    const out = { n: this.n, nParty: this.nParty, f: {} };
    for (const k of ['district', 'stratum', 'gen', 'size', 'income', 'employment', 'sol',
      'awareness', 'militancy', 'enthusiasm', 'turnoutBase', 'playerFavor',
      'ideology', 'support', 'identity']) out.f[k] = b64(this[k]);
    return out;
  }
  static fromJSON(o) {
    const p = new Pops(o.n, o.nParty);
    const un = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
    for (const k in o.f) {
      const Ctor = p[k].constructor;
      p[k] = new Ctor(un(o.f[k]));
    }
    return p;
  }
}

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

  let i = 0;
  districts.forEach((d, di) => {
    const region = data.byId.region[d.regionId];
    const shares = data.pops.strataShareByUrbanity[String(clamp(d.urbanity, 0, 5))];
    const idm = identityForLean(identCfg, d.lean);
    const incomeScale = (region.economy.perCapitaIncome / 700000) * (0.9 + d.urbanity * 0.045);
    const unemp = region.economy.unemployment;

    strata.forEach((s, si) => {
      gens.forEach((g, gi) => {
        const size = Math.max(120, d.population * shares[s.id] * g.share * rng.range(0.93, 1.07));
        P.district[i] = di; P.stratum[i] = si; P.gen[i] = gi;
        P.size[i] = size;
        P.income[i] = s.baseIncome * incomeScale * rng.range(0.95, 1.05)
          * (g.id === 'youth' ? 0.72 : g.id === 'senior' ? 0.88 : 1.08);
        P.employment[i] = clamp(1 - unemp * (s.id === 'bluecollar' ? 1.6 : s.id === 'student' ? 3.2 : 1)
          * rng.range(0.85, 1.15), 0.5, 0.995);
        P.awareness[i] = clamp05(s.awareness + g.awarenessShift + d.urbanity * 0.12 + rng.range(-0.4, 0.4));
        P.militancy[i] = clamp05(rng.range(0.2, 1.4));
        P.enthusiasm[i] = clamp05(2 + rng.range(-0.6, 0.8));
        P.turnoutBase[i] = clamp(s.turnoutBase + g.turnoutShift + rng.range(-0.03, 0.03), 0.35, 0.92);
        P.playerFavor[i] = 0;

        data.axisIds.forEach((axId, ai) => {
          const base = (s.ideology[axId] ?? 0) + (g.ideologyShift[axId] ?? 0);
          const leanPull = axId === 'unification' ? d.lean * 0.55
            : axId === 'progressivism' ? -d.lean * 0.18
              : axId === 'marketFreedom' ? d.lean * 0.12 : 0;
          P.setAx(i, ai, base + leanPull + rng.range(-0.7, 0.7));
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
