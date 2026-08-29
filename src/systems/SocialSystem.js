// @ts-check
/**
 * 社交平台。
 *
 * 追蹤數不等於知名度。有十萬追蹤但走在路上沒有人認得的政治人物非常多，
 * 反過來也有。所以這裡是一個獨立的數字，只有一部分會折算回知名度。
 *
 * 直播要氣魄三，因為留言區不會對你客氣；
 * 街頭宣講要氣魄四，因為你會站在一個沒有人有義務停下來的地方。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { bumpCounter } from './CanvassSystem.js';
import { citeBonus } from './TheorySystem.js';

export function init(state, data, rng) {
  const F = data.social.followers;
  const base = F.baseFromFame[Math.round(clamp(state.player.fame, 0, 5))] ?? 500;
  state.social = {
    followers: Math.round(base * rng.range(0.7, 1.3)),
    peak: 0,
    streams: 0,
    lastViral: 0,
  };
  state.social.peak = state.social.followers;
}

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  if (!state.social) return {};
  const F = data.social.followers;
  const s = state.social;
  const news = [];

  // 追蹤數會自己往知名度該有的水準靠，但靠得很慢
  const target = F.baseFromFame[Math.round(clamp(state.player.fame, 0, 5))] ?? 500;
  const drift = s.followers < target ? F.organicGrowth : -F.decayPerTurn;
  s.followers = Math.max(0, Math.round(s.followers * (1 + drift * scaleMult)));
  s.peak = Math.max(s.peak, s.followers);

  // 追蹤數大到一定程度，知名度會被它拉上去一部分
  const bonus = clamp(s.followers / F.toFameDivisor, 0, F.toFameMax);
  state.flags.followerFame = bonus;

  // 病毒事件
  const pool = data.social.viralEvents.filter((e) => s.followers >= (e.minFollowers ?? 0));
  if (pool.length && rng.bool((data.tuning?.social?.viralChance ?? 0.07) * scaleMult)) {
    const ev = rng.weighted(pool, (e) => e.weight);
    apply(state, ev.effect, s);
    news.push({ kind: 'society', text: ev.text });
    s.lastViral = state.meta.turn;
  }
  return { news };
}

function apply(state, e, s) {
  const p = state.player;
  if (e.followerMult) s.followers = Math.round(s.followers * e.followerMult);
  if (e.fame) p.fame = clamp05(p.fame + e.fame);
  if (e.stigma) p.stigma = clamp05(p.stigma + e.stigma);
  if (e.favorNational) p.favorNational = clampBi(p.favorNational + e.favorNational);
  if (e.grassroots) {
    const d = state.districts[p.homeDistrict];
    if (d) d.playerGrassroots = clamp05(d.playerGrassroots + e.grassroots);
  }
  if (e.enthusiasm) state.flags.enthusiasmBoost = (state.flags.enthusiasmBoost ?? 0) + e.enthusiasm;
}

/** 開一場直播 */
export function livestream(state, data, rng, theoryId) {
  const C = data.social.livestream;
  const a = state.player.attrs;
  if (a.boldness < C.requires.boldness) {
    return { ok: false, msg: '你在鏡頭前面撐不住三十分鐘的留言攻擊，這一點你自己最清楚。' };
  }
  let score = C.baseViewers + a.eloquence / 5 * C.eloquenceWeight
    + a.charisma / 5 * C.charismaWeight + a.boldness / 5 * C.boldnessWeight
    - state.player.fatigueRaw * C.fatiguePenalty;
  if (theoryId) score += citeBonus(state, data, theoryId, 'media') * C.theoryBonus;
  score += rng.normal(0, 0.11);

  const out = C.outcomes.find((o) => score >= o.min) ?? C.outcomes[C.outcomes.length - 1];
  apply(state, out, state.social);
  state.social.streams += 1;
  const milestone = bumpCounter(state, data, 'stream');
  return { ok: true, quality: out.q, text: out.text, score, milestone,
    followers: state.social.followers };
}

/** 街頭宣講 */
export function streetSpeech(state, data, rng, theoryId) {
  const C = data.social.streetSpeech;
  const a = state.player.attrs;
  if (a.boldness < C.requires.boldness) {
    return { ok: false, msg: '站在沒有人有義務停下來的地方講三十分鐘，你還沒有那個膽子。' };
  }
  const grass = state.districts[state.player.homeDistrict]?.playerGrassroots ?? 0;
  let score = a.eloquence / 5 * C.eloquenceWeight + a.boldness / 5 * C.boldnessWeight
    + grass / 5 * C.grassrootsWeight;
  if (theoryId) score += citeBonus(state, data, theoryId, 'media') * C.theoryBonus;
  score += rng.normal(0, 0.12);

  const out = C.outcomes.find((o) => score >= o.min) ?? C.outcomes[C.outcomes.length - 1];
  apply(state, out, state.social);
  return { ok: true, quality: out.q, text: out.text, score, followers: state.social.followers };
}
