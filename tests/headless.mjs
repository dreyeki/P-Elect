// 無 UI 的整局模擬，用來驗證引擎不會炸、數值不會失控
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (url) => {
  const p = path.join(ROOT, String(url).replace(/^\.\//, ''));
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};

const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales, word } = await import('../src/util/scale.js');
const Events = await import('../src/systems/EventSystem.js');
const { Rng } = await import('../src/core/Rng.js');
const F = await import('../src/util/format.js');
const Asset = await import('../src/systems/AssetSystem.js');

const t0 = Date.now();
const data = await loadData();
initScales(data.scales);
console.log(`資料載入 ${Date.now() - t0} ms；事件 ${data.events.length} 則、選區 ${data.districts.districts.length} 個`);

const seed = process.argv[2] ?? 'TESTSEED';
const turns = Number(process.argv[3] ?? 120);

const state = createGame(data, {
  seedStr: seed, name: '測試員', gender: 'x',
  startId: 'rookie', backgroundId: 'activist', education: '大學',
  homeDistrict: 'KHH-05', party: 'PDA',
  ideology: { centralization: 0, unification: -2, marketFreedom: -2, progressivism: 3, immigration: 1, environment: 2, militaryAutonomy: 1, directDemocracy: 2 },
});
console.log(`POP 數：${state.pops.n}（每選區 ${state.pops.n / data.districts.districts.length}）`);

const rng = new Rng(12345);
let evCount = 0, nanCount = 0, maxTurnMs = 0;
const t1 = Date.now();
for (let i = 0; i < turns; i++) {
  const ts = Date.now();
  const r = advance(state, data);
  maxTurnMs = Math.max(maxTurnMs, Date.now() - ts);
  evCount += r.events.length;
  // 隨機選一個選項
  for (const ev of r.events) Events.resolve(state, data, ev, rng.int(0, ev.options.length - 1));
  // NaN 巡檢
  if (!Number.isFinite(state.central.fiscal.gdp) || !Number.isFinite(state.flags.avgSol)) nanCount++;
}
const elapsed = Date.now() - t1;
console.log(`\n跑了 ${turns} 回合，共 ${elapsed} ms（平均 ${(elapsed / turns).toFixed(1)} ms／回合，最慢 ${maxTurnMs} ms）`);
console.log(`事件觸發 ${evCount} 次；NaN 次數 ${nanCount}`);
console.log(`\n=== ${state.meta.year} 年 ${state.meta.month} 月 ===`);
console.log('GDP        ', F.bil(state.central.fiscal.gdp));
console.log('成長率     ', (state.central.fiscal.gdpGrowth * 100).toFixed(2) + '%');
console.log('失業率     ', (state.central.fiscal.unemployment * 100).toFixed(2) + '%');
console.log('通膨       ', (state.central.fiscal.inflation * 100).toFixed(2) + '%');
console.log('股市       ', state.central.stockIndex);
console.log('國債佔比   ', ((state.central.fiscal.debtToGdp ?? 0) * 100).toFixed(1) + '%');
console.log('平均生活水準', state.flags.avgSol?.toFixed(2), '→', word('sol', state.flags.avgSol));
console.log('民調       ', (state.flags.approval ?? 0).toFixed(1) + '%');
console.log('玩家       ', `知名度 ${word('fame', state.player.fame)}｜清廉 ${word('integrity', state.player.integrity)}｜汙名 ${word('stigma', state.player.stigma)}｜疲勞 ${word('fatigue', state.player.fatigueRaw / 24)}`);
console.log('私產       ', F.money(state.finance.personal), '；競選經費', F.money(state.finance.campaign));
console.log('身家       ', F.money(Asset.netWorth(state)),
  '（房產', state.assets?.house ? F.money(state.assets.house.value) : '無',
  '、負債', F.money(Asset.totalDebt(state)),
  '、投資', state.assets?.holdings?.length ?? 0, '筆）');
console.log('標籤       ', state.tags.join('、') || '（無）');
console.log('價值觀     ', Object.entries(state.values).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' '));
const { nationalSupport } = await import('../src/systems/PopSystem.js');
const sup = nationalSupport(state, data);
console.log('全國政黨支持度：', Object.entries(sup).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${data.byId.party[k]?.shortName ?? k} ${(v * 100).toFixed(1)}%`).join('　'));
console.log('各階層生活水準：');
for (const [k, v] of Object.entries(state.flags.stratSol ?? {})) {
  console.log('  ', data.byId.stratum[k].name.padEnd(6, '　'), v.toFixed(2), word('sol', v));
}
if (state.log.length) { console.log('\n錯誤紀錄：'); state.log.slice(0, 12).forEach((l) => console.log('  ', l.text)); }
console.log(`民調：累積 ${(state.polls ?? []).length} 份`);
const byPs = {};
for (const p of state.polls ?? []) byPs[p.pollsterShort] = (byPs[p.pollsterShort] ?? 0) + 1;
console.log('  最近各家：', Object.entries(byPs).map(([k, v]) => `${k}×${v}`).join('　'));
const lp = (state.polls ?? [])[0];
if (lp) console.log(`  最新一份 ${lp.pollsterShort}（${lp.scopeName}）：`,
  Object.entries(lp.partySupport).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${data.byId.party[k]?.shortName ?? k} ${v.toFixed(1)}%`).join('　'),
  `｜總統 ${lp.presidentApproval.toFixed(0)}%`, lp.playerListed ? `｜你 ${lp.playerApproval.toFixed(1)}%` : '｜你未列入');
console.log(`通告：手上 ${(state.invitations ?? []).length} 個`);
console.log(`憲政：總統 ${state.presidency?.name}（${state.presidency?.party}）滿意度 ${state.presidency?.approval.toFixed(1)}%`);
console.log(`  大法官 ${state.court?.justices.length} 位、審理中 ${state.court?.pendingReviews.length} 案、已裁判 ${state.court?.history.length} 案`);
if (state.court?.history.length) {
  for (const h of state.court.history.slice(-3)) console.log(`   《${h.lawName}》→ ${h.verdict}`);
}
console.log('\n最近新聞：');
state.news.slice(0, 5).forEach((n) => console.log('  -', n.text));
