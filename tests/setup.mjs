// 建角偏好記憶與開局即存檔的行為測試
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });

// 假的 localStorage，讓存檔與偏好在 Node 裡也跑得起來
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (v.length > 5e6) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.btoa = (x) => Buffer.from(x, 'binary').toString('base64');
globalThis.atob = (x) => Buffer.from(x, 'base64').toString('binary');

const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { initScales } = await import('../src/util/scale.js');
const SaveMgr = await import('../src/save/SaveManager.js');
const { setupDraft, initDraft, attrBudget } = await import('../src/ui/pages/setup.js');

const data = await loadData(); initScales(data.scales);
SaveMgr.setData(data);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

/* ── 1. 沒有紀錄的時候用資料檔的預設值 ── */
store.clear();
initDraft(data);
ok(setupDraft.name === '龍天台' && setupDraft.age === 35 && setupDraft.gender === 'm',
  `第一次開局用資料檔的預設值：${setupDraft.name}／${setupDraft.age} 歲`);
ok(!setupDraft.restoredFrom, '沒有上一局的時候不會顯示沿用提示');
ok(setupDraft.backgroundId === null && setupDraft.partyMode === null, '出身與政黨路線都還沒選');

/* ── 2. 記住上一局的每一項選擇 ── */
const d = setupDraft;
d.name = '陳彥廷'; d.gender = 'f'; d.education = '碩士'; d.age = 41;
d.startId = 'aide'; d.backgroundId = 'lawyer';
d.homeRegion = 'TNN'; d.homeDistrict = data.districts.districts.find((x) => x.regionId === 'TNN').id;
d.partyMode = 'minor'; d.party = 'TPL';
d.attrs = { stamina: 1, sociability: 4, charisma: 2, eloquence: 3, judgment: 1, boldness: 0 };
d.ideology.unification = -4; d.ideology.punishment = 3;
d.china.friendly = -3; d.china.usTrust = 2;
SaveMgr.saveSetupPrefs(d);

initDraft(data);
ok(setupDraft.name === '陳彥廷' && setupDraft.gender === 'f' && setupDraft.education === '碩士',
  `姓名、性別、學歷都帶回來了：${setupDraft.name}／${setupDraft.gender}／${setupDraft.education}`);
ok(setupDraft.age === 41 && setupDraft.startId === 'aide', '年齡與起點帶回來了');
ok(setupDraft.backgroundId === 'lawyer' && setupDraft.partyMode === 'minor' && setupDraft.party === 'TPL',
  '出身、政黨路線與上一局選的黨都帶回來了');
ok(setupDraft.homeDistrict && setupDraft.homeRegion === 'TNN', '家鄉選區帶回來了，縣市也跟著對上');
ok(setupDraft.attrs.sociability === 4 && setupDraft.attrs.boldness === 0, '屬性配點帶回來了');
ok(setupDraft.ideology.unification === -4 && setupDraft.ideology.punishment === 3, '十三條軸的立場帶回來了');
ok(setupDraft.china.friendly === -3 && setupDraft.china.usTrust === 2, '兩岸七維帶回來了');
ok(!!setupDraft.restoredFrom, '會顯示沿用上一局設定的提示');
ok(setupDraft.step === 0, '每次回到建角畫面都從第一步開始');

/* ── 3. 資料檔變動之後要能自己修正，不能壞掉 ── */
store.set('p-election:setup', JSON.stringify({
  v: 1, name: '', gender: '外星', education: '幼稚園', age: 999,
  startId: 'NOPE', backgroundId: 'NOPE', homeDistrict: 'NOPE', homeRegion: 'NOPE',
  partyMode: 'NOPE', party: 'NOPE',
  attrs: { sociability: 99, judgment: -5, 已刪除的屬性: 3 },
  ideology: { 已刪除的軸: 4, unification: 99 },
  china: { 已刪除的維度: 2, friendly: -99 },
}));
initDraft(data);
ok(setupDraft.name === '龍天台', '空的姓名退回預設值');
ok(setupDraft.startId === 'rookie' && setupDraft.backgroundId === null, '不存在的起點與出身退回預設值');
ok(setupDraft.homeDistrict === null && setupDraft.partyMode === null, '不存在的選區與路線退回預設值');
ok(setupDraft.age >= 26 && setupDraft.age <= 42, `超出範圍的年齡被夾回起點允許的範圍：${setupDraft.age}`);
ok(setupDraft.attrs.sociability === 5 && setupDraft.attrs.judgment === 0, '超出 0~5 的屬性被夾回來');
ok(!('已刪除的屬性' in setupDraft.attrs), '已經不存在的屬性不會被帶進來');
ok(setupDraft.ideology.unification === 5 && setupDraft.china.friendly === -5, '超出 −5~5 的立場被夾回來');
ok(!('已刪除的軸' in setupDraft.ideology) && !('已刪除的維度' in setupDraft.china),
  '已經不存在的軸與維度不會被帶進來');

store.set('p-election:setup', '這不是 JSON');
initDraft(data);
ok(setupDraft.name === '龍天台', '壞掉的紀錄不會讓建角畫面壞掉');

/* ── 4. 屬性成本只看起點與出身，選政黨不收錢 ── */
store.clear();
initDraft(data);
setupDraft.startId = 'rookie'; setupDraft.backgroundId = 'activist';
const capBase = attrBudget(data).cap;
ok(capBase === 16, `素人加社運出身不扣點，全額 ${capBase} 點`);
setupDraft.startId = 'aide';
ok(attrBudget(data).cap === 16 - 3, `議助起點扣 3 點，剩 ${attrBudget(data).cap} 點`);
setupDraft.backgroundId = 'heir';
ok(attrBudget(data).cap === 16 - 3 - 4, `再加企業二代共扣 7 點，剩 ${attrBudget(data).cap} 點`);
// 政黨在建角階段完全不影響額度
const before = attrBudget(data).cap;
for (const mode of ['major', 'minor', 'independent', null]) {
  setupDraft.partyMode = mode;
  if (attrBudget(data).cap !== before) { ok(false, `選 ${mode} 竟然改變了屬性額度`); break; }
}
ok(attrBudget(data).cap === before, '不管選哪一種政黨，屬性額度都不變');
ok(data.starts.partyChoice.every((c) => (c.attrCost ?? 0) === 0), '三種政黨選項的 attrCost 都是零');

/* ── 5. 新開一局要立刻存得起來 ── */
store.clear();
const state = createGame(data, {
  seedStr: 'SETUP', name: '龍天台', gender: 'm', education: '大學', age: 35,
  startId: 'rookie', backgroundId: 'activist',
  homeDistrict: data.districts.districts[0].id, party: null,
  ideology: {}, china: {},
  baseAttrs: { stamina: 2, sociability: 2, charisma: 2, eloquence: 2, judgment: 2, boldness: 2 },
});
const r = SaveMgr.save(state, 'auto');
ok(r.ok, `第一回合就存得起來（${(r.bytes / 1024 / 1024).toFixed(2)} MB）`);
const back = SaveMgr.load('auto');
ok(back && back.meta.turn === 1 && back.player.name === '龍天台',
  '關掉再打開，讀回來的是第一回合而不是空的');
ok(Object.keys(back.people ?? {}).length > 100, `選區人物也一起存下來了（${Object.keys(back.people).length} 位）`);
const slots = SaveMgr.listSlots();
ok(slots.find((x) => x.slot === 'auto' && !x.empty)?.turn === 1,
  '自動存檔欄位顯示的是第 1 回合');

/* ── 6. 存檔滿了要講出來，不能安靜地失敗 ── */
const big = { ...state };
const fake = SaveMgr.save({ ...state, news: Array.from({ length: 400000 }, () => ({ text: '一則很長的新聞文字內容'.repeat(20) })) }, 'auto');
ok(!fake.ok && fake.msg.includes('儲存空間'), '空間不夠的時候會回報失敗原因，而不是假裝存好了');

console.log(fails ? `\n${fails} 項失敗` : '\n建角與存檔全部通過');
process.exit(fails ? 1 : 0);
