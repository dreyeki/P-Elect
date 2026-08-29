// @ts-check
/**
 * 人情牽制。
 *
 * 這一行真正的貨幣不是錢也不是政治資本，是誰欠誰。
 * favor 是有號的：正值代表對方欠你，負值代表你欠對方。
 * 握著別人的人情，幫助會自己找上門；欠著別人的人情，請託也會。
 * 拒絕請託不會被罰錢，但那筆人情會直接翻成怨。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  if (!state.people) return {};
  const cfg = data.favors;
  const news = [];

  // 人情會淡，但淡得很慢
  for (const p of Object.values(state.people)) {
    if (!p.favor) continue;
    p.favor *= 1 - cfg.decayPerTurn * scaleMult;
    if (Math.abs(p.favor) < 0.05) p.favor = 0;
  }

  // 已經觸發過的事件先不重複
  state.favorPending ??= [];
  if (state.favorPending.length >= 2) return { news };

  const creditors = Object.values(state.people).filter((p) => p.favor >= 1.0);
  const debtors = Object.values(state.people).filter((p) => p.favor <= -1.0);
  const chance = (data.tuning?.favor?.eventChance ?? 0.22) * scaleMult;
  if (!rng.bool(chance)) return { news };

  const useHelp = creditors.length && (!debtors.length || rng.bool(0.55));
  const pool = useHelp ? creditors : debtors;
  if (!pool.length) return { news };
  const who = rng.pick(pool);
  const debt = Math.abs(who.favor);

  const list = useHelp ? cfg.helpEvents : cfg.requestEvents;
  const ok = list.filter((e) => {
    const need = useHelp ? (e.minDebt ?? 0) : (e.minOwed ?? 0);
    if (debt < need) return false;
    if (e.requires?.primarySeason && (state.flags.monthsToElection ?? 99) > 8) return false;
    if (e.requires?.campaignSeason && !state.election) return false;
    if (e.requires?.roles && !e.requires.roles.includes(state.player.role)) return false;
    return true;
  });
  if (!ok.length) return { news };
  const ev = rng.weighted(ok, (e) => e.weight ?? 20);

  state.favorPending.push({
    kind: useHelp ? 'help' : 'request',
    eventId: ev.id, personId: who.id, personName: who.name,
    headline: ev.headline.replace('{name}', who.name),
    body: ev.body.replace('{name}', who.name),
  });
  return { news };
}

/** 記一筆人情。amount 正值為對方欠你。 */
export function addFavor(state, data, personId, amount) {
  const p = state.people?.[personId];
  if (!p) return 0;
  const max = data.favors.maxDebt ?? 5;
  p.favor = clamp((p.favor ?? 0) + amount, -max, max);
  return p.favor;
}

/** 結算一個幫助事件 */
export function resolveHelp(state, data, pending, rng) {
  const ev = data.favors.helpEvents.find((e) => e.id === pending.eventId);
  const who = state.people?.[pending.personId];
  if (!ev || !who) return { msg: '' };
  const p = state.player;
  const e = ev.effect;

  if (e.campaignFundsRange) {
    const amt = Math.round(rng.range(e.campaignFundsRange[0], e.campaignFundsRange[1]) / 10000) * 10000;
    state.finance.campaign += amt;
  }
  if (e.stigma) p.stigma = clamp05(p.stigma + e.stigma);
  if (e.stigmaReduce) p.stigma = clamp05(p.stigma - e.stigmaReduce);
  if (e.fame) p.fame = clamp05(p.fame + e.fame);
  if (e.grassrootsHome) {
    const d = state.districts[p.homeDistrict];
    if (d) d.playerGrassroots = clamp05(d.playerGrassroots + e.grassrootsHome);
  }
  if (e.favorHome) {
    const d = state.districts[p.homeDistrict];
    if (d) d.playerFavor = clampBi(d.playerFavor + e.favorHome);
  }
  if (e.primaryMemberBonus) state.flags.primaryHelp = (state.flags.primaryHelp ?? 0) + e.primaryMemberBonus;
  if (e.campaignBoost) state.flags.campaignBoost = (state.flags.campaignBoost ?? 0) + e.campaignBoost;
  if (e.scandalShield) state.flags.scandalShield = (state.flags.scandalShield ?? 0) + e.scandalShield;
  if (e.politicalCapital) p.politicalCapital = Math.max(0, p.politicalCapital + e.politicalCapital);

  who.favor = clamp(who.favor - (ev.cost ?? 1), -5, 5);
  state.favorPending = (state.favorPending ?? []).filter((x) => x !== pending);
  return { msg: ev.resultText };
}

/** 結算一個請託事件。拒絕會讓人情翻成怨。 */
export function resolveRequest(state, data, pending, optionIdx) {
  const ev = data.favors.requestEvents.find((e) => e.id === pending.eventId);
  const who = state.people?.[pending.personId];
  if (!ev || !who) return { msg: '' };
  const opt = ev.options[optionIdx];
  if (!opt) return { msg: '' };
  const p = state.player, e = opt.effects;

  if (e.campaignFundsDelta) state.finance.campaign += e.campaignFundsDelta;
  if (e.stigma) p.stigma = clamp05(p.stigma + e.stigma);
  if (e.integrity) p.integrity = clamp05(p.integrity + e.integrity);
  if (e.fame) p.fame = clamp05(p.fame + e.fame);
  if (e.politicalCapital) p.politicalCapital = Math.max(0, p.politicalCapital + e.politicalCapital);
  if (e.fatigue) p.fatigueRaw = clamp(p.fatigueRaw + e.fatigue, 0, 120);
  if (e.scandalRisk) state.flags.pendingScandalRisk = (state.flags.pendingScandalRisk ?? 0) + e.scandalRisk;

  if (e.favorSettle) who.favor = clamp(who.favor + e.favorSettle, -5, 5);
  if (e.favorFlip) {
    who.favor = clamp(who.favor + e.favorFlip, -5, 5);
    who.relation = 'rival';
  }
  state.favorPending = (state.favorPending ?? []).filter((x) => x !== pending);
  return { msg: e.favorFlip
    ? `${who.name}在電話裡沒有發脾氣，只是很平靜地說他知道了。那種平靜比發脾氣還難處理。`
    : `${who.name}沒有多說什麼，這件事就這樣過去了。這一行的規矩是不必道謝，記著就好。` };
}

/** 手上握著誰的人情、又欠了誰 */
export function ledger(state) {
  const all = Object.values(state.people ?? {}).filter((p) => Math.abs(p.favor ?? 0) >= 0.3);
  return {
    owed: all.filter((p) => p.favor > 0).sort((a, b) => b.favor - a.favor),
    owing: all.filter((p) => p.favor < 0).sort((a, b) => a.favor - b.favor),
  };
}
