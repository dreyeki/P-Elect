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
  && D.backgrounds.backgrounds.some((x) => x.attrCost > 0)
  && D.starts.partyChoice.some((x) => x.attrCost > 0);
costOk ? pass('比較好的開局要付屬性點') : fail('開局選項沒有屬性成本');
D.starts.defaults?.name === '龍天台' && D.starts.defaults?.age === 35
  ? pass('開局預設為龍天台、35 歲') : fail('開局預設值不符');

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

console.log(`\n${errors ? `✗ ${errors} 項錯誤` : '✓ 全部通過'}${warns ? `，${warns} 項警告` : ''}`);
process.exit(errors ? 1 : 0);
