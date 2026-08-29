import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales } = await import('../src/util/scale.js');
const { app } = await import('../src/ui/app.js');
const data = await loadData(); initScales(data.scales); app.data = data;

const state = createGame(data, {
  seedStr: 'RENDER01', name: '林可為', gender: 'x', startId: 'aide',
  backgroundId: 'reporter', education: '碩士', homeDistrict: 'TCH-03', party: 'TPL',
  ideology: { centralization: 0, unification: -1, marketFreedom: 1, progressivism: 2, immigration: 1, environment: 1, militaryAutonomy: 0, directDemocracy: 3 },
});
app.state = state;
for (let i = 0; i < 8; i++) advance(state, data);

const { turnPage, eventModal } = await import('../src/ui/pages/turn.js');
const { politicsPage, lawModal } = await import('../src/ui/pages/politics.js');
const { dataPage } = await import('../src/ui/pages/data.js');
const { mapPage } = await import('../src/ui/pages/map.js');
const { teamPage, financePage, profilePage } = await import('../src/ui/pages/misc.js');
const { electionPage } = await import('../src/ui/pages/election.js');

const cases = [
  ['turn', () => turnPage(state, data)],
  ['politics/overview', () => politicsPage(state, data, 'overview')],
  ['politics/court', () => politicsPage(state, data, 'court')],
  ['politics/laws', () => politicsPage(state, data, 'laws')],
  ['politics/factions', () => politicsPage(state, data, 'factions')],
  ['politics/budget', () => politicsPage(state, data, 'budget')],
  ['politics/interp', () => politicsPage(state, data, 'interp')],
  ['data/macro', () => dataPage(state, data, 'macro')],
  ['data/pops', () => dataPage(state, data, 'pops')],
  ['data/values', () => dataPage(state, data, 'values')],
  ['data/world', () => dataPage(state, data, 'world')],
  ['data/history', () => dataPage(state, data, 'history')],
  ['data/semi', () => dataPage(state, data, 'semi')],
  ['election/primaryLost', () => {
    const saved = state.election;
    state.election = {
      phase: 'primary', sched: { year: 2026, month: 11 },
      run: { type: 'councilor', name: '市議員', level: {} },
      primaryWon: false,
      primaryMsg: '你以 46.7% 落敗，洪菁宜拿到了提名。',
      primaryField: [
        { name: '洪菁宜', isPlayer: false, share: 0.533 },
        { name: state.player.name, isPlayer: true, share: 0.467 },
      ],
    };
    const html = electionPage(state, data);
    state.election = saved;
    if (!html.includes('心灰意冷')) throw new Error('初選落敗頁少了「心灰意冷」這個選項');
    if (!html.includes('primary-accept') || !html.includes('primary-bolt')) {
      throw new Error('初選落敗頁少了原本的兩個選項');
    }
    return html;
  }],
  ['map', () => mapPage(state, data, { mode: 'favor' })],
  ['map/region', () => mapPage(state, data, { region: 'TCH' })],
  ['map/district', () => mapPage(state, data, { district: 'TCH-03' })],
  ['team', () => teamPage(state, data)],
  ['finance', () => financePage(state, data)],
  ['profile', () => profilePage(state, data)],
  ['election/idle', () => electionPage(state, data)],
  ['lawModal', () => lawModal(state, data, 'LAW_LABOR_STANDARDS', 2)],
];
let bad = 0;
for (const [name, fn] of cases) {
  try {
    const h = fn();
    if (typeof h !== 'string' || h.length < 20) { console.log('EMPTY', name); bad++; continue; }
    if (h.includes('undefined')) console.log('WARN  ', name, '有 undefined 字樣');
    if (h.includes('[object Object]')) { console.log('BAD   ', name, '有 [object Object]'); bad++; }
    if (h.includes('NaN')) { console.log('BAD   ', name, '有 NaN'); bad++; }
    console.log('OK    ', name.padEnd(20), h.length, 'chars');
  } catch (e) { bad++; console.log('FAIL  ', name, '→', e.message); }
}
// 事件 modal
const ev = state.pendingEvents[0];
if (ev) { try { eventModal(ev, state); console.log('OK     eventModal'); } catch (e) { bad++; console.log('FAIL   eventModal', e.message); } }
// 存讀檔往返
const SaveMgr = await import('../src/save/SaveManager.js');
SaveMgr.setData(data);
const round = SaveMgr.deserialize(JSON.parse(JSON.stringify(SaveMgr.serialize(state))));
// POP 的有界欄位在存檔時被量化成一個位元組，所以往返比對要用容差而不是相等。
// 容差取 0.05：解析度是 0.02~0.083，而玩家看到的是四字語詞，這個誤差永遠不會被看見。
const TOL = 0.05;
const near = (a, b) => Math.abs(a - b) <= TOL;
let popDrift = 0;
for (let i = 0; i < state.pops.n; i += 37) {
  if (!near(round.pops.sol[i], state.pops.sol[i])) popDrift++;
  if (!near(round.pops.ideology[i * 13], state.pops.ideology[i * 13])) popDrift++;
  if (!near(round.pops.china[i * 7], state.pops.china[i * 7])) popDrift++;
  if (!near(round.pops.femaleShare[i], state.pops.femaleShare[i])) popDrift++;
}
const peopleOk = Object.keys(round.people ?? {}).length === Object.keys(state.people ?? {}).length
  && Object.values(round.people ?? {}).every((p) => p.regionId);
const same = round.pops.n === state.pops.n && round.meta.turn === state.meta.turn
  && Math.abs(round.central.fiscal.gdp - state.central.fiscal.gdp) < 1e-6
  && popDrift === 0 && peopleOk;
console.log(same ? `OK     存讀檔往返一致（量化誤差皆在 ±${TOL} 之內）`
  : `FAIL   存讀檔往返不一致（POP 偏移 ${popDrift} 處${peopleOk ? '' : '、人物欄位缺漏'}）`);
if (!same) bad++;
const bytes = JSON.stringify(SaveMgr.serialize(state)).length;
console.log(`存檔大小 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > 2.4e6) { console.log('WARN   存檔超過 2.4 MB，localStorage 以 UTF-16 儲存會逼近上限'); bad++; }
console.log(bad ? `\n${bad} 項失敗` : '\n全部通過');
process.exit(bad ? 1 : 0);
