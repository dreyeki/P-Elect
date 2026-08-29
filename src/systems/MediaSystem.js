// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { nationalSupport } from './PopSystem.js';

export function tick(state, ctx) {
  const { data, scaleMult, rng } = ctx;
  // 議題熱度自然衰減
  for (const iss of data.issues.issues) {
    state.issues[iss.id] = clamp05(state.issues[iss.id] - iss.decay * scaleMult);
  }
  // 媒體立場更新
  const support = nationalSupport(state, data);
  const rulingParty = state.central.government.presidentParty;
  const rulingBias = biasOfParty(state, rulingParty);
  let loudest = null, loudestV = -1;
  for (const pid in support) if (support[pid] > loudestV) { loudestV = support[pid]; loudest = pid; }

  for (const m of Object.values(state.media)) {
    if (m.biasMode === 'government') {
      m.bias = clampBi(m.bias + (rulingBias - m.bias) * 0.08 * scaleMult);
      m.credibility = clamp05(m.credibility - 0.004 * scaleMult);
    } else if (m.biasMode === 'follower') {
      m.bias = clampBi(m.bias + (biasOfParty(state, loudest) - m.bias) * 0.06 * scaleMult);
    }
    m.playerRelation = clampBi(m.playerRelation * (1 - 0.01 * scaleMult));
  }

  // 媒體框架：影響 POP 意識形態漂移
  const frame = {};
  let reachSum = 0;
  for (const m of Object.values(state.media)) {
    const w = m.reach * m.credibility;
    reachSum += w;
    frame.unification = (frame.unification ?? 0) + m.bias * 0.5 * w;
    frame.progressivism = (frame.progressivism ?? 0) - m.bias * 0.3 * w;
    frame.marketFreedom = (frame.marketFreedom ?? 0) + m.bias * 0.2 * w;
  }
  for (const k in frame) frame[k] = clampBi(frame[k] / Math.max(1, reachSum));
  state.flags.mediaFrame = frame;

  // 媒體攻擊：越知名越容易被盯上
  const atk = rollAttack(state, ctx);

  // 民調
  state.flags.approval = approval(state, data, rng);
  return { news: atk.news };
}

/**
 * 媒體攻擊。
 *
 * 這不是意外，是這一行的常態：站得越高，願意花人力查你的媒體就越多。
 * 退出兩大黨的人會被該黨親近的媒體同時圍剿，那一波的強度是平常的兩倍多，
 * 而且會持續好幾個回合——媒體不會因為你解釋過一次就放過你。
 */
export function rollAttack(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const M = data.reactions?.mediaAttack;
  if (!M) return { news: [] };
  const p = state.player;
  const news = [];

  const boltUntil = state.flags.boltAttackUntil ?? 0;
  const bolting = state.meta.turn <= boltUntil;
  let chance = (M.baseChance + p.fame * M.famePerLevel + p.stigma * M.stigmaPerLevel) * scaleMult;
  if (bolting) chance *= M.boltMultiplier;
  if (p.image) chance *= M.imageBackfireMult;
  if (state.flags.scandalShield > 0) chance *= 1 - M.shieldReduction;
  if (!rng.bool(clamp(chance, 0, 0.6))) return { news };

  const pool = data.reactions.events.filter((e) => {
    if (e.requiresBolt && !bolting) return false;
    if (e.requiresImage && !p.image) return false;
    if (e.minFame != null && p.fame < e.minFame) return false;
    return true;
  });
  if (!pool.length) return { news };
  const ev = rng.weighted(pool, (e) => e.weight);

  // 挑一家對你最不友善的媒體來當發動者
  const media = Object.values(state.media).sort((a, b) =>
    (a.playerRelation - b.playerRelation) || (b.reach - a.reach));
  const m1 = media[0], m2 = media[1] ?? m1;

  state.mediaAttack = {
    id: ev.id,
    headline: ev.headline.replace('{media}', m1?.name ?? '一家電視台').replace('{media2}', m2?.name ?? '另一家報紙'),
    body: ev.body.replace('{media}', m1?.name ?? '一家電視台').replace('{media2}', m2?.name ?? '另一家報紙'),
    effects: ev.effects,
    mediaId: m1?.id ?? null,
    turn: state.meta.turn,
  };
  news.push({ kind: 'scandal', text: state.mediaAttack.headline + '。' });
  return { news };
}

/** 玩家對媒體攻擊的回應 */
export function respondAttack(state, data, responseId, rng) {
  const atk = state.mediaAttack;
  if (!atk) return { msg: '' };
  const R = data.reactions.responses.find((x) => x.id === responseId);
  if (!R) return { msg: '' };
  const p = state.player;
  const e = R.effects;

  // 先吃下攻擊本身的傷害，回應只能減輕不能免除
  const base = atk.effects ?? {};
  if (base.stigma) p.stigma = clamp05(p.stigma + base.stigma);
  if (base.fame) p.fame = clamp05(p.fame + base.fame);
  if (base.favorNational) p.favorNational = clampBi(p.favorNational + base.favorNational);
  if (base.fatigue) p.fatigueRaw = clamp(p.fatigueRaw + base.fatigue, 0, 120);
  if (base.imageDamage) state.flags.imageDamage = (state.flags.imageDamage ?? 0) + base.imageDamage;
  if (base.pollDistrust) state.flags.pollDistrust = (state.flags.pollDistrust ?? 0) + base.pollDistrust;

  if (e.stigmaReduce) p.stigma = clamp05(p.stigma - e.stigmaReduce);
  if (e.fame) p.fame = clamp05(p.fame + e.fame);
  if (e.stigma) p.stigma = clamp05(p.stigma + e.stigma);
  if (e.fatigue) p.fatigueRaw = clamp(p.fatigueRaw + e.fatigue, 0, 120);
  if (e.campaignFunds) state.finance.campaign += e.campaignFunds;
  if (e.favorNational) p.favorNational = clampBi(p.favorNational + e.favorNational);
  if (e.enthusiasm) state.flags.enthusiasmBoost = (state.flags.enthusiasmBoost ?? 0) + e.enthusiasm;
  if (e.mediaRelation && atk.mediaId && state.media[atk.mediaId]) {
    state.media[atk.mediaId].playerRelation = clampBi(state.media[atk.mediaId].playerRelation + e.mediaRelation);
  }
  if (e.favorCost) {
    const who = Object.values(state.people ?? {}).filter((x) => x.favor > 0).sort((a, b) => b.favor - a.favor)[0];
    if (who) who.favor = Math.max(0, who.favor - e.favorCost);
  }

  const msgs = {
    RESP_CLARIFY: '你把資料一頁一頁攤在桌上講了四十分鐘。願意聽完的記者不多，但至少留下了完整的紀錄。',
    RESP_LEGAL: '律師函發出去了，對方在晚間新聞裡把那封信也一起播了出來。',
    RESP_IGNORE: '你什麼都沒有說。這則新聞在第三天自己消失了，跟著消失的還有一點點你原本有的東西。',
    RESP_COUNTER: '你反過來質疑對方的金主，同溫層很滿意。中間選民看到的是兩個人在互相潑水。',
    RESP_FRIENDLY: '隔天有另一個版本出現在別家的版面上。這通電話你欠了誰，只有你自己知道。',
  };
  state.mediaAttack = null;
  return { msg: msgs[responseId] ?? '' };
}

/** 脫黨之後被兩大黨親近媒體同時圍剿的那一段時間 */
export function startBoltBacklash(state, data) {
  const M = data.reactions?.mediaAttack;
  state.flags.boltAttackUntil = state.meta.turn + (M?.boltDurationTurns ?? 10);
  for (const m of Object.values(state.media)) {
    m.playerRelation = clampBi(m.playerRelation - 1.2);
  }
}

function biasOfParty(state, pid) {
  const p = state.parties[pid];
  if (!p) return 0;
  return clampBi(p.platform.unification * 1.1);
}

export function approval(state, data, rng) {
  const P = state.pops;
  let favSum = 0, w = 0;
  for (let i = 0; i < P.n; i++) { favSum += ((P.playerFavor[i] + 5) / 10) * P.size[i]; w += P.size[i]; }
  const favTerm = favSum / Math.max(1, w);
  const solTrend = clamp((state.flags.solTrend ?? 0) * 40 + 0.5, 0, 1);
  const p = state.player;
  const image = clamp((p.integrity - p.stigma * 1.5 + 5) / 10, 0, 1);
  const mediaNet = clamp((Object.values(state.media)
    .reduce((a, m) => a + m.playerRelation * m.reach, 0) / 60 + 0.5), 0, 1);
  const issueFit = 0.5;
  const base = 0.32 * favTerm + 0.24 * solTrend + 0.20 * issueFit + 0.12 * image + 0.12 * mediaNet;
  return clamp(base * 100 + (rng ? rng.normal(0, 1.6) : 0), 3, 95);
}

/** 依媒體立場產生同一則新聞的不同標題 */
export function frameHeadline(state, data, baseText, subjectBias = 0) {
  const out = [];
  for (const m of Object.values(state.media)) {
    if (m.reach < 3) continue;
    const align = -Math.abs(m.bias - subjectBias) / 10 + 0.5;
    out.push({ media: m.name, tone: align > 0.4 ? 'friendly' : 'hostile', text: baseText });
  }
  return out;
}

export function pressConference(state, data, issueId, rng) {
  const p = state.player;
  const roll = p.attrs.eloquence * 10 + p.attrs.charisma * 6 + p.fame * 5 + rng.range(-15, 15);
  const gain = clamp(roll / 40, 0.3, 2.2);
  state.issues[issueId] = clamp05(state.issues[issueId] + gain);
  p.fame = clamp05(p.fame + gain * 0.12);
  for (const m of Object.values(state.media)) {
    m.playerRelation = clampBi(m.playerRelation + (roll > 40 ? 0.2 : -0.05));
  }
  return {
    gain,
    text: roll > 55
      ? `你把議題設定得很成功，晚間新聞有三台把你的說法放在開頭，接下來幾天大家談的都是這件事。`
      : roll > 25
        ? `記者會平順地結束，該講的都講了，版面不大但方向是對的。`
        : `到場的記者比預期少，提問也集中在別的事情上，這場記者會等於白開了。`,
  };
}
