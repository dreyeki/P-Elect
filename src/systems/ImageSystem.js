// @ts-check
/**
 * 主打形象。
 * 選民記住一個政治人物，靠的不是六個屬性，是一句話。
 * 形象會放大特定族群的好感，也會放大對應的反噬——
 * 打清廉的人沾上一次汙名，跌得比誰都重。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';

export function current(state, data) {
  const id = state.player.image;
  return id ? data.playerImages[id] : null;
}

/**
 * 形象還能撐多久。
 *
 * 一句話要立起來需要兩年，兩年之內反覆換只會讓人覺得你沒有中心思想。
 * 所以主打形象這個行動兩年才開一次：沒有形象的時候隨時可以決定，
 * 立了以後就要等到期。到期之後續打同一個不用錢，改打別的才要。
 */
export function reviewMonths(data) { return data.images?.reviewMonths ?? 24; }

export function monthsSinceSet(state) {
  if (!state.player.image) return Infinity;
  return state.meta.turn - (state.player.imageSince ?? state.meta.turn);
}
export function monthsUntilReview(state, data) {
  if (!state.player.image) return 0;
  return Math.max(0, reviewMonths(data) - monthsSinceSet(state));
}
export function canSet(state, data) {
  return !state.player.image || monthsUntilReview(state, data) <= 0;
}

export function available(state, data) {
  const p = state.player;
  const age = state.meta.year - p.birthYear;
  return data.images.playerImages.map((img) => {
    const r = img.requires ?? {};
    const why = [];
    if (r.integrity != null && p.integrity < r.integrity) why.push(`清廉印象要到「${wordAt(data, 'integrity', r.integrity)}」`);
    if (r.stigmaMax != null && p.stigma > r.stigmaMax) why.push('汙名印象已經太高了');
    if (r.judgment != null && p.attrs.judgment < r.judgment) why.push(`判斷要到「${wordAt(data, 'judgment', r.judgment)}」`);
    if (r.boldness != null && p.attrs.boldness < r.boldness) why.push(`氣魄要到「${wordAt(data, 'boldness', r.boldness)}」`);
    if (r.ageMax != null && age > r.ageMax) why.push(`過了 ${r.ageMax} 歲就不適合再打這個`);
    return { img, ok: why.length === 0, why: why.join('、') };
  });
}
function wordAt(data, scale, n) { return data.scales.linear[scale]?.[n] ?? String(n); }

export function adopt(state, data, imageId) {
  const entry = available(state, data).find((x) => x.img.id === imageId);
  if (!entry) return { ok: false, msg: '沒有這個形象。' };
  if (!entry.ok) return { ok: false, msg: entry.why + '，現在打這個沒有人會信。' };
  const cost = data.images.switchCost ?? {};
  const first = !state.player.image;
  const renew = !first && state.player.image === imageId;
  // 續打同一個形象不用付政治資本。你什麼都沒有改，
  // 只是又站上去把同一句話再講一次，這件事本來就不該收錢。
  if (!first && !renew) {
    if (state.player.politicalCapital < (cost.politicalCapital ?? 80)) {
      return { ok: false, msg: '換形象要重新溝通、重新投放、重新說服，政治資本不夠。' };
    }
    state.player.politicalCapital -= cost.politicalCapital ?? 80;
    state.player.favorNational = clampBi(state.player.favorNational - (cost.favorPenalty ?? 0.6));
    state.player.imageSwitches = (state.player.imageSwitches ?? 0) + 1;
  }
  const wasSince = state.player.imageSince ?? state.meta.turn;
  state.player.image = imageId;
  // 續打的時候不把年資歸零，形象的成熟度是連續累積的
  state.player.imageSince = renew ? wasSince : state.meta.turn;
  state.player.imageReviewedAt = state.meta.turn;
  return {
    ok: true,
    renew,
    msg: first
      ? `從今天起，你就是那個講「${entry.img.slogan}」的人。`
      : renew
        ? `你決定繼續打同一句話。第三年再講一次的時候，聽起來會跟第一年不一樣。`
        : `你換了主打形象。原本相信你的那些人會有一段時間覺得陌生，這是要付的代價。`,
  };
}

/** 每回合把形象的效果施加到 POP 上 */
export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  const imgId = state.player.image;
  if (!imgId) return {};
  const img = data.images.playerImages.find((x) => x.id === imgId);
  if (!img) return {};

  const P = state.pops;
  const tenure = state.meta.turn - (state.player.imageSince ?? state.meta.turn);
  // 形象要時間長出來，掛上去的第一年效果很淡
  const maturity = clamp(tenure / 24, 0.2, 1);
  const strength = 0.02 * maturity * scaleMult;

  for (let i = 0; i < P.n; i++) {
    const sid = data.strataIds[P.stratum[i]];
    const w = (img.strata?.[sid] ?? img.strata?._all ?? 1) - 1;
    if (Math.abs(w) < 0.01) continue;
    P.playerFavor[i] = clampBi(P.playerFavor[i] + w * strength);
  }
  // 形象也會慢慢把國家價值觀往那個方向推
  for (const ax in img.axis ?? {}) {
    state.modifiers.add({
      id: 'image:' + ax, source: 'image', label: img.name,
      target: `value.${ax}`, op: 'add', value: img.axis[ax] * 0.25 * maturity,
      duration: 3, startTurn: state.meta.turn,
    });
  }
  return {};
}

/** 反噬倍率：某類負面事件對主打這個形象的人特別傷 */
export function backfireMult(state, data, kind) {
  const imgId = state.player.image;
  if (!imgId) return 1;
  const img = data.images.playerImages.find((x) => x.id === imgId);
  const b = img?.backfire;
  if (!b) return 1;
  const key = 'on' + kind[0].toUpperCase() + kind.slice(1);
  return b[key] ?? 1;
}
export function backfireText(state, data) {
  const img = data.images.playerImages.find((x) => x.id === state.player.image);
  return img?.backfire?.text ?? '';
}

/** 選舉時的個人因素加成 */
export function electionBonus(state, data, stratumId) {
  const img = data.images.playerImages.find((x) => x.id === state.player.image);
  if (!img) return 0;
  const tenure = state.meta.turn - (state.player.imageSince ?? state.meta.turn);
  const maturity = clamp(tenure / 24, 0.2, 1);
  const w = (img.strata?.[stratumId] ?? img.strata?._all ?? 1) - 1;
  return w * 0.06 * maturity - (img.moderatePenalty ?? 0) * 0.5;
}

/** 政黨的主打形象 */
export function partyImageOf(state, data, partyId) {
  const p = state.parties[partyId];
  if (!p?.image) return null;
  return data.images.partyImages.find((x) => x.id === p.image) ?? null;
}
