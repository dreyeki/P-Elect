// v0.6.2：同日選舉與母雞帶小雞、黨中央的選區評估、上級人物的免費造勢場、人群試作沙盒
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
const E = await import('../src/systems/ElectionSystem.js');
const B = await import('../src/systems/BallotSystem.js');
const R = await import('../src/systems/RallySystem.js');
const Lab = await import('../src/systems/PopLabSystem.js');
const F = await import('../src/util/format.js');

const data = await loadData(); initScales(data.scales);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (seed = 'V062', over = {}) => {
  const g = createGame(data, {
    seedStr: seed, name: '龍天台', gender: 'm', education: '大學', age: 35,
    startId: 'rookie', backgroundId: 'reporter', homeDistrict: 'KHH-01', party: 'PDA',
    ideology: {}, china: {},
    baseAttrs: { stamina: 2, sociability: 3, charisma: 3, eloquence: 4, judgment: 3, boldness: 3 },
    ...over,
  });
  g.player.fame = over.fame ?? 2;
  return g;
};
const local = data.elections.schedule[0];   // 2026/11 地方
const nat = data.elections.schedule[1];     // 2028/1 中央
const lv = data.elections.levels;
const runC = { type: 'councilor', scopeId: 'KHH-01', name: '議員', level: { ...lv.councilor, seats: 5, costMult: 1 } };
const runL = { type: 'legislator', scopeId: 'KHH-L01', name: '立委', level: { ...lv.legislator, seats: 1, costMult: 3.6 } };
const runM = { type: 'mayor', scopeId: 'KHH', name: '市長', level: { ...lv.mayor, seats: 1, costMult: 12 } };

/* ── 1. 同一天的選票排序 ── */
console.log('\n── 同日選舉 ──');
ok(B.topOfTicket(data, local) === 'mayor', '地方選舉那一天排最前面的是縣市長');
ok(B.topOfTicket(data, nat) === 'president', '中央選舉那一天排最前面的是總統');

let s = mk('T1'); for (let i = 0; i < 10; i++) advance(s, data);
let rng = new Rng(7, 0);
const above = B.runAbove(s, data, runC, local, rng);
ok(above.races.length >= 1 && above.races[0].type === 'mayor',
  `玩家選議員，先開的是 ${above.races.map((r) => r.name).join('、')}`);
ok(above.races[0].share > 0.3 && above.races[0].share < 0.8,
  `縣市長那一場的得票率 ${(above.races[0].share * 100).toFixed(1)}%，落在合理範圍`);
ok(!!above.coattail && above.coattail.topType === 'mayor', '母雞的身分被記下來了');
ok(s.flags.coattail === above.coattail, 'computeVotes 讀得到這個結果');

const outcome = { won: true, results: [{ candidate: { isPlayer: true }, share: 0.2, votes: 1000 }, { candidate: { isPlayer: false, party: 'CRP' }, share: 0.18, votes: 900 }] };
const below = B.runBelow(s, data, runC, outcome, local, rng, above);
ok(below.length >= 1, `玩家開完票之後再開 ${below.map((r) => r.name).join('、')}`);
ok(!below.some((r) => r.type === 'townshipHead'),
  '高雄是直轄市，開票畫面不會冒出一場不存在的鄉鎮市長選舉');
const yun = mk('T2', { homeDistrict: data.districts.districts.find((d) => d.regionId === 'YUN' && d.type === 'general').id });
for (let i = 0; i < 6; i++) advance(yun, data);
const yunRun = { type: 'councilor', scopeId: yun.player.homeDistrict, name: '議員', level: { ...lv.councilor, seats: 5 } };
const yunBelow = B.runBelow(yun, data, yunRun, outcome, local, new Rng(3, 0), B.runAbove(yun, data, yunRun, local, new Rng(3, 0)));
ok(yunBelow.some((r) => r.type === 'townshipHead'), '雲林是縣，就開得出鄉鎮市長那一場');

// 複數席次的選舉要給席次分佈，不是只給第一名
const withSeats = [...above.races, ...below].find((r) => r.seats > 1);
if (withSeats) {
  const total = withSeats.seatSplit.reduce((a, x) => a + x.seats, 0);
  ok(total === withSeats.seats, `複數席次的選舉給的是席次分佈，加起來剛好 ${total} 席`);
}

/* ── 2. 母雞帶小雞真的會改變票數 ── */
console.log('\n── 母雞帶小雞 ──');
const warm = [];
for (let i = 0; i < 12; i++) { const g = mk('W' + i); for (let k = 0; k < 8; k++) advance(g, data); warm.push(g); }
function winRate(run, coatParty, shift) {
  let won = 0;
  warm.forEach((g, i) => {
    g.flags.coattail = coatParty
      ? { topType: run.type === 'councilor' ? 'mayor' : 'president', topName: 'x', party: coatParty, shift }
      : null;
    const rr = new Rng(i, 0);
    const cs = [{ isPlayer: true, name: '龍天台', party: 'PDA', fame: 2, stigma: 0, attrs: g.player.attrs },
      ...E.makeOpponents(g, data, run, rr)];
    const rs = E.computeVotes(g, data, run, cs, rr).results;
    const rank = rs.findIndex((x) => x.candidate.isPlayer);
    if (rank >= 0 && rank < (run.level.seats ?? 1)) won++;
  });
  return won / warm.length * 100;
}
const base = winRate(runL, null, 0);
const lifted = winRate(runL, 'PDA', 0.12);
const dragged = winRate(runL, 'CRP', 0.12);
ok(lifted > base, `總統大勝 12pt 把立委當選率從 ${base.toFixed(0)}% 抬到 ${lifted.toFixed(0)}%`);
ok(dragged < base, `總統輸掉 12pt 把當選率拖到 ${dragged.toFixed(0)}%`);
ok(lifted - dragged >= 10, `一場總統選舉的差別是 ${(lifted - dragged).toFixed(0)} 個百分點的當選率——下層級確實很大程度取決於上層級`);
const cRates = data.elections.sameDay.coattail;
ok(cRates.president.partyList > cRates.president.legislator,
  '政黨票跟著總統跑得比區域立委還兇，因為那根本是同一張選票上的同一個判斷');
ok(cRates.mayor.villageHead < cRates.mayor.councilor * 0.4,
  '村里長幾乎不受影響——那一票投的是隔壁的鄰居，不是政黨');

// 玩家自己就是母雞的時候，帶動下層級的是他自己的結果
s = mk('TOP'); for (let i = 0; i < 8; i++) advance(s, data);
const topAbove = B.runAbove(s, data, runM, local, new Rng(1, 0));
ok(topAbove.races.length === 0, '玩家選市長的時候，上面沒有別的場次要先開');
B.runBelow(s, data, runM, { won: true, results: [
  { candidate: { isPlayer: true }, share: 0.55 }, { candidate: { isPlayer: false, party: 'CRP' }, share: 0.40 }] },
local, new Rng(1, 0), topAbove);
ok(s.flags.coattail?.fromPlayer === true, '這時候的母雞是玩家自己');

/* ── 3. 黨中央的選區評估 ── */
console.log('\n── 黨中央的評估 ──');
s = mk('AS');
const assess = (run, mine, theirs) => {
  s.election = { run, poll: [{ isPlayer: true, share: mine }, { isPlayer: false, share: theirs, party: 'CRP' }], weeksElapsed: 5 };
  return E.assessDistrict(s, data, run);
};
ok(assess(runL, 0.50, 0.48).tier.id === 'MUST_WIN', '五五波的單一席次選區是必爭之地');
ok(assess(runL, 0.62, 0.34).tier.id === 'SAFE', '大幅領先的是票倉，黨部不會多給');
ok(assess(runL, 0.28, 0.68).tier.id === 'WRITE_OFF', '差太多的是陪榜');
const tossup = assess(runL, 0.50, 0.48), safe = assess(runL, 0.62, 0.34), lost = assess(runL, 0.28, 0.68);
ok(tossup.resource > safe.resource && tossup.resource > lost.resource,
  `五五波拿到的資源最多：必爭 ${tossup.resource.toFixed(2)}、票倉 ${safe.resource.toFixed(2)}、陪榜 ${lost.resource.toFixed(2)}`);
// 單一席次比複數席次值錢
const singleR = assess(runL, 0.50, 0.48).resource;
const multiR = assess({ ...runC, level: { ...lv.councilor, seats: 5 } }, 0.11, 0.20).resource;
ok(singleR > multiR, `單一席次的邊際效益比較高：${singleR.toFixed(2)} > ${multiR.toFixed(2)}`);
ok(data.elections.partyAssess.seatBonus.single > data.elections.partyAssess.seatBonus.multi,
  '資料層也寫明了單一席次的加成比較高');

// 撥款只發生一次，而且要等到黨部排完序
s = mk('FUND');
s.election = { run: runL, poll: [{ isPlayer: true, share: 0.50 }, { isPlayer: false, share: 0.48, party: 'CRP' }], weeksElapsed: 1 };
ok(!E.deliverPartySupport(s, data, runL, new Rng(1, 0)), '第一週還沒撥——黨部還在排全部選區的順序');
s.election.weeksElapsed = 2;
const cash0 = s.finance.campaign;
const fund = E.deliverPartySupport(s, data, runL, new Rng(1, 0));
ok(fund && fund.amount > 0 && s.finance.campaign === cash0 + fund.amount,
  `第二週撥下來 ${F.money(fund.amount)}，錢真的進了專戶`);
s.election.weeksElapsed = 3;
ok(!E.deliverPartySupport(s, data, runL, new Rng(1, 0)), '不會撥第二次');
// 陪榜的選區拿到的錢差很多
const poor = mk('POOR');
poor.election = { run: runL, poll: [{ isPlayer: true, share: 0.28 }, { isPlayer: false, share: 0.68, party: 'CRP' }], weeksElapsed: 2 };
const poorFund = E.deliverPartySupport(poor, data, runL, new Rng(1, 0));
ok(poorFund.amount < fund.amount / 5,
  `陪榜的選區只拿到 ${F.money(poorFund.amount)}，必爭之地拿 ${F.money(fund.amount)}`);
// 無黨籍沒有人評估
const ind = mk('IND', { party: null });
ind.election = { run: runL, poll: [], weeksElapsed: 5 };
ok(E.assessDistrict(ind, data, runL) === null, '無黨籍沒有人替他評估這個選區值不值得投資');

/* ── 4. 上級人物的免費造勢場 ── */
console.log('\n── 免費造勢場 ──');
const G = data.rally.guestRally;
s = mk('G', { fame: 0 });
let got = 0;
for (let i = 0; i < 40; i++) { s.flags.guestRally = null; if (R.rollGuestInvite(s, data, new Rng(i, 0))) got++; }
ok(got === 0, '沒有人會為了一個素人辦場子');
const noParty = mk('NP', { party: null, fame: 3 });
got = 0;
for (let i = 0; i < 40; i++) { noParty.flags.guestRally = null; if (R.rollGuestInvite(noParty, data, new Rng(i, 0))) got++; }
ok(got === 0, '無黨籍收不到黨內大咖的邀請');

const hostsBy = {};
for (const fame of [1, 3, 5]) {
  const seen = new Set();
  for (let i = 0; i < 150; i++) {
    const g = mk('H' + fame + i, { fame });
    const inv = R.rollGuestInvite(g, data, new Rng(i, 0));
    if (inv) seen.add(inv.hostTitle);
  }
  hostsBy[fame] = [...seen];
}
ok(hostsBy[1].length <= 2 && !hostsBy[1].includes('總統'),
  `知名度 1 只找得到 ${hostsBy[1].join('、')}`);
ok(hostsBy[5].length > hostsBy[1].length,
  `知名度 5 找得到的咖比較多：${hostsBy[5].join('、')}`);

// 四種講法：安全的最小、火力全開的最大也最髒
const gains = {};
for (const sp of G.speak) {
  let fame = 0, stig = 0;
  for (let i = 0; i < 40; i++) {
    const g = mk('SP' + i, { fame: 3 });
    g.flags.guestRally = { hostId: 'x', hostTitle: '黨主席', hostName: 'y', scale: 2.2, invite: '', risk: '', expiresIn: 2 };
    const f0 = g.player.fame, s0 = g.player.stigma;
    R.attendGuestRally(g, data, sp.id, new Rng(i, 0));
    fame += g.player.fame - f0; stig += g.player.stigma - s0;
  }
  gains[sp.id] = { fame: fame / 40, stigma: stig / 40 };
}
ok(gains.GS_SAFE.fame < gains.GS_SELF.fame,
  `講場面話 +${gains.GS_SAFE.fame.toFixed(3)} 比講自己的事 +${gains.GS_SELF.fame.toFixed(3)} 少——最安全的三分鐘也是最浪費的三分鐘`);
ok(gains.GS_SAFE.stigma === 0 && gains.GS_FIRE.stigma > 0,
  `火力全開會留下汙名（+${gains.GS_FIRE.stigma.toFixed(3)}），講場面話不會`);
// 吹捧主人換到黨內聲望
let g2 = mk('HOST', { fame: 3 }); g2.player.partyPrestige = 2;
g2.flags.guestRally = { hostId: 'x', hostTitle: '黨主席', hostName: 'y', scale: 2.2, invite: '', risk: '', expiresIn: 2 };
R.attendGuestRally(g2, data, 'GS_HOST', new Rng(1, 0));
ok(g2.player.partyPrestige > 2, '全力吹捧主人換到的是他的人情');
g2 = mk('SELF', { fame: 3 }); g2.player.partyPrestige = 2;
g2.flags.guestRally = { hostId: 'x', hostTitle: '黨主席', hostName: 'y', scale: 2.2, invite: '', risk: '', expiresIn: 2 };
R.attendGuestRally(g2, data, 'GS_SELF', new Rng(1, 0));
ok(g2.player.partyPrestige < 2, '講自己的事會被主人記一筆');

// 邀請會過期，婉拒多了黨內會有話講
s = mk('EXP', { fame: 3 });
s.flags.guestRally = { hostId: 'x', hostTitle: '黨主席', hostName: 'y', scale: 2, invite: '', risk: '', expiresIn: 2 };
advance(s, data); advance(s, data);
ok(!s.flags.guestRally, '大咖的場子不會等你，兩回合沒答應就過期了');
s = mk('DEC', { fame: 3 }); s.player.partyPrestige = 3;
for (let i = 0; i < 2; i++) {
  s.flags.guestRally = { hostId: 'x', hostTitle: '黨主席', hostName: 'y', scale: 2, invite: '', risk: '', expiresIn: 2 };
  R.declineGuestRally(s, data);
}
ok(s.player.partyPrestige < 3, '拒絕一次沒事，拒絕兩次就會有人開始講話');
ok(G.speak.every((x) => x.text && x.text.length > 40), '四種講法各有一段夠長的敘述');

/* ── 5. 人群試作沙盒 ── */
console.log('\n── 人群試作 ──');
const me = { party: 'PDA', china: -3, econ: -1, fame: 3, stigma: 0.5, gen: 'middle' };
const lab = Lab.sample(null, data, 'DEMO', me);
ok(lab.people.length === 60, `抽出 ${lab.people.length} 個人`);
ok(lab.people.every((p) => p.support >= -100 && p.support <= 100), '支持度全部落在 −100～+100');
ok(lab.people.every((p) => p.militancy >= 0 && p.militancy <= 100), '激進度全部落在 0～100');
// 每個人的加值要加得回總數
const bad = lab.people.filter((p) => {
  const sum = p.supportTerms.reduce((a, t) => a + t.value, 0);
  return Math.abs(sum - p.support) > 0.5 && Math.abs(p.support) < 100;
});
ok(!bad.length, '每個人的支持度都等於各項加值的總和，拆解對得起來');
// 使用者要的那四項都在
const names = data.popLab.support.terms.map((t) => t.name);
ok(names.includes('基礎不情願') && names.includes('政黨認同') && names.includes('媒體宣傳'),
  `支持度的項目：${names.join('、')}`);
const someone = lab.people.find((p) => p.party === 'PDA');
const partyTerm = someone?.supportTerms.find((t) => t.id === 'PARTY_SAME');
ok(partyTerm && partyTerm.value === 42, `同黨的人政黨認同就是 +${partyTerm?.value}`);
ok(lab.people.every((p) => p.supportTerms.some((t) => t.id === 'PARTY_SAME')),
  '就算是 0 也要列出來——「他不認任何一個黨」本身就是資訊');
ok(lab.people.every((p) => p.supportTerms.some((t) => t.id === 'BASE' && t.value === -20)),
  '每個人都從基礎不情願 −20 開始，你要先把那 20 分賺回來');

// 換一個玩家，同一批人的反應要跟著變
const asBlue = Lab.sample(null, data, 'DEMO', { ...me, party: 'CRP', china: 3 });
const asDirty = Lab.sample(null, data, 'DEMO', { ...me, stigma: 5 });
const asFamous = Lab.sample(null, data, 'DEMO', { ...me, fame: 5 });
const avg = (r) => r.people.reduce((a, p) => a + p.support, 0) / r.people.length;
ok(Math.abs(avg(lab) - avg(asBlue)) > 1, `換一個政黨，同一批人的平均支持度從 ${avg(lab).toFixed(1)} 變成 ${avg(asBlue).toFixed(1)}`);
ok(avg(asDirty) < avg(lab) - 15, `汙名爆表把平均支持度打到 ${avg(asDirty).toFixed(1)}`);
ok(avg(asFamous) > avg(lab), `知名度拉滿之後媒體宣傳那一項變大，平均支持度來到 ${avg(asFamous).toFixed(1)}`);

const sum2 = Lab.summarize(lab, data);
ok(sum2.n === 60 && sum2.supportBands.reduce((a, b) => a + b.n, 0) === 60, '支持度分佈的人數加起來是 60');
ok(sum2.quad.passive > 0 || sum2.quad.hostile > 0,
  `把兩個值分開才看得到的那兩格：支持但消極 ${sum2.quad.passive} 人、反對且激進 ${sum2.quad.hostile} 人`);
// 多數人對政治的投入程度就是很低，而且那是好事。
// 如果這個分佈跑出一半的人願意上街，那是模型壞了。
let street = 0, total = 0;
for (let k = 0; k < 15; k++) {
  const rr = Lab.sample(null, data, 'M' + k, me);
  street += rr.people.filter((p) => p.militancy >= 70).length;
  total += rr.people.length;
}
ok(street / total < 0.12,
  `十五批人裡只有 ${(street / total * 100).toFixed(0)}% 願意為了政治上街——會上街的人在任何社會都是少數`);
ok(sum2.avgM > 20 && sum2.avgM < 55, `平均激進度 ${sum2.avgM.toFixed(1)}，落在合理範圍`);
// 立場用鐘形而不是均勻分佈：極端的人要很稀疏
const extreme = lab.people.filter((p) => Math.abs(p.china) > 4).length;
ok(extreme / lab.people.length < 0.15,
  `兩岸立場站在極端的只有 ${extreme} 人——均勻分佈會讓一半的人變成極端派，那不是台灣的樣子`);
// 同一顆種子要重現得出來
const again = Lab.sample(null, data, 'DEMO', me);
ok(JSON.stringify(again.people.map((p) => p.support)) === JSON.stringify(lab.people.map((p) => p.support)),
  '同一顆種子重抽一次，結果一模一樣——這樣才比較得出改一個參數之後差在哪裡');
// 沙盒不能碰到真的遊戲狀態
const clean = mk('CLEAN');
const before = JSON.stringify({ f: clean.finance, p: clean.player.fame });
Lab.sample(clean, data, 'X');
ok(JSON.stringify({ f: clean.finance, p: clean.player.fame }) === before,
  '這個沙盒跑完之後，遊戲裡的狀態一個字都沒有動');

/* ── 6. 長跑 ── */
console.log('\n── 長跑 ──');
s = mk('LONG62', { fame: 3 });
let nan = 0;
for (let i = 0; i < 48; i++) {
  advance(s, data);
  if (!Number.isFinite(s.finance.campaign)) nan++;
}
ok(nan === 0, '四十八回合裡沒有把數字算壞');
ok((s.flags.guestRallyCount ?? 0) >= 0, '免費造勢場的邀請在長跑裡不會爆掉');

console.log(fails ? `\n${fails} 項失敗` : '\nv0.6.2 全部通過');
process.exit(fails ? 1 : 0);
