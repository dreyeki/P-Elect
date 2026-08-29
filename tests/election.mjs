import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { advance } = await import('../src/core/TurnEngine.js');
const { initScales, word } = await import('../src/util/scale.js');
const E = await import('../src/systems/ElectionSystem.js');
const { Rng } = await import('../src/core/Rng.js');
const { clamp05 } = await import('../src/core/Formula.js');

const data = await loadData(); initScales(data.scales);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

const state = createGame(data, {
  seedStr: 'ELEC0001', name: '王明德', gender: 'x', startId: 'aide',
  backgroundId: 'local', education: '大學', homeDistrict: 'TNN-04', party: 'PDA',
  ideology: { centralization: 0, unification: -2, marketFreedom: -1, progressivism: 2, immigration: 0, environment: 1, militaryAutonomy: 1, directDemocracy: 2 },
});

// 週回合切換
let weekSeen = false;
for (let i = 0; i < 14; i++) { advance(state, data); if (state.meta.scale === 'week') weekSeen = true; }
ok(weekSeen, `選前兩個月自動切換為週回合（目前 ${state.meta.scale}，${state.meta.year}/${state.meta.month}）`);

// 可參選職位
const { sched } = E.monthsUntilElection(state, data);
const runs = E.availableRuns(state, data, sched);
ok(runs.length > 0, `可參選職位 ${runs.length} 個：${runs.map((r) => r.name).join('、')}`);

// 初選：多競爭者、可以先去談
const rng = new Rng(state.meta.seed, 4242);
const pri = E.buildPrimary(state, data, runs[0], rng);
ok(!pri.skip && pri.rivals.length >= 1, `初選對手 ${pri.rivals.length} 位：${pri.rivals.map((r) => `${r.name}（${r.factionName}）`).join('、')}`);
const beforeMember = pri.me.member;
state.player.politicalCapital = 200;
const fac = state.parties[state.player.party].factions[0];
fac.favor = 5;
const lob = E.lobbyFaction(state, data, pri, fac.id, new Rng(3, 0));
ok(lob.ok, `拜會派系：${lob.msg}`);
ok(pri.lobbied.length === 1, '談過的派系不能再談第二次');
const lob2 = E.lobbyFaction(state, data, pri, fac.id, new Rng(3, 0));
ok(!lob2.ok, '重複拜會會被擋下來');
const res = E.resolvePrimary(state, data, pri, rng);
ok(typeof res.won === 'boolean' && res.field.length === pri.rivals.length + 1,
  `初選開票：${res.field.map((x) => `${x.name} ${(x.share * 100).toFixed(1)}%`).join('　')}`);
ok(Math.abs(res.field.reduce((a, x) => a + x.share, 0) - 1) < 1e-6, '初選得票率總和為 1');

// 對手與計票
const run = runs.find((r) => r.type === 'councilor') ?? runs[0];
const opps = E.makeOpponents(state, data, run, rng);
ok(opps.length >= 2, `產生 ${opps.length} 位對手`);
const me = { isPlayer: true, name: state.player.name, party: state.player.party, fame: state.player.fame, stigma: state.player.stigma, attrs: state.player.attrs };
const r1 = E.computeVotes(state, data, run, [me, ...opps], rng);
const sum = r1.results.reduce((a, x) => a + x.share, 0);
ok(Math.abs(sum - 1) < 1e-6, `得票率總和 = ${sum.toFixed(6)}`);
ok(r1.results.every((x) => x.votes > 0 && Number.isFinite(x.votes)), '所有候選人得票為有限正數');
ok(r1.results.every((x) => x.noise >= 0.98 && x.noise <= 1.05), `隨機乘數落在 0.98–1.05（實際 ${r1.results.map((x) => x.noise.toFixed(3)).join(' ')}）`);

// 隨機乘數確實造成差異
const r2 = E.computeVotes(state, data, run, [me, ...opps], new Rng(state.meta.seed, 9999));
const diff = Math.abs(r1.results[0].share - r2.results.find((x) => x.candidate === r1.results[0].candidate).share);
ok(diff > 0, `不同隨機序列下同一候選人的得票率有差異（${(diff * 100).toFixed(3)} 個百分點）`);

// 基層組織確實提升得票
// 用固定的隨機序列比較，才不會被 0.98~1.05 的乘數干擾
for (const d of Object.values(state.districts)) d.playerGrassroots = 0;
const before = E.computeVotes(state, data, run, [me, ...opps], new Rng(7, 0)).results.find((x) => x.candidate.isPlayer).share;
for (const d of Object.values(state.districts)) d.playerGrassroots = 5;
const r3 = E.computeVotes(state, data, run, [me, ...opps], new Rng(7, 0));
const after = r3.results.find((x) => x.candidate.isPlayer).share;
ok(after > before, `基層組織拉滿後得票率由 ${(before * 100).toFixed(2)}% 升到 ${(after * 100).toFixed(2)}%`);

// 熱情度確實影響投票率
for (const d of Object.values(state.districts)) d.playerGrassroots = 0;
const P = state.pops;
const baseline = E.computeVotes(state, data, run, [me, ...opps], new Rng(11, 0)).results.find((x) => x.candidate.isPlayer).votes;
for (let i = 0; i < P.n; i++) P.enthusiasm[i] = 0;
const cold = E.computeVotes(state, data, run, [me, ...opps], new Rng(11, 0)).results.find((x) => x.candidate.isPlayer).votes;
ok(cold < baseline, `支持者熱情歸零後票數由 ${baseline.toLocaleString()} 掉到 ${cold.toLocaleString()}`);

// SNTV 與不分區
const seats = data.byId.district[run.scopeId]?.seats ?? 5;
const want = Math.min(seats, r1.results.length);
ok(E.resolveSNTV(r1.results, seats).length === want, `SNTV 從 ${r1.results.length} 位候選人中取出 ${want} 名當選人（應選 ${seats} 席）`);
const pl = E.partyListSeats({ PDA: 0.34, CRP: 0.33, TPL: 0.12, NGF: 0.06, TWR: 0.03, GSP: 0.02 }, 34, 0.05);
const plSum = Object.values(pl).reduce((a, b) => a + b, 0);
ok(plSum === 34, `不分區配出 ${plSum} 席，5% 門檻下 TWR/GSP 未分配到（${JSON.stringify(pl)}）`);
ok(!('TWR' in pl) && !('GSP' in pl), '未達門檻政黨確實被排除');

// 立委選區覆蓋
const legTotal = data.elections.legislatorDistricts.length;
ok(legTotal === 73, `區域立委選區共 ${legTotal} 個`);
const cov = {};
for (const l of data.elections.legislatorDistricts) for (const p of l.parts) cov[p.districtId] = (cov[p.districtId] ?? 0) + p.weight;
const badCov = Object.entries(cov).filter(([, v]) => Math.abs(v - 1) > 0.08);
ok(badCov.length === 0, `所有一般選區的權重加總都接近 1（異常 ${badCov.length} 個）`);

console.log(fails ? `\n${fails} 項失敗` : '\n選舉系統全部通過');
process.exit(fails ? 1 : 0);
