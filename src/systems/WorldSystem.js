// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';

export function tick(state, ctx) {
  const { rng, scaleMult } = ctx;
  const news = [];
  for (const b of Object.values(state.world)) {
    // 景氣循環：以週期 + 噪音推進
    const period = b.id === 'GLOBAL' ? 46 : 62;
    const target = Math.sin((state.meta.turn / period) * Math.PI * 2 + b.id.length) * 0.7;
    b.cycle = clamp(b.cycle + (target - b.cycle) * 0.14 * scaleMult
      + rng.normal(0, 0.03) * scaleMult, -1, 1);
    b.stance = clampBi(b.stance + (b.trend ?? 0) * scaleMult + rng.normal(0, 0.02) * scaleMult);

    // 內政翻轉：四年一度的政權輪替
    if (b.domesticPolitics?.nextShiftYear === state.meta.year && state.meta.month === 11) {
      if (rng.bool(0.45)) {
        const o = b.domesticPolitics.orientation;
        b.domesticPolitics.orientation = o === 'internationalist' ? 'isolationist' : 'internationalist';
        const d = b.domesticPolitics.orientation === 'isolationist' ? -1.2 : 1.2;
        b.stance = clampBi(b.stance + d);
        const dir = b.domesticPolitics.orientation === 'isolationist' ? '向內收縮' : '重新對外開放';
        news.push({ kind: 'world', text: `${b.name}的內政路線出現明顯轉向，對外政策整體${dir}，我方必須重新評估既有的合作基礎與往來節奏。` });
      }
      b.domesticPolitics.nextShiftYear += 4;
    }
  }
  // 中國大陸的軍事壓力隨我方統合軸與國防投入變化
  const chn = state.world.CHN;
  if (chn) {
    const target = clamp05(3 - state.values.unification * 0.35 + (state.central.defense.budgetRatio - 0.031) * 12);
    chn.militaryPressure = clamp05(chn.militaryPressure + (target - chn.militaryPressure) * 0.06 * scaleMult);
  }
  // 世界對中央外交數值的傳導
  const dip = state.central.diplomacy;
  dip.usRelation = clampBi(dip.usRelation + (state.world.USA.stance - dip.usRelation) * 0.04 * scaleMult);
  dip.prcRelation = clampBi(dip.prcRelation + (state.world.CHN.stance - dip.prcRelation) * 0.04 * scaleMult);
  dip.japanRelation = clampBi(dip.japanRelation + (state.world.JPN.stance - dip.japanRelation) * 0.04 * scaleMult);
  dip.euRelation = clampBi(dip.euRelation + (state.world.EU.stance - dip.euRelation) * 0.04 * scaleMult);
  return { news };
}

/** 產業景氣：把世界區塊對應到各產業的循環係數 */
export function sectorCycles(state) {
  const g = state.world.GLOBAL.cycle;
  const kor = state.world.KOR.cycle, chn = state.world.CHN.cycle, usa = state.world.USA.cycle;
  const mea = state.world.MEA.cycle, asean = state.world.ASEAN.cycle, eu = state.world.EU.cycle;
  return {
    semiconductor: g * 0.034 - kor * 0.008,
    electronics: g * 0.020 + usa * 0.006,
    petrochemical: -mea * 0.014 + chn * 0.008,
    steel: chn * 0.012 - eu * 0.004,
    machinery: g * 0.010 + asean * 0.006,
    food: 0.001,
    textile: -asean * 0.008,
    finance: usa * 0.012 + g * 0.008,
    retail: 0.0015,
    tourism: chn * 0.018 + asean * 0.008,
    logistics: g * 0.014 + usa * 0.008,
    agriculture: 0.0005,
    fishery: 0.0005,
    publicSector: 0,
    other: g * 0.004,
  };
}
