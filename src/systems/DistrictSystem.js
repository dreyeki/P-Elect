// @ts-check
import { clamp05 } from '../core/Formula.js';

export function tick(state, ctx) {
  const { scaleMult, data } = ctx;
  const TG = data?.tuning?.grassroots ?? {};
  const home = state.player.homeDistrict;
  for (const d of Object.values(state.districts)) {
    // 自然衰退：沒經營就會鬆動
    const decay = d.serviceOffice ? (TG.decayWithOffice ?? 0.02) : (TG.decayUnworked ?? 0.05);
    if (d.id !== home || d.playerGrassroots > 3) {
      d.playerGrassroots = clamp05(d.playerGrassroots - decay * scaleMult);
    }
    if (d.serviceOffice) d.playerGrassroots = clamp05(d.playerGrassroots + (TG.officeGain ?? 0.1) * scaleMult);
    // 好感自然回歸中性
    d.playerFavor *= 1 - 0.01 * scaleMult;
    // 政黨基層組織隨席次與聲望微調
    for (const pid in d.grassroots) {
      const party = state.parties[pid];
      if (!party) continue;
      const target = clamp05((party.cohesion / 5) * 3 + (party.publicImage / 5) * 1.5);
      d.grassroots[pid] = clamp05(d.grassroots[pid] + (target - d.grassroots[pid]) * 0.004 * scaleMult);
    }
  }
  return {};
}

/** 服務處維持費（每回合，元） */
export function officeCost(state, data) {
  let cost = 0;
  const organizer = state.team.find((t) => t.role === 'organizer');
  const mult = organizer ? 1 + (data.byId.staffRole.organizer.effects.officeCostMult ?? 0) * (organizer.ability / 5 + 0.5) : 1;
  for (const d of Object.values(state.districts)) {
    if (d.serviceOffice) cost += (data.tuning?.grassroots?.officeBaseCost ?? 60000) * mult;
    if (d.playerGrassroots > 1) cost += Math.pow(d.playerGrassroots, 1.8) * 9000 * mult;
  }
  return Math.round(cost);
}

/** 動員強度：玩家個人 0.6 + 所屬政黨 0.4 */
export function mobilization(state, districtId, partyId) {
  const d = state.districts[districtId];
  if (!d) return 0;
  const party = partyId ? (d.grassroots[partyId] ?? 0) : 0;
  return d.playerGrassroots * 0.6 + party * 0.4;
}

export function grow(state, districtId, amount) {
  const d = state.districts[districtId];
  if (d) d.playerGrassroots = clamp05(d.playerGrassroots + amount);
}
