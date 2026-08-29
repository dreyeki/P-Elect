// v0.6.0：造勢、私人財務（房貸、借貸、投資、詐騙）、募款三管道、選區代稱、形象兩年一次
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
globalThis.btoa = (x) => Buffer.from(x, 'binary').toString('base64');
globalThis.atob = (x) => Buffer.from(x, 'base64').toString('binary');

const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales } = await import('../src/util/scale.js');
const { Rng } = await import('../src/core/Rng.js');
const Char = await import('../src/systems/CharacterSystem.js');
const Rally = await import('../src/systems/RallySystem.js');
const Asset = await import('../src/systems/AssetSystem.js');
const Fund = await import('../src/systems/FundraiseSystem.js');
const Team = await import('../src/systems/TeamSystem.js');
const ImageSys = await import('../src/systems/ImageSystem.js');
const F = await import('../src/util/format.js');
const FF = await import('../src/systems/FastForwardSystem.js');
const Election = await import('../src/systems/ElectionSystem.js');
const SaveMgr = await import('../src/save/SaveManager.js');

const data = await loadData(); initScales(data.scales); SaveMgr.setData(data);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (seed = 'V060', over = {}) => createGame(data, {
  seedStr: seed, name: '龍天台', gender: 'm', education: '大學', age: 35,
  startId: 'rookie', backgroundId: 'activist',
  homeDistrict: data.districts.districts[0].id, party: null,
  ideology: {}, china: {},
  baseAttrs: { stamina: 2, sociability: 2, charisma: 2, eloquence: 2, judgment: 2, boldness: 2 },
  ...over,
});

/* ── 1. 掃街不花錢 ── */
console.log('\n── 掃街 ──');
ok((data.tuning.canvass?.cost ?? -1) === 0, '掃街的成本設定是零，破產也跑得動');

/* ── 2. 選區代稱 ── */
console.log('\n── 選區代稱 ──');
const ds = data.districts.districts;
ok(ds.every((d) => d.alias && d.alias.length >= 2), `195 個選區全部有代稱，最短 ${Math.min(...ds.map((d) => d.alias.length))} 字`);
ok(ds.every((d) => d.alias !== d.name), '代稱都不等於正式名稱');
const khh1 = ds.find((d) => d.id === 'KHH-01');
ok(F.distName(khh1) === '高雄市第一選舉區(旗美)', `高雄市第一選舉區的顯示：${F.distName(khh1)}`);
ok(F.distName(khh1, { aliasOnly: true }) === '旗美', '只要代稱的時候拿得到旗美');

/* ── 3. 錢的單位不用十億 ── */
console.log('\n── 金錢單位 ──');
ok(!F.bil(31200).includes('十億'), `三兆二的 GDP 寫成：${F.bil(31200)}`);
ok(F.yiBig(32000).startsWith('3 兆'), `yiBig(32000) = ${F.yiBig(32000)}`);
ok(F.yiBig(0.4).includes('萬'), `一億以下降到萬：${F.yiBig(0.4)}`);
const srcFiles = ['src/ui/pages/map.js', 'src/ui/pages/data.js', 'src/util/format.js', 'tests/headless.mjs'];
const leaks = srcFiles.filter((f) => /'\s*十億|十億'|十億`/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
ok(!leaks.length, `畫面上不會再出現十億這個單位${leaks.length ? '：' + leaks.join('、') : ''}`);

/* ── 4. 開局送房 ── */
console.log('\n── 私人財產 ──');
let s = mk();
const H = s.assets.house;
ok(!!H, '開局就有一間自有住宅');
ok(H.value >= 3_500_000 && H.value <= 14_000_000, `房價 ${F.money(H.value)}（六到七百萬乘上家鄉的房價指數）`);
ok(H.mortgage === 3_000_000, `背著 ${F.money(H.mortgage)} 的房貸`);
ok(Asset.netWorth(s) > s.finance.personal, '淨資產把房子算進去了，比帳戶現金多');

// 房貸每個月真的在扣，而且餘額會下降
const cashBefore = s.finance.personal, mortBefore = H.mortgage;
for (let i = 0; i < 12; i++) advance(s, data);
ok(s.assets.house.mortgage < mortBefore, `一年之後房貸餘額從 ${F.money(mortBefore)} 降到 ${F.money(s.assets.house.mortgage)}`);
ok(s.assets.house.value > H.value * 0.9, '房子本身緩步增值');

/* ── 5. 貸款額度隨職位放大 ── */
console.log('\n── 貸款 ──');
s = mk();
const capBy = {};
for (const role of ['citizen', 'councilor', 'legislator', 'mayor']) {
  s.player.role = role;
  capBy[role] = Asset.capOf(s, data, 'LOAN_FARM');
}
ok(capBy.citizen < capBy.councilor && capBy.councilor < capBy.legislator && capBy.legislator < capBy.mayor,
  `農會額度隨職位放大：${Object.entries(capBy).map(([k, v]) => k + ' ' + Math.round(v / 10000) + '萬').join('、')}`);

s = mk(); s.player.role = 'councilor';
const before = s.finance.personal;
const r = Asset.borrow(s, data, 'LOAN_BANK', 1_000_000);
ok(r.ok && s.finance.personal === before + r.amount, `銀行信貸撥款 ${F.money(r.amount)} 進帳戶`);
ok(s.assets.loans.length === 1 && s.assets.loans[0].monthly > 0, `每月要還 ${F.money(s.assets.loans[0].monthly)}`);
const cashAfterBorrow = s.finance.personal;
advance(s, data);
ok(s.finance.personal < cashAfterBorrow, '下一個回合月付真的被扣掉了');

// 選上的時候借得到，落選之後同一筆負債就變成災難——
// 這是很多政治生涯真正的終點，而不是哪一場辯論輸了。
s = mk(); s.player.role = 'mayor';
for (const id of ['LOAN_FARM', 'LOAN_BANK', 'LOAN_MORTGAGE_TOP']) {
  Asset.borrow(s, data, id, Asset.capOf(s, data, id));
}
ok(Asset.loanState(s, data, 'LOAN_BANK').cap === 0, '首長身分借滿之後額度歸零');
const ratioMayor = Asset.debtRatio(s, data);
s.player.role = 'citizen';
const ratioOut = Asset.debtRatio(s, data);
ok(ratioOut > ratioMayor * 2, `落選之後負債比從 ${ratioMayor.toFixed(1)} 倍跳到 ${ratioOut.toFixed(1)} 倍`);
const denied = Asset.loanState(s, data, 'LOAN_FARM');
ok(!denied.ok, `落選以後就沒有人願意再借：${denied.why}`);

// 增貸要有房子，額度看漲了多少
s = mk();
const topUp = Asset.loanState(s, data, 'LOAN_MORTGAGE_TOP');
ok(topUp.ok && topUp.cap > 0, `房屋增貸可借 ${F.money(topUp.cap)}`);
s.assets.house = null;
ok(!Asset.loanState(s, data, 'LOAN_MORTGAGE_TOP').ok, '沒有房子就不能增貸');

/* ── 6. 投資：判斷是門檻 ── */
console.log('\n── 投資 ──');
s = mk();
s.player.attrs.judgment = 2;
let opts = Asset.investOptions(s, data).map((x) => x.id);
ok(!opts.includes('INV_SANDISC'), '判斷二看不到 SNDC');
ok(opts.some((x) => x.startsWith('SCAM_')), `判斷二看得到 ${opts.filter((x) => x.startsWith('SCAM_')).length} 個詐騙標的`);
s.player.attrs.judgment = 4;
opts = Asset.investOptions(s, data).map((x) => x.id);
ok(opts.includes('INV_SANDISC'), '判斷四解鎖 SNDC');
ok(!opts.some((x) => x.startsWith('SCAM_')), '判斷四以後那些東西就不會出現在選單裡了');

// SNDC 的那一段行情：開局幾個月漲近十倍
s = mk(); s.player.attrs.judgment = 4;
s.finance.personal = 5_000_000;
Asset.buy(s, data, 'INV_SANDISC', 1_000_000);
for (let i = 0; i < 12; i++) advance(s, data);
const sndc = s.assets.holdings.find((h) => h.defId === 'INV_SANDISC');
const mult = sndc ? sndc.value / sndc.cost : 0;
ok(mult > 6 && mult < 15, `SNDC 開局那一段漲了 ${mult.toFixed(1)} 倍`);

// 台灣五十長期贏過大盤
s = mk(); s.finance.personal = 5_000_000;
Asset.buy(s, data, 'INV_ETF50', 1_000_000);
const idx0 = s.central.stockIndex;
for (let i = 0; i < 60; i++) advance(s, data);
const etf = s.assets.holdings.find((h) => h.defId === 'INV_ETF50');
const idxGain = s.central.stockIndex / idx0;
ok(etf.value / etf.cost > idxGain, `五年後 ETF 漲 ${(etf.value / etf.cost).toFixed(2)} 倍，大盤 ${idxGain.toFixed(2)} 倍`);

// 詐騙會爆
s = mk(); s.player.attrs.judgment = 1; s.finance.personal = 5_000_000;
let busted = 0;
for (let seed = 0; seed < 30; seed++) {
  const g = mk('SCAM' + seed); g.player.attrs.judgment = 1; g.finance.personal = 5_000_000;
  Asset.buy(g, data, 'SCAM_CRYPTO', 1_000_000);
  for (let i = 0; i < 24; i++) advance(g, data);
  if (!g.assets.holdings.some((h) => h.defId === 'SCAM_CRYPTO')) busted++;
}
ok(busted >= 24, `三十局裡有 ${busted} 局的幣爆掉了（設定的爆掉機率是九成）`);

/* ── 7. 募款三管道 ── */
console.log('\n── 募款 ──');
s = mk();
const chIds = data.fundraising.channels.map((c) => c.id);
ok(chIds.length === 3, `三種管道：${data.fundraising.channels.map((c) => c.name).join('、')}`);
ok(Fund.channelState(s, data, 'FUND_SMALL').ok, '素人也開得成小額捐');
ok(!Fund.channelState(s, data, 'FUND_DINNER').ok, '素人辦不成餐會');
ok(!Fund.channelState(s, data, 'FUND_DEVELOPER').ok, '素人見不到建商');

s = mk(); s.player.fame = 3;
const got = {};
for (const id of chIds) {
  const g = mk('FUND' + id); g.player.fame = 3; g.player.role = 'councilor';
  g.finance.campaign = 1_000_000;   // 餐會要先付得出場地訂金
  const rng = new Rng(g.meta.seed, 0);
  let sum = 0;
  for (let i = 0; i < 40; i++) {
    g.flags.fundCooldown = {};
    const res = Fund.run(g, data, id, rng);
    if (res.ok) sum += res.amount;
  }
  got[id] = sum / 40;
}
ok(got.FUND_SMALL < got.FUND_DINNER && got.FUND_DINNER < got.FUND_DEVELOPER,
  `金額排序符合設計：小額捐 ${Math.round(got.FUND_SMALL / 10000)}萬 < 餐會 ${Math.round(got.FUND_DINNER / 10000)}萬 < 建商 ${Math.round(got.FUND_DEVELOPER / 10000)}萬`);

// 建商的錢會留下汙名，小額捐不會
const stig = {};
for (const id of ['FUND_SMALL', 'FUND_DEVELOPER']) {
  const g = mk('STIG' + id); g.player.fame = 3; g.player.role = 'councilor';
  g.finance.campaign = 1_000_000;
  const rng = new Rng(g.meta.seed, 0);
  for (let i = 0; i < 20; i++) { g.flags.fundCooldown = {}; Fund.run(g, data, id, rng); }
  stig[id] = g.player.stigma;
}
ok(stig.FUND_SMALL === 0, '小額捐二十次一點汙名都沒有');
ok(stig.FUND_DEVELOPER > 1, `拜訪建商二十次的汙名累積到 ${stig.FUND_DEVELOPER.toFixed(2)}`);

// 冷卻：同一批人不能連著找
s = mk(); s.player.fame = 3; s.finance.campaign = 1_000_000;
const rng2 = new Rng(s.meta.seed, 0);
Fund.run(s, data, 'FUND_DINNER', rng2);
ok(!Fund.channelState(s, data, 'FUND_DINNER').ok, '剛辦完的餐會有冷卻，不能連著再開一場');

/* ── 8. 造勢 ── */
console.log('\n── 造勢 ──');
s = mk();
ok(!Rally.venueState(s, data, 'V_BOULEVARD').ok, '素人租不到凱道等級的場地');
ok(Rally.venueState(s, data, 'V_STREET').ok, '路口空地誰都租得到');

// 報價要能算出來，而且大場子貴很多
const q1 = Rally.quote(s, data, { venue: 'V_STREET', mobilize: 'M_NONE', speech: 'S_NONE' });
const q2 = Rally.quote(s, data, { venue: 'V_BOULEVARD', mobilize: 'M_BUS', speech: 'S_NONE' });
ok(q2.total > q1.total * 40, `路口空地 ${F.money(q1.total)}，凱道封街加遊覽車 ${F.money(q2.total)}`);
ok(q2.total > 20_000_000, '最大的場子確實是幾千萬等級，這才是台灣造勢的真實價碼');

// 錢不夠就辦不成
s = mk(); s.finance.campaign = 50_000;
const poor = Rally.run(s, data, { venue: 'V_STREET', mobilize: 'M_NONE', speech: 'S_NONE' }, new Rng(1, 0));
ok(!poor.ok, `專戶不夠的時候辦不起來：${poor.msg}`);

// 場地開太大就會空給人看
s = mk(); s.player.fame = 3; s.finance.campaign = 30_000_000;
const big = Rally.run(s, data, { venue: 'V_PLAZA', mobilize: 'M_NONE', speech: 'S_NONE' }, new Rng(7, 0));
ok(big.ok && big.fillRate < 0.3, `基層淺又不動員，市民廣場的到場率只有 ${(big.fillRate * 100).toFixed(0)}%`);
ok(big.q === -1, '空一半的場子拿到的是最差的那一段結果');

// 花錢動員就填得滿
s = mk(); s.player.fame = 3; s.finance.campaign = 30_000_000;
s.districts[s.player.homeDistrict].playerGrassroots = 4;
const full = Rally.run(s, data, { venue: 'V_PARK', mobilize: 'M_PAID', speech: 'S_SELF' }, new Rng(11, 0));
ok(full.ok && full.fillRate > 0.6, `基層深又發車馬費，到場率 ${(full.fillRate * 100).toFixed(0)}%`);
ok(full.cost > 0 && s.finance.campaign === 30_000_000 - full.cost, `錢確實從專戶扣了 ${F.money(full.cost)}`);

// 講稿的門檻
s = mk();
ok(!Rally.speechState(s, data, 'S_THEORY').ok, '沒有理論就不能用理論當骨架');
ok(!Rally.speechState(s, data, 'S_DRAFT').ok, '沒有幕僚就沒有人幫你寫稿');

/* ── 9. 團隊職位逐步解鎖 ── */
console.log('\n── 團隊 ──');
s = mk();
let open = Team.openRoles(s, data).map((r) => r.id);
ok(open.length === 1 && open[0] === 'aide', `素人只有隨行助理會來：${open.join('、')}`);
s.player.fame = 2; s.player.role = 'councilor';
s.team = [{ id: 'x', role: 'aide' }, { id: 'y', role: 'service' }];
open = Team.openRoles(s, data).map((r) => r.id);
ok(open.includes('organizer') && open.includes('policy'), `當上議員以後開得出 ${open.join('、')}`);
ok(!open.includes('manager'), '競選經理還是最後才會到位的那一個');
s.player.fame = 4; s.player.role = 'legislator';
s.team = ['aide', 'service', 'organizer', 'policy'].map((r, i) => ({ id: 'z' + i, role: r }));
ok(Team.openRoles(s, data).map((r) => r.id).includes('manager'), '知名度與團隊都到位之後，競選經理才願意來');

// 一百局的第一位應徵者一定是助理
let notAide = 0;
for (let i = 0; i < 100; i++) {
  const g = mk('HIRE' + i);
  const c = Team.makeCandidate(g, data, new Rng(i, 0));
  if (c && c.role !== 'aide') notAide++;
}
ok(notAide === 0, '一百局的第一位應徵者全部都是隨行助理');

/* ── 10. 主打形象兩年一次 ── */
console.log('\n── 主打形象 ──');
s = mk(); s.player.fame = 2;
ok(Char.actionState(s, data, Char.ACTIONS.find((a) => a.id === 'setImage')).unlocked, '還沒立形象的時候可以決定');
const imgId = ImageSys.available(s, data).find((x) => x.ok).img.id;
ImageSys.adopt(s, data, imgId);
ok(!Char.actionState(s, data, Char.ACTIONS.find((a) => a.id === 'setImage')).unlocked, '立了以後這個行動就收起來了');
ok(ImageSys.monthsUntilReview(s, data) === 24, `二十四個月之後才會再開：現在還要 ${ImageSys.monthsUntilReview(s, data)} 個月`);
s.meta.turn += 24;
ok(ImageSys.canSet(s, data), '滿兩年之後可以重新決定');
const pcBefore = s.player.politicalCapital;
const renew = ImageSys.adopt(s, data, imgId);
ok(renew.ok && renew.renew && s.player.politicalCapital === pcBefore, '續打同一個形象不花政治資本');
s.meta.turn += 24;
s.player.politicalCapital = 200;
const other = ImageSys.available(s, data).filter((x) => x.ok && x.img.id !== imgId)[0];
if (other) {
  const sw = ImageSys.adopt(s, data, other.img.id);
  ok(sw.ok && s.player.politicalCapital < 200, '改打別的才要付政治資本');
}

/* ── 11. 存讀檔要帶著這一本帳 ── */
console.log('\n── 存檔 ──');
s = mk(); s.player.role = 'councilor';
Asset.borrow(s, data, 'LOAN_FARM', 1_000_000);
s.finance.personal = 5_000_000;
Asset.buy(s, data, 'INV_ETF50', 1_000_000);
const round = SaveMgr.deserialize(JSON.parse(JSON.stringify(SaveMgr.serialize(s))), data);
ok(round.assets.house && Math.abs(round.assets.house.value - s.assets.house.value) < 1, '房子存得回來');
ok(round.assets.loans.length === 1 && round.assets.loans[0].defId === 'LOAN_FARM', '貸款存得回來');
ok(round.assets.holdings.length === 1 && round.assets.holdings[0].defId === 'INV_ETF50', '投資部位存得回來');
// 舊存檔沒有 assets，讀回來不能炸
const legacy = JSON.parse(JSON.stringify(SaveMgr.serialize(s)));
delete legacy.state.assets;
const old = SaveMgr.deserialize(legacy, data);
ok(old.assets && Asset.totalDebt(old) === 0, '沒有這一本帳的舊存檔讀得回來，而且不會炸');

/* ── 12. 跑一整局不會壞 ── */
console.log('\n── 長跑 ──');
s = mk('LONG'); s.player.fame = 3; s.player.role = 'councilor'; s.player.attrs.judgment = 1;
let nan = 0;
for (let i = 0; i < 96; i++) {
  advance(s, data);
  if (!Number.isFinite(Asset.netWorth(s)) || !Number.isFinite(s.finance.personal)) nan++;
}
ok(nan === 0, '九十六回合裡沒有任何一個回合把身家算成 NaN');
ok(Number.isFinite(s.assets.house?.value ?? 0), '房價一直是有限的數字');

/* ── 13. 結束回合不再被攔 ── */
console.log('\n── 結束回合 ──');
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
ok(!mainSrc.includes('還有事情沒處理'), '結束回合的時候不再跳出「還有事情沒處理」');

/* ── 14. 沒在選的人不放慢成一週 ── */
console.log('\n── 回合尺度 ──');
s = mk('SCALE');
let sawWeek = false;
for (let i = 0; i < 14; i++) { advance(s, data); if (s.meta.scale === 'week') sawWeek = true; }
ok(!sawWeek, '整整走過一次選舉季，沒有登記參選就一直是月回合');
s.election = { phase: 'campaign' };
Election.enterCampaignScale(s);
ok(s.meta.scale === 'week', '真的下去選了才切成週');
s.election = null; advance(s, data);
ok(s.meta.scale === 'month', '選完就切回月');

/* ── 15. 開局第一場就選得到議員，村里長沒有派系 ── */
console.log('\n── 第一場選舉 ──');
s = mk('FIRSTELEC');
const sched0 = data.elections.schedule[0];
const runs0 = Election.availableRuns(s, data, sched0);
ok(runs0.some((r) => r.type === 'councilor'), `知名度零的素人選得到：${runs0.map((r) => r.level.name).join('、')}`);
ok(data.elections.levels.councilor.fameNeed === 0, '縣市議員不設知名度門檻，擋住素人的是二十萬保證金');
const vRun = { type: 'villageHead', scopeId: s.player.homeDistrict, name: '村里長', level: data.elections.levels.villageHead };
let partisan = 0;
for (let i = 0; i < 30; i++) {
  const g = mk('VIL' + i);
  g.player.party = 'PDA';
  const opps = Election.makeOpponents(g, data, vRun, new Rng(i, 0));
  if (opps.some((c) => c.party !== 'IND')) partisan++;
}
ok(partisan === 0, '三十局的村里長選舉，沒有一位對手掛著黨籍');
s.player.party = 'PDA';
ok(Election.buildPrimary(s, data, vRun, new Rng(1, 0)).skip, '村里長不用跑黨內初選');

/* ── 16. 快轉半年 ── */
console.log('\n── 快轉半年 ──');
s = mk('FF');
ok(FF.state(s, data).ok, '素人可以快轉');
s.player.role = 'legislator';
ok(!FF.state(s, data).ok, `當上立委之後就跳不過去了：${FF.state(s, data).why}`);

// 上班：錢會進來，知名度會掉
s = mk('FFWORK');
const cash0 = s.finance.personal, fame0 = s.player.fame;
let ff = FF.run(s, data, 'FF_WORK', advance, new Rng(1, 0));
ok(ff.ok && ff.months === 6, `一次跳過 ${ff.months} 個月`);
ok(s.meta.turn >= 6, `回合真的往前走了：第 ${s.meta.turn} 回合`);
ok(s.finance.personal > cash0, `半年上班之後現金從 ${F.money(cash0)} 變成 ${F.money(s.finance.personal)}`);
ok(s.player.fame < fame0 + 0.01, '半年沒有露面，知名度不會往上長');

// 休息：疲勞歸零
s = mk('FFREST'); s.player.fatigueRaw = 60;
ff = FF.run(s, data, 'FF_REST', advance, new Rng(2, 0));
ok(ff.ok && s.player.fatigueRaw === 0, '休息半年之後疲勞歸零');

// 蹲點：基層明顯往上
s = mk('FFGROUND');
const g0 = s.districts[s.player.homeDistrict].playerGrassroots;
ff = FF.run(s, data, 'FF_GROUND', advance, new Rng(3, 0));
const g1 = s.districts[s.player.homeDistrict].playerGrassroots;
ok(g1 > g0 + 0.2, `蹲點半年，家鄉基層從 ${g0.toFixed(2)} 長到 ${g1.toFixed(2)}`);

// 進修：學費要付得起，念滿學期才拿得到學位
s = mk('FFSTUDY');
s.player.education = '大學';
s.finance.personal = 3_000_000;
const deg = FF.nextDegree(s, data);
ok(deg?.degree === '碩士', `大學的下一階是${deg?.degree}，要念 ${deg?.step.terms} 個學期`);
// 三個學期要一年半，中間會跨過選舉季；這裡把時鐘擺在兩場選舉中間，
// 讓測試量的是學位進度本身，而不是選舉的擋門
const studyFails = [];
for (let i = 0; i < deg.step.terms; i++) {
  s.election = null; s.meta.scale = 'month'; s.meta.year = 2029; s.meta.month = 1;
  const rr = FF.run(s, data, 'FF_STUDY', advance, new Rng(10 + i, 0));
  if (!rr.ok) studyFails.push(rr.msg);
}
ok(!studyFails.length, `三個學期都念得下去${studyFails.length ? '：' + studyFails.join('／') : ''}`);
ok(s.player.education === '碩士', `念滿之後學歷變成 ${s.player.education}`);
ok(FF.nextDegree(s, data)?.degree === '博士', '碩士之後還有博士可以念');
s.player.education = '博士';
ok(FF.nextDegree(s, data) === null, '博士就是頂了，再念不會多一票');

// 選舉在眼前的時候不給跳
s = mk('FFELEC');
for (let i = 0; i < 8; i++) advance(s, data);
ok(!FF.state(s, data).ok, `選舉就在眼前的時候擋下來：${FF.state(s, data).why}`);

console.log(fails ? `\n${fails} 項失敗` : '\nv0.6.0 全部通過');
process.exit(fails ? 1 : 0);
