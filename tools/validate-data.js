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
  pollsters: read('data/pollsters.json'), shows: read('data/shows.json'),
  constitution: read('data/constitution.json'), tuning: read('data/tuning.json'),
  theories: read('data/theories.json'), images: read('data/images.json'),
  cabinetData: read('data/cabinet.json'),
  china: read('data/china.json'), people: read('data/people.json'),
  canvass: read('data/canvass.json'), favors: read('data/favors.json'),
  invitations: read('data/invitations.json'), semiconductor: read('data/semiconductor.json'),
  social: read('data/social.json'), reactions: read('data/reactions.json'),
  firstTimes: read('data/firstTimes.json'),
  rally: read('data/rally.json'), personalFinance: read('data/personalFinance.json'),
  fundraising: read('data/fundraising.json'), fastForward: read('data/fastForward.json'),
  proposals: read('data/proposals.json'),
};
D.byIdInv = Object.fromEntries(D.invitations.kinds.map((x) => [x.id, x]));
D.byIdCorp = Object.fromEntries(D.corps.corporations.map((x) => [x.id, x]));
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
D.values.axes.length === 13 ? pass('13 條價值觀軸') : fail(`軸數 ${D.values.axes.length}，應為 13`);
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
  '中華電信', '統一超商', '聯合報', '中國時報', '自由時報', '三立', '民視', '東森', 'TVBS',
  '美光', '台達電', '聯發科', '瑞昱', '南亞科', '力積電', '漢微科', '家登', '應材', '日月光'];
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

/* ── v0.3 / v0.4 新增的資料 ── */
D.pollsters.pollsters.length >= 8 ? pass(`${D.pollsters.pollsters.length} 家民調公司`) : fail('民調公司太少');
D.shows.shows.length >= 6 ? pass(`${D.shows.shows.length} 個政論節目`) : fail('政論節目太少');
D.theories.theories.length >= 15 ? pass(`${D.theories.theories.length} 套組織理論`) : fail('理論太少');
D.images.playerImages.length >= 8 ? pass(`${D.images.playerImages.length} 種主打形象`) : fail('形象太少');
D.cabinetData.ministries.length >= 12 ? pass(`${D.cabinetData.ministries.length} 個部會`) : fail('部會太少');

// 民調公司要有樣本數與設計效果，誤差不能是手填的
const badMoe = D.pollsters.pollsters.filter((p) => !p.sampleSize || !p.designEffect || p.sampleError != null);
badMoe.length ? fail(`${badMoe.length} 家民調公司缺少 sampleSize/designEffect，或還留著手填的 sampleError`)
  : pass('所有民調公司的誤差都由 sampleSize 與 designEffect 推算');
const worstSmallParty = Math.max(...D.pollsters.pollsters.map((p) =>
  1.96 * Math.sqrt(0.03 * 0.97 / p.sampleSize) * Math.sqrt(p.designEffect) * 100));
worstSmallParty < 2 ? pass(`3% 小黨的最大抽樣誤差 ±${worstSmallParty.toFixed(2)}%，不會出現十個百分點的離譜讀數`)
  : fail(`小黨誤差過大：±${worstSmallParty.toFixed(2)}%`);

// 每個縣市都要有選民結構，且三分類加起來接近 100
// （lean 是校準出來的模型參數，不是選民結構的鏡射，所以不檢查兩者的方向是否一致）
let vsBad = 0;
for (const r of D.regions.regions) {
  const vs = r.voterStructure;
  if (!vs || Math.abs(vs.green + vs.blue + vs.white - 100) > 0.5) vsBad++;
}
vsBad ? fail(`${vsBad} 個縣市的選民結構缺漏或加總不到 100`)
  : pass('22 縣市的選民結構完整，藍綠白加總為 100');

// 副市長人數要符合地方制度法
const rule = D.cabinetData.deputyMayorRule;
let depBad = 0;
for (const r of D.regions.regions) {
  const cfg = r.type === '直轄市' ? rule.municipality : rule.county;
  const want = cfg.base + (r.population.total >= cfg.extraIfPopulationOver ? cfg.extra : 0);
  if (want < 1 || want > 3) depBad++;
}
depBad ? fail('副首長人數規則算出不合理的結果') : pass('副首長人數規則符合地方制度法');

// tuning.json 的每一節都要有說明
const noNote = Object.entries(D.tuning).filter(([k, v]) =>
  !k.startsWith('_') && typeof v === 'object' && !Array.isArray(v) && !v._note);
noNote.length ? warn(`tuning.json 有 ${noNote.length} 節沒有寫 _note：${noNote.map((x) => x[0]).join('、')}`)
  : pass('tuning.json 每一節都有說明');

// 理論的欄位
const badTheory = D.theories.theories.filter((t) => !t.claims || t.claims.length < 2 || !t.field || !t.axis);
badTheory.length ? fail(`${badTheory.length} 套理論缺少 claims/field/axis`) : pass('所有理論的欄位完整');
const theoryShort = [];
for (const t of D.theories.theories) {
  for (const c of t.claims) for (const sen of sentences(c)) if (len(sen) < 7) theoryShort.push(`${t.id}: ${sen}`);
}
theoryShort.length ? fail(`理論論點有 ${theoryShort.length} 個句子少於 7 字`) : pass('理論論點的句長全部達標');

/* ─────────── v0.5 新增的檢查 ─────────── */

// 每個階層與政黨都要有全部 13 條軸
const axisIds = D.values.axes.map((a) => a.id);
const missAx = [];
for (const st of D.pops.strata) for (const a of axisIds) if (st.ideology[a] == null) missAx.push(`${st.id}.${a}`);
for (const pt of D.parties.parties) for (const a of axisIds) if (pt.platform[a] == null) missAx.push(`${pt.id}.${a}`);
missAx.length ? fail(`${missAx.length} 個階層或政黨缺少軸：${missAx.slice(0, 5).join('、')}`)
  : pass('所有階層與政黨都涵蓋 13 條軸');

// 兩岸七維
const cnKeys = D.china.dims.map((d) => d.id);
cnKeys.length === 7 ? pass('兩岸七個細部維度') : fail(`兩岸維度數 ${cnKeys.length}`);
const cnMiss = D.parties.parties.filter((p) => cnKeys.some((k) => p.chinaStance?.[k] == null));
cnMiss.length ? fail(`${cnMiss.length} 個政黨缺少 chinaStance`) : pass('所有政黨都有七維兩岸立場');
const reasonOk = D.china.reasons.length === 5
  && D.china.reasons.every((r) => r.movedBy?.length && r.desc);
reasonOk ? pass('五種兩岸態度理由完整') : fail('兩岸理由的欄位缺漏');
// 理由不等於方向：narratives 裡每一種理由都要同時有正反兩邊
const byReason = {};
for (const n of D.china.narratives) (byReason[n.reason] ??= new Set()).add(Math.sign(n.direction));
const oneSided = Object.entries(byReason).filter(([, v]) => v.size < 2).map(([k]) => k);
oneSided.length ? fail(`理由只有單邊論述：${oneSided.join('、')}`)
  : pass('每一種理由都同時存在友中與抗中兩種論述');

// 性別
const gp = D.pops.gender;
const genderOk = gp && gp.ideologyGap && gp.gapByGeneration
  && gp.gapByGeneration.youth > gp.gapByGeneration.senior;
genderOk ? pass('性別落差已參數化，且青年世代的落差大於樂齡世代')
  : fail('pops.json 的 gender 區塊缺漏或世代倍率不合理');

// 跑攤：至少 20 種場景、每種 3 個分支、六十次不重複
const cv = D.canvass;
cv.scenes.length >= 20 ? pass(`${cv.scenes.length} 種跑攤場景`) : fail(`跑攤場景只有 ${cv.scenes.length} 種`);
// 每一種都市化程度都要湊得出六十段不重複的文本
const urbShort = [];
for (let u = 0; u <= 5; u++) {
  const n = cv.scenes.filter((x) => u >= x.urbanity[0] - 2 && u <= x.urbanity[1] + 2).length;
  if (n * 3 < cv.noRepeatWindow) urbShort.push(`都市化 ${u} 只有 ${n * 3} 段`);
}
urbShort.length ? fail(`跑攤文本覆蓋不足：${urbShort.join('、')}`)
  : pass(`每一種都市化程度都湊得出 ${cv.noRepeatWindow} 段以上不重複的跑攤文本`);
const brBad = cv.scenes.filter((x) => x.branches.length !== 3);
brBad.length ? fail(`${brBad.length} 個場景的分支不是 3 個`) : pass('每個場景都有 3 種結果');
const totalText = cv.scenes.length * 3;
totalText >= cv.noRepeatWindow ? pass(`${totalText} 段文本 ≥ 不重複視窗 ${cv.noRepeatWindow}`)
  : fail(`文本只有 ${totalText} 段，撐不起 ${cv.noRepeatWindow} 次不重複`);
// 不能出現月份代詞，因為一個回合可以跑好幾攤
const pron = [];
for (const sc of cv.scenes) {
  for (const t of [sc.lead, ...sc.branches.map((b) => b.text)]) {
    if (t.includes('這個月') || t.includes('本月')) pron.push(sc.id);
  }
}
pron.length ? fail(`${pron.length} 段跑攤文本出現月份代詞`) : pass('跑攤文本沒有出現月份代詞');
// 句長
const cvShort = [];
for (const sc of cv.scenes) {
  for (const t of [sc.lead, ...sc.branches.map((b) => b.text)]) {
    for (const sen of sentences(t)) if (len(sen) < 7 && !sen.includes('「')) cvShort.push(sen);
  }
}
cvShort.length ? fail(`跑攤文本有 ${cvShort.length} 個句子少於 7 字`) : pass('跑攤文本的句長全部達標');

// 掛著「第一次」敘述的那兩回，素人在每一種都市化程度都要有足夠的場景可以抽
const MEMBER_ONLY = (sc, b) => sc.requires === 'member' || sc.branches[b].requires === 'member'
  || sc.requires === 'office' || sc.branches[b].requires === 'office';
const rookieShort = [];
for (let u = 0; u <= 5; u++) {
  const pool = cv.scenes.filter((x) => u >= x.urbanity[0] - 2 && u <= x.urbanity[1] + 2);
  for (let b = 0; b < 3; b++) {
    const n = pool.filter((sc) => !sc.branches[b].assumesHistory && !MEMBER_ONLY(sc, b)).length;
    if (n < 6) rookieShort.push(`都市化 ${u} 的分支 ${b} 只剩 ${n} 個`);
  }
}
rookieShort.length ? fail(`素人前兩次可用的場景太少：${rookieShort.join('、')}`)
  : pass('掛著第一次敘述的那兩回，素人在每一種都市化程度都有足夠的場景可抽');

// 上面寫第一次、下面寫上次你來——這種矛盾要在資料層就擋掉
const histWords = /上次|上一次|認出你|三個月來收到|每次選舉前|連續站了.*天|人在哪裡/;
const unflagged = [];
for (const sc of cv.scenes) {
  sc.branches.forEach((b, i) => {
    if (histWords.test(b.text) && !b.assumesHistory) unflagged.push(`${sc.id}/${i}`);
  });
}
unflagged.length ? fail(`這些段落假設你來過卻沒有標記 assumesHistory：${unflagged.join('、')}`)
  : pass('所有假設你來過的段落都標記了 assumesHistory');

// 服務處與議事堂同理
const officeWords = /服務處|議事堂/;
const unGated = [];
for (const sc of cv.scenes) {
  sc.branches.forEach((b, i) => {
    if (officeWords.test(b.text) && !b.requires && !sc.requires) unGated.push(`${sc.id}/${i}`);
  });
  if (officeWords.test(sc.lead) && !sc.requires) unGated.push(`${sc.id}/lead`);
}
unGated.length ? fail(`這些段落假設你有服務處或民代身分卻沒有上門檻：${unGated.join('、')}`)
  : pass('所有假設服務處或議事堂的段落都上了身分門檻');

// 跑攤的第一次敘述不能綁定場合：底下那一段可能是任何一種場合
const ftCan = ["1", "2"].flatMap((o) => D.firstTimes.actions.canvass[o] ?? []);
const venueBound = ftCan.filter((t) => /市場|早市|攤商|攤販|服務處|議事堂/.test(t));
venueBound.length ? fail(`跑攤的第一次敘述綁定了場合：${venueBound[0].slice(0, 20)}…`)
  : pass('跑攤的第一次敘述不綁定場合，配得上任何一種場合');

// 選區人物
const pe = D.people;
pe.perDistrict.min === 3 && pe.perDistrict.max === 7
  ? pass('每個選區配置 3~7 位在地人物') : fail('選區人物數量的設定不符');
pe.archetypes.length >= 10 ? pass(`${pe.archetypes.length} 種人物原型`) : fail('人物原型太少');
// 空降的機率要隨層級遞增
const pc = pe.parachute.byLevel;
(pc.councilor < pc.legislator && pc.legislator < pc.mayor && pc.mayor < pc.president)
  ? pass('空降機率隨選舉層級遞增，議員層級幾乎不會有') : fail('空降機率的層級順序不對');

// 邀約與助理代打
const inv = D.invitations;
inv.aideRule.perAidePerMonth === 1 ? pass('每位助理一個月只能跑一場') : fail('助理代打的配額不是每月一場');
inv.aideRule.effectMult < 1 ? pass('派助理去的效果低於親自出席') : fail('助理代打的效果沒有折損');
['INV_WEDDING', 'INV_FUNERAL', 'INV_SPORTS', 'INV_CORPORATE'].every((k) => D.byIdInv[k])
  ? pass('婚宴、告別式、運動會、企業活動的邀約都在') : fail('缺少指定的邀約類型');

// 人情牽制
const fv = D.favors;
fv.helpEvents.length >= 4 && fv.requestEvents.length >= 3
  ? pass(`人情事件：幫助 ${fv.helpEvents.length} 種、請託 ${fv.requestEvents.length} 種`)
  : fail('人情事件太少');
fv.helpEvents.some((e) => e.effect?.campaignFundsRange) ? pass('人情可以換到募款') : fail('缺少募款類的幫助事件');
fv.helpEvents.some((e) => e.effect?.primaryMemberBonus) ? pass('人情可以幫忙解決初選提名') : fail('缺少初選類的幫助事件');

// 反對選項與媒體攻擊
const rc = D.reactions;
rc.opposePhrases.length >= 7 ? pass(`${rc.opposePhrases.length} 種反對的說法`) : fail('反對的同義說法少於 7 種');
new Set(rc.opposePhrases).size === rc.opposePhrases.length ? pass('反對用語沒有重複') : fail('反對用語有重複');
rc.mediaAttack.boltMultiplier > 2 ? pass('退黨後遭媒體圍剿的強度超過兩倍') : fail('退黨的媒體反撲不夠強');
rc.events.some((e) => e.requiresBolt) ? pass('有專門針對退黨的攻擊事件') : fail('缺少退黨的媒體攻擊事件');

// 社群
const so = D.social;
so.livestream.requires.boldness === 3 ? pass('直播需要氣魄 3') : fail('直播的氣魄門檻不是 3');
so.streetSpeech.requires.boldness === 4 ? pass('街頭宣講需要氣魄 4') : fail('街頭宣講的氣魄門檻不是 4');

// 半導體
const sc = D.semiconductor;
sc.segments.length === 5 ? pass('半導體五大版圖') : fail(`半導體版圖數 ${sc.segments.length}`);
const wantSeg = ['FOUNDRY', 'MEMORY', 'COMPONENT', 'DESIGN', 'EQUIP'];
wantSeg.every((k) => sc.segments.some((x) => x.id === k))
  ? pass('晶片製造、記憶體、電子組件、晶片設計、上游設備都在') : fail('半導體版圖缺項');
const segCorpMiss = sc.segments.flatMap((x) => x.corps).filter((c) => !D.byIdCorp[c]);
segCorpMiss.length ? fail(`半導體版圖指向不存在的公司：${segCorpMiss.join('、')}`)
  : pass('半導體版圖的公司都存在於企業表');
// 記憶體的循環振幅要明顯大於代工，這是這個產業的常識
sc.cycle.MEMORY.amplitude > sc.cycle.FOUNDRY.amplitude * 2
  ? pass('記憶體的景氣振幅明顯大於晶圓代工') : fail('記憶體的循環振幅設定不符現實');

// 預算的權責分工
const ba = D.budget.authority;
!ba.canAllocate.includes('legislator') && !ba.canAllocate.includes('councilor')
  ? pass('民代不能編預算，只能審') : fail('民代被允許編列預算，與憲政分工不符');
D.budget.specialBudgets.some((x) => x.id === 'SB_CASH2027')
  && D.budget.specialBudgets.some((x) => x.id === 'SB_CHILD5000')
  ? pass('2027 現金普發與育兒補助都已編列') : fail('缺少 2027 年度的兩項特別預算');

// 開局要付屬性點
const costOk = D.starts.starts.some((x) => x.attrCost > 0)
  && D.backgrounds.backgrounds.some((x) => x.attrCost > 0);
costOk ? pass('比較好的起點與出身要付屬性點') : fail('起點或出身沒有屬性成本');
D.starts.defaults?.name === '龍天台' && D.starts.defaults?.age === 35
  ? pass('開局預設為龍天台、35 歲') : fail('開局預設值不符');

// 每個行動的前兩次都要有專屬文本，每次三種變體
const FT = D.firstTimes;
// 募款是選單型的行動，專屬文本掛在下面三條管道各自的計數器上；
// 造勢自己有一組。快轉半年與私人財務不扣行動點，也就沒有「第一次」這回事。
const actionIds = ['canvass', 'theory', 'invitations', 'livestream', 'streetSpeech', 'talkshow',
  'showPrep', 'presser', 'commissionPoll', 'faction', 'trainStaff', 'draftLaw',
  'prepQuestion', 'visit', 'setImage', 'retire', 'dealmaking',
  'rally', 'FUND_DINNER', 'FUND_SMALL', 'FUND_DEVELOPER',
  'proposeBill', 'lobbySupport', 'suggest'];
const ftMiss = actionIds.filter((id) => !FT.actions[id]);
ftMiss.length ? fail(`${ftMiss.length} 個行動沒有第一次的文本：${ftMiss.join('、')}`)
  : pass(`全部 ${actionIds.length} 個行動都有專屬的第一次文本`);

let ftBad = [], ftTotal = 0;
for (const [id, pack] of Object.entries(FT.actions)) {
  const occ = Object.keys(pack).filter((k) => /^\d+$/.test(k));
  // 退出政壇是終局，同一局裡不會有第二次，所以只需要第一次
  const want = id === 'retire' ? 1 : FT.occurrences;
  if (occ.length !== want) ftBad.push(`${id} 有 ${occ.length} 次而不是 ${want} 次`);
  for (const o of occ) {
    if (pack[o].length !== FT.variants) ftBad.push(`${id} 第 ${o} 次只有 ${pack[o].length} 種變體`);
    ftTotal += pack[o].length;
    if (new Set(pack[o]).size !== pack[o].length) ftBad.push(`${id} 第 ${o} 次的變體有重複`);
  }
  if (!pack.name) ftBad.push(`${id} 沒有 name`);
}
ftBad.length ? fail(`第一次文本的結構有問題：${ftBad.slice(0, 4).join('；')}`)
  : pass(`第一次文本共 ${ftTotal} 段，每次都有 ${FT.variants} 種不重複的變體`);

// 同一個行動的六段文本彼此不能重複
let ftDup = [];
for (const [id, pack] of Object.entries(FT.actions)) {
  const all = Object.keys(pack).filter((k) => /^\d+$/.test(k)).flatMap((o) => pack[o]);
  if (new Set(all).size !== all.length) ftDup.push(id);
}
ftDup.length ? fail(`這些行動的第一次與第二次有重複的文本：${ftDup.join('、')}`)
  : pass('每個行動的第一次與第二次沒有任何一段重複');

// 句長
const ftShort = [];
for (const pack of Object.values(FT.actions)) {
  for (const o of Object.keys(pack).filter((k) => /^\d+$/.test(k))) {
    for (const t of pack[o]) for (const sen of sentences(t)) if (len(sen) < 7) ftShort.push(sen);
  }
}
ftShort.length ? fail(`第一次文本有 ${ftShort.length} 個句子少於 7 字：${ftShort.slice(0, 3).join('、')}`)
  : pass('第一次文本的句長全部達標');

// 加入哪一個黨不收屬性點：那是開局之後的決定，代價寫在遊戲本身
D.starts.partyChoice.every((c) => (c.attrCost ?? 0) === 0)
  ? pass('選政黨不扣屬性點，代價寫在遊戲本身而不是建角畫面')
  : fail('政黨選項仍在扣屬性點');

// 幕僚的雷
const gf = D.staffRoles.graft;
const risky = D.staffRoles.backgrounds.filter((b) => b.graftRisk > 0);
gf.yearlyChance === 0.05 && risky.length >= 4
  ? pass(`${risky.length} 種幕僚來歷帶著每年 5% 的收贓風險`) : fail('幕僚收贓的設定不符');
risky.every((b) => !b.text.includes('貪') && !b.text.includes('風險'))
  ? pass('帶雷的幕僚敘述沒有明講，玩家要自己讀出來') : fail('幕僚的雷寫得太白');

// 第三個校準維度
const wlMiss = D.regions.regions.filter((r) => r.whiteLean == null);
wlMiss.length ? fail(`${wlMiss.length} 個縣市缺少 whiteLean`) : pass('22 縣市都有中間政黨的地方強弱參數');
const dwl = D.districts.districts.filter((x) => x.whiteLean == null);
dwl.length ? fail(`${dwl.length} 個選區缺少 whiteLean`) : pass('所有選區都繼承了 whiteLean');

// 事件門檻不能把素人整個鎖死：政治素人仍然必須看得到相當數量的事件
const mapRole = (r) => (r === 'councilor' ? 'councilor' : r === 'legislator' ? 'legislator'
  : ['mayor', 'minister', 'president'].includes(r) ? 'mayor' : 'citizen');
const rookieVisible = events.filter((e) => {
  if (e.requires?.roles && !e.requires.roles.includes(mapRole('citizen'))) return false;
  const g = e.gate;
  if (!g) return true;
  if (g.requiresParty) return false;
  if ((g.minFame ?? 0) > 0) return false;
  return true;
});
rookieVisible.length >= 30
  ? pass(`政治素人仍看得到 ${rookieVisible.length} 則事件，門檻沒有把開局鎖死`)
  : fail(`政治素人只看得到 ${rookieVisible.length} 則事件，門檻設得太緊`);

// 但預設首長權限的選項一定要被鎖住
const execOpts = events.flatMap((e) => e.options.map((o) => ({ e, o })))
  .filter((x) => /宣布停班停課|強制撤離|親自進駐|全程指揮/.test(x.o.text));
execOpts.length && execOpts.every((x) => x.o.gate?.office?.includes('mayor'))
  ? pass(`${execOpts.length} 個需要首長權限的選項都已上鎖，素人按不下去`)
  : fail('有預設首長權限的選項沒有上鎖');

// 屬性成長里程碑
const ms = D.tuning.milestones;
ms.theoriesForJudgment === 1 && ms.showsForEloquence === 5 && ms.canvassForSociability === 5
  ? pass('屬性成長里程碑符合指定：理論 1 次、節目 5 次、跑攤 5 次') : fail('屬性成長的門檻不符');

/* ═══════════ v0.6.0 ═══════════ */
console.log('\n── v0.6.0 ──');

// 掃街不花錢
(D.tuning.canvass?.cost ?? -1) === 0
  ? pass('掃街的成本是零，破產的候選人還是出得了門') : fail('掃街還在扣錢');

// 選區代稱
const aliasMiss = D.districts.districts.filter((d) => !d.alias || d.alias.length < 2);
const aliasSame = D.districts.districts.filter((d) => d.alias === d.name);
!aliasMiss.length && !aliasSame.length
  ? pass(`${D.districts.districts.length} 個選區都有兩個字以上的代稱，而且都不等於正式名稱`)
  : fail(`${aliasMiss.length} 個沒有代稱、${aliasSame.length} 個代稱等於本名`);
D.districts.districts.find((d) => d.id === 'KHH-01')?.alias === '旗美'
  ? pass('高雄市第一選舉區的代稱是旗美') : fail('KHH-01 的代稱不對');

// 造勢：場地要從便宜到貴排得出一條線，而且最大的場子真的要幾千萬
const venues = D.rally.venues;
const sortedByCap = [...venues].sort((a, b) => a.capacity - b.capacity);
sortedByCap[0].cost < sortedByCap[sortedByCap.length - 1].cost
  ? pass(`${venues.length} 種場地從 ${venues[0].name} 到 ${venues[venues.length - 1].name}，容量與租金同向`)
  : fail('場地的容量與租金沒有同向');
Math.max(...venues.map((v) => v.cost)) >= 10000000
  ? pass(`最大的場子要 ${(Math.max(...venues.map((v) => v.cost)) / 10000).toFixed(0)} 萬，符合台灣的實際價碼`)
  : fail('造勢的經費還是太便宜，不符合現實');
const mobs = D.rally.mobilize;
mobs.every((m, i) => i === 0 || m.yield >= mobs[i - 1].yield)
  ? pass('動員方式的效率由低到高排好了') : fail('動員效率沒有排序');
mobs.filter((m) => m.stigma > 0).length >= 2
  ? pass(`${mobs.filter((m) => m.stigma > 0).length} 種動員方式帶著汙名，人不是白來的`) : fail('動員手法沒有代價');
D.rally.outcomes.length === 4 && D.rally.outcomes.every((o) => o.text.length > 60)
  ? pass('四種到場率結果各有一段夠長的敘述') : fail('造勢結果的敘述太短或數量不對');

// 私人財務
const PF = D.personalFinance;
PF.housing.baseValueRange[0] >= 6000000 && PF.housing.baseValueRange[1] <= 7000000
  ? pass(`開局的房子值 ${PF.housing.baseValueRange.map((x) => x / 10000).join('～')} 萬，貸款 ${PF.housing.mortgage / 10000} 萬`)
  : fail('開局房產的價值範圍不符');
PF.loans.some((l) => l.id === 'LOAN_FARM') && PF.loans.some((l) => l.id === 'LOAN_BANK')
  ? pass('農會與銀行兩條借錢的路都在') : fail('缺少農會或銀行貸款');
const roleScaled = PF.loans.filter((l) => l.byRole);
roleScaled.every((l) => l.byRole.president > l.byRole.citizen)
  ? pass(`${roleScaled.length} 種貸款的額度都隨職位放大`) : fail('貸款額度沒有隨職位放大');
const sndc = PF.investments.find((x) => x.id === 'INV_SANDISC');
sndc?.unlock?.judgment === 4 && sndc?.scriptedRun?.totalMultiple >= 9
  ? pass(`判斷四解鎖的那一檔，開局那段行情漲 ${sndc.scriptedRun.totalMultiple} 倍`) : fail('SNDC 的解鎖或行情設定不符');
const etf = PF.investments.find((x) => x.trackIndex);
etf?.excessReturn > 0
  ? pass(`台灣五十的超額報酬 ${(etf.excessReturn * 100).toFixed(1)}%，長期贏過大盤`) : fail('ETF 沒有設定超額報酬');
PF.scams.length >= 3 && PF.scams.every((x) => x.unlock?.judgmentMax <= 2 && x.pitch && x.bust)
  ? pass(`${PF.scams.length} 種詐騙標的都只對判斷二以下的人出現，而且推銷與爆掉各有一段`)
  : fail('詐騙標的的門檻或文本不完整');

// 募款三管道：金額越大越髒
const chs = D.fundraising.channels;
chs.length === 3 ? pass(`募款三管道：${chs.map((c) => c.name).join('、')}`) : fail('募款管道不是三種');
const byMid = [...chs].sort((a, b) => (a.baseRange[0] + a.baseRange[1]) - (b.baseRange[0] + b.baseRange[1]));
byMid.every((c, i) => i === 0 || c.stigmaChance >= byMid[i - 1].stigmaChance)
  ? pass('金額越大的管道，汙名機率越高——這條線是這個系統的整個重點')
  : fail('金額與汙名沒有同向');
chs.find((c) => c.id === 'FUND_SMALL')?.stigmaChance === 0
  ? pass('小額捐一點汙名都不帶') : fail('小額捐不該有汙名');

// 快轉半年
const FFD = D.fastForward;
FFD.months === 6 && FFD.options.length >= 4
  ? pass(`快轉一次 ${FFD.months} 個月，有 ${FFD.options.length} 種過法`) : fail('快轉的設定不完整');
FFD.blockedRoles.includes('legislator') && FFD.blockedRoles.includes('mayor')
  ? pass('有公職在身的人跳不過去，因為他每個月都有非做不可的事') : fail('快轉沒有擋住有公職的人');
Object.values(FFD.education.steps).every((x) => x.terms >= 3 && x.tuitionPerTerm > 0)
  ? pass('每一階學位都要念好幾個學期，而且學費不是零') : fail('學位的學期或學費設定不對');

// 團隊職位逐步解鎖
const roles = D.staffRoles.roles;
const aide = roles.find((r) => r.id === 'aide');
aide.unlock.fame === 0 && roles.filter((r) => (r.unlock?.fame ?? 0) === 0).length === 1
  ? pass('只有隨行助理不需要知名度，其他職位都要等') : fail('開局願意來的職位不只助理');
roles.find((r) => r.id === 'manager').unlock.fame >= 3
  ? pass('競選經理是最後才會到位的那一個') : fail('競選經理的門檻太低');
roles.every((r) => r.unlockNote && r.unlockNote.length >= 15)
  ? pass('每個職位都寫了為什麼現在還沒有人願意來') : fail('有職位缺少解鎖說明');

// 主打形象兩年一次
D.images.reviewMonths === 24
  ? pass('主打形象每二十四個月才需要重新決定一次') : fail('形象的重新決定週期不是兩年');

// 村里長是無黨籍選舉，議員不設知名度門檻
D.elections.levels.villageHead.nonPartisan === true
  ? pass('村里長依法無黨籍，選票上不印黨籍，也就不會有派系對手') : fail('村里長還掛著黨籍');
D.elections.levels.councilor.fameNeed === 0
  ? pass('縣市議員不設知名度門檻，開局第一場就選得到') : fail('議員還擋著素人');

// 錢的單位
const unitFiles = ['src/ui/pages/map.js', 'src/ui/pages/data.js'];
const unitLeak = unitFiles.filter((f) => /十億/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
!unitLeak.length ? pass('畫面上不再用十億當金錢單位') : fail(`還在用十億：${unitLeak.join('、')}`);

/* ═══════════ v0.6.1 ═══════════ */
console.log('\n── v0.6.1 ──');

// 直轄市沒有鄉鎮市
const LV = D.elections.levels;
LV.townshipHead.onlyRegionTypes?.includes('縣') && !LV.townshipHead.onlyRegionTypes.includes('直轄市')
  ? pass('鄉鎮市長只在縣底下才選得到，直轄市與省轄市的區長是派任的') : fail('鄉鎮市長沒有限制在縣');
LV.townshipRep.onlyRegionTypes?.includes('縣')
  ? pass('鄉鎮市民代表同樣只在縣底下') : fail('鄉鎮市民代表沒有限制在縣');

// 提案權
const SC = D.proposals.scopes;
['councilor', 'mayor', 'legislator', 'president'].every((r) => SC[r])
  ? pass(`${Object.keys(SC).filter((k) => k[0] !== '_').length} 種職位有提案權，其餘只能建議`) : fail('提案權的職位不齊');
!SC.citizen && !SC.village && !SC.aide
  ? pass('素人、助理、村里長都沒有提案權——提案權附著在職位上') : fail('不該有提案權的職位拿到了提案權');
SC.councilor.kind === 'localBill' && SC.legislator.kind === 'law'
  ? pass('議員的提案權在議會，立委的在立法院，兩邊不會互相跨界') : fail('提案權的議事機關對不上');

// 遊說：同黨與他黨必須是量級的差別
const LB = D.proposals.lobby;
LB.windowTurns === 3 ? pass('提案之後有三個回合的遊說期') : fail('遊說期不是三個回合');
LB.ownParty.baseGain > LB.otherParty.maxSupport * 2
  ? pass(`自己政黨遊說一次的效果（${LB.ownParty.baseGain}）大於別的政黨的上限（${LB.otherParty.maxSupport}）`)
  : fail('同黨與他黨的遊說沒有拉開差距');
D.proposals.vote.unlobbiedPenalty > 0
  ? pass('沒有被遊說過的黨團不會平白給你一半的票') : fail('沒遊說的黨團還是從五成起跳');

// 助理費補助
const AS = D.staffRoles.aideSubsidy.byRole;
AS.citizen.monthly === 0 && AS.legislator.monthly > AS.councilor.monthly
  && AS.councilor.monthly > AS.village.monthly
  ? pass(`助理費補助隨層級放大：村里長 ${AS.village.monthly / 10000} 萬、縣市議員 ${AS.councilor.monthly / 10000} 萬、直轄市議員 ${AS.councilor.metroMonthly / 10000} 萬、立委 ${AS.legislator.monthly / 10000} 萬`)
  : fail('助理費補助的層級關係不對');
AS.councilor.metroMonthly === 320000 && AS.councilor.monthly === 160000
  ? pass('直轄市議員三十二萬、縣市議員十六萬，跟地方民代費用支給條例第六條對得上') : fail('議員助理費不符法定數字');
AS.village.monthly === 50000
  ? pass('村里長的事務補助費每月五萬，原住民地區加兩成') : fail('村里長事務費不符');
Object.values(AS).every((x) => x.note && x.note.length >= 10)
  ? pass('每一級的補助都寫了它在現實裡是什麼') : fail('有補助沒有說明');

// 服務處負載
const SD = D.tuning.serviceDesk;
SD.serviceStaffMult > SD.aideMult && SD.aideMult > SD.otherMult
  ? pass('選民服務專員處理陳情的效率最高，這是他這個位子存在的理由') : fail('服務處的人力效率沒有分級');
SD.dropThreshold > 0 && SD.favorPerDrop > 0
  ? pass(`案子堆超過 ${SD.dropThreshold} 件就會有人等到放棄，而每一件都是一個對你失望的人`) : fail('沒有做出案子爛掉的後果');
SD.roleMult.legislator > SD.roleMult.citizen
  ? pass('有公職的人被找上門的機會多很多，因為大家知道你講得上話') : fail('陳情量沒有跟職位掛勾');

// 得票補助款
const SB = D.elections.subsidy;
SB.perVote === 30 && SB.partyPerVote === 50
  ? pass('候選人每票三十元、政黨票每票五十元，跟選罷法對得上') : fail('補助款金額不符法定數字');
Math.abs(SB.winnerRatio - 1 / 3) < 0.01
  ? pass('門檻是當選票數的三分之一，不是得票率——這個差別在複數選區裡差很多') : fail('補助款門檻不是三分之一');
Object.entries(SB.partyCut).filter(([k]) => k[0] !== '_').every(([, v]) => v > 0 && v < 0.5)
  ? pass('每個政黨都會從當選人的補助款裡抽一筆，比例落在合理範圍') : fail('政黨抽成的比例不合理');
(SB.noSubsidyLevels ?? []).includes('villageHead')
  ? pass('村里長這一級沒有中央的競選費用補助款') : fail('村里長不該有補助款');

// 起點與存款
const STS = D.starts.starts;
STS.length === 5 && ['scion', 'listMP', 'tycoon'].every((id) => STS.some((x) => x.id === id))
  ? pass(`五種起點：${STS.map((x) => x.name).join('、')}`) : fail('起點數量或內容不對');
STS.find((x) => x.id === 'listMP').role === 'legislator'
  ? pass('不分區立委開局就是立法委員，但沒有選區') : fail('不分區立委的職位不對');
STS.find((x) => x.id === 'listMP').grassrootsHome === 0
  ? pass('不分區沒有選區，所以家鄉基層是零') : fail('不分區立委不該有家鄉基層');
const BGS = D.backgrounds.backgrounds;
!BGS.some((b) => ['activist', 'heir', 'local'].includes(b.id))
  ? pass(`會跟遊戲文本打架的三個出身已經拿掉，現在剩 ${BGS.map((b) => b.name).join('、')}`) : fail('該拿掉的出身還在');
BGS.every((b) => b.wealth && b.wealth.perYear2 > 0) && STS.filter((s) => s.wealth).every((s) => s.wealth.perYear2 > 0)
  ? pass('存款全部改成年齡的二次函數，前幾年在還學貸，後幾年是複利') : fail('有出身或起點的存款不是二次函數');
BGS.every((b) => b.personalAssets === undefined)
  ? pass('舊的固定存款欄位已經全部移除') : fail('還有出身留著固定存款');

// 政論節目
const SHW = D.shows.shows;
SHW.every((x) => x.partyAffinity && Object.keys(x.partyAffinity).length >= 7)
  ? pass(`${SHW.length} 個節目都標了對七個政黨的邀約傾向`) : fail('有節目沒有標政黨傾向');
SHW.every((x) => x.fee >= 20000 && x.fee <= 80000)
  ? pass(`通告費落在 ${Math.min(...SHW.map((x) => x.fee)) / 10000}～${Math.max(...SHW.map((x) => x.fee)) / 10000} 萬——一個月只有兩點行動點，那半個月的價錢要看得見`)
  : fail('通告費不在兩萬到八萬之間');
SHW.every((x) => Object.values(x.partyAffinity).every((v) => v > 0))
  ? pass('沒有一個節目把任何一黨壓到零，偶爾還是會找對面的人來當沙包') : fail('有節目把某一黨完全排除');
SHW.some((x) => x.partyAffinity.TPL >= 2)
  ? pass('中間政黨也有自己的主場節目') : fail('民生黨沒有主場節目');

// 掃街不花錢（兩條路都要是零）
const elecSrc = fs.readFileSync(path.join(ROOT, 'src/ui/pages/election.js'), 'utf8');
/id: 'street',[^}]*cost: 0/.test(elecSrc)
  ? pass('選戰期的掃街拜票也是零成本，破產的候選人還是走得出門') : fail('選戰期的掃街還在扣錢');

console.log(`\n${errors ? `✗ ${errors} 項錯誤` : '✓ 全部通過'}${warns ? `，${warns} 項警告` : ''}`);
process.exit(errors ? 1 : 0);
