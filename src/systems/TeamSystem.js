// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { makeName } from './NameGen.js';

export function slots(state, data) { return data.staffRoles.slotsByRole[state.player.role] ?? 1; }

export function tick(state, ctx) {
  const { rng, data, scaleMult } = ctx;
  const news = [];
  const p = state.player;

  const G = data.staffRoles.graft ?? {};
  for (const t of state.team) {
    // 汙名高的老闆會磨損忠誠
    if (p.stigma >= 3 && rng.bool(0.06 * scaleMult)) t.loyalty = clamp05(t.loyalty - 0.5);

    // ── 有些人本來就帶著問題進來，只是你當初沒有多問
    const risk = t.graftRisk ?? 0;
    if (risk > 0 && rng.bool(risk / 12 * scaleMult)) {
      const amt = Math.round(rng.range(G.amountRange?.[0] ?? 300000, G.amountRange?.[1] ?? 4200000) / 10000) * 10000;
      t.graftTaken = (t.graftTaken ?? 0) + amt;
      t.graftSince ??= state.meta.turn;
    }
    // 收了錢的事情不會馬上被發現，它會先累積再爆
    if (t.graftTaken > 0 && rng.bool((G.discoveryChancePerTurn ?? 0.035) * scaleMult)) {
      state.flags.graftCase = {
        staffId: t.id, name: t.name, roleName: t.roleName,
        amount: t.graftTaken, since: t.graftSince, turn: state.meta.turn,
      };
      t.graftTaken = 0;
      news.push({ kind: 'scandal', text: `檢調在偵辦另一件案子的時候，查到你辦公室的${t.roleName}${t.name}名下有一筆來源說不清楚的金流。你在新聞跳出來的那一刻才知道這件事。` });
    }

    // 高野心且長期沒有回報
    t.tenure = (t.tenure ?? 0) + scaleMult;
    if (t.ambition >= 4 && t.tenure > 36 && rng.bool(0.05 * scaleMult)) {
      news.push({ kind: 'team', text: `${t.name}告訴你他想自己出來選，語氣客氣但態度堅決。你知道再挽留下去只會傷了多年的交情。` });
      t.leaving = 'ambition';
    }
    if (t.loyalty <= 1 && rng.bool(0.08 * scaleMult)) {
      t.leaving = t.knownSecrets >= 2 ? 'betray' : 'quit';
    }
  }
  const leaving = state.team.filter((t) => t.leaving);
  for (const t of leaving) {
    state.team = state.team.filter((x) => x !== t);
    if (t.leaving === 'betray') {
      p.stigma = clamp05(p.stigma + 0.8);
      news.push({ kind: 'team', text: `${t.name}離開之後接受了週刊專訪，把他知道的事講了大半。你的辦公室從中午開始就沒有人敢接電話。` });
    } else if (t.leaving === 'ambition') {
      const d = state.districts[p.homeDistrict];
      if (d) d.playerGrassroots = clamp05(d.playerGrassroots - 0.6);
      news.push({ kind: 'team', text: `${t.name}正式宣布參選，而且選的就是你經營多年的那個選區，他帶走了一批熟悉地方的志工。` });
    } else {
      news.push({ kind: 'team', text: `${t.name}遞出辭呈，理由寫得很客氣，你們都知道真正的原因不在紙上。` });
    }
  }

  // 招募機會
  if (state.team.length < slots(state, data) && rng.bool(0.22 * scaleMult)) {
    state.flags.recruitOffer = makeCandidate(state, data, rng);
  }
  return { news };
}

export function makeCandidate(state, data, rng) {
  const p = state.player;
  const taken = new Set(state.team.map((t) => t.role));
  const roles = data.staffRoles.roles.filter((r) => !taken.has(r.id));
  if (!roles.length) return null;
  const role = rng.pick(roles);
  const tier = [...data.staffRoles.recruitTiers].reverse().find((t) => p.fame >= t.minFame)
    ?? data.staffRoles.recruitTiers[0];
  let ability = rng.int(tier.abilityRange[0], tier.abilityRange[1]);
  // 汙名會嚇跑好人才
  if (p.stigma >= 3) ability = clamp05(ability - 1);
  if (p.attrs.sociability >= 4) ability = clamp05(ability + 1);
  // 每個人都帶著一段來歷。它讀起來像人物設定，但有些來歷是有代價的。
  const bg = rng.pick(data.staffRoles.backgrounds ?? [{ id: 'BG_NONE', text: '', graftRisk: 0 }]);
  return {
    id: 'staff_' + state.meta.turn + '_' + role.id,
    name: makeName(data, rng, state.meta.year - rng.int(28, 55)),
    role: role.id, roleName: role.name,
    ability, loyalty: clamp05(rng.int(1, 3) + (p.attrs.sociability >= 3 ? 1 : 0)),
    ambition: rng.int(0, 5),
    salary: Math.round(role.baseSalary * tier.salaryMult * (0.8 + ability * 0.12) / 1000) * 1000,
    background: bg.id, backgroundText: bg.text,
    graftRisk: bg.graftRisk ?? 0, graftTaken: 0,
    knownSecrets: 0, tenure: 0,
  };
}

/**
 * 處理一件幕僚收贓款的案子。
 * 切割會讓剩下的人看著你，扛下來會讓你自己沾上。兩條路都要付錢。
 */
export function resolveGraft(state, data, mode) {
  const c = state.flags.graftCase;
  if (!c) return { msg: '' };
  const G = data.staffRoles.graft ?? {};
  const p = state.player;
  state.flags.graftCase = null;

  if (mode === 'fire') {
    fire(state, c.staffId, false);
    p.stigma = clamp05(p.stigma + (G.stigmaIfFired ?? 0.5));
    for (const t of state.team) t.loyalty = clamp05(t.loyalty - (G.loyaltyPenalty ?? 1));
    return { msg: `你在記者會上宣布已經解除${c.name}的職務並且會全力配合調查。當天下午辦公室裡沒有人講話，他們都在想同一件事：下一次會不會是自己。` };
  }
  if (mode === 'cover') {
    p.stigma = clamp05(p.stigma + (G.stigmaOnDiscovery ?? 1.2));
    state.flags.pendingScandalRisk = (state.flags.pendingScandalRisk ?? 0) + 0.25;
    return { msg: `你選擇把人留下來，對外的說法是尚未確定的事情不應該先定罪。這句話在法律上沒有錯，在新聞上完全沒有用。` };
  }
  // 主動送辦
  fire(state, c.staffId, false);
  p.integrity = clamp05(p.integrity + 0.6);
  p.stigma = clamp05(p.stigma + 0.2);
  state.finance.campaign -= Math.round(c.amount * 0.5);
  return { msg: `你自己把資料整理好送進地檢署，並且宣布這筆錢由服務處先行返還。這一步讓你少了一些錢，但那些原本要寫你的人，稿子改了方向。` };
}

export function hire(state, cand) {
  state.team.push({ ...cand });
  state.flags.recruitOffer = null;
  return true;
}
export function fire(state, id, asScapegoat = false) {
  const t = state.team.find((x) => x.id === id);
  if (!t) return false;
  state.team = state.team.filter((x) => x.id !== id);
  if (asScapegoat) {
    state.player.stigma = clamp05(state.player.stigma + 0.4);
    for (const o of state.team) o.loyalty = clamp05(o.loyalty - 1);
  }
  return true;
}
export function train(state, id, rng) {
  const t = state.team.find((x) => x.id === id);
  if (!t) return null;
  if (rng.bool(0.5) && t.ability < 5) { t.ability = clamp05(t.ability + 1); return 'ability'; }
  t.loyalty = clamp05(t.loyalty + 1);
  return 'loyalty';
}

/** 團隊效果彙總：所有系統查這裡 */
export function teamBonus(state, data, key) {
  let sum = 0;
  for (const t of state.team) {
    const r = data.byId.staffRole[t.role];
    const v = r?.effects?.[key];
    if (v != null) sum += v * (0.4 + t.ability * 0.16) * (t.loyalty >= 2 ? 1 : 0.5);
  }
  return sum;
}
export function witnessSecret(state) {
  for (const t of state.team) t.knownSecrets = (t.knownSecrets ?? 0) + 1;
}
