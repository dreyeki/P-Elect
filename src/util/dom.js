// @ts-check
/** 極簡模板：html`` 產生字串，esc 保證跳脫。不使用 innerHTML 插入未跳脫資料。 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * html`` 只負責拼接，不做跳脫。
 * 跳脫一律由呼叫端用 esc() 明示——這樣「哪一段是使用者輸入」在程式碼上看得見，
 * 而不是靠一層隱形的魔法，日後改動時比較不會漏。
 */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    out += (Array.isArray(v) ? v.join('') : v == null ? '' : v) + strings[i + 1];
  }
  return out;
}
/** 保留給語意標示：這段已經是安全的 HTML */
export const raw = (s) => (s ?? '');

export function el(id) { return document.getElementById(id); }
export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/** 事件委派：一次綁定，靠 data-act 分派 */
export function delegate(root, selector, type, handler) {
  root.addEventListener(type, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}
