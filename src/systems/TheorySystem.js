// @ts-check
/**
 * 組織理論。
 * 政治人物的專業不是一條屬性，是他手上有沒有一套講得出來的東西。
 * 理論要花時間組織，可以在節目上引用、在選舉時當政見提出、在質詢時當論據，
 * 而且每講一次都會更圓熟——第十次講的版本，一定比第一次好。
 */
import { clamp, clamp05 } from '../core/Formula.js';
import { bumpCounter as bumpAttr } from './CanvassSystem.js';

export function held(state) { return state.theories ?? (state.theories = []); }
export function has(state, id) { return held(state).some((t) => t.id === id); }
export function get(state, id) { return held(state).find((t) => t.id === id); }

/** 目前正在組織的那一套 */
export function inProgress(state) { return state.flags.theoryWIP ?? null; }

/**
 * 花一次「組織理論」行動。
 * 沒有在研究的時候會挑一套開始，已經在研究就往前推進。
 */
export function research(state, data, rng, pickId = null) {
  const T = data.tuning?.theory ?? {};
  const need = T.researchTurnsPerLevel ?? 3;
  let wip = inProgress(state);

  if (!wip) {
    const pool = candidates(state, data);
    if (!pool.length) return { ok: false, msg: '該讀的你都讀過了。這一行的知識總有盡頭，剩下的要靠實務。' };
    const pick = pickId ? pool.find((t) => t.id === pickId) : rng.pick(pool);
    if (!pick) return { ok: false, msg: '以你現在的程度，還讀不進這一套。' };
    wip = state.flags.theoryWIP = { id: pick.id, progress: 0, need: need + pick.difficulty - 2 };
  }
  wip.progress += 1;
  const th = data.byId.theory[wip.id];

  if (wip.progress >= wip.need) {
    state.flags.theoryWIP = null;
    held(state).push({ id: wip.id, level: 1, uses: 0, learnedTurn: state.meta.turn });
    // 把想法整理成一套講得出來的東西，這件事本身就會改變你看問題的方式
    const milestone = bumpAttr(state, data, 'theory');
    return {
      ok: true, done: true, theory: th, milestone,
      msg: `你把《${th.name}》整理成一套講得出來的東西了。接下來只要有人肯聽，你就有話可說。`,
    };
  }
  return {
    ok: true, done: false, theory: th, progress: wip.progress, need: wip.need,
    msg: `《${th.name}》還在整理中，${wip.need - wip.progress} 次之後才成形。`,
  };
}

/** 現在讀得起的理論 */
export function candidates(state, data) {
  const p = state.player;
  return data.theories.theories.filter((t) => {
    if (has(state, t.id)) return false;
    if (state.flags.theoryWIP?.id === t.id) return false;
    return p.attrs.judgment >= Math.max(0, t.difficulty - 2);
  });
}

/**
 * 使用一套理論。每次使用都會讓它更完善，
 * 完善度直接加成引用時的效果。
 */
export function use(state, data, id) {
  const t = get(state, id);
  if (!t) return 0;
  const T = data.tuning?.theory ?? {};
  t.uses += 1;
  t.level = clamp05(t.level + (T.refinePerUse ?? 0.34));
  return t.level;
}

/** 引用理論在某個議題上的效果強度 */
export function citeBonus(state, data, id, field) {
  const t = get(state, id);
  if (!t) return 0;
  const th = data.byId.theory[id];
  const onTopic = th.field === field;
  return (0.6 + t.level * 0.5) * (onTopic ? 1.6 : 0.7);
}

/** 幕僚會帶自己的東西進來 */
export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const T = data.tuning?.theory ?? {};
  const news = [];
  const policyStaff = state.team.find((s) => s.role === 'policy');
  if (!policyStaff) return { news };
  if (!rng.bool((T.staffOfferChance ?? 0.18) * (policyStaff.ability / 5) * scaleMult)) return { news };

  const pool = data.theories.theories.filter((t) => !has(state, t.id));
  if (!pool.length) return { news };
  const th = rng.pick(pool);
  held(state).push({ id: th.id, level: 0.6, uses: 0, learnedTurn: state.meta.turn, fromStaff: policyStaff.name });
  news.push({
    kind: 'theory',
    text: `${policyStaff.name}把一份《${th.name}》的整理丟到你桌上，說這套東西你遲早用得到。`
      + `他寫得比你自己整理的粗一點，但省下的時間是實際的。`,
  });
  return { news };
}

/** 選舉時可提出的政見 */
export function platformOf(state, data) {
  return held(state).map((t) => ({ ...t, def: data.byId.theory[t.id] }))
    .sort((a, b) => b.level - a.level);
}
