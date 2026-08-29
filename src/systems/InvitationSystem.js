// @ts-check
/**
 * 邀約。
 *
 * 政治人物的行事曆不是自己排出來的，是被別人塞滿的。
 * 每一場都可以自己去，也可以派助理代表——但每位助理一個月只能跑一場，
 * 而且派人去的效果永遠比自己到場低。這就是為什麼要養團隊，
 * 也是為什麼養了團隊還是永遠不夠用。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import * as People from './PeopleSystem.js';
import { addFavor } from './FavorSystem.js';

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const cfg = data.invitations;
  state.socialInvites ??= [];

  // 到期的邀約會自己消失，而且不是沒有代價
  const news = [];
  for (const inv of state.socialInvites.slice()) {
    inv.expiresIn -= 1;
    if (inv.expiresIn > 0) continue;
    state.socialInvites = state.socialInvites.filter((x) => x !== inv);
    const kind = data.byId.invitation[inv.kindId];
    if (kind?.declinePenalty && inv.personId) {
      addFavor(state, data, inv.personId, -0.3);
    }
  }

  // 助理的每月配額在每個月的第一個回合重置
  if (state.meta.scale === 'month' || state.meta.weekIndex === 0) {
    state.flags.aideUsed = {};
  }

  const R = cfg.arrivalRate;
  if (state.socialInvites.length >= R.maxPending) return { news };
  const p = state.player;
  const grass = state.districts[p.homeDistrict]?.playerGrassroots ?? 0;
  let rate = (R.base + p.fame * R.fame + grass * R.grass) * scaleMult;
  if (state.election) rate *= R.campaignSeasonMult;

  let n = Math.floor(rate);
  if (rng.bool(rate - n)) n += 1;
  for (let i = 0; i < n && state.socialInvites.length < R.maxPending; i++) {
    state.socialInvites.push(makeInvite(state, data, rng));
  }
  return { news };
}

function makeInvite(state, data, rng) {
  const cfg = data.invitations;
  const pool = cfg.kinds.filter((k) => {
    if (k.id === 'INV_STUMP' && !state.player.party) return false;
    if (k.id === 'INV_STUMP' && state.player.fame < 1.5) return false;
    return true;
  });
  const kind = rng.weighted(pool, (k) => k.weight);
  const who = kind.id === 'INV_STUMP'
    ? People.pickAcquaintance(state, data, rng, { sameParty: true, minFame: 1 })
    : People.pickAcquaintance(state, data, rng, { local: true });
  return {
    id: 'inv' + (state.flags.inviteSeq = (state.flags.inviteSeq ?? 0) + 1).toString(36),
    kindId: kind.id,
    personId: who?.id ?? null,
    personName: who?.name ?? '地方上的一位長輩',
    lead: kind.lead.replace('{name}', who?.name ?? '同陣營的一位參選人'),
    expiresIn: cfg.arrivalRate.expireTurns,
  };
}

/** 哪些助理今天還能派得出去 */
export function availableAides(state, data) {
  const used = state.flags.aideUsed ?? {};
  const roles = new Set(data.invitations.aideRule.aideRoles);
  return state.team.filter((t) => roles.has(t.role) && !used[t.id]);
}

/**
 * 出席一場邀約。mode 為 self / aide / decline。
 * 自己去最有效但要花行動點，派人去不花行動點但效果打折，
 * 推掉不花任何東西，只花掉別人對你的期待。
 */
export function attend(state, data, inviteId, mode, aideId, rng) {
  const inv = (state.socialInvites ?? []).find((x) => x.id === inviteId);
  if (!inv) return { ok: false, msg: '這個邀約已經不在了。' };
  const kind = data.byId.invitation[inv.kindId];
  const p = state.player;
  const home = state.districts[p.homeDistrict];
  const AR = data.invitations.aideRule;

  let mult = 1, text = '', aideName = '';
  if (mode === 'decline') {
    mult = 0;
    text = kind.decline;
    if (inv.personId) addFavor(state, data, inv.personId, -(kind.declinePenalty ?? 0.6) * 0.4);
  } else if (mode === 'aide') {
    if (!kind.aideOk) return { ok: false, msg: '這種場合派人去等於沒去，對方要的就是你本人。' };
    const aide = state.team.find((t) => t.id === aideId);
    if (!aide) return { ok: false, msg: '你找不到可以派去的人。' };
    const used = state.flags.aideUsed ??= {};
    if (used[aide.id]) return { ok: false, msg: `${aide.name}這個月已經跑過一場了，一個人分不了兩邊。` };
    used[aide.id] = inv.id;
    aideName = aide.name;
    mult = AR.effectMult + (aide.ability ?? 2) * AR.abilityBonus;
    text = kind.aide.replace('{aide}', aide.name);
    // 忠誠跟不上能力的人，去了反而可能出事
    const gap = Math.max(0, (aide.ability ?? 2) - (aide.loyalty ?? 2));
    if (gap > 0 && rng.bool(gap * AR.blunderChancePerLoyaltyGap)) {
      mult *= 0.4;
      p.stigma = clamp05(p.stigma + 0.12);
      text += `　後來你才知道${aide.name}在場上替你答應了一件你沒有答應過的事。`;
    }
  } else {
    text = kind.self;
    mult = 1;
  }

  if (mult > 0) {
    const e = kind.effects;
    if (e.grassroots && home) home.playerGrassroots = clamp05(home.playerGrassroots + e.grassroots * mult);
    if (e.favor && home) home.playerFavor = clampBi(home.playerFavor + e.favor * mult);
    if (e.fame) p.fame = clamp05(p.fame + e.fame * mult);
    if (e.integrity) p.integrity = clamp05(p.integrity + e.integrity * mult);
    if (e.corpMood) {
      for (const c of Object.values(state.corporations)) c.mood = clampBi(c.mood + e.corpMood * mult * 0.25);
    }
    if (e.campaignFundsChance && rng.bool(e.campaignFundsChance * mult)) {
      const amt = Math.round(rng.range(200000, 1200000) / 10000) * 10000;
      state.finance.campaign += amt;
      text += `　散場之後有人把一個信封放在你的助理手上，裡面是合乎規定的政治獻金收據，金額是 ${amt / 10000} 萬。`;
    }
    if (e.stigmaRisk && rng.bool(e.stigmaRisk * mult)) p.stigma = clamp05(p.stigma + 0.15);
    if (e.favorGain && inv.personId) addFavor(state, data, inv.personId, e.favorGain * mult);
    if (kind.cost) state.finance.campaign -= Math.round(kind.cost * (mode === 'self' ? 1 : 0.9));
  }

  state.socialInvites = state.socialInvites.filter((x) => x !== inv);
  return { ok: true, text, mode, aideName, kind };
}
