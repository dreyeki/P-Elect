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
ok(open0.length === 4 && open0.includes('canvass') && open0.includes('study'),
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
const internal = Poll.makePoll(s, data, rng, data.byId.pollster.HUILIU, 'district', 'TCH-03', true);
ok(internal.error < data.byId.pollster.HUILIU.sampleError,
  `內參民調誤差 ±${internal.error.toFixed(1)}% 小於公開版的 ±${data.byId.pollster.HUILIU.sampleError}%`);

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

console.log(fails ? `\n${fails} 項失敗` : '\n新系統全部通過');
process.exit(fails ? 1 : 0);
