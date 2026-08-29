// @ts-check
/**
 * 第一次做一件事的時候。
 *
 * 每個行動的前兩次都有專屬的文本。理由很簡單：
 * 第一次是「我不知道這件事長什麼樣子」，第二次是「我知道了，但我還很笨拙」——
 * 這兩種心情只會出現在最前面，第三次之後它就變成工作的一部分了。
 *
 * 變體由種子決定而不是當下的亂數：同一顆種子重開會拿到同一段，
 * 存檔要能重現，這一段也不例外。
 */
import { seedFromString } from '../core/Rng.js';

/**
 * 記一次行動，並在前兩次的時候回傳專屬文本。
 * 這個函式會改動計數器，所以每個行動只能叫一次——
 * 呼叫點固定在 CharacterSystem.spendAP，也就是行動點真的被扣掉的那一刻。
 */
export function take(state, data, actionId) {
  const pack = data.firstTimes?.actions?.[actionId];
  state.actionCount ??= {};
  const nth = (state.actionCount[actionId] = (state.actionCount[actionId] ?? 0) + 1);
  if (!pack) return null;
  const variants = pack[String(nth)];
  if (!Array.isArray(variants) || !variants.length) return null;

  // 用種子加上行動代號與次數決定選哪一段，不去動主亂數序列
  const h = seedFromString(`${state.meta.seedStr}|first|${actionId}|${nth}`);
  return {
    actionId, nth,
    name: pack.name ?? actionId,
    text: variants[h % variants.length],
  };
}

/**
 * 退回一次計數。
 * 有些行動會先扣行動點，發現做不成再退回去——
 * 那種情況不應該把「第一次」這段文本白白用掉。
 */
export function refund(state, actionId) {
  if (!state.actionCount?.[actionId]) return;
  state.actionCount[actionId] -= 1;
  if (state.flags?.pendingFirst?.actionId === actionId) state.flags.pendingFirst = null;
}

/** 這個行動做過幾次 */
export function countOf(state, actionId) {
  return state.actionCount?.[actionId] ?? 0;
}

/** 還有哪些行動一次都沒有做過。供「初來乍到」的提示使用。 */
export function untried(state, data, actionIds) {
  return actionIds.filter((id) => !countOf(state, id));
}
