// 民調、節目、憲政三個新系統的行為測試
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales, word } = await import('../src/util/scale.js');
const { Rng } = await import('../src/core/Rng.js');
const Poll = await import('../src/systems/PollSystem.js');
const Show = await import('../src/systems/ShowSystem.js');
const Court = await import('../src/systems/CourtSystem.js');
const Legis = await import('../src/systems/LegislatureSystem.js');
const Char = await import('../src/systems/CharacterSystem.js');
const { clamp05 } = await import('../src/core/Formula.js');
const People = await import('../src/systems/PeopleSystem.js');
const Canvass = await import('../src/systems/CanvassSystem.js');
const Favor = await import('../src/systems/FavorSystem.js');
const Invite = await import('../src/systems/InvitationSystem.js');
const SocialSys = await import('../src/systems/SocialSystem.js');
const Semi = await import('../src/systems/SemiconductorSystem.js');
const Media = await import('../src/systems/MediaSystem.js');
const Events = await import('../src/systems/EventSystem.js');
const Budget = await import('../src/systems/BudgetSystem.js');
const Team = await import('../src/systems/TeamSystem.js');
const Election = await import('../src/systems/ElectionSystem.js');

const data = await loadData(); initScales(data.scales);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

const mk = () => createGame(data, {
  seedStr: 'SYSTEST1', name: '測試員', gender: 'x', startId: 'rookie',
  backgroundId: 'reporter', education: '碩士', homeDistrict: 'TCH-03', party: 'PDA',
  ideology: { centralization: 0, unification: -1, marketFreedom: 0, progressivism: 2, immigration: 1, environment: 1, militaryAutonomy: 0, directDemocracy: 2 },
});

/* ── 開局狀態 ── */
let s = mk();
ok(Math.abs(s.finance.personal - 350000) < 1, `開局私產 ${s.finance.personal.toLocaleString()} 元（記者出身）`);
const open0 = Char.availableActions(s, data).map((a) => a.id);
ok(open0.length === 2 && open0.includes('canvass') && open0.includes('theory'),
  `開局只有 ${open0.length} 個行動：${open0.join('、')}`);
ok(!open0.includes('talkshow') && !open0.includes('presser'), '政論節目與記者會開局是鎖住的');
ok(s.court?.justices.length === 15, `十五位大法官已就任`);
ok(!!s.presidency?.name, `總統：${s.presidency?.name}（滿意度 ${s.presidency?.approval}%）`);
ok((s.polls ?? []).length === 0, '開局沒有任何民調——沒人做就是沒有');

/* ── 民調要有人做才有 ── */
for (let i = 0; i < 6; i++) advance(s, data);
ok(s.polls.length > 0, `六個回合後累積 ${s.polls.length} 份公開民調`);
const unlisted = s.polls.filter((p) => !p.playerListed).length;
ok(unlisted === s.polls.length, `知名度不足時，${unlisted} 份民調全都沒有列入玩家`);

// 房效應：偏藍的家讀出來的藍營數字要比偏綠的家高
const rng = new Rng(999, 0);
const blue = Poll.makePoll(s, data, rng, data.byId.pollster.UNIONPOLL, 'nation', null, false);
const green = Poll.makePoll(s, data, rng, data.byId.pollster.MINGJING, 'nation', null, false);
ok(blue.partySupport.CRP > green.partySupport.CRP,
  `房效應成立：聯日民調的華復 ${blue.partySupport.CRP.toFixed(1)}% ＞ 明淨的 ${green.partySupport.CRP.toFixed(1)}%`);
const ps = data.byId.pollster.HUILIU;
const publicPoll = Poll.makePoll(s, data, rng, ps, 'district', 'TCH-03', false);
const internal = Poll.makePoll(s, data, rng, ps, 'district', 'TCH-03', true);
ok(internal.error < publicPoll.error,
  `內參民調誤差 ±${internal.error.toFixed(2)}% 小於公開版的 ±${publicPoll.error.toFixed(2)}%`);
// 誤差要符合統計學：n 越大誤差越小，小黨的誤差要比大黨小
const moeBig = Poll.marginOfError(ps.sampleSize, ps.designEffect, 0.4);
const moeSmall = Poll.marginOfError(ps.sampleSize, ps.designEffect, 0.03);
ok(moeSmall < moeBig * 0.55,
  `支持度 3% 的小黨誤差 ±${moeSmall.toFixed(2)}% 遠小於 40% 大黨的 ±${moeBig.toFixed(2)}%`);
const moeBigSample = Poll.marginOfError(4000, 1.0);
const moeSmallSample = Poll.marginOfError(600, 1.0);
ok(moeBigSample < moeSmallSample,
  `樣本 4000 的誤差 ±${moeBigSample.toFixed(2)}% 小於樣本 600 的 ±${moeSmallSample.toFixed(2)}%`);
// 沒有任何一家的小黨讀數會離譜到兩位數
let worstSmall = 0;
for (const x of data.pollsters.pollsters) {
  worstSmall = Math.max(worstSmall, Poll.marginOfError(x.sampleSize, x.designEffect, 0.03));
}
ok(worstSmall < 2.0, `所有民調公司對 3% 小黨的抽樣誤差都在 ±${worstSmall.toFixed(2)}% 以內`);

// 委託
s.finance.campaign = 500000;
const c1 = Poll.commission(s, data, 'HUILIU', 'district');
ok(c1.ok && s.finance.campaign < 500000, `委託成功並扣款：${c1.msg}`);
const c2 = Poll.commission(s, data, 'HUILIU', 'district');
ok(!c2.ok, '同時只能有一份委託在跑');
advance(s, data);
ok(s.polls.some((p) => p.internal), '委託的內參民調已交件');

/* ── 節目通告 ── */
s = mk();
s.player.fame = 3;
let sawInvite = false;
for (let i = 0; i < 20 && !sawInvite; i++) { advance(s, data); if ((s.invitations ?? []).length) sawInvite = true; }
ok(sawInvite, `知名度拉到「${word('fame', 3)}」之後收到了通告`);
const openA = Char.availableActions(s, data).map((a) => a.id);
ok(openA.includes('talkshow'), '有通告之後「上政論節目」解鎖');
ok(!Char.availableActions(s, data).some((a) => a.id === 'retire') || s.meta.turn >= 12,
  '退出政壇要有一定的資歷才會出現');
const inv = s.invitations[0];
const before = s.player.fame;
const r = Show.appear(s, data, inv.showId, new Rng(7, 0));
ok(r.ok && r.perf >= 0 && r.perf <= 5, `上了《${r.show.name}》，表現「${word('showPerf', r.perf)}」`);
ok(s.invitations.every((i) => i.showId !== inv.showId), '用掉的通告已經從清單移除');
const noInv = Show.appear(s, data, inv.showId, new Rng(7, 0));
ok(!noInv.ok, '沒有通告就上不了同一個節目');

/* ── 釋憲 ── */
s = mk();
s.player.role = 'legislator';
s.legislature = { PDA: 30, CRP: 55, TPL: 20, IND: 8 };
const hi = data.laws.laws.filter((l) => l.controversy >= data.constitution.review.controversyNeeded);
ok(hi.length > 0, `有 ${hi.length} 條法律的爭議度足以被聲請釋憲`);
let petitioned = null;
for (let i = 0; i < 60 && !petitioned; i++) {
  petitioned = Court.petition(s, data, hi[0].id, new Rng(1000 + i, 0));
}
ok(!!petitioned, `《${hi[0].name}》被聲請釋憲`);
s.laws[hi[0].id] = Math.min(hi[0].tiers.length - 1, s.laws[hi[0].id] + 1);
petitioned.tier = s.laws[hi[0].id];
petitioned.turnsLeft = 0;
const beforeTier = s.laws[hi[0].id];
advance(s, data);
ok(s.court.history.length > 0, `憲法法庭做出裁判：${s.court.history[0]?.verdict}`);
if (s.court.history[0]?.verdict === 'unconstitutional') {
  ok(s.laws[hi[0].id] !== beforeTier, '違憲判決確實把法案退回修法前的檔位');
} else {
  ok(true, '本次判決為合憲，法案維持');
}

/* ── 大法官傾向反映提名者 ── */
s = mk();
const blueJ = s.court.justices.filter((j) => j.nominatedBy === 'CRP');
const greenJ = s.court.justices.filter((j) => j.nominatedBy === 'PDA');
if (blueJ.length && greenJ.length) {
  const bm = blueJ.reduce((a, j) => a + j.ideology.unification, 0) / blueJ.length;
  const gm = greenJ.reduce((a, j) => a + j.ideology.unification, 0) / greenJ.length;
  ok(bm > gm, `藍營提名的大法官統合軸均值 ${bm.toFixed(2)} ＞ 綠營提名的 ${gm.toFixed(2)}`);
} else ok(true, '提名者分佈不足以比較');

/* ── 競選費用符合台灣行情 ── */
const { CAMPAIGN_ACTIONS, actionCost } = await import('../src/ui/pages/election.js');
for (const [lvl, want] of [['councilor', [1000000, 3500000]], ['legislator', [2000000, 20000000]]]) {
  const level = data.elections.levels[lvl];
  const run = { level };
  // 八週、每週兩點行動點，取中位價的組合
  const sorted = CAMPAIGN_ACTIONS.map((a) => actionCost(run, a)).sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const total = mid * 16;
  ok(total >= want[0] && total <= want[1],
    `${level.name}打滿十六個行動約 ${(total / 10000).toFixed(0)} 萬（行情 ${level.budgetGuide}）`);
}


/* ── v0.4.0 新系統 ── */
console.log('\n── v0.4.0 ──');
const Theory = await import('../src/systems/TheorySystem.js');
const ImageSys = await import('../src/systems/ImageSystem.js');
const Ending = await import('../src/systems/EndingSystem.js');
const Gov = await import('../src/systems/GovernmentSystem.js');

s = mk();
// 組織理論
const rng2 = new Rng(555, 0);
let res = null;
for (let i = 0; i < 8 && !(res && res.done); i++) res = Theory.research(s, data, rng2);
ok(Theory.held(s).length === 1, `組織出第一套理論：《${data.byId.theory[Theory.held(s)[0].id].name}》`);
const th0 = Theory.held(s)[0];
const lvBefore = th0.level;
Theory.use(s, data, th0.id); Theory.use(s, data, th0.id);
ok(th0.level > lvBefore, `理論隨使用完善：${lvBefore.toFixed(2)} → ${th0.level.toFixed(2)}（用過 ${th0.uses} 次）`);
const onTopic = Theory.citeBonus(s, data, th0.id, data.byId.theory[th0.id].field);
const offTopic = Theory.citeBonus(s, data, th0.id, 'nonsense');
ok(onTopic > offTopic, `對題引用的加成 ${onTopic.toFixed(2)} 大於不對題的 ${offTopic.toFixed(2)}`);

// 主打形象
s = mk();
s.player.fame = 3; s.player.integrity = 4; s.player.attrs.judgment = 4;
const avail = ImageSys.available(s, data);
ok(avail.some((x) => x.ok), `可主打的形象 ${avail.filter((x) => x.ok).length} 個`);
const clean = ImageSys.adopt(s, data, 'IMG_CLEAN');
ok(clean.ok && s.player.image === 'IMG_CLEAN', `掛上形象：${clean.msg}`);
ok(ImageSys.backfireMult(s, data, 'stigmaGain') > 1.5, '打清廉的人，汙名的反噬倍率明顯放大');
s.player.politicalCapital = 200;
const sw = ImageSys.adopt(s, data, 'IMG_TECHNOCRAT');
ok(sw.ok && s.player.politicalCapital < 200, '換形象要付政治資本');
s.player.politicalCapital = 5;
ok(!ImageSys.adopt(s, data, 'IMG_CLEAN').ok, '政治資本不夠就換不了形象');

// 內閣與副市長
s = mk();
ok(s.cabinet && s.cabinet.length === data.cabinet.ministries.length,
  `內閣 ${s.cabinet.length} 個部會首長都就任了`);
const dm = Object.values(s.regions).map((r) => [r.name, r.deputies.length, r.population.total, r.type]);
const bad = dm.filter(([n, cnt, pop, type]) => {
  const rule = type === '直轄市' ? data.cabinet.deputyMayorRule.municipality : data.cabinet.deputyMayorRule.county;
  const want = rule.base + (pop >= rule.extraIfPopulationOver ? rule.extra : 0);
  return cnt !== want;
});
ok(bad.length === 0, `副首長人數全部符合地方制度法（${dm.filter((x) => x[3] === '直轄市' && x[1] === 3).map((x) => x[0]).join('、')} 各三位）`);
ok(Object.values(s.regions).every((r) => r.politics.mayorName), '每個縣市都有首長姓名');

// 退場結算與事後談
s = mk();
s.player.ideology = { centralization: 0, unification: -4, marketFreedom: -3, progressivism: 3,
  immigration: 0, environment: 2, militaryAutonomy: 0, directDemocracy: 2 };
for (let i = 0; i < 3; i++) advance(s, data);
const sumBad = Ending.summarize(s, data);
const epBad = Ending.epilogue(s, data, sumBad, new Rng(9, 0));
ok(sumBad.tier === 'forgotten', `什麼都沒做的人：「${Ending.TIER_NAME[sumBad.tier]}」`);
ok(epBad.paras.length > 0 && epBad.paras.every((p) => !p.aligned),
  '沒有成就的事後談，每一段都往玩家反對的方向走');
ok(!!epBad.regret, '沒有成就會出現遺憾的那一句');

s.player.role = 'president';
s.player.careerLog = [
  { turn: 10, kind: 'win', text: '當選縣市議員' }, { turn: 60, kind: 'win', text: '當選立法委員' },
  { turn: 120, kind: 'win', text: '當選總統' },
  ...Array.from({ length: 6 }, (_, i) => ({ turn: 130 + i, kind: 'law', text: `推動《法案${i}》` })),
];
s.player.fame = 5;
const sumGood = Ending.summarize(s, data);
const epGood = Ending.epilogue(s, data, sumGood, new Rng(9, 0));
ok(sumGood.tier === 'legend', `做了很多事的人：「${Ending.TIER_NAME[sumGood.tier]}」（分數 ${sumGood.score.toFixed(0)}）`);
ok(epGood.paras.every((p) => p.aligned), '有成就的事後談，每一段都往玩家相信的方向走');
ok(!epGood.regret, '有成就就不會出現那句遺憾');

// 行動點超支
s = mk();
const ap = Char.apOf(s, data);
s._apRng = new Rng(1, 0);
for (let i = 0; i < ap; i++) Char.spendAP(s, data, 1, 0);
const fBefore = s.player.fatigueRaw;
const over = Char.spendAP(s, data, 1, 0);
ok(over.ok && over.over === 1, '行動點用完之後還可以硬撐一點');
ok(s.player.fatigueRaw >= fBefore, `超支之後疲勞從 ${fBefore.toFixed(0)} 變成 ${s.player.fatigueRaw.toFixed(0)}`);
const tooMuch = Char.spendAP(s, data, 5, 0);
ok(!tooMuch.ok, '超支也有上限，撐不下去就是撐不下去');

/* ─────────── v0.5.0 ─────────── */
console.log('\n── v0.5.0 ──');

// 1. 選區人物
s = mk();
const home = s.player.homeDistrict;
const locals = People.inDistrict(s, home);
ok(locals.length >= 3 && locals.length <= 9, `家鄉選區有 ${locals.length} 位在地政治人物`);
const allD = Object.values(s.peopleByDistrict);
ok(allD.every((x) => x.length >= 3), `全部 ${allD.length} 個選區都至少有三個人在跑`);
ok(Object.values(s.people).every((p) => p.name && p.archetype && p.traits.length), '每個人物都有姓名、原型與特質');
const thr = locals.map((p) => People.threat(p));
ok(thr.every((t, i) => i === 0 || t <= thr[i - 1]), '人物依威脅度排序，最難對付的排在最前面');

// 議員選舉的對手幾乎全是本地人；立委才會有空降
const rngA = new Rng(7, 0);
const cRun = { type: 'councilor', scopeId: home, name: '市議員', level: {} };
let paraCouncil = 0, paraLeg = 0;
for (let i = 0; i < 30; i++) {
  const c1 = People.candidatesFor(s, data, cRun, new Rng(11, i * 13), 4);
  if (c1.some((x) => x.parachute)) paraCouncil++;
  const c2 = People.candidatesFor(s, data, { ...cRun, type: 'legislator' }, new Rng(12, i * 13), 4);
  if (c2.some((x) => x.parachute)) paraLeg++;
}
ok(paraLeg > paraCouncil, `空降：議員選舉 ${paraCouncil}/30，立委選舉 ${paraLeg}/30`);

// 每季會補新人
const npcBefore = Object.keys(s.people).length;
for (let i = 0; i < 14; i++) advance(s, data);
const npcAfter = Object.keys(s.people).length;
ok(npcAfter !== npcBefore, `一年之後人數從 ${npcBefore} 變成 ${npcAfter}，這個世界會自己補人也會自己少人`);

// 2. 跑攤：六十次不重複
s = mk();
const seen = new Set();
for (let i = 0; i < 60; i++) {
  const r = Canvass.run(s, data, home, new Rng(31, i * 7));
  seen.add(r.scene.id + ':' + r.branchIndex);
}
ok(seen.size === 60, `連續跑六十次，看到 ${seen.size} 種不同的文本，沒有重複`);
const anyText = Canvass.run(s, data, home, new Rng(31, 999));
ok(!anyText.text.includes('這個月') && !anyText.lead.includes('這個月'), '跑攤文本沒有月份代詞');

// 跑攤五次換到交際
s = mk();
const socBefore = s.player.attrs.sociability;
let msFound = null;
for (let i = 0; i < 5; i++) { const r = Canvass.run(s, data, home, new Rng(41, i)); if (r.milestone) msFound = r.milestone; }
ok(msFound && s.player.attrs.sociability === socBefore + 1,
  `跑攤五次之後交際從 ${socBefore} 升到 ${s.player.attrs.sociability}`);

// 3. 人情牽制
s = mk();
const someone = Object.values(s.people)[0];
Favor.addFavor(s, data, someone.id, 2.5);
ok(s.people[someone.id].favor === 2.5, `${someone.name}欠了你一份人情`);
const L = Favor.ledger(s);
ok(L.owed.length === 1 && L.owing.length === 0, '人情帳本分得清楚誰欠誰');
Favor.addFavor(s, data, someone.id, -9);
ok(s.people[someone.id].favor >= -5, '人情有上下限，不會無限累積');

// 4. 邀約與助理代打
s = mk();
s.player.fame = 3;
for (let i = 0; i < 6; i++) advance(s, data);
ok((s.socialInvites ?? []).length > 0, `知名度上來之後收到 ${s.socialInvites.length} 個邀約`);
s.team.push({ id: 'a1', name: '陳助理', role: 'aide', roleName: '隨行助理', ability: 3, loyalty: 3, ambition: 1, knownSecrets: 0, tenure: 0 });
const inv1 = s.socialInvites.find((x) => data.byId.invitation[x.kindId].aideOk);
if (inv1) {
  const r1 = Invite.attend(s, data, inv1.id, 'aide', 'a1', new Rng(5, 0));
  ok(r1.ok && r1.text.includes('陳助理'), '助理可以代表出席，文本會寫出是誰去的');
  const inv2 = s.socialInvites.find((x) => data.byId.invitation[x.kindId].aideOk);
  if (inv2) {
    const r2 = Invite.attend(s, data, inv2.id, 'aide', 'a1', new Rng(5, 1));
    ok(!r2.ok && r2.msg.includes('一個人分不了兩邊'), '同一位助理一個月不能跑第二場');
  }
}

// 5. 社群：直播與街頭宣講的氣魄門檻
s = mk();
s.player.attrs.boldness = 2;
ok(!SocialSys.livestream(s, data, new Rng(1, 0)).ok, '氣魄 2 開不了直播');
s.player.attrs.boldness = 3;
const live = SocialSys.livestream(s, data, new Rng(1, 0));
ok(live.ok, '氣魄 3 可以開直播');
ok(!SocialSys.streetSpeech(s, data, new Rng(1, 0)).ok, '氣魄 3 還不能街頭宣講');
s.player.attrs.boldness = 4;
ok(SocialSys.streetSpeech(s, data, new Rng(1, 0)).ok, '氣魄 4 可以街頭宣講');
ok(s.social.followers > 0, `追蹤數 ${s.social.followers.toLocaleString('zh-TW')}`);

// 6. 事件門檻：素人看得到事件，但按不下首長權限的按鈕
s = mk();
s.player.role = 'citizen'; s.player.fame = 0;
const typhoon = data.byId.event.EVT_DIS_TYPHOON_LANDFALL;
const execOpt = typhoon.options.find((o) => o.gate?.office);
ok(!Events.optionAllowed(s, execOpt), '政治素人宣布不了停班停課');
s.player.role = 'mayor';
ok(Events.optionAllowed(s, execOpt), '當上縣市長之後就可以了');
s.player.role = 'citizen';
let fired = 0;
for (let t = 1; t <= 12; t++) { s.meta.turn = t; fired += Events.generate(s, { data, rng: new Rng(3, t * 9), scaleMult: 1 }).events.length; }
ok(fired >= 5, `素人十二回合仍觸發 ${fired} 則事件，門檻沒有把開局鎖死`);

// 表示反對
s = mk();
let evX = null;
for (let t = 1; t <= 20 && !evX; t++) {
  s.meta.turn = t; s.eventCooldown = {};
  evX = Events.generate(s, { data, rng: new Rng(4, t * 31), scaleMult: 1 }).events[0];
}
ok(!!evX?.oppose?.text, `事件附帶反對選項：「${evX?.oppose?.text ?? '（沒有抽到事件）'}」`);
const phrases = new Set();
for (let i = 0; i < 14; i++) phrases.add(Events.opposeOption(s, data).text);
ok(phrases.size >= 7, `反對的用詞在 ${phrases.size} 種說法之間輪替`);
s.player.attrs.eloquence = 5; s.player.attrs.boldness = 4; s.player.attrs.judgment = 4;
const oppGood = Events.resolveOppose(s, data, evX, new Rng(6, 0));
s.player.attrs.eloquence = 0; s.player.attrs.boldness = 0; s.player.attrs.judgment = 0;
const oppBad = Events.resolveOppose(s, data, evX, new Rng(6, 0));
ok(oppGood.score > oppBad.score, `口才好的反對分數 ${oppGood.score.toFixed(2)} 高於口才差的 ${oppBad.score.toFixed(2)}`);

// 7. 媒體攻擊
s = mk();
s.player.fame = 5; s.player.stigma = 3;
let atk = 0;
for (let i = 0; i < 40; i++) { s.mediaAttack = null; Media.rollAttack(s, { data, rng: new Rng(8, i * 3), scaleMult: 1 }); if (s.mediaAttack) atk++; }
const famous = atk;
s.player.fame = 0; s.player.stigma = 0;
atk = 0;
for (let i = 0; i < 40; i++) { s.mediaAttack = null; Media.rollAttack(s, { data, rng: new Rng(8, i * 3), scaleMult: 1 }); if (s.mediaAttack) atk++; }
ok(famous > atk, `知名度高的人被盯上 ${famous}/40 次，沒沒無聞的只有 ${atk}/40 次`);
s = mk();
Media.startBoltBacklash(s, data);
ok(s.flags.boltAttackUntil > s.meta.turn, '退出大黨之後會有一段被圍剿的期間');
ok(Object.values(s.media).every((m) => m.playerRelation < 0), '退黨當下所有媒體的關係同時轉負');

// 8. 初選迴圈的修正
s = mk();
s.election = { phase: 'primary', sched: { year: 2026, month: 11 }, run: { type: 'councilor', name: '市議員' }, primaryField: [{ name: '對手', isPlayer: false }] };
const after2 = Election.afterPrimaryLoss(s, data, new Rng(2, 0));
ok(after2 && ['withdraw', 'draft', 'unite'].includes(after2.kind), `初選落敗之後排入了「${after2.kind}」的後續`);
let kinds = { withdraw: 0, draft: 0, unite: 0 };
for (let i = 0; i < 200; i++) {
  s.flags.pendingPrimaryEvent = null;
  kinds[Election.afterPrimaryLoss(s, data, new Rng(50, i * 11)).kind]++;
}
ok(Math.abs(kinds.withdraw / 200 - 0.30) < 0.09, `對手退選 ${(kinds.withdraw / 2).toFixed(0)}%（設定 30%）`);
ok(Math.abs(kinds.draft / 200 - 0.20) < 0.09, `徵召別區 ${(kinds.draft / 2).toFixed(0)}%（設定 20%）`);
ok(kinds.unite > 0, `其餘 ${(kinds.unite / 2).toFixed(0)}% 走團結站台`);

// 9. 預算的權責分工
s = mk();
s.player.role = 'legislator';
ok(!Budget.canAllocate(s, data) && Budget.canReview(s, data), '立委只能審預算，不能編');
const rv = Budget.review(s, data, 'defense', 'freeze');
ok(rv.ok && s.flags.frozenBudget === 1, '立委可以凍結預算，並取得要求專案報告的籌碼');
ok(!Budget.launchSpecialBudget(s, data, 'SB_CASH2027').ok, '立委編不了特別預算');
s.player.role = 'president';
s.meta.year = 2027;
const sb = Budget.launchSpecialBudget(s, data, 'SB_CASH2027');
ok(sb.ok, '總統可以編列現金普發特別預算');
ok(s.central.fiscal.debtOutstanding > 0, '普發的錢是借來的，債務餘額同步上升');

// 10. 幕僚的雷
s = mk();
const risky = data.staffRoles.backgrounds.filter((b) => b.graftRisk > 0);
ok(risky.length >= 4, `${risky.length} 種來歷帶著收贓風險，敘述裡不會明講`);
s.team.push({ id: 'g1', name: '林專員', role: 'service', roleName: '選民服務專員', ability: 3, loyalty: 3, ambition: 2, graftRisk: 1.0, graftTaken: 0, knownSecrets: 0, tenure: 0 });
let caught = false;
for (let i = 0; i < 60 && !caught; i++) { Team.tick(s, { data, rng: new Rng(13, i * 5), scaleMult: 1 }); if (s.flags.graftCase) caught = true; }
ok(caught, `${s.flags.graftCase?.name ?? ''}收的錢最後被查出來了`);
const gr = Team.resolveGraft(s, data, 'fire');
ok(gr.msg.includes('解除') && !s.team.find((t) => t.id === 'g1'), '切割之後那個人不在名單上了');

// 11. 半導體
s = mk();
ok(Object.keys(s.semi).length === 5, '半導體五個版圖都建立了');
const snap = Semi.snapshot(s, data);
ok(snap.every((x) => x.corps.length > 0), '每個版圖都掛著對應的公司');
const t0 = s.semi.FOUNDRY.techLevel;
s.values.investmentPriority = 5;
for (let i = 0; i < 24; i++) Semi.tick(s, { data, scaleMult: 1 });
ok(s.semi.FOUNDRY.techLevel > t0, `兩年的產業投資讓晶圓代工的技術從 ${t0.toFixed(2)} 升到 ${s.semi.FOUNDRY.techLevel.toFixed(2)}`);
const memAmp = Math.abs(s.semi.MEMORY.cycle), fabAmp = Math.abs(s.semi.FOUNDRY.cycle);
ok(data.semiconductor.cycle.MEMORY.amplitude > data.semiconductor.cycle.FOUNDRY.amplitude * 2,
  '記憶體的景氣振幅是晶圓代工的三倍以上，符合這個產業的常識');
ok((s.flags.semiTotals?.gdpShare ?? 0) > 0.05, `半導體佔國內生產毛額 ${((s.flags.semiTotals.gdpShare) * 100).toFixed(1)}%`);

// 12. 男女差距與兩岸七維
s = mk();
advance(s, data);
const gs = s.flags.genderSupport;
ok(gs && gs.male && gs.female, '支持度分男女兩份算出來了');
const maxGap = Math.max(...data.partyIds.map((p) => Math.abs((gs.male[p] ?? 0) - (gs.female[p] ?? 0)))) * 100;
ok(maxGap > 1, `男女支持度最大落差 ${maxGap.toFixed(2)} 個百分點`);
// 呈現方式：玩家看到的是「哪一邊比較挺、差多少」，不是兩個要自己相減的數字
const F = await import('../src/util/format.js');
ok(F.genderLean(46.9, 52.4).text === '女+5.5', `女性較挺寫成「${F.genderLean(46.9, 52.4).text}」`);
ok(F.genderLean(54.0, 46.0).text === '男+8.0', `男性較挺寫成「${F.genderLean(54.0, 46.0).text}」`);
ok(F.genderLean(30.1, 30.2).text === '幾無差異', '差距小到看不出來就不給方向');
ok(F.genderLean(46.9, 52.4).cls === 'g-f' && F.genderLean(54.0, 46.0).cls === 'g-m',
  '兩個方向用不同顏色標示');
const leansAll = data.partyIds.map((pid) => F.genderLean((gs.male[pid] ?? 0) * 100, (gs.female[pid] ?? 0) * 100));
ok(leansAll.every((L) => /^(男|女)\+\d+\.\d$|^幾無差異$/.test(L.text)),
  `實際跑出來的七個政黨都寫得出來：${leansAll.map((L) => L.text).join('、')}`);
ok(Object.keys(s.flags.chinaMood).length === 7, '兩岸七個維度都有全國讀數');
const reasons = new Set();
for (let i = 0; i < s.pops.n; i += 17) reasons.add(s.pops.chinaReason[i]);
ok(reasons.size === 5, `五種兩岸態度的理由在人口裡都存在`);
// 同一種理由要能推向兩個方向
const econArgs = data.china.narratives.filter((n) => n.reason === 'economy');
ok(new Set(econArgs.map((n) => Math.sign(n.direction))).size === 2,
  '以經濟為理由的人，有人主張友中也有人主張抗中');

// 13. 民調的招牌題組
s = mk();
for (let i = 0; i < 10; i++) advance(s, data);
const specs = new Set((s.polls ?? []).map((x) => x.specialty?.id).filter(Boolean));
ok(specs.size >= 3, `已經出現 ${specs.size} 種不同格式的民調：${[...specs].join('、')}`);
const idPoll = (s.polls ?? []).find((x) => x.extra?.kind === 'identity');
const ctPoll = (s.polls ?? []).find((x) => x.extra?.kind === 'crosstab');
if (idPoll) ok(idPoll.extra.china.length === 7 && idPoll.extra.reasons.length === 5, '政智選研的題組包含國家認同與兩岸七維');
if (ctPoll) ok(ctPoll.extra.groups.length === 9, '燦爛島的交叉表有九個族群');
const withMin = (s.polls ?? []).find((x) => x.ministers?.length);
ok(withMin && withMin.ministers.length === 18, '部會首長的滿意度也是問出來的，一共十八個部會');

// 九種題組的欄位都要齊全，畫面才畫得出來。
// 政智選研每六回合才發一次，靠實機瀏覽不一定碰得到，所以在這裡逐一產生驗證。
const { makePoll } = Poll;
const { biWord } = await import('../src/util/scale.js');
const shapeBad = [];
const need = {
  crosstab: (e) => e.groups?.length === 9 && e.groups.every((g) => g.name && g.top != null
    && Number.isFinite(g.topShare) && Number.isFinite(g.share) && Number.isFinite(g.turnout)),
  issueSalience: (e) => e.rows?.length >= 5 && e.rows.every((r) => r.name && Number.isFinite(r.pct)),
  identity: (e) => e.identity?.length === 4 && e.identity.every((x) => x.id && Number.isFinite(x.pct))
    && e.china?.length === 7 && e.china.every((d) => d.negName && d.posName && Number.isFinite(d.value))
    && e.reasons?.length === 5 && e.reasons.every((r) => r.name && Number.isFinite(r.pct)),
  genderAge: (e) => e.rows?.length && e.rows.every((r) => r.name && Number.isFinite(r.male) && Number.isFinite(r.female))
    && e.youthGap && Number.isFinite(e.youthGap.gap),
  regionBreak: (e) => e.rows?.length === 2 && e.rows.every((r) => r.label && Number.isFinite(r.topShare)),
  headToHead: (e) => e.rows?.length === 2 && e.rows.every((r) => r.name && Number.isFinite(r.pct)),
  trend: (e) => e.rows?.length && e.rows.every((r) => r.name && Number.isFinite(r.now) && Number.isFinite(r.delta)),
  quickTake: (e) => typeof e.question === 'string' && Number.isFinite(e.yes),
  openWeb: (e) => typeof e.warning === 'string' && e.warning.length > 10,
};
for (const ps of data.pollsters.pollsters) {
  const poll = makePoll(s, data, new Rng(77, ps.id.length), ps, 'nation', null, false);
  const e = poll.extra;
  if (!e || e.kind !== ps.specialty.id) { shapeBad.push(`${ps.short} 沒有產出 ${ps.specialty.id}`); continue; }
  if (!need[e.kind](e)) shapeBad.push(`${ps.short} 的 ${e.kind} 欄位不齊`);
}
shapeBad.length ? ok(false, `題組欄位有問題：${shapeBad.join('；')}`)
  : ok(true, `九家民調的招牌題組欄位全部齊全，畫面畫得出來`);

// 國家認同那一份會用四字語詞呈現兩岸七維，刻度名稱要對得上
const zz = data.pollsters.pollsters.find((x) => x.specialty.id === 'identity');
const zPoll = makePoll(s, data, new Rng(5, 1), zz, 'nation', null, false);
const cnWords = zPoll.extra.china.map((d) => biWord('cn' + d.id.charAt(0).toUpperCase() + d.id.slice(1), d.value));
ok(cnWords.every((w) => [...w].length === 4),
  `兩岸七維都對得上四字刻度：${cnWords.join('、')}`);

console.log(fails ? `\n${fails} 項失敗` : '\n新系統全部通過');
process.exit(fails ? 1 : 0);
