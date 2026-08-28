/**
 * 把整個專案打包成一個可以雙擊執行的 HTML 檔。
 *
 * 為什麼需要這個：瀏覽器基於安全考量，禁止 file:// 頁面用 ES Modules 與 fetch
 * 載入本機檔案。多檔版本必須透過 HTTP 服務才能跑。這個腳本把所有模組與資料
 * 內嵌進單一頁面，讓不想開伺服器的人也能直接玩。
 *
 * 用法：node tools/build-single.js
 * 產出：dist/選舉人生.html
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/* ── 收集所有模組 ── */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walk(SRC).sort();
const idOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/* ── 轉換：ES Modules → 一個極小的 CommonJS 風格註冊表 ── */
const IMPORT_NAMED = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm;
const IMPORT_STAR = /^import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/gm;
const IMPORT_BARE = /^import\s*['"]([^'"]+)['"];?/gm;
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let|var)\s+(\w+)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?/gm;

function resolve(fromAbs, spec) {
  if (!spec.startsWith('.')) throw new Error(`不支援外部模組：${spec}（於 ${idOf(fromAbs)}）`);
  return idOf(path.resolve(path.dirname(fromAbs), spec));
}

const deps = {};
const modules = [];

for (const abs of files) {
  const id = idOf(abs);
  let code = fs.readFileSync(abs, 'utf8');
  const exported = new Set();
  deps[id] = new Set();

  code = code.replace(IMPORT_NAMED, (_, names, spec) => {
    const target = resolve(abs, spec);
    deps[id].add(target);
    const binding = names.split(',').map((n) => {
      const [orig, alias] = n.split(/\s+as\s+/).map((x) => x.trim());
      return alias ? `${orig}: ${alias}` : orig;
    }).filter(Boolean).join(', ');
    return `const { ${binding} } = __req(${JSON.stringify(target)});`;
  });
  code = code.replace(IMPORT_STAR, (_, name, spec) => {
    const target = resolve(abs, spec);
    deps[id].add(target);
    return `const ${name} = __req(${JSON.stringify(target)});`;
  });
  code = code.replace(IMPORT_BARE, (_, spec) => {
    const target = resolve(abs, spec);
    deps[id].add(target);
    return `__req(${JSON.stringify(target)});`;
  });
  code = code.replace(EXPORT_DECL, (m, kind, name) => {
    exported.add(name);
    return m.replace(/^export\s+/, '');
  });
  code = code.replace(EXPORT_LIST, (_, names) => {
    for (const n of names.split(',')) {
      const [orig, alias] = n.split(/\s+as\s+/).map((x) => x.trim());
      if (orig) exported.add(alias || orig);
    }
    return '';
  });

  if (/^export\s/m.test(code)) {
    const bad = code.match(/^export\s.*/m)[0];
    throw new Error(`${id} 有無法處理的 export：${bad.slice(0, 60)}`);
  }
  if (/^import\s/m.test(code)) {
    throw new Error(`${id} 有無法處理的 import：${code.match(/^import\s.*/m)[0].slice(0, 60)}`);
  }

  const assign = exported.size
    ? `\nObject.assign(__x, { ${[...exported].join(', ')} });\n` : '\n';
  modules.push(
    `__m[${JSON.stringify(id)}] = function (__x, __req) {\n${code}${assign}};`
  );
}

/* ── 循環依賴檢查（末端賦值的做法遇到循環會拿到空的 exports） ── */
const cycles = [];
(function detect() {
  const state = {};
  const stack = [];
  const visit = (id) => {
    if (state[id] === 2) return;
    if (state[id] === 1) { cycles.push([...stack.slice(stack.indexOf(id)), id].join(' → ')); return; }
    state[id] = 1; stack.push(id);
    for (const d of deps[id] ?? []) visit(d);
    stack.pop(); state[id] = 2;
  };
  for (const id of Object.keys(deps)) visit(id);
})();
if (cycles.length) {
  console.log('! 發現循環依賴，單檔版可能出錯：');
  cycles.forEach((c) => console.log('   ' + c));
}

/* ── 內嵌資料 ── */
const dataFiles = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
  if (f.endsWith('.json')) dataFiles.push('data/' + f);
}
for (const f of fs.readdirSync(path.join(ROOT, 'data/events'))) {
  if (f.endsWith('.json')) dataFiles.push('data/events/' + f);
}
const dataObj = {};
for (const rel of dataFiles) dataObj[rel] = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/* ── 內嵌樣式 ── */
const css = ['reset', 'theme', 'layout', 'components']
  .map((n) => fs.readFileSync(path.join(ROOT, 'css', n + '.css'), 'utf8')).join('\n');

/* ── 取出 index.html 的 body 骨架 ── */
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const body = indexHtml.match(/<body>([\s\S]*?)<script>/)[1].trim();

const out = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1116">
<title>選舉人生：福爾摩沙</title>
<!-- 這是單檔版：所有程式與資料都在這個檔案裡，可以直接雙擊開啟。 -->
<style>
${css}
</style>
</head>
<body>
${body}
<script id="pe-data" type="application/json">${JSON.stringify(dataObj).replace(/</g, '\\u003c')}</script>
<script>
globalThis.__PE_DATA = JSON.parse(document.getElementById('pe-data').textContent);
(function () {
  const __m = {}, __c = {};
  function __req(id) {
    if (__c[id]) return __c[id];
    const f = __m[id];
    if (!f) throw new Error('找不到模組 ' + id);
    const x = (__c[id] = {});
    f(x, __req);
    return x;
  }
${modules.join('\n')}
  window.__peBooted = true;
  __req('src/main.js');
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const dest = path.join(ROOT, 'dist', '選舉人生.html');
fs.writeFileSync(dest, out);
console.log(`✓ ${files.length} 個模組、${dataFiles.length} 個資料檔、${css.length} 位元組的樣式`);
console.log(`✓ 產出 dist/選舉人生.html（${(Buffer.byteLength(out) / 1024 / 1024).toFixed(2)} MB）`);
console.log('  這個檔案可以直接雙擊開啟，不需要伺服器。');
