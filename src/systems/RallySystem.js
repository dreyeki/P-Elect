// @ts-check
/**
 * 造勢。
 *
 * 這是台灣選舉最貴、也最看得見的一件事。
 * 一場造勢由三個決定組成：場地、動員、講稿。
 * 場地決定容納上限與租金，動員決定實際到場人數，講稿決定他們回去以後會講什麼。
 *
 * 真正被評分的不是人數，是到場率——
 * 兩千人在路口空地是爆滿，兩千人在巨蛋是災難。
 * 空著一半的場子比不辦還糟，因為鏡頭一定會拍那一半。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import * as Theory from './TheorySystem.js';
import * as People from './PeopleSystem.js';
import { makePolitician } from './NameGen.js';

export function venues(data) { return data.rally?.venues ?? []; }
export function mobilizeOptions(data) { return data.rally?.mobilize ?? []; }
export function speechOptions(data) { return data.rally?.speech ?? []; }

/** 這個場地租不租得到 */
export function venueState(state, data, venueId) {
  const v = venues(data).find((x) => x.id === venueId);
  if (!v) return { ok: false, why: '沒有這個場地。' };
  if (state.player.fame < (v.minFame ?? 0)) {
    return { ok: false, why: '這種規模的場子，以你現在的知名度租下來只會空給別人看。' };
  }
  return { ok: true };
}

export function speechState(state, data, speechId) {
  const sp = speechOptions(data).find((x) => x.id === speechId);
  if (!sp) return { ok: false, why: '沒有這個選項。' };
  if (sp.needStaff && !state.team.length) return { ok: false, why: '你沒有幕僚可以幫你寫稿。' };
  if (sp.needTheory && !(state.theories ?? []).length) {
    return { ok: false, why: '你手上還沒有一套組織好的理論可以當骨架。' };
  }
  return { ok: true };
}

/** 這一場的預估開銷。玩家在按下去之前就該看到這個數字。 */
export function quote(state, data, plan) {
  const v = venues(data).find((x) => x.id === plan.venue);
  const mo = mobilizeOptions(data).find((x) => x.id === plan.mobilize);
  if (!v || !mo) return null;
  const target = Math.round(v.capacity * (mo.yield ?? 0.2));
  const mobCost = Math.round(target * (mo.costPerHead ?? 0));
  return {
    venueCost: v.cost, mobCost, total: v.cost + mobCost,
    capacity: v.capacity, target,
  };
}

/**
 * 辦一場。
 *
 * attendance = 場地容量 × 動員效率 × (0.5 + 基層/10) × (0.6 + 知名度/8) × 天氣
 * 每一項都是玩家自己養出來的：基層是跑攤跑出來的，知名度是上節目上出來的，
 * 動員效率是他願意花多少錢。只有天氣不是。
 */
export function run(state, data, plan, rng) {
  const T = data.rally?.tuning ?? {};
  const v = venues(data).find((x) => x.id === plan.venue);
  const mo = mobilizeOptions(data).find((x) => x.id === plan.mobilize);
  const sp = speechOptions(data).find((x) => x.id === plan.speech);
  if (!v || !mo || !sp) return { ok: false, msg: '這場造勢的規劃還沒有填完。' };

  const vs = venueState(state, data, plan.venue);
  if (!vs.ok) return { ok: false, msg: vs.why };
  const ss = speechState(state, data, plan.speech);
  if (!ss.ok) return { ok: false, msg: ss.why };

  const q = quote(state, data, plan);
  if (state.finance.campaign < q.total) {
    return { ok: false, msg: `這一場要 ${Math.round(q.total / 10000)} 萬，專戶裡不夠。造勢是選舉裡最誠實的一件事：沒有錢就是辦不起來。` };
  }

  const p = state.player;
  const home = state.districts[p.homeDistrict];
  const grass = home?.playerGrassroots ?? 0;
  const rain = rng.bool(v.rainRisk ?? 0);
  const weatherMult = rain ? (T.rainAttendanceMult ?? 0.55) : 1;

  let attendance = v.capacity
    * (mo.yield ?? 0.2)
    * (0.5 + grass * (T.grassrootsWeight ?? 0.1))
    * (0.6 + p.fame * (T.fameWeight ?? 0.125))
    * weatherMult
    * rng.range(0.85, 1.15);
  attendance = Math.max(0, Math.round(Math.min(attendance, v.capacity * 1.05)));
  const fillRate = attendance / v.capacity;

  const outcome = (data.rally?.outcomes ?? []).find((o) => fillRate >= o.min)
    ?? { q: -1, text: '這場造勢沒有辦成。' };

  /* 扣錢、扣體力 */
  state.finance.campaign -= q.total;
  p.fatigueRaw = clamp(p.fatigueRaw + (T.baseFatigue ?? 16) + (sp.fatigue ?? 0), 0, 120);

  /* 成績。到場率是唯一的度量，因為鏡頭拍的就是那個。 */
  const speechQ = sp.quality ?? 0;
  const eloq = p.attrs.eloquence / 5;
  const score = (fillRate - 0.5) * 2 + speechQ * 0.35 * (0.5 + eloq);

  p.fame = clamp05(p.fame + Math.max(0, score) * (T.fameGainPerFill ?? 0.55) * 0.5);
  p.favorNational = clampBi(p.favorNational + score * (T.favorGainPerFill ?? 0.5) * 0.3);
  if (home) {
    home.playerGrassroots = clamp05(home.playerGrassroots + Math.max(0, score) * (T.grassrootsPerFill ?? 0.25) * 0.4);
    home.playerFavor = clampBi(home.playerFavor + score * 0.3);
  }
  // 到場的人回去以後會跟別人講。熱情是這樣傳開的，也是這樣消失的。
  bumpEnthusiasm(state, data, score * (T.enthusiasmPerFill ?? 0.6) * 0.35);

  /* 動員手法的代價 */
  let stigmaText = '';
  if (mo.stigma > 0 && rng.bool(mo.stigma * 0.7)) {
    p.stigma = clamp05(p.stigma + mo.stigma * 0.5);
    stigmaText = mo.id === 'M_PAID'
      ? '有人拍到了發放車馬費的那張桌子，照片在當天晚上就傳了出去。'
      : mo.id === 'M_ASSOC'
        ? '幾位理事長在台下坐第一排，那個畫面在地方上的意思，跟在電視上的意思不一樣。'
        : '有記者算了一下停在外面的遊覽車數量，然後把那個數字寫進了報導裡。';
  }
  if (mo.id === 'M_ASSOC') {
    state.player.favorOwed = (state.player.favorOwed ?? 0) + 0.8;
  }

  /* 用理論當骨架的演說會把那套理論再打磨一次——
     一套講過的理論跟一套只寫在筆記本裡的理論，不是同一套東西。 */
  if (sp.needTheory) {
    const best = Theory.held(state).slice().sort((a, b) => b.level - a.level)[0];
    if (best) Theory.use(state, data, best.id);
  }

  state.flags.rallyCount = (state.flags.rallyCount ?? 0) + 1;
  state.flags.lastRallyTurn = state.meta.turn;

  return {
    ok: true,
    attendance, capacity: v.capacity, fillRate, rain,
    cost: q.total, venue: v, mobilize: mo, speech: sp,
    q: outcome.q, text: outcome.text,
    weatherText: rain ? data.rally?.weatherText?.rain : data.rally?.weatherText?.clear,
    stigmaText,
    mediaGain: (v.prestige ?? 0) * (T.mediaPerPrestige ?? 0.12) * Math.max(0, score),
  };
}

function bumpEnthusiasm(state, data, amount) {
  if (!amount) return;
  const P = state.pops;
  const di = data.districts.districts.findIndex((x) => x.id === state.player.homeDistrict);
  for (let i = 0; i < P.n; i++) {
    if (P.district[i] !== di) continue;
    P.enthusiasm[i] = clamp(P.enthusiasm[i] + amount, 0, 5);
  }
}

/* ─────────── 上級人物辦的造勢場 ─────────── */

/**
 * 台灣選舉最常見的畫面之一：大咖辦場子，底下站著一排要靠他抬轎的候選人。
 *
 * 對玩家來說這是一次免費的曝光——場地、動員、舞台全部是別人出的錢，
 * 他要付的只有一個行動點跟一段上台講話的時間。
 *
 * 代價藏在別的地方：站上那個台就是選邊，而且那個邊不是你選的。
 * 更現實的是**你只有三分鐘**，講得好會被剪成短影音，講不好也會。
 */
export function guestConfig(data) { return data.rally?.guestRally ?? null; }

/** 每回合擲一次：有沒有大咖找你去站台 */
export function rollGuestInvite(state, data, rng) {
  const G = guestConfig(data);
  if (!G || state.flags.guestRally) return null;
  const p = state.player;
  if (G.requiresParty && !p.party) return null;
  if (p.fame < (G.minFame ?? 1)) return null;
  // 選戰期間大咖的場子排得最密，平時偶爾也有
  const mult = state.meta.scale === 'week' ? 1 : 0.35;
  if (!rng.bool((G.chancePerWeek ?? 0.2) * mult)) return null;

  // 找得到多大的咖，看你自己有多大。沒有人會為了一個素人辦場子。
  const pool = G.hosts.filter((h) => h.minHostFame <= p.fame + 1.6);
  if (!pool.length) return null;
  const host = rng.weighted(pool, (h) => 1 / (1 + Math.abs(h.minHostFame - p.fame)));
  const person = People.pickAcquaintance(state, data, rng, { sameParty: true, minFame: 2 });

  state.flags.guestRally = {
    hostId: host.id,
    hostTitle: host.name,
    hostName: person?.name ?? makePolitician(data, rng, { party: p.party, fame: 4 }).name,
    scale: host.scale,
    invite: host.invite,
    risk: host.risk,
    expiresIn: G.expiresIn ?? 2,
  };
  return state.flags.guestRally;
}

/**
 * 上台講三分鐘。
 *
 * 四種講法的差別不是好壞，是**你把那三分鐘用在誰身上**：
 * 講場面話最安全也最浪費，吹捧主人換到的是他的人情，
 * 講自己的事會惹主人不高興但玩家自己有收穫，
 * 火力全開的聲量最大，代價是那個表情今天晚上會出現在每一台。
 */
export function attendGuestRally(state, data, speakId, rng) {
  const G = guestConfig(data);
  const inv = state.flags.guestRally;
  if (!G || !inv) return { ok: false, msg: '現在沒有人找你去站台。' };
  const sp = G.speak.find((x) => x.id === speakId);
  if (!sp) return { ok: false, msg: '沒有這個講法。' };

  const p = state.player;
  const home = state.districts[p.homeDistrict];
  // 講得好不好看口才與氣魄，風險高的講法要撐得住才有回報
  const skill = (p.attrs.eloquence / 5) * 0.6 + (p.attrs.boldness / 5) * 0.4;
  const roll = skill - sp.risk + rng.range(-0.25, 0.25);
  const q = roll > 0.35 ? 'great' : roll > -0.1 ? 'ok' : 'flop';
  const mult = q === 'great' ? 1.3 : q === 'ok' ? 0.85 : 0.35;
  const gain = sp.gain * inv.scale * mult;

  p.fame = clamp05(p.fame + gain * 0.16);
  p.favorNational = clampBi(p.favorNational + gain * 0.10);
  if (home) home.playerFavor = clampBi(home.playerFavor + gain * 0.22);
  if (sp.stigma && q !== 'great') p.stigma = clamp05(p.stigma + sp.stigma);

  // 主人的觀感。吹捧換人情，講自己的事會被記一筆。
  let hostLine = '';
  if (sp.favorHost) {
    p.partyPrestige = clamp05(p.partyPrestige + sp.favorHost * 0.25);
    hostLine = `${inv.hostTitle}在後台跟你多聊了兩句，那兩句話比台上那三分鐘有用。`;
  } else if (sp.hostAnnoy) {
    p.partyPrestige = clamp05(p.partyPrestige - sp.hostAnnoy * 0.18);
    hostLine = `${inv.hostTitle}沒有說什麼，但他的幕僚事後提醒你「下次照稿念比較好」。`;
  }

  state.flags.guestRally = null;
  state.flags.guestRallyCount = (state.flags.guestRallyCount ?? 0) + 1;
  return {
    ok: true, q, gain,
    hostTitle: inv.hostTitle, hostName: inv.hostName,
    msg: [sp.text, G.outcome[q], hostLine, inv.risk].filter(Boolean).join('\n\n'),
  };
}

export function declineGuestRally(state, data) {
  const G = guestConfig(data);
  if (!state.flags.guestRally) return { ok: false, msg: '現在沒有邀請。' };
  state.flags.guestRally = null;
  state.flags.guestRallyDeclined = (state.flags.guestRallyDeclined ?? 0) + 1;
  // 拒絕一次沒事，拒絕多了黨內會有人開始講話
  if (state.flags.guestRallyDeclined >= 2) {
    state.player.partyPrestige = clamp05(state.player.partyPrestige - 0.2);
  }
  return { ok: true, msg: G?.declineText ?? '你婉拒了。' };
}

/** 邀請會過期。大咖的場子不會等你。 */
export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const inv = state.flags.guestRally;
  if (inv) {
    inv.expiresIn -= 1;
    if (inv.expiresIn <= 0) state.flags.guestRally = null;
    return {};
  }
  rollGuestInvite(state, data, rng);
  return {};
}
