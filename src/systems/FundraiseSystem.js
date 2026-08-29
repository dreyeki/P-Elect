// @ts-check
/**
 * 募款。
 *
 * 台灣的選舉經費有三個來源：政治獻金、政黨補助、自己的錢。
 * 這個檔案管第一個，而三種管道的差別不只是金額——
 * 小額捐最乾淨也最慢，建商最快也最貴，餐會在中間。
 * 每一種都在測量不同的東西：餐會測你的人脈，小額捐測有多少人真的在乎你，
 * 拜訪建商測的是你願意欠多少。
 */
import { clamp05 } from '../core/Formula.js';

export function channels(data) { return data.fundraising?.channels ?? []; }
export function channelById(data, id) { return channels(data).find((c) => c.id === id); }

/** 這個管道現在開不開得成，以及為什麼開不成 */
export function channelState(state, data, id) {
  const c = channelById(data, id);
  if (!c) return { ok: false, why: '沒有這個募款管道。' };
  const p = state.player;
  const u = c.unlock ?? {};
  if (u.fame != null && p.fame < u.fame) {
    return { ok: false, why: id === 'FUND_DEVELOPER'
      ? '建商不會見一個他還沒聽過的人，那是浪費他的時間。'
      : '沒有人認識你的時候，這種場子是開不成的。' };
  }
  const cd = (state.flags.fundCooldown ?? {})[id] ?? 0;
  if (cd > 0) {
    return { ok: false, why: `同一批人不能連著找，再等 ${cd} 個月。`, cooldown: cd };
  }
  if (c.cost && state.finance.campaign < c.cost) {
    return { ok: false, why: '光是訂場地的訂金專戶就付不出來了。' };
  }
  return { ok: true };
}

export function available(state, data) {
  return channels(data).map((c) => ({ c, st: channelState(state, data, c.id) }));
}

/**
 * 跑一次募款。
 * 金額 = 基準區間隨機值 × (1 + 各項權重加總)。
 * 權重都是 0~5 的抽象量除以五之後乘上係數，所以一個知名度五、
 * 交際五、基層五的人大概是基準的兩倍，不會誇張到把系統打壞。
 */
export function run(state, data, id, rng) {
  const st = channelState(state, data, id);
  if (!st.ok) return { ok: false, msg: st.why };
  const c = channelById(data, id);
  const T = data.fundraising?.tuning ?? {};
  const p = state.player;
  const home = state.districts[p.homeDistrict];

  let mult = 1;
  mult += (c.fameWeight ?? 0) * (p.fame / 5) * 5 * 0.2;
  mult += (c.sociabilityWeight ?? 0) * (p.attrs.sociability / 5) * 5 * 0.2;
  mult += (c.grassrootsWeight ?? 0) * ((home?.playerGrassroots ?? 0) / 5) * 5 * 0.2;
  mult += (c.followerWeight ?? 0) * Math.min(1.6, Math.log10(1 + (state.social?.followers ?? 0)) / 4);
  mult += (c.enthusiasmWeight ?? 0) * ((state.flags.lastEnthusiasm ?? 2) / 5);
  if (c.roleWeight) {
    const RANK = { citizen: 0, aide: 0.1, village: 0.25, councilor: 0.55, legislator: 0.8, mayor: 1, minister: 0.9, president: 1 };
    mult += c.roleWeight * (RANK[p.role] ?? 0);
  }
  if (p.party) mult += T.partyBonus ?? 0.15;
  if (state.team.some((t) => t.role === 'finance')) mult += T.financeStaffBonus ?? 0.25;
  if (state.meta.scale === 'week') mult *= T.campaignSeasonMult ?? 1.6;
  // 汙名高的人募款會變難：願意跟你合照的人變少了
  mult *= 1 - clamp05(p.stigma) / 5 * 0.3;

  const base = rng.range(c.baseRange[0], c.baseRange[1]);
  const amount = Math.max(0, Math.round(base * mult / 10000) * 10000);
  const good = amount >= (c.baseRange[0] + c.baseRange[1]) / 2;

  state.finance.campaign += amount - (c.cost ?? 0);

  const out = {
    ok: true, id, amount, good,
    name: c.name,
    text: good ? c.flavorGood : c.flavorBad,
    stigma: 0, condition: null,
  };

  // 汙名。收下去的那一刻就決定了，事後怎麼解釋都改不掉。
  if (c.stigmaChance && rng.bool(c.stigmaChance)) {
    p.stigma = clamp05(p.stigma + (c.stigmaAmount ?? 0.15));
    out.stigma = c.stigmaAmount ?? 0.15;
  }
  // 建商的錢有一半會附帶一件他沒有明講的事
  if (c.conditionChance && c.conditions?.length && rng.bool(c.conditionChance)) {
    const cond = rng.pick(c.conditions);
    out.condition = cond;
    p.stigma = clamp05(p.stigma + (cond.stigma ?? 0));
    state.flags.developerFavors = (state.flags.developerFavors ?? 0) + 1;
  }

  state.flags.fundCooldown ??= {};
  state.flags.fundCooldown[id] = (T.cooldownTurns?.[id] ?? 1) + 1;
  state.flags.fundTotals ??= {};
  state.flags.fundTotals[id] = (state.flags.fundTotals[id] ?? 0) + amount;
  return out;
}

/** 冷卻每回合遞減 */
export function tick(state, ctx) {
  const cd = state.flags.fundCooldown;
  if (!cd) return {};
  for (const k in cd) cd[k] = Math.max(0, cd[k] - (ctx.scaleMult ?? 1));
  return {};
}
