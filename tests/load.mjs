import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.document = { getElementById: () => ({ style: {}, innerHTML: '', dataset: {}, hidden: false, scrollTop: 0, addEventListener() {} }), createElement: () => ({ click() {}, style: {} }), body: { addEventListener() {}, appendChild() {} }, documentElement: { dataset: {} } };
globalThis.window = { scrollTo() {} };
const mods = [];
for (const dir of ['core','systems','util','ui','ui/pages','data','save']) {
  for (const f of fs.readdirSync(path.join(ROOT, 'src', dir))) {
    if (f.endsWith('.js')) mods.push(`../src/${dir}/${f}`);
  }
}
let bad = 0;
for (const m of mods) {
  try { await import(m); } catch (e) { bad++; console.log('FAIL', m, '→', e.message); }
}
console.log(bad ? `${bad} 個模組載入失敗` : `全部 ${mods.length} 個模組載入成功`);
