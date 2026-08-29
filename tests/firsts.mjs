// 前兩次的專屬文本、行動點鎖死、回合尺度用字
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(u).replace(/^\.\//, '')), 'utf8')) });
globalThis.btoa = (x) => Buffer.from(x, 'binary').toString('base64');
globalThis.atob = (x) => Buffer.from(x, 'base64').toString('binary');

const { loadData } = await import('../src/data/loader.js');
const { createGame } = await import('../src/core/GameState.js');
const { initScales } = await import('../src/util/scale.js');
const Char = await import('../src/systems/CharacterSystem.js');
const Firsts = await import('../src/systems/FirstTimeSystem.js');
const { endTurnLabel } = await import('../src/ui/pages/turn.js');

const data = await loadData(); initScales(data.scales);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (seed = 'FIRST') => createGame(data, {
  seedStr: seed, name: '龍天台', gender: 'm', education: '大學', age: 35,
  startId: 'rookie', backgroundId: 'activist',
  homeDistrict: data.districts.districts[0].id, party: null,
  ideology: {}, china: {},
  baseAttrs: { stamina: 2, sociability: 2, charisma: 2, eloquence: 2, judgment: 2, boldness: 2 },
});

/* ── 1. 前兩次有文本，第三次之後沒有 ── */
let s = mk();
const seq = [];
for (let i = 0; i < 4; i++) {
  s.player.apUsed = 0;
  const r = Char.doAction(s, data, 'canvass');
  seq.push(r.first ? r.first.nth : null);
}
ok(JSON.stringify(seq) === '[1,2,null,null]', `跑攤第一、二次有專屬文本，第三次之後沒有：${JSON.stringify(seq)}`);

/* ── 2. 十八個行動全部都有 ── */
s = mk();
const ids = Char.ACTIONS.map((a) => a.id);
const missing = [];
for (const id of ids) {
  s.player.apUsed = 0;
  const r = Char.commit(s, data, id);
  if (!r.first?.text) missing.push(id);
}
ok(!missing.length, `全部 ${ids.length} 個行動的第一次都有文本${missing.length ? '：缺 ' + missing.join('、') : ''}`);
// 第二次：退出政壇是終局，同一局不會有第二次
const noSecond = [];
for (const id of ids) {
  s.player.apUsed = 0;
  const r = Char.commit(s, data, id);
  if (!r.first?.text) noSecond.push(id);
}
ok(noSecond.length === 1 && noSecond[0] === 'retire',
  `第二次也都有文本，只有退出政壇沒有（那是終局，同一局不會有第二次）`);

/* ── 3. 三種變體，不同種子會拿到不同段 ── */
const seen = new Set();
for (const seed of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
  const g = mk(seed);
  g.player.apUsed = 0;
  seen.add(Char.doAction(g, data, 'canvass').first.text);
}
ok(seen.size >= 2, `八顆不同的種子抽到 ${seen.size} 種不同的變體`);
const pool = new Set(data.firstTimes.actions.canvass['1']);
ok([...seen].every((t) => pool.has(t)), '抽到的變體都來自這個行動自己的文本庫');

/* ── 4. 同一顆種子重開會拿到同一段 ── */
const g1 = mk('SAME'); g1.player.apUsed = 0;
const g2 = mk('SAME'); g2.player.apUsed = 0;
ok(Char.commit(g1, data, 'talkshow').first.text === Char.commit(g2, data, 'talkshow').first.text,
  '同一顆種子重開會拿到同一段，存檔可以重現');

/* ── 4b. 打開選單看一看不算做過一次 ── */
const g3 = mk('PEEK'); g3.player.apUsed = 0;
const peek = Char.doAction(g3, data, 'talkshow');
ok(peek.deferred && !peek.first && Firsts.countOf(g3, 'talkshow') === 0,
  '打開節目選單但沒有真的上，不算做過一次');
ok(Char.commit(g3, data, 'talkshow').first?.nth === 1, '真的上了才算第一次');

/* ── 5. 做不成的行動要把次數退回去 ── */
s = mk();
s.player.apUsed = 0;
Char.commit(s, data, 'setImage');
ok(Firsts.countOf(s, 'setImage') === 1, '掛形象記了一次');
Firsts.refund(s, 'setImage');
ok(Firsts.countOf(s, 'setImage') === 0 && !s.flags.pendingFirst,
  '沒換成就退回去，第一次的文本不會被白白用掉');

/* ── 6. 事件消耗行動點不算成任何一個行動 ── */
s = mk();
s.player.apUsed = 0;
const evAp = Char.spendAP(s, data, 1, 4);
ok(evAp.ok && !evAp.first && !s.flags.pendingFirst, '處理事件花掉的行動點不會被算成某個行動');

/* ── 7. 行動點鎖死在兩點 ── */
s = mk();
const base = Char.apOf(s, data);
ok(base === 2, `基礎行動點 ${base} 點`);
const probes = [];
s.player.role = 'president'; probes.push(Char.apOf(s, data));
s.player.attrs.stamina = 5; probes.push(Char.apOf(s, data));
s.player.fatigueRaw = 119; probes.push(Char.apOf(s, data));
s.meta.scale = 'week';
s.team.push({ id: 'm1', name: '王經理', role: 'manager', roleName: '競選經理', ability: 5, loyalty: 5, ambition: 1 });
probes.push(Char.apOf(s, data));
ok(probes.every((x) => x === 2), `總統、體力五、疲勞爆表、帶競選經理，全部都還是兩點：${probes.join('/')}`);
ok(Char.maxAPWithOverdraft(s, data) > 2, `硬撐的上限仍然高於兩點（${Char.maxAPWithOverdraft(s, data)}），那是把身體借出去用`);
ok(data.canvass.standingGig.maxSlots === 1, '常駐通告上限降為一個，不然兩點會被吃掉一半');

/* ── 8. 選戰期間的按鈕不能出現「月」 ── */
s = mk();
s.meta.scale = 'week';
const weekLabels = [];
for (const left of [0, 1, 2]) weekLabels.push(endTurnLabel(s, data, left));
s.player.fatigueRaw = 80; weekLabels.push(endTurnLabel(s, data, 0));
s.meta.month = 12; weekLabels.push(endTurnLabel(s, data, 2));
ok(weekLabels.every((x) => x.includes('週') && !x.includes('月')),
  `週回合的按鈕全部寫「週」不寫「月」：${[...new Set(weekLabels)].join('／')}`);
s.election = { phase: 'campaign', weeksLeft: 3 };
ok(endTurnLabel(s, data, 2).includes('週'), `選戰倒數也是寫週：${endTurnLabel(s, data, 2)}`);
s.meta.scale = 'month'; s.election = null; s.player.fatigueRaw = 0; s.meta.month = 12;
ok(endTurnLabel(s, data, 0).includes('月'), `月回合維持寫月：${endTurnLabel(s, data, 0)}`);
ok(!endTurnLabel(s, data, 0).includes('件事沒處理'), '按鈕上不再催促還有幾件事沒處理');

console.log(fails ? `\n${fails} 項失敗` : '\n第一次文本與行動點全部通過');
process.exit(fails ? 1 : 0);
