// v0.6.1：提案修法與遊說、助理費補助、服務處負載、得票補助款、新起點與存款曲線、調試模式
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
globalThis.btoa = (x) => Buffer.from(x, 'binary').toString('base64');
globalThis.atob = (x) => Buffer.from(x, 'base64').toString('binary');

const { loadData } = await import('../src/data/loader.js');
const { createGame, wealthAt } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales } = await import('../src/util/scale.js');
const { Rng } = await import('../src/core/Rng.js');
const Char = await import('../src/systems/CharacterSystem.js');
const P = await import('../src/systems/ProposalSystem.js');
const E = await import('../src/systems/ElectionSystem.js');
const Desk = await import('../src/systems/ServiceOfficeSystem.js');
const F = await import('../src/util/format.js');
const SaveMgr = await import('../src/save/SaveManager.js');

const data = await loadData(); initScales(data.scales); SaveMgr.setData(data);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (seed = 'V061', over = {}) => createGame(data, {
  seedStr: seed, name: '龍天台', gender: 'm', education: '大學', age: 35,
  startId: 'rookie', backgroundId: 'reporter',
  homeDistrict: data.districts.districts[0].id, party: 'PDA',
  ideology: {}, china: {},
  baseAttrs: { stamina: 2, sociability: 3, charisma: 2, eloquence: 3, judgment: 3, boldness: 2 },
  ...over,
});
const lawId = data.laws.laws[0].id;
const otherTier = (s) => (s.laws[lawId] === 0 ? 1 : 0);

/* ── 1. 直轄市沒有鄉鎮市長 ── */
console.log('\n── 選舉層級 ──');
const sched = data.elections.schedule[0];
const byType = {};
for (const rid of ['TPE', 'KHH', 'KEE', 'YUN', 'PIF']) {
  const home = data.districts.districts.find((x) => x.regionId === rid && x.type === 'general');
  const fake = { player: { homeDistrict: home.id, fame: 5 } };
  byType[rid] = E.availableRuns(fake, data, sched).map((r) => r.type);
}
ok(!byType.TPE.includes('townshipHead') && !byType.KHH.includes('townshipHead'),
  '直轄市選不到鄉鎮市長，因為區長是派任的');
ok(!byType.KEE.includes('townshipHead'), '省轄市底下也是區，一樣選不到');
ok(byType.YUN.includes('townshipHead') && byType.PIF.includes('townshipHead'),
  '縣底下才有鄉鎮市長可以選');
ok(byType.TPE.includes('councilor') && byType.TPE.includes('villageHead'),
  '直轄市的議員與里長照常選得到');

/* ── 2. 提案權 ── */
console.log('\n── 提案權 ──');
let s = mk();
ok(!P.canPropose(s, data), '素人沒有提案權');
const acts = () => Char.availableActions(s, data).map((a) => a.id);
ok(acts().includes('suggest') && !acts().includes('proposeBill'), '素人看到的是建議，不是提案');
for (const [role, kind] of [['councilor', 'localBill'], ['mayor', 'localBill'],
  ['legislator', 'law'], ['minister', 'law'], ['president', 'law']]) {
  s.player.role = role;
  ok(P.scopeOf(s, data)?.kind === kind, `${role} 的提案權在${P.scopeOf(s, data)?.name}`);
}
s.player.role = 'village';
ok(!P.canPropose(s, data), '村里長沒有提案權');
s.player.role = 'legislator';
ok(acts().includes('proposeBill') && !acts().includes('suggest'), '有提案權的人就不再看到建議');
const c = mk('CROSS'); c.player.role = 'councilor';
ok(!P.propose(c, data, 'law', lawId, otherTier(c), new Rng(1, 0)).ok, '議員提不了中央法律');

/* ── 3. 一次只能一案 ── */
console.log('\n── 一次一案 ──');
s = mk('ONE'); s.player.role = 'legislator';
const rng = new Rng(1, 0);
ok(P.propose(s, data, 'law', lawId, otherTier(s), rng).ok, '第一案送得進去');
ok(!P.proposeState(s, data).ok, `第二案被擋：${P.proposeState(s, data).why.slice(0, 20)}…`);
const rivals = s.proposal.rivals.length;
ok(rivals >= 3 && rivals <= 6, `同會期還有 ${rivals} 個案子在競爭`);
ok(Object.values(s.proposal.support).every((x) => x === 0), '起始只有你自己支持，其他人都是零');

/* ── 4. 遊說：同黨與他黨是兩件事 ── */
console.log('\n── 遊說 ──');
ok(P.lobbyOpen(s, data), '提案後遊說期是開的');
s.meta.turn = s.proposal.lobbyUntil + 1;
ok(!P.lobbyOpen(s, data), `過了 ${data.proposals.lobby.windowTurns} 個回合就關了`);

let own = 0, other = 0, otherMany = 0;
for (let i = 0; i < 25; i++) {
  const g = mk('LOB' + i); g.player.role = 'legislator';
  const r = new Rng(i, 0);
  P.propose(g, data, 'law', lawId, otherTier(g), r);
  P.lobby(g, data, 'PDA', r); own += g.proposal.support.PDA;
  P.lobby(g, data, 'CRP', r); other += g.proposal.support.CRP;
  for (let k = 0; k < 9; k++) P.lobby(g, data, 'CRP', r);
  otherMany += g.proposal.support.CRP;
}
own /= 25; other /= 25; otherMany /= 25;
ok(own > 0.5, `自己政黨遊說一次就大多支持：${(own * 100).toFixed(0)}%`);
ok(other < 0.12, `別的政黨遊說一次幾乎沒有動：${(other * 100).toFixed(0)}%`);
ok(otherMany < 0.25, `別的政黨遊說十次也還是很少：${(otherMany * 100).toFixed(0)}%`);
ok(own > otherMany * 2.5, '同黨一次比他黨十次還有用，因為那是兩件不同的事');

/* ── 5. 排議程與表決 ── */
console.log('\n── 排議程 ──');
function runProposal(seed, lobbies, role = 'legislator', kind = 'law') {
  const g = mk(seed); g.player.role = role; g.player.partyPrestige = 2;
  const r = new Rng(1, 0);
  const rid = data.byId.district[g.player.homeDistrict].regionId;
  const id = kind === 'law' ? lawId : data.localBills.bills[0].id;
  const cur = kind === 'law' ? g.laws[id] : g.localBills[rid][id];
  const tgt = cur === 0 ? 1 : 0;
  if (!P.propose(g, data, kind, id, tgt, r, rid).ok) return null;
  for (const pid of lobbies) P.lobby(g, data, pid, r);
  for (let k = 0; k < 12; k++) advance(g, data);
  const changed = kind === 'law' ? g.laws[id] === tgt : g.localBills[rid][id] === tgt;
  return { shelved: g.proposal?.stage === 'shelved', changed, g };
}
let shelved = 0;
for (let i = 0; i < 10; i++) if (runProposal('NOLOB' + i, [])?.shelved) shelved++;
ok(shelved >= 9, `不遊說的十局裡有 ${shelved} 局連議程都排不上`);
let onAgenda = 0;
for (let i = 0; i < 10; i++) if (runProposal('LOB' + i, ['PDA'])?.shelved === false) onAgenda++;
ok(onAgenda >= 7, `同黨遊說之後十局裡有 ${onAgenda} 局排得上議程`);

let passedNone = 0, passedOwn = 0, passedAll = 0;
for (let i = 0; i < 10; i++) {
  if (runProposal('PA' + i, [])?.changed) passedNone++;
  if (runProposal('PB' + i, ['PDA'])?.changed) passedOwn++;
  if (runProposal('PC' + i, ['PDA', 'CRP', 'TPL'])?.changed) passedAll++;
}
ok(passedNone === 0, '完全不遊說的案子一件都沒過');
ok(passedOwn > passedNone && passedAll >= passedOwn,
  `過關數隨遊說增加：不談 ${passedNone}／同黨 ${passedOwn}／全談 ${passedAll}`);

/* ── 6. 建議 ── */
console.log('\n── 建議 ──');
s = mk('SUG');
const before = s.issues.housing;
const sr = P.suggest(s, data, 'housing', new Rng(3, 0));
ok(sr.ok && s.issues.housing > before, `建議把議題關注度從 ${before.toFixed(2)} 推到 ${s.issues.housing.toFixed(2)}`);
ok(sr.chance > 0 && sr.chance < 0.6, `有 ${(sr.chance * 100).toFixed(0)}% 的機會被有提案權的人撿走`);
ok(s.suggestions.length === 1, '建議會被記下來，等別人來撿');

/* ── 7. 助理費補助 ── */
console.log('\n── 助理費補助 ──');
const subs = {};
for (const role of ['citizen', 'village', 'councilor', 'legislator', 'mayor', 'president']) {
  const g = mk('SUB' + role); g.player.role = role;
  subs[role] = Desk.aideSubsidy(g, data).monthly;
}
ok(subs.citizen === 0, '素人一毛補助都沒有');
ok(subs.village > 0 && subs.village < subs.councilor, `村里長 ${subs.village / 10000} 萬 < 議員 ${subs.councilor / 10000} 萬`);
ok(subs.councilor < subs.legislator, `議員 ${subs.councilor / 10000} 萬 < 立委 ${subs.legislator / 10000} 萬`);
ok(subs.legislator === 420000, `立委的公費助理補助是 ${subs.legislator / 10000} 萬`);
// 直轄市議員拿得比縣市議員多
const metro = mk('METRO', { homeDistrict: 'TPE-01' }); metro.player.role = 'councilor';
const county = mk('COUNTY', { homeDistrict: data.districts.districts.find((d) => d.regionId === 'YUN').id });
county.player.role = 'councilor';
ok(Desk.aideSubsidy(metro, data).monthly > Desk.aideSubsidy(county, data).monthly,
  `直轄市議員 ${Desk.aideSubsidy(metro, data).monthly / 10000} 萬 > 縣市議員 ${Desk.aideSubsidy(county, data).monthly / 10000} 萬`);

// 補助真的會少扣專戶
const poor = mk('POOR'); const rich = mk('RICH'); rich.player.role = 'legislator';
for (const g of [poor, rich]) {
  g.team = [{ id: 'a', role: 'aide', roleName: '助理', salary: 60000, ability: 3, loyalty: 3, ambition: 1, tenure: 0, knownSecrets: 0, graftRisk: 0, graftTaken: 0 }];
}
ok(Desk.payrollSplit(poor, data).outOfPocket === 60000, '素人請一個助理要自己付六萬');
ok(Desk.payrollSplit(rich, data).outOfPocket === 0, '立委請一個助理一毛都不用自己出');
const fund0 = poor.finance.campaign; const fund1 = rich.finance.campaign;
advance(poor, data); advance(rich, data);
ok((fund0 - poor.finance.campaign) > (fund1 - rich.finance.campaign),
  '一個月下來，素人的專戶掉得比立委多');

/* ── 8. 服務處負載 ── */
console.log('\n── 服務處 ──');
s = mk('DESK'); s.player.role = 'legislator'; s.player.fame = 3;
ok(Desk.officeCount(s) === 0, '開局沒有服務處');
ok(Desk.inflow(s, data) === 0, '沒有服務處就沒有陳情案');
s.districts[s.player.homeDistrict].serviceOffice = true;
const inc = Desk.inflow(s, data);
ok(inc > 0, `掛牌之後每個月進來 ${inc} 件陳情`);
const capAlone = Desk.capacity(s, data);
s.team = [{ id: 'a', role: 'service', roleName: '選民服務', salary: 48000, ability: 4, loyalty: 3, ambition: 1, tenure: 0, knownSecrets: 0, graftRisk: 0, graftTaken: 0 }];
ok(Desk.capacity(s, data) > capAlone * 1.5, `請了選民服務專員之後，處理量從 ${capAlone} 變成 ${Desk.capacity(s, data)}`);
// 人手不夠案子會堆積
const busy = mk('BUSY'); busy.player.role = 'legislator'; busy.player.fame = 5;
busy.districts[busy.player.homeDistrict].serviceOffice = true;
for (let i = 0; i < 10; i++) advance(busy, data);
ok(busy.serviceDesk.queue > 0, `一個人撐十個月，堆了 ${busy.serviceDesk.queue} 件沒處理`);
ok(Desk.load(busy, data) > 1, `負載量 ${Desk.load(busy, data).toFixed(1)}：${Desk.loadWord(Desk.load(busy, data)).text}`);
// 人夠就處理得完，而且會長好感
const staffed = mk('STAFF'); staffed.player.role = 'councilor'; staffed.player.fame = 2;
staffed.districts[staffed.player.homeDistrict].serviceOffice = true;
staffed.team = ['service', 'service', 'aide'].map((r, i) => ({ id: 's' + i, role: r, roleName: r, salary: 48000, ability: 4, loyalty: 3, ambition: 1, tenure: 0, knownSecrets: 0, graftRisk: 0, graftTaken: 0 }));
const fav0 = staffed.districts[staffed.player.homeDistrict].playerFavor;
for (let i = 0; i < 10; i++) advance(staffed, data);
ok(staffed.serviceDesk.queue === 0, '人手夠的話案子不會堆');
ok(staffed.districts[staffed.player.homeDistrict].playerFavor > fav0,
  `處理掉 ${staffed.serviceDesk.handledTotal} 件陳情之後，選區好感往上走`);

/* ── 9. 得票補助款 ── */
console.log('\n── 得票補助款 ──');
s = mk('SUBSIDY');
const mkResults = (votes) => votes.map((v, i) => ({
  candidate: { isPlayer: i === 0, name: 'X' + i }, votes: v,
  share: v / votes.reduce((a, b) => a + b, 0),
}));
const lv = data.elections.levels;
let sub = E.subsidyFor(s, data, { type: 'councilor', scopeId: 'KHH-01', level: { ...lv.councilor, seats: 5 } },
  { results: mkResults([12000, 30000, 26000, 22000, 19000, 15000]) });
ok(sub.gross === 12000 * 30, `一萬二千票拿到 ${F.money(sub.gross)}（每票三十元）`);
ok(sub.rate > 0 && sub.cut > 0, `黨中央抽走 ${(sub.rate * 100).toFixed(0)}%，也就是 ${F.money(sub.cut)}`);
ok(sub.net === sub.gross - sub.cut, `你實收 ${F.money(sub.net)}`);
sub = E.subsidyFor(s, data, { type: 'councilor', scopeId: 'KHH-01', level: { ...lv.councilor, seats: 5 } },
  { results: mkResults([4000, 30000, 26000, 22000, 19000, 15000]) });
ok(sub.reason === 'missed' && sub.gross === 0, `沒到當選票數的三分之一就沒有補助（門檻 ${sub.need} 票）`);
sub = E.subsidyFor(s, data, { type: 'villageHead', scopeId: 'KHH-01', level: lv.villageHead },
  { results: mkResults([900, 1100]) });
ok(sub.reason === 'none', '村里長這一級沒有中央的補助款');
s.player.party = null;
sub = E.subsidyFor(s, data, { type: 'legislator', scopeId: 'KHH-01', level: { ...lv.legislator, seats: 1 } },
  { results: mkResults([45000, 90000, 20000]) });
ok(sub.rate === 0 && sub.net === sub.gross, '無黨籍不用分給任何人，全額入袋');

/* ── 10. 新起點與存款曲線 ── */
console.log('\n── 起點與存款 ──');
const starts = data.starts.starts.map((x) => x.id);
ok(['scion', 'listMP', 'tycoon'].every((x) => starts.includes(x)),
  `五種起點：${data.starts.starts.map((x) => x.name).join('、')}`);
const bgs = data.backgrounds.backgrounds.map((x) => x.id);
ok(!bgs.includes('activist') && !bgs.includes('heir') && !bgs.includes('local'),
  `三個會跟文本打架的出身已經拿掉：現在剩 ${data.backgrounds.backgrounds.map((x) => x.name).join('、')}`);
ok(bgs.every((b) => data.backgrounds.backgrounds.find((x) => x.id === b).wealth),
  '每個出身都有存款曲線，不再是一個固定數字');

// 醫師的存款是年齡的二次函數：往上彎，不是直線
const doc = data.backgrounds.backgrounds.find((x) => x.id === 'doctor').wealth;
const d35 = wealthAt(doc, 35), d45 = wealthAt(doc, 45), d55 = wealthAt(doc, 55);
ok(d35 < d45 && d45 < d55, `醫師存款 35 歲 ${F.money(d35)}／45 歲 ${F.money(d45)}／55 歲 ${F.money(d55)}`);
ok((d55 - d45) > (d45 - d35), '後十年存的比前十年多，所以曲線是往上彎的');
const rep = data.backgrounds.backgrounds.find((x) => x.id === 'reporter').wealth;
ok(wealthAt(rep, 45) < wealthAt(doc, 45), '同齡的記者存得比醫師少很多');

// 不分區立委一上任就是立委
const mp = mk('MP', { startId: 'listMP', backgroundId: 'lawyer', age: 45 });
ok(mp.player.role === 'legislator', '不分區立委開局就是立法委員');
// 不分區沒有選區。這是這個起點的整個設計：全國知名度最高，地方基層最薄。
const grassBy = {};
for (const id of ['rookie', 'aide', 'scion', 'listMP', 'tycoon']) {
  const g = mk('GR' + id, { startId: id, backgroundId: 'lawyer', age: 45 });
  grassBy[id] = g.districts[g.player.homeDistrict].playerGrassroots;
}
ok(grassBy.listMP === Math.min(...Object.values(grassBy)),
  `不分區立委的基層是五種起點裡最薄的：${Object.entries(grassBy).map(([k, v]) => k + ' ' + v).join('、')}`);
ok(grassBy.listMP < grassBy.scion, '政治世家有家族留下來的系統，不分區沒有');
ok(mp.player.fame >= 3, `但他的全國知名度是 ${mp.player.fame}，比素人高得多`);
ok(Desk.aideSubsidy(mp, data).monthly === 420000, '而且他一開局就有立委的助理費補助');
const ty = mk('TY', { startId: 'tycoon', backgroundId: 'lawyer', age: 50 });
ok(ty.finance.personal > 50000000, `知名企業家開局的身家 ${F.money(ty.finance.personal)}`);
const sc = mk('SC', { startId: 'scion', backgroundId: 'reporter', age: 35 });
ok(sc.districts[sc.player.homeDistrict].playerGrassroots >= 3, '政治世家開局就有家族留下來的基層');

/* ── 11. 掃街不花錢 ── */
console.log('\n── 掃街 ──');
const { CAMPAIGN_ACTIONS } = await import('../src/ui/pages/election.js');
ok(CAMPAIGN_ACTIONS.find((a) => a.id === 'street').cost === 0, '選戰期的掃街拜票也是零成本');
ok((data.tuning.canvass?.cost ?? -1) === 0, '平時的跑攤一樣是零成本');

/* ── 12. 政論節目的政黨傾向與通告費 ── */
console.log('\n── 政論節目 ──');
const shows = data.shows.shows;
ok(shows.every((x) => x.partyAffinity), `${shows.length} 個節目都標了政黨傾向`);
ok(shows.every((x) => x.fee >= 20000 && x.fee <= 80000),
  `通告費全部落在兩萬到八萬：${Math.min(...shows.map((x) => x.fee)) / 10000}～${Math.max(...shows.map((x) => x.fee)) / 10000} 萬`);
const green = shows.find((x) => x.id === 'SHOW_LATENIGHT');
const blue = shows.find((x) => x.id === 'SHOW_WARROOM');
const white = shows.find((x) => x.id === 'SHOW_LIVELIHOOD');
ok(green.partyAffinity.PDA > green.partyAffinity.CRP * 3, '深綠節目找進盟的人遠多於國民');
ok(blue.partyAffinity.CRP > blue.partyAffinity.PDA * 3, '深藍節目反過來');
ok(white && white.partyAffinity.TPL > 2, '民生黨也有自己的主場節目');
// 立場鮮明的節目要有明顯偏食，中間的綜藝與網路節目則不必——
// 那些節目本來就不在乎你是哪一黨的。
const partisan = shows.filter((x) => Math.abs(x.bias) >= 2);
ok(partisan.length >= 4 && partisan.every((x) => Object.values(x.partyAffinity).some((v) => v <= 0.4)),
  `${partisan.length} 個立場鮮明的節目都有幾個黨是它很少找的`);
ok(shows.every((x) => Object.values(x.partyAffinity).every((v) => v > 0)),
  '但沒有一個節目把任何一黨的機率壓到零——偶爾要找對面的人來當沙包');

/* ── 13. 調試模式 ── */
console.log('\n── 調試模式 ──');
s = mk('DBG');
ok(!s.flags.debug, '預設不開調試模式');
s.flags.debug = true;
const round = SaveMgr.deserialize(JSON.parse(JSON.stringify(SaveMgr.serialize(s))), data);
ok(round.flags.debug === true, '開過調試模式的存檔會一直帶著這個標記');

/* ── 14. 長跑 ── */
console.log('\n── 長跑 ──');
s = mk('LONG61'); s.player.role = 'legislator'; s.player.fame = 3;
s.districts[s.player.homeDistrict].serviceOffice = true;
let bad = 0;
for (let i = 0; i < 72; i++) {
  advance(s, data);
  if (!Number.isFinite(s.finance.campaign) || !Number.isFinite(s.serviceDesk.queue)) bad++;
}
ok(bad === 0, '七十二回合裡沒有任何一個回合把數字算壞');
ok(s.serviceDesk.handledTotal > 0, `六年下來服務處處理了 ${s.serviceDesk.handledTotal} 件陳情`);

console.log(fails ? `\n${fails} 項失敗` : '\nv0.6.1 全部通過');
process.exit(fails ? 1 : 0);
