// @ts-check
/**
 * 事件 trigger 的受限表達式求值器。不使用 eval。
 * 支援：屬性存取、數字、字串、比較、&& ||、括號、in [..]、!
 */
const TOKEN = /\s*(&&|\|\||>=|<=|==|!=|[<>!()]|\[|\]|,|'[^']*'|"[^"]*"|[A-Za-z_$][\w$.]*|-?\d+(?:\.\d+)?)/y;

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) { if (/^\s+$/.test(src.slice(i))) break; throw new Error('無法解析：' + src.slice(i, i + 20)); }
    out.push(m[1]); i = TOKEN.lastIndex;
  }
  return out;
}

export function compile(src) {
  if (!src || !String(src).trim()) return () => true;
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { if (toks[p] !== t) throw new Error('預期 ' + t + ' 但得到 ' + toks[p]); p++; };

  function parseOr() {
    let l = parseAnd();
    while (peek() === '||') { p++; const r = parseAnd(); const a = l, b = r; l = (c) => a(c) || b(c); }
    return l;
  }
  function parseAnd() {
    let l = parseCmp();
    while (peek() === '&&') { p++; const r = parseCmp(); const a = l, b = r; l = (c) => a(c) && b(c); }
    return l;
  }
  function parseCmp() {
    const l = parseUnary();
    const op = peek();
    if (['>', '<', '>=', '<=', '==', '!='].includes(op)) {
      p++; const r = parseUnary();
      switch (op) {
        case '>': return (c) => num(l(c)) > num(r(c));
        case '<': return (c) => num(l(c)) < num(r(c));
        case '>=': return (c) => num(l(c)) >= num(r(c));
        case '<=': return (c) => num(l(c)) <= num(r(c));
        case '==': return (c) => l(c) == r(c);
        case '!=': return (c) => l(c) != r(c);
      }
    }
    if (op === 'in') {
      p++; eat('[');
      const items = [];
      while (peek() !== ']') { items.push(parseUnary()); if (peek() === ',') p++; }
      eat(']');
      return (c) => { const v = l(c); return items.some((f) => f(c) == v); };
    }
    return l;
  }
  function parseUnary() {
    if (peek() === '!') { p++; const e = parseUnary(); return (c) => !e(c); }
    return parseAtom();
  }
  function parseAtom() {
    const t = toks[p];
    if (t === '(') { p++; const e = parseOr(); eat(')'); return e; }
    p++;
    if (t === undefined) throw new Error('表達式提前結束');
    if (/^-?\d/.test(t)) { const n = parseFloat(t); return () => n; }
    if (/^['"]/.test(t)) { const s = t.slice(1, -1); return () => s; }
    if (t === 'true') return () => true;
    if (t === 'false') return () => false;
    const path = t.split('.');
    return (c) => { let v = c; for (const seg of path) { if (v == null) return undefined; v = v[seg]; } return v; };
  }
  const num = (v) => (typeof v === 'number' ? v : v == null ? NaN : Number(v));
  const fn = parseOr();
  return (ctx) => { try { return !!fn(ctx); } catch { return false; } };
}

const cache = new Map();
export function evalTrigger(src, ctx) {
  if (!cache.has(src)) {
    try { cache.set(src, compile(src)); }
    catch (e) { console.warn('[expr] 無法編譯：', src, e.message); cache.set(src, () => false); }
  }
  return cache.get(src)(ctx);
}
