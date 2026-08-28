// @ts-check
import { clamp05 } from '../core/Formula.js';
import { applyEffects } from './Effects.js';
import { grow } from './DistrictSystem.js';

export function inSession(state) {
  const m = state.meta.month;
  return (m >= 4 && m <= 6) || (m >= 10 && m <= 12);
}

export function proposeBill(state, data, regionId, billId, targetTier, rng) {
  const bill = data.byId.bill[billId];
  const region = state.regions[regionId];
  if (!bill || !region) return { ok: false, msg: '找不到這個議案或縣市。' };
  if (state.localBills[regionId][billId] === targetTier) return { ok: false, msg: '這已經是現行的做法了。' };

  // 議會表決：依議會組成與各黨對該議案的立場
  const comp = region.politics.councilComposition;
  const total = Object.values(comp).reduce((a, b) => a + b, 0);
  let yes = 0;
  const mayorParty = region.politics.mayorParty;
  for (const pid in comp) {
    let p = 0.5;
    if (pid === state.player.party) p += 0.22;
    if (pid === mayorParty) p += 0.15;
    const cost = bill.tiers[targetTier].cost?.annual ?? 0;
    p += cost > 0 ? 0.06 : cost < -400 ? -0.14 : -0.04;
    p -= (bill.controversy ?? 2) * 0.03;
    for (let i = 0; i < comp[pid]; i++) if (rng.bool(Math.max(0.05, Math.min(0.95, p)))) yes++;
  }
  const passed = yes > total / 2;
  if (passed) {
    state.modifiers.removeBySource(`bill:${regionId}:${billId}`);
    state.localBills[regionId][billId] = targetTier;
    applyEffects(state, data, bill.tiers[targetTier].effects, {
      source: `bill:${regionId}:${billId}`, label: bill.name, regionId, regionKey: regionId, duration: -1,
    });
    const g = bill.tiers[targetTier].effects?.grassrootsEffect ?? 0;
    if (g) {
      for (const d of Object.values(state.districts)) if (d.regionId === regionId) grow(state, d.id, g);
    }
    const annual = bill.tiers[targetTier].cost?.annual ?? 0;
    region.finance.debt -= annual;
  }
  return {
    ok: true, passed, yes, total,
    msg: passed
      ? `《${bill.name}》在議會以 ${yes} 比 ${total - yes} 通過，改為「${bill.tiers[targetTier].name}」，相關預算將在下個年度編列。`
      : `《${bill.name}》在議會遭到否決，票數是 ${yes} 比 ${total - yes}，反對方認為財政負擔難以承受。`,
  };
}

export function tick(state, ctx) {
  const { scaleMult } = ctx;
  // 中央與地方分屬不同政黨時的統籌分配款拉鋸
  const rulingParty = state.central.government.presidentParty;
  for (const r of Object.values(state.regions)) {
    const aligned = r.politics.mayorParty === rulingParty;
    const target = aligned ? 1.06 : 0.94;
    const cur = state.flags['alloc_' + r.id] ?? 1;
    const next = cur + (target - cur) * 0.02 * scaleMult;
    state.flags['alloc_' + r.id] = next;
    r.finance.allocationFund *= next / Math.max(0.01, cur);
    // 財政困難
    const rigid = (r.finance.personnelCost + r.finance.debt * 0.012)
      / Math.max(1, r.finance.ownRevenue + r.finance.allocationFund + r.finance.subsidy);
    r.fiscalStress = rigid;
    if (rigid > 0.85) {
      r.mayorApproval = Math.max(5, r.mayorApproval - 1 * scaleMult);
    }
  }
  return {};
}
