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

/**
 * 誰可以編預算。
 * 這在現實裡是憲政層級的分工：行政院編、立法院審，地方也是同一套。
 * 所以民代玩家看到的預算頁不會有滑桿，只會有刪減、凍結跟附帶決議。
 */
export function canAllocate(state, data) {
  return (data.budget.authority?.canAllocate ?? ['minister', 'president'])
    .includes(state.player.role);
}
export function canReview(state, data) {
  return (data.budget.authority?.canReview ?? ['councilor', 'legislator'])
    .includes(state.player.role);
}

/**
 * 民代審預算。
 * 刪減是把錢砍掉，凍結是把錢留著但不准動——後者才是實際上最有用的，
 * 因為解凍要行政部門來做報告，而做報告的時候你就有籌碼了。
 */
export function review(state, data, categoryId, actionId) {
  const A = data.budget.authority;
  if (!canReview(state, data)) {
    return { ok: false, msg: '你沒有審預算的身分。這件事只有民意代表做得到。' };
  }
  const act = A.reviewActions.find((x) => x.id === actionId);
  const cat = data.budget.categories.find((c) => c.id === categoryId);
  if (!act || !cat) return { ok: false, msg: '找不到這個科目或這種處理方式。' };
  const p = state.player;
  if (p.politicalCapital < act.politicalCapital) {
    return { ok: false, msg: '你手上的政治資本不夠推動這一案，委員會裡沒有人會跟著你舉手。' };
  }
  p.politicalCapital -= act.politicalCapital;
  p.fatigueRaw = clamp(p.fatigueRaw + (A.cutFatigue ?? 6), 0, 120);

  const rec = state.flags.budgetReview ??= {};
  rec[categoryId] = { action: actionId, ratio: act.maxRatio, turn: state.meta.turn };

  if (act.id === 'cut') {
    const alloc = state.flags.budgetAlloc
      ?? Object.fromEntries(data.budget.categories.map((c) => [c.id, c.share]));
    const floor = cat.share * cat.rigid;
    alloc[categoryId] = Math.max(floor, alloc[categoryId] * (1 - act.maxRatio));
    const sum = Object.values(alloc).reduce((a, b) => a + b, 0);
    for (const k in alloc) alloc[k] /= sum;
    state.flags.budgetAlloc = alloc;
    if (act.corpMood) for (const c of Object.values(state.corporations)) c.mood = clamp(c.mood + act.corpMood, -5, 5);
    return { ok: true, msg: `${cat.name}被刪減了。行政部門的人在議場外面講了幾句很難聽的話，記者都聽見了。` };
  }
  if (act.id === 'freeze') {
    state.flags.frozenBudget = (state.flags.frozenBudget ?? 0) + 1;
    state.flags.executiveLeverage = (state.flags.executiveLeverage ?? 0) + (act.leverage ?? 1);
    return { ok: true, msg: `${cat.name}被凍結。要動這筆錢，部裡得先來做一次專案報告，而報告什麼時候排得進來由你決定。` };
  }
  p.fame = clamp05(p.fame + (act.fame ?? 0));
  return { ok: true, msg: `附帶決議寫進了紀錄。它沒有強制力，但下一次質詢的時候你可以拿著這一頁問他為什麼沒有做。` };
}

/** 玩家調整歲出配置（總和必須為 1）。只有行政部門做得到。 */
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
  if (!canAllocate(state, data)) {
    return { ok: false, msg: '編列特別預算是行政部門的事。你能做的是等它送到議場，然後決定要不要讓它過。' };
  }
  if (sb.year && state.meta.year < sb.year) {
    return { ok: false, msg: `這一案要到 ${sb.year} 年度才會排進編列作業。` };
  }
  state.flags['sb_' + id] = state.meta.turn;
  state.central.fiscal.debtOutstanding += sb.amount;
  applyEffects(state, data, sb.effects, { source: 'sb:' + id, label: sb.name, duration: sb.years * 12 });

  // 普發現金這類政策的政治效果是立即的，財政效果是長期的——順序反過來就是問題所在
  const pol = sb.politics;
  if (pol) {
    if (pol.approvalBoost) {
      state.modifiers.add({ id: 'sb:approval:' + id, source: sb.name, target: 'player.approval',
        op: 'add', value: pol.approvalBoost, duration: pol.approvalDecayTurns ?? 8, startTurn: state.meta.turn });
      state.central.government.presidentApproval = clamp(
        state.central.government.presidentApproval + pol.approvalBoost, 3, 95);
    }
    if (pol.corpMood) for (const c of Object.values(state.corporations)) c.mood = clamp(c.mood + pol.corpMood, -5, 5);
    for (const k in (pol.valuePressure ?? {})) {
      state.flags.valuePressure ??= {};
      state.flags.valuePressure[k] = (state.flags.valuePressure[k] ?? 0) + pol.valuePressure[k];
    }
    // 普及式給付會變成往後每一年都要編的固定支出
    if (pol.rigidCost) {
      const cat = data.budget.categories.find((c) => c.id === 'welfare');
      if (cat) cat.rigid = Math.min(0.95, cat.rigid + pol.rigidCost);
    }
  }
  return { ok: true, msg: `${sb.name}編列 ${sb.amount} 億元，全數以舉債支應。短期內看得到成果，但這筆帳會跟著你很多年。` };
}
