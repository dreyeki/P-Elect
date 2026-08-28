// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { applyEffects } from './Effects.js';

/** 依稅制檔位推算歲入 */
export function revenue(state, data) {
  const c = state.central;
  const base = c.fiscal.gdp * 0.126;   // 稅收佔 GDP 的基準
  let total = 0;
  const rows = [];
  for (const t of data.budget.taxes) {
    let amt = base * t.baseShare * 10;  // 十億 → 億
    const mult = state.modifiers.get('tax.' + t.id, 0);
    amt *= 1 + mult;
    if (t.lawId) {
      const law = data.byId.law[t.lawId];
      const tier = law?.tiers[state.laws[t.lawId]];
      const m = tier?.effects?.central?.['fiscal.revenueMult'] ?? 0;
      amt *= 1 + m * 3.2;   // 該稅目承受主要衝擊
    }
    amt *= 1 + (state.central.fiscal.gdpGrowth - 0.02) * 1.4;
    rows.push({ id: t.id, name: t.name, amount: amt });
    total += amt;
  }
  return { total, rows };
}

export function expenditure(state, data) {
  const alloc = state.flags.budgetAlloc ?? Object.fromEntries(data.budget.categories.map((c) => [c.id, c.share]));
  const scale = state.flags.budgetScale ?? 1;
  const totalBase = revenue(state, data).total * 1.05 * scale;
  const rows = data.budget.categories.map((c) => ({
    id: c.id, name: c.name, share: alloc[c.id], rigid: c.rigid,
    amount: totalBase * alloc[c.id],
  }));
  return { total: totalBase, rows, alloc };
}

export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  const news = [];
  const c = state.central;
  const rev = revenue(state, data);
  const exp = expenditure(state, data);
  const deficit = exp.total - rev.total;
  c.fiscal.revenueBase = rev.total;
  c.fiscal.expenditure = exp.total;
  c.fiscal.debtOutstanding += deficit / 12 * scaleMult;
  const ratio = c.fiscal.debtOutstanding / (c.fiscal.gdp * 10);
  c.fiscal.debtToGdp = ratio;

  if (ratio > c.fiscal.debtCeilingRatio && !state.flags.debtCeilingHit) {
    state.flags.debtCeilingHit = true;
    news.push({ kind: 'budget', text: '公債餘額佔前三年名目國內生產毛額的比率已經觸及公債法的上限，主計機關發出正式警告，接下來任何新增支出都必須先找到財源。' });
  }
  if (ratio <= c.fiscal.debtCeilingRatio) state.flags.debtCeilingHit = false;

  // 預算的施政效果
  const efficiency = clamp(0.7 + (c.government.cabinetCohesion / 5) * 0.3, 0.5, 1.0);
  for (const row of exp.rows) {
    const cat = data.budget.categories.find((x) => x.id === row.id);
    const rel = row.share / cat.share;
    const eff = cat.affects ?? {};
    const k = (rel - 1) * 0.06 * efficiency * scaleMult;
    if (Math.abs(k) < 1e-6) continue;
    if (eff.popSoL) applyEffects(state, data, { popSoL: scaleObj(eff.popSoL, k) }, { source: 'budget:' + row.id });
    if (eff.infrastructure) {
      for (const r of Object.values(state.regions)) {
        for (const ik in eff.infrastructure) r.infrastructure[ik] = clamp05(r.infrastructure[ik] + eff.infrastructure[ik] * k);
      }
    }
    if (eff['defense.readiness']) c.defense.readiness = clamp05(c.defense.readiness + eff['defense.readiness'] * k);
    if (eff['defense.asymmetricCapability']) c.defense.asymmetricCapability = clamp05(c.defense.asymmetricCapability + eff['defense.asymmetricCapability'] * k);
    if (eff['society.pensionSustainability']) c.society.pensionSustainability = clamp05(c.society.pensionSustainability + eff['society.pensionSustainability'] * k);
    if (eff.gdpGrowthBonus) state.modifiers.add({ id: 'budget:gdp', source: 'budget', target: 'econ.gdpGrowthBonus', op: 'add', value: eff.gdpGrowthBonus * (rel - 1), duration: 2, startTurn: state.meta.turn });
    if (eff.regionFinance) for (const r of Object.values(state.regions)) r.finance.subsidy *= 1 + k * 0.5;
  }
  return { news };
}

function scaleObj(o, k) { const out = {}; for (const kk in o) out[kk] = o[kk] * k; return out; }

/** 玩家調整歲出配置（總和必須為 1） */
export function setAllocation(state, data, alloc) {
  const sum = Object.values(alloc).reduce((a, b) => a + b, 0);
  const norm = {};
  for (const k in alloc) norm[k] = alloc[k] / sum;
  // 剛性支出不能砍太多
  for (const c of data.budget.categories) {
    const floor = c.share * c.rigid;
    if (norm[c.id] < floor) norm[c.id] = floor;
  }
  const s2 = Object.values(norm).reduce((a, b) => a + b, 0);
  for (const k in norm) norm[k] /= s2;
  state.flags.budgetAlloc = norm;
  return norm;
}

export function launchSpecialBudget(state, data, id) {
  const sb = data.budget.specialBudgets.find((s) => s.id === id);
  if (!sb || state.flags['sb_' + id]) return { ok: false, msg: '這個特別預算已經在執行中了。' };
  state.flags['sb_' + id] = state.meta.turn;
  state.central.fiscal.debtOutstanding += sb.amount;
  applyEffects(state, data, sb.effects, { source: 'sb:' + id, label: sb.name, duration: sb.years * 12 });
  return { ok: true, msg: `${sb.name}編列 ${sb.amount} 億元，全數以舉債支應。短期內看得到成果，但這筆帳會跟著你很多年。` };
}
