// 資料檔完整性檢查。CI 會跑這個，資料壞掉就擋下來。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
let errors = 0, warns = 0;
const fail = (m) => { console.log('✗ ' + m); errors++; };
const warn = (m) => { console.log('! ' + m); warns++; };
const pass = (m) => console.log('✓ ' + m);

const D = {
  meta: read('data/meta.json'), scales: read('data/scales.json'),
  regions: read('data/regions.json'), districts: read('data/districts.json'),
  central: read('data/central.json'), world: read('data/world.json'),
  corps: read('data/corporations.json'), parties: read('data/parties.json'),
  laws: read('data/laws.json'), bills: read('data/localBills.json'),
  values: read('data/values.json'), pops: read('data/pops.json'),
  media: read('data/media.json'), issues: read('data/issues.json'),
  budget: read('data/budget.json'), elections: read('data/elections.json'),
  starts: read('data/starts.json'), backgrounds: read('data/backgrounds.json'),
  tags: read('data/tags.json'), staffRoles: read('data/staffRoles.json'),
  donations: read('data/donations.json'), naming: read('data/naming.json'),
};
const EVENT_FILES = ['economy', 'energy', 'crossStrait', 'disaster', 'society', 'scandal', 'party', 'personal'];
const events = EVENT_FILES.flatMap((f) => read(`data/events/${f}.json`).events);

/* ── 基本結構 ── */
const REGION_IDS = D.regions.regions.map((r) => r.id);
const PARTY_IDS = D.parties.parties.map((p) => p.id);
const AXIS_IDS = D.values.axes.map((a) => a.id);
const ISSUE_IDS = D.issues.issues.map((i) => i.id);
const STRATA_IDS = D.pops.strata.map((s) => s.id);

D.regions.regions.length === 22 ? pass('22 個縣市') : fail(`縣市數 ${D.regions.regions.length}，應為 22`);
D.districts.districts.length >= 190 ? pass(`${D.districts.districts.length} 個議員選區`) : fail('選區數不足');
D.laws.laws.length === 25 ? pass('25 條中央法律') : fail(`法律數 ${D.laws.laws.length}`);
D.bills.bills.length === 15 ? pass('15 條地方議案') : fail(`議案數 ${D.bills.bills.length}`);
D.world.blocks.length === 15 ? pass('15 個世界區塊') : fail(`區塊數 ${D.world.blocks.length}`);
D.values.axes.length === 8 ? pass('8 條價值觀軸') : fail(`軸數 ${D.values.axes.length}`);
D.issues.issues.length === 12 ? pass('12 大議題') : fail(`議題數 ${D.issues.issues.length}`);
D.pops.strata.length === 10 ? pass('10 個職業階層') : fail(`階層數 ${D.pops.strata.length}`);
D.elections.legislatorDistricts.length === 73 ? pass('73 個區域立委選區') : fail('立委選區數不對');

/* ── id 唯一 ── */
for (const [name, list] of [
  ['縣市', REGION_IDS], ['選區', D.districts.districts.map((d) => d.id)],
  ['政黨', PARTY_IDS], ['法律', D.laws.laws.map((l) => l.id)],
  ['議案', D.bills.bills.map((b) => b.id)], ['事件', events.map((e) => e.id)],
  ['企業', D.corps.corporations.map((c) => c.id)], ['標籤', D.tags.tags.map((t) => t.id)],
]) {
  const dup = list.filter((x, i) => list.indexOf(x) !== i);
  dup.length ? fail(`${name} id 重複：${[...new Set(dup)].join('、')}`) : pass(`${name} id 皆唯一`);
}

/* ── 交叉引用 ── */
const badRegion = D.districts.districts.filter((d) => !REGION_IDS.includes(d.regionId));
badRegion.length ? fail(`${badRegion.length} 個選區的 regionId 不存在`) : pass('選區的縣市代碼皆有效');

let badStance = 0;
for (const l of D.laws.laws) for (const t of l.tiers) {
  for (const pid in t.partyStance ?? {}) if (!PARTY_IDS.includes(pid)) badStance++;
  for (const ax in t.effects?.valuePressure ?? {}) if (!AXIS_IDS.includes(ax)) { fail(`${l.id} 用了未知的價值觀軸 ${ax}`); }
  for (const s in t.effects?.popSoL ?? {}) if (s !== '_all' && !STRATA_IDS.includes(s)) fail(`${l.id} 用了未知階層 ${s}`);
}
badStance ? fail(`${badStance} 處 partyStance 指向未知政黨`) : pass('法案的政黨立場皆指向有效政黨');

for (const e of events) {
  for (const o of e.options ?? []) {
    for (const k in o.effects?.issueHeat ?? {}) if (!ISSUE_IDS.includes(k)) fail(`${e.id} 用了未知議題 ${k}`);
    for (const k in o.effects?.valuePressure ?? {}) if (!AXIS_IDS.includes(k)) fail(`${e.id} 用了未知軸 ${k}`);
  }
  if ((e.options ?? []).length < 3) warn(`${e.id} 只有 ${(e.options ?? []).length} 個選項`);
}
pass(`${events.length} 則事件的鍵值檢查完成`);

/* ── 比例總和 ── */
let ratioBad = 0;
const near1 = (v) => Math.abs(v - 1) < 0.002;
for (const r of D.regions.regions) {
  for (const key of ['ageStructure', 'education', 'ethnicity', 'industryMix']) {
    if (!near1(Object.values(r.population[key] ?? r.economy[key] ?? {}).reduce((a, b) => a + b, 0))) ratioBad++;
  }
  if (!near1(Object.values(r.economy.sectors).reduce((a, b) => a + b, 0))) { fail(`${r.id} 的產業佔比總和不為 1`); }
  const comp = Object.values(r.politics.councilComposition).reduce((a, b) => a + b, 0);
  if (comp !== r.councilSeats) fail(`${r.id} 議會組成 ${comp} 席，應為 ${r.councilSeats}`);
}
ratioBad ? fail(`${ratioBad} 組人口／教育／族群比例總和不為 1`) : pass('所有比例欄位總和為 1');

const legSum = D.regions.regions.reduce((a, r) => a + r.legislatorSeats, 0);
legSum === 73 ? pass('區域立委席次總和 73') : fail(`區域立委席次總和 ${legSum}`);
const seatSum = Object.values(D.central.government.legislature).reduce((a, b) => a + b, 0);
seatSum === 113 ? pass('立法院總席次 113') : fail(`立法院席次 ${seatSum}`);
const wSum = D.corps.corporations.reduce((a, c) => a + c.weightInIndex, 0);
near1(wSum) ? pass('股市權重總和 1') : fail(`股市權重總和 ${wSum}`);

/* ── 抽象量必須是 0~5 或 −5~5 ── */
let absBad = 0;
const chk = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
for (const r of D.regions.regions) {
  for (const k in r.infrastructure) if (!chk(r.infrastructure[k], 0, 5)) { absBad++; }
  for (const k in r.culture) if (typeof r.culture[k] === 'number' && !chk(r.culture[k], 0, 5)) absBad++;
}
for (const b of D.world.blocks) {
  if (!chk(b.stance, -5, 5)) absBad++;
  for (const k of ['economicLink', 'militaryPressure', 'techControl', 'narrativeInfluence']) if (!chk(b[k], 0, 5)) absBad++;
}
for (const c of D.corps.corporations) { if (!chk(c.mood, -5, 5)) absBad++; if (!chk(c.lobbyPower, 0, 5)) absBad++; }
absBad ? fail(`${absBad} 個抽象量超出 0~5／−5~5 的範圍`) : pass('所有抽象量都在合法範圍');

/* ── 四字語詞刻度完整性 ── */
let scaleBad = 0;
for (const k in D.scales.linear) if (D.scales.linear[k].length !== 6) { fail(`刻度 ${k} 有 ${D.scales.linear[k].length} 個語詞，應為 6`); scaleBad++; }
for (const k in D.scales.bipolar) if (D.scales.bipolar[k].length !== 11) { fail(`刻度 ${k} 有 ${D.scales.bipolar[k].length} 個語詞，應為 11`); scaleBad++; }
let notFour = [];
for (const k in D.scales.linear) for (const w of D.scales.linear[k]) if ([...w].length !== 4) notFour.push(`${k}:${w}`);
for (const k in D.scales.bipolar) for (const w of D.scales.bipolar[k]) if ([...w].length !== 4) notFour.push(`${k}:${w}`);
notFour.length ? warn(`${notFour.length} 個語詞不是四個字：${notFour.slice(0, 6).join('、')}`) : pass('所有刻度語詞都是四個字');
if (!scaleBad) pass('刻度長度正確');

/* ── 命名安全：不得出現真實名稱 ── */
const BLACK = ['民主進步黨', '民進黨', '中國國民黨', '國民黨', '台灣民眾黨', '民眾黨', '時代力量',
  '台積電', '臺積電', '鴻海', '聯發科', '長榮', '中鋼', '台塑', '台電', '中油', '國泰金', '富邦金',
  '中華電信', '統一超商', '聯合報', '中國時報', '自由時報', '三立', '民視', '東森', 'TVBS'];
// 先把我們自己的虛構名稱挖掉，否則「中華國民黨」會被誤判成「國民黨」
const OURS = [
  ...D.parties.parties.flatMap((p) => [p.name, p.shortName]),
  ...D.corps.corporations.map((c) => c.name),
  ...D.media.media.map((m) => m.name),
];
let allText = JSON.stringify({ ...D, events });
for (const own of OURS.sort((a, b) => b.length - a.length)) allText = allText.split(own).join('§');
const hits = BLACK.filter((b) => allText.includes(b));
hits.length ? fail(`資料檔出現真實名稱：${hits.join('、')}`) : pass('資料檔沒有出現真實政黨、企業或媒體名稱');

/* ── 事件文本句長：非特殊情況禁止少於 7 字 ── */
const CJK = /[一-鿿㐀-䶿]/;
function sentences(text) {
  return String(text ?? '').split(/[。！？；]/).map((x) => x.trim()).filter((x) => CJK.test(x));
}
function len(s) { return [...s.replace(/[，、：「」『』（）〈〉《》…—·\s""'']/g, '')].length; }
const short = [];
for (const e of events) {
  const fields = [e.headline, e.body, ...e.options.flatMap((o) => [o.text, o.hint])];
  for (const f of fields) for (const s of sentences(f)) {
    if (/^["'「『].*["'」』]$/.test(s.trim())) continue;   // 引號內對白除外
    if (len(s) < 7) short.push(`${e.id}: 「${s}」(${len(s)} 字)`);
  }
}
short.length ? fail(`${short.length} 個句子少於 7 字：\n    ${short.slice(0, 8).join('\n    ')}`)
  : pass(`${events.length} 則事件的文本句長全部達標（無少於 7 字的句子）`);

/* ── 立委選區覆蓋 ── */
const cov = {};
for (const l of D.elections.legislatorDistricts) for (const p of l.parts) cov[p.districtId] = (cov[p.districtId] ?? 0) + p.weight;
const general = D.districts.districts.filter((d) => d.type === 'general');
const uncovered = general.filter((d) => !cov[d.id]);
const skewed = Object.entries(cov).filter(([, v]) => Math.abs(v - 1) > 0.08);
uncovered.length ? fail(`${uncovered.length} 個一般選區沒有被任何立委選區涵蓋`) : pass('所有一般選區都被立委選區涵蓋');
skewed.length ? fail(`${skewed.length} 個選區的權重加總偏離 1`) : pass('立委選區的權重分配正確');

console.log(`\n${errors ? `✗ ${errors} 項錯誤` : '✓ 全部通過'}${warns ? `，${warns} 項警告` : ''}`);
process.exit(errors ? 1 : 0);
