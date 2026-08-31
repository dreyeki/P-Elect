// v0.6.3：開局家底的規模與組成、變現的摩擦
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
globalThis.btoa = (x) => Buffer.from(x, 'binary').toString('base64');
globalThis.atob = (x) => Buffer.from(x, 'base64').toString('binary');

const { loadData } = await import('../src/data/loader.js');
const { createGame, wealthAt } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales } = await import('../src/util/scale.js');
const A = await import('../src/systems/AssetSystem.js');
const F = await import('../src/util/format.js');
const SaveMgr = await import('../src/save/SaveManager.js');

const data = await loadData(); initScales(data.scales); SaveMgr.setData(data);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (startId, backgroundId, age, over = {}) => createGame(data, {
  seedStr: 'V063', name: '龍天台', gender: 'm', education: '大學', age,
  startId, backgroundId, homeDistrict: 'KHH-01', party: 'PDA', ideology: {}, china: {},
  baseAttrs: { stamina: 1, sociability: 1, charisma: 1, eloquence: 1, judgment: 1, boldness: 1 },
  ...over,
});
const inherited = (g) => g.assets.holdings.filter((h) => h.inherited);

/* ── 1. 家底翻上去了 ── */
console.log('\n── 家底的規模 ──');
const bg = (id) => data.backgrounds.backgrounds.find((b) => b.id === id).wealth;
ok(wealthAt(bg('doctor'), 45) > 40000000,
  `四十五歲的醫師存款 ${F.money(wealthAt(bg('doctor'), 45))}——舊版只有一千六百萬，那不是台灣的樣子`);
ok(wealthAt(bg('lawyer'), 45) > 25000000, `四十五歲的律師 ${F.money(wealthAt(bg('lawyer'), 45))}`);
ok(wealthAt(bg('reporter'), 45) > 8000000, `四十五歲的記者 ${F.money(wealthAt(bg('reporter'), 45))}`);
// 三倍是這一版的下限
const OLD = { doctor: 16050000, lawyer: 8820000, reporter: 2920000 };
for (const [id, before] of Object.entries(OLD)) {
  const now = wealthAt(bg(id), 45);
  ok(now >= before * 3,
    `${data.backgrounds.backgrounds.find((b) => b.id === id).name}翻了 ${(now / before).toFixed(1)} 倍（${F.money(before)} → ${F.money(now)}）`);
}
// 曲線還是往上彎的
for (const id of ['doctor', 'lawyer', 'reporter']) {
  const w = bg(id);
  ok(wealthAt(w, 55) - wealthAt(w, 45) > wealthAt(w, 45) - wealthAt(w, 35),
    `${id} 後十年存的比前十年多，二次函數的形狀沒有跑掉`);
}

/* ── 2. 家底有組成 ── */
console.log('\n── 家底的組成 ──');
const scion = mk('scion', 'reporter', 35);
const tycoon = mk('tycoon', 'doctor', 50);
const mp = mk('listMP', 'lawyer', 45);
const rookie = mk('rookie', 'reporter', 35);

ok(inherited(rookie).length === 0, '素人名下沒有任何家產，他只有自己存的那點錢');
ok(inherited(scion).some((h) => h.kind === 'land'),
  `政二代名下有土地：${inherited(scion).filter((h) => h.kind === 'land').map((h) => h.name).join('、')}`);
ok(inherited(tycoon).some((h) => h.founderStake),
  `企業家名下有自家公司的創辦人持股 ${F.money(inherited(tycoon).find((h) => h.founderStake).value)}`);
ok(inherited(mp).some((h) => h.kind === 'stock' && !h.founderStake),
  '不分區立委名下是多年累積的股票部位，不是公司控制權');

// 使用者的重點：企業家的家底要含股票、政二代要有很多土地
const stake = inherited(tycoon).find((h) => h.founderStake);
ok(stake.value > 1000000000, `創辦人持股 ${F.money(stake.value)}——他自己的介紹寫的是千億企業創辦人，家底要對得起那句話`);
ok(stake.value / A.netWorth(tycoon) > 0.5,
  `而且那些持股佔他身家的 ${(stake.value / A.netWorth(tycoon) * 100).toFixed(0)}%，是絕對的大宗`);
const land = inherited(scion).filter((h) => h.kind === 'land' || h.kind === 'realty');
const landSum = land.reduce((a, h) => a + h.value, 0);
ok(landSum > 150000000, `政二代的土地與房產合計 ${F.money(landSum)}`);
ok(landSum / A.netWorth(scion) > 0.6,
  `佔他身家的 ${(landSum / A.netWorth(scion) * 100).toFixed(0)}%——三代人買下來的地才是政治世家真正的底氣`);

// 淨資產的量級
console.log('');
for (const [label, g] of [['政治素人', rookie], ['不分區立委', mp], ['政二代', scion], ['知名企業家', tycoon]]) {
  console.log(`     ${label.padEnd(6)} 現金 ${F.money(g.finance.personal).padStart(11)}　淨資產 ${F.money(A.netWorth(g))}`);
}
ok(A.netWorth(tycoon) > A.netWorth(scion) && A.netWorth(scion) > A.netWorth(mp) && A.netWorth(mp) > A.netWorth(rookie),
  '四種起點的身家有清楚的量級差');

/* ── 3. 有錢跟花得出去是兩件事 ── */
console.log('\n── 變現的摩擦 ──');
ok(tycoon.finance.personal < A.netWorth(tycoon) * 0.25,
  `企業家能直接花的現金只佔身家的 ${(tycoon.finance.personal / A.netWorth(tycoon) * 100).toFixed(0)}%——其餘要用得先賣`);
ok(scion.finance.personal < A.netWorth(scion) * 0.25,
  `政二代能直接花的只佔 ${(scion.finance.personal / A.netWorth(scion) * 100).toFixed(0)}%——那些地平常一毛錢都變不出來`);

// 賣土地：稅很重
let g = mk('scion', 'reporter', 35);
let lot = inherited(g).find((h) => h.kind === 'land');
let book = lot.value, cash0 = g.finance.personal, stig0 = g.player.stigma;
let r = A.sell(g, data, lot.id, 1);
ok(r.ok && (g.finance.personal - cash0) < book * 0.75,
  `帳面 ${F.money(book)} 的土地全部出清只拿到 ${F.money(g.finance.personal - cash0)}——土地增值稅三成不是開玩笑的`);
ok(g.player.stigma > stig0, `而且會留下汙名（${stig0.toFixed(2)} → ${g.player.stigma.toFixed(2)}）：政治人物賣祖產是會被寫的`);
ok(r.msg.includes('稅'), '結果會直接告訴玩家稅繳掉多少');

// 賣股票：稅很輕
g = mk('listMP', 'lawyer', 45);
let port = inherited(g).find((h) => h.kind === 'stock');
book = port.value; cash0 = g.finance.personal; stig0 = g.player.stigma;
A.sell(g, data, port.id, 1);
ok((g.finance.personal - cash0) > book * 0.9,
  `同樣是全部出清，股票拿得回 ${((g.finance.personal - cash0) / book * 100).toFixed(0)}%——證交稅只有千分之三`);
ok(g.player.stigma === stig0, '賣自己的股票不會留下汙名');

// 一般的家產分批賣比一次丟划算：急著脫手就要讓價
const partial = mk('scion', 'reporter', 40);
const whole = mk('scion', 'reporter', 40);
const pid = inherited(partial).find((h) => h.kind === 'land').id;
const wid = inherited(whole).find((h) => h.kind === 'land').id;
const pStart = partial.finance.personal, wStart = whole.finance.personal;
for (let i = 0; i < 4; i++) {
  const h = partial.assets.holdings.find((x) => x.id === pid);
  if (h) A.sell(partial, data, pid, 0.25 / (1 - 0.25 * i));
}
A.sell(whole, data, wid, 1);
ok((partial.finance.personal - pStart) > (whole.finance.personal - wStart),
  `土地分四次賣拿到 ${F.money(partial.finance.personal - pStart)}，一次全丟只拿到 ${F.money(whole.finance.personal - wStart)}——想賣好價錢的人不會一次全丟出來`);

// 創辦人持股反過來：每一次減碼都是一次獨立的訊號，分批賣不會比較好看
const fPartial = mk('tycoon', 'doctor', 50);
const fWhole = mk('tycoon', 'doctor', 50);
const fp = inherited(fPartial).find((h) => h.founderStake).id;
const fw = inherited(fWhole).find((h) => h.founderStake).id;
const fpStart = fPartial.finance.personal, fwStart = fWhole.finance.personal;
for (let i = 0; i < 4; i++) {
  const h = fPartial.assets.holdings.find((x) => x.id === fp);
  if (h) A.sell(fPartial, data, fp, 0.25 / (1 - 0.25 * i));
}
A.sell(fWhole, data, fw, 1);
ok((fPartial.finance.personal - fpStart) < (fWhole.finance.personal - fwStart) * 1.02,
  `但創辦人持股分四次賣只拿到 ${F.money(fPartial.finance.personal - fpStart)}，不比一次出清的 ${F.money(fWhole.finance.personal - fwStart)} 好——每一次減碼都是一次獨立的訊號`);

// 創辦人減碼會讓剩下的縮水
g = mk('tycoon', 'doctor', 50);
let st = inherited(g).find((h) => h.founderStake);
const before = st.value;
r = A.sell(g, data, st.id, 0.2);
const left = g.assets.holdings.find((h) => h.founderStake);
ok(left && left.value < before * 0.8 * 0.95,
  `賣掉兩成之後，剩下的八成又縮水到 ${F.money(left.value)}——市場把減碼解讀成一個訊號`);
ok(r.msg.includes('創辦人減碼') || r.msg.includes('縮水'), '而且會講清楚為什麼');

/* ── 3b. 房子的敘述要對得起身分 ── */
console.log('\n── 自用住宅 ──');
const houses = {};
for (const [id, age] of [['rookie', 35], ['scion', 35], ['listMP', 45], ['tycoon', 50]]) {
  houses[id] = mk(id, 'reporter', age).assets.house;
}
ok(houses.rookie.mortgage > 0 && houses.tycoon.mortgage === 0,
  '素人揹房貸，企業家不用——「父母幫忙付了頭期款」那句話寫給二十二億身家的人很荒謬');
ok(houses.tycoon.value > houses.rookie.value * 5,
  `企業家的房子 ${F.money(houses.tycoon.value)} 是素人 ${F.money(houses.rookie.value)} 的好幾倍`);
ok(houses.tycoon.desc !== houses.rookie.desc && houses.scion.desc !== houses.rookie.desc,
  '有家底的起點各自帶自己的房子敘述');
ok(houses.listMP.mortgage > 0, '不分區立委是自己買的，貸款還有一大半');

/* ── 4. 家產會增值，而且不跟股市綁在一起 ── */
console.log('\n── 家產的增值 ──');
g = mk('scion', 'reporter', 35);
const land0 = inherited(g).reduce((a, h) => a + h.value, 0);
for (let i = 0; i < 60; i++) advance(g, data);
const land5 = inherited(g).reduce((a, h) => a + h.value, 0);
ok(land5 > land0, `五年後家產從 ${F.money(land0)} 長到 ${F.money(land5)}`);
ok(land5 < land0 * 1.6, '但漲得不誇張——土地不是飆股');
const spec = data.starts.starts.find((s) => s.id === 'scion').estate;
ok(spec.every((e) => e.appreciationPerYear > 0 && e.appreciationPerYear < 0.1),
  '每一筆家產的年增值率都設在合理範圍');

/* ── 5. 財產申報不會被股價漲跌誤傷 ── */
console.log('\n── 財產申報 ──');
g = mk('tycoon', 'doctor', 50);
let warned = 0;
for (let i = 0; i < 72; i++) {
  const out = advance(g, data);
  if ((out.news ?? []).some((n) => n.text.includes('監察機關'))) warned++;
}
ok(warned <= 2,
  `六年下來只有 ${warned} 次被監察機關來函——一個身家七成在股票上的人，帳面每年上下兩成是正常的`);

/* ── 6. 存讀檔要帶著家產 ── */
console.log('\n── 存讀檔 ──');
g = mk('tycoon', 'doctor', 50);
const round = SaveMgr.deserialize(JSON.parse(JSON.stringify(SaveMgr.serialize(g))), data);
const rs = round.assets.holdings.filter((h) => h.inherited);
ok(rs.length === inherited(g).length, `${rs.length} 筆家產存得回來`);
ok(rs.every((h) => h.liquidity != null && h.sellTax != null), '變現率與稅率也一起存下來了');
ok(Math.abs(A.netWorth(round) - A.netWorth(g)) < 2, '讀回來的身家跟存檔前一致');

/* ── 7. 長跑 ── */
console.log('\n── 長跑 ──');
g = mk('tycoon', 'doctor', 50);
let bad = 0;
for (let i = 0; i < 96; i++) {
  advance(g, data);
  if (!Number.isFinite(A.netWorth(g)) || A.netWorth(g) < 0) bad++;
}
ok(bad === 0, `九十六回合裡身家一直是有限的正數，最後是 ${F.money(A.netWorth(g))}`);

console.log(fails ? `\n${fails} 項失敗` : '\nv0.6.3 全部通過');
process.exit(fails ? 1 : 0);
