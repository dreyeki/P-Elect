// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { mobilization } from './DistrictSystem.js';
import { makePolitician } from './NameGen.js';
import * as People from './PeopleSystem.js';

/** 距離下一場玩家可參與的選舉還有幾個月 */
export function monthsUntilElection(state, data) {
  const { year, month } = state.meta;
  for (const s of data.elections.schedule) {
    const diff = (s.year - year) * 12 + (s.month - month);
    if (diff >= 0) return { months: diff, sched: s };
  }
  return { months: null, sched: null };
}

export function shouldUseWeekScale(state, data) {
  const { months } = monthsUntilElection(state, data);
  return months !== null && months <= data.meta.weekTurnLeadMonths;
}

/** 玩家可參選的職位 */
export function availableRuns(state, data, sched) {
  const p = state.player;
  const out = [];
  const homeD = data.byId.district[p.homeDistrict];
  if (!homeD || !sched) return out;
  const L = data.elections.levels;
  for (const type of sched.types) {
    const lv = L[type];
    if (!lv) continue;
    if ((lv.fameNeed ?? 0) > p.fame) continue;
    if (type === 'councilor') out.push({ type, scopeId: homeD.id, name: `${homeD.name}${lv.name}`, level: lv });
    else if (type === 'mayor') out.push({ type, scopeId: homeD.regionId, name: `${data.byId.region[homeD.regionId].name}${lv.name}`, level: lv });
    else if (type === 'legislator') {
      const ld = data.elections.legislatorDistricts.find((l) => l.parts.some((x) => x.districtId === homeD.id));
      if (ld) out.push({ type, scopeId: ld.id, name: `${ld.name}${lv.name}`, level: lv });
    } else if (type === 'president') out.push({ type, scopeId: 'NATION', name: '總統', level: lv });
    else if (type === 'villageHead' || type === 'townshipHead') out.push({ type, scopeId: homeD.id, name: `${homeD.name}${lv.name}`, level: lv });
  }
  return out;
}

/** 取得某個範圍涵蓋的選區清單與權重 */
export function scopeDistricts(data, type, scopeId) {
  const all = data.districts.districts;
  if (type === 'president') return all.map((d) => ({ districtId: d.id, weight: 1 }));
  if (type === 'mayor') return all.filter((d) => d.regionId === scopeId).map((d) => ({ districtId: d.id, weight: 1 }));
  if (type === 'legislator') {
    const ld = data.elections.legislatorDistricts.find((l) => l.id === scopeId);
    return ld ? ld.parts : [];
  }
  return [{ districtId: scopeId, weight: type === 'villageHead' || type === 'townshipHead' ? 0.25 : 1 }];
}

/** 產生對手 */
/**
 * 產生對手。
 *
 * 對手不是憑空生出來的，是選區裡本來就在跑的那些人。
 * 議員層級幾乎全部來自本地，因為那個層級靠的是誰家的喜宴你有到；
 * 立委以上才會出現黨中央派來的空降人選——知名度高，但地方上沒有人欠他。
 */
export function makeOpponents(state, data, run, rng) {
  const homeD = data.byId.district[run.scopeId] ?? data.byId.district[state.player.homeDistrict];
  const n = run.type === 'councilor' ? Math.max(3, (homeD?.seats ?? 5) + 3)
    : run.type === 'president' ? 2 : rng.int(1, 3);
  const out = People.candidatesFor(state, data, run, rng, n)
    .filter((c) => c.party !== state.player.party || run.type === 'councilor');
  // 同黨的人在初選之後就不會再出現在正式選票上，所以偶爾要補足人數
  while (out.length < n) {
    const npc = makePolitician(data, rng, {
      party: rng.pick(data.partyIds.filter((x) => x !== state.player.party)),
      fame: clamp(rng.int(1, 4) + (run.type === 'president' ? 1 : 0), 0, 5),
    });
    npc.grassroots = clamp05(rng.range(1, 4));
    out.push(npc);
  }
  return out.slice(0, n);
}

/**
 * 初選落敗之後會發生的事。
 *
 * 落選不是句點。三成的機會出線的那個人一個月後自己走掉——
 * 可能是週刊寫了什麼，可能是身體出了狀況，也可能是有人請他讓一讓。
 * 兩成的機會黨中央問你要不要去別的選區，那是一份看起來像機會的懲罰。
 * 剩下的情況你只剩下一個選擇：要不要真心去幫贏你的那個人站台。
 */
export function afterPrimaryLoss(state, data, rng) {
  const T = data.tuning?.election ?? {};
  const pri = state.election?.primary;
  const winner = state.election?.primaryField?.find((x) => !x.isPlayer);
  const run = state.election?.run;
  state.flags.primaryLoss = {
    year: state.election?.sched?.year ?? state.meta.year,
    winnerName: winner?.name ?? '出線的那位',
    runName: run?.name ?? '這個位子',
    runType: run?.type ?? 'councilor',
  };

  const roll = rng.next();
  const pWithdraw = T.rivalWithdrawChance ?? 0.30;
  const pDraft = T.draftOtherDistrictChance ?? 0.20;

  if (roll < pWithdraw) {
    const how = rng.pick(['scandal', 'death', 'persuaded']);
    state.flags.pendingPrimaryEvent = { kind: 'withdraw', how, turn: state.meta.turn + rng.int(2, 4) };
  } else if (roll < pWithdraw + pDraft) {
    // 徵召去別區：挑一個離家夠遠、而且沒有人想選的地方
    const homeD = data.byId.district[state.player.homeDistrict];
    const far = data.districts.districts.filter((d) => d.regionId !== homeD.regionId);
    const target = far.length ? rng.pick(far) : homeD;
    state.flags.pendingPrimaryEvent = {
      kind: 'draft', districtId: target.id, districtName: target.name,
      regionName: data.byId.region[target.regionId]?.name ?? '',
      hostile: target.lean * (state.parties[state.player.party]?.platform.unification ?? 0) > 0 ? false : true,
      turn: state.meta.turn + rng.int(1, 3),
    };
  } else {
    state.flags.pendingPrimaryEvent = { kind: 'unite', turn: state.meta.turn + 1 };
  }
  return state.flags.pendingPrimaryEvent;
}

/** 把上面那三種後續事件變成玩家看得到的一則待決事項 */
export function primaryAftermath(state, data) {
  const ev = state.flags.pendingPrimaryEvent;
  if (!ev || state.meta.turn < ev.turn) return null;
  const L = state.flags.primaryLoss ?? {};
  if (ev.kind === 'withdraw') {
    const bodies = {
      scandal: `週刊在封面放了${L.winnerName}跟一位女士走進飯店的照片，內頁還有四頁的行車紀錄與刷卡明細。他召開記者會否認，但第二天黨中央就宣布提名作業重新啟動。你接到電話的時候正在服務處整理落選之後沒有人要的文宣。`,
      death: `${L.winnerName}在自家浴室倒下，送醫之後沒有再醒過來。他的年紀比你大不了幾歲，前一週你們才在同一場告別式上點過頭。黨中央在告別式結束的隔天就打電話給你，語氣很得體，內容很現實。`,
      persuaded: `${L.winnerName}在中常會之後主動宣布退出，理由是希望把機會讓給年輕一代。你知道那不是他自己的意思，因為前一天有一位很久沒有出面的前輩，親自去了他的服務處一趟。`,
    };
    return {
      kind: 'withdraw',
      headline: `${L.winnerName}宣布退出${L.runName}的提名`,
      body: bodies[ev.how] ?? bodies.persuaded,
      options: [
        { id: 'take', text: '接下這張提名，把原本的選戰重新啟動',
          hint: '你會拿回這個位子，但所有人都知道你是怎麼拿到的' },
        { id: 'refuse', text: '婉拒遞補，說這個位子不該用這種方式得到',
          hint: '你會失去這一屆，換來一個很難用金錢衡量的東西' },
      ],
    };
  }
  if (ev.kind === 'draft') {
    return {
      kind: 'draft',
      headline: `黨中央問你願不願意被徵召到${ev.regionName}${ev.districtName}`,
      body: `打電話來的人先誇了你在初選的表現，說中央都看在眼裡。接著他提到${ev.regionName}那個選區一直找不到人，如果你願意去，黨部會全力支援。你查了一下那個選區近三屆的得票，然後明白了全力支援這四個字在這裡是什麼意思。你在那裡沒有半個認識的里長，也沒有任何一場婚喪喜慶去過。`,
      options: [
        { id: 'accept', text: '接受徵召，把家搬過去從零開始',
          hint: '基層歸零，但黨內會欠你一個很大的人情' },
        { id: 'decline', text: '婉拒徵召，留在自己經營多年的地方',
          hint: '你保住了基層，也保住了那個被拒絕的紀錄' },
      ],
    };
  }
  return {
    kind: 'unite',
    headline: `${L.winnerName}的競選總部希望你去站台`,
    body: `打電話來的是他的競選經理，語氣客氣得有點過頭。他說黨內團結很重要，也說${L.winnerName}本人很希望你能到場。你們兩個月前才在初選裡把對方的每一個弱點都講過一遍，那些話現在都還躺在網路上。要不要去，以及去了要用什麼表情，是接下來幾天你唯一在想的事。`,
    options: [
      { id: 'full', text: '去，而且講得比自己選的時候還賣力',
        hint: '黨內的人會記住，你的支持者會有一部分覺得被出賣' },
      { id: 'token', text: '去露個臉，講三分鐘場面話就走',
        hint: '兩邊都交代得過去，兩邊也都不會真的滿意' },
      { id: 'skip', text: '不去，說自己需要一點時間',
        hint: '誠實但昂貴，這件事會被記在提名名單旁邊' },
    ],
  };
}

/** 結算初選後續事件 */
export function resolveAftermath(state, data, kind, optionId, rng) {
  const p = state.player;
  state.flags.pendingPrimaryEvent = null;
  if (kind === 'withdraw') {
    if (optionId === 'take') {
      state.flags['elecDone_' + (state.flags.primaryLoss?.year ?? state.meta.year)] = false;
      p.stigma = clamp05(p.stigma + 0.3);
      p.partyPrestige = clamp05(p.partyPrestige + 0.5);
      return { msg: '你接下了這張提名。記者會上有人問你對前一位被提名人的看法，你講了一段很得體的話，然後三天都沒有睡好。', reopen: true };
    }
    p.integrity = clamp05(p.integrity + 1);
    p.fame = clamp05(p.fame + 0.3);
    return { msg: '你婉拒了遞補。黨內有人說你不識抬舉，也有人記住了這件事——後面那種人比較少，但他們記得比較久。' };
  }
  if (kind === 'draft') {
    if (optionId === 'accept') {
      const ev = state.flags.pendingDraftDistrict;
      p.partyPrestige = clamp05(p.partyPrestige + 1.2);
      state.flags.draftAccepted = true;
      return { msg: '你接受了徵召。搬過去的第一個月，你在市場裡站了兩個小時，沒有一個人叫得出你的名字。', draft: true };
    }
    p.partyPrestige = clamp05(p.partyPrestige - 0.8);
    return { msg: '你婉拒了徵召。那通電話掛掉之後，黨部的人在名單上你的名字旁邊寫了一個記號。' };
  }
  // 團結站台
  if (optionId === 'full') {
    p.partyPrestige = clamp05(p.partyPrestige + 1);
    p.favorNational = clampBi(p.favorNational - 0.3);
    const w = Object.values(state.people ?? {}).find((x) => x.name === state.flags.primaryLoss?.winnerName);
    if (w) w.favor = clamp(w.favor + 1.6, -5, 5);
    return { msg: '你在台上把他誇了十五分鐘，台下有幾位你的支持者提早離場。散場之後他握著你的手講了很久，那些話有幾分真心你分辨不出來。' };
  }
  if (optionId === 'token') {
    p.partyPrestige = clamp05(p.partyPrestige + 0.3);
    return { msg: '你上台講了三分鐘，內容全部是黨的政策，一次都沒有提到他的名字。在場的人都聽出來了。' };
  }
  p.partyPrestige = clamp05(p.partyPrestige - 1);
  p.integrity = clamp05(p.integrity + 0.4);
  return { msg: '你沒有去。那天晚上你在家裡看轉播，鏡頭掃過主席台的時候，你發現自己並不後悔。' };
}

/**
 * 核心得票計算。
 * 每個候選人、每個選區各擲一次 0.98~1.05 的乘數。
 */
export function computeVotes(state, data, run, candidates, rng) {
  const P = state.pops;
  const nP = data.partyIds.length;
  const parts = scopeDistricts(data, run.type, run.scopeId);
  const partMap = Object.fromEntries(parts.map((p) => [p.districtId, p.weight]));
  const dIndex = {};
  data.districts.districts.forEach((d, i) => (dIndex[i] = d));
  const level = run.level;

  const totals = candidates.map(() => 0);
  const byDistrict = {};

  for (let i = 0; i < P.n; i++) {
    const d = dIndex[P.district[i]];
    const w = partMap[d.id];
    if (!w) continue;

    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci];
      const pIdx = data.partyIds.indexOf(c.party);
      const partySup = pIdx >= 0 ? P.support[i * nP + pIdx] : 0.04;
      const mob = c.isPlayer ? mobilization(state, d.id, c.party) : (c.grassroots ?? 1);
      const personal = personalFactor(state, data, c, d, i);

      const scoreRaw = partySup * 0.55 + personal * 0.30 + (mob / 5) * 0.15;
      // 投票率
      const enth = P.enthusiasm[i];
      const turnout = clamp(
        P.turnoutBase[i]
        * (1 + P.awareness[i] / 5 * 0.15)
        * level.turnoutFactor
        * (1 + mob * 0.04)
        * (0.72 + 0.056 * enth)
        * (state.flags.weatherFactor ?? 1),
        0.15, 0.95);
      const votes = P.size[i] * w * turnout * scoreRaw;
      totals[ci] += votes;
      (byDistrict[d.id] ??= candidates.map(() => 0))[ci] += votes;
    }
  }
  // 正規化 + 每人每區的隨機乘數
  const results = candidates.map((c, ci) => {
    const noise = rng.range(0.98, 1.05);
    return { candidate: c, votes: Math.round(totals[ci] * noise), noise };
  });
  const sum = results.reduce((a, r) => a + r.votes, 0) || 1;
  results.forEach((r) => (r.share = r.votes / sum));
  results.sort((a, b) => b.votes - a.votes);
  return { results, byDistrict };
}

function personalFactor(state, data, c, district, popIdx) {
  const P = state.pops;
  if (c.isPlayer) {
    const p = state.player;
    const dState = state.districts[district.id];
    const home = data.byId.district[p.homeDistrict];
    const geo = district.id === p.homeDistrict ? 1 : district.regionId === home?.regionId ? 0.5 : 0;
    let f = 0.30 * (p.fame / 5)
      + 0.25 * ((dState.playerFavor + 5) / 10)
      + 0.20 * (p.attrs.charisma / 5)
      + 0.15 * geo
      - 0.10 * (p.stigma / 5)
      + 0.05 * ((P.playerFavor[popIdx] + 5) / 10);
    for (const tid of state.tags) {
      const t = data.byId.tag[tid];
      const sid = data.strataIds[P.stratum[popIdx]];
      const pf = t?.effects?.popFavor;
      if (pf) f += ((pf[sid] ?? pf._all ?? 0)) * 0.02;
      if (t?.effects?.moderateVotePenalty) f -= t.effects.moderateVotePenalty * 0.5;
    }
    return clamp(f, 0, 1);
  }
  return clamp(0.30 * (c.fame / 5) + 0.20 * (c.attrs.charisma / 5) + 0.20 * ((c.grassroots ?? 1) / 5)
    + 0.20 * 0.5 - 0.10 * (c.stigma / 5), 0, 1);
}

/** SNTV：複數當選 */
export function resolveSNTV(results, seats) {
  return results.slice(0, seats).map((r) => r.candidate);
}

/** 不分區：政黨票 5% 門檻，最大餘額法 */
export function partyListSeats(support, seatCount = 34, threshold = 0.05) {
  const eligible = Object.entries(support).filter(([, v]) => v >= threshold);
  const total = eligible.reduce((a, [, v]) => a + v, 0) || 1;
  const quotas = eligible.map(([k, v]) => ({ k, exact: (v / total) * seatCount }));
  const out = {};
  let used = 0;
  for (const q of quotas) { out[q.k] = Math.floor(q.exact); used += out[q.k]; }
  quotas.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  let i = 0;
  while (used < seatCount && quotas.length) { out[quotas[i % quotas.length].k]++; used++; i++; }
  return out;
}

/**
 * 黨內初選。
 * 這不是擲一次骰子——你會看到跟你搶同一張門票的是誰、他背後站著哪個派系，
 * 而在投票之前，你還有機會去談。
 */
export function buildPrimary(state, data, run, rng) {
  const p = state.player;
  if (!p.party) {
    return { skip: true, msg: '你沒有政黨，不需要初選，直接登記參選就可以。' };
  }
  const party = state.parties[p.party];
  const d = state.districts[p.homeDistrict];

  const myPoll = clamp(((d?.playerFavor ?? 0) + 5) / 10 * 0.55 + p.fame / 5 * 0.45, 0.02, 1);
  const myMember = clamp(p.partyPrestige / 5 * 0.5
    + (clamp(party.factions.reduce((a, f) => a + clamp(f.favor / 5, -1, 1) * f.seatShare, 0), -1, 1) + 1) / 2 * 0.5,
    0.02, 1);

  // 對手：從派系裡推出來的人，每個背後站著一個派系
  const n = run.type === 'president' ? 2 : run.type === 'mayor' ? rng.int(1, 3) : rng.int(1, 2);
  const facs = rng.shuffle(party.factions).slice(0, n);
  const rivals = facs.map((f) => {
    const npc = makePolitician(data, rng, { party: p.party, fame: rng.int(1, 4) });
    const backing = clamp(f.seatShare * 1.6 + rng.range(-0.1, 0.2), 0.05, 0.95);
    return {
      id: npc.id, name: npc.name, factionId: f.id, factionName: f.name,
      poll: clamp(npc.fame / 5 * 0.6 + rng.range(0.1, 0.45), 0.05, 0.95),
      member: clamp(backing * 0.7 + rng.range(0.05, 0.3), 0.05, 0.95),
      desc: `${f.name}推出來的人選。${npc.fame >= 3 ? '在媒體上有一定的能見度。' : '知名度不高，但派系動員得起來。'}`,
    };
  });

  return {
    skip: false, run,
    me: { poll: myPoll, member: myMember, stigma: p.stigma },
    rivals,
    lobbied: [],
    lobbyBudget: 2,
    msg: `${party.name}要為${run.name}辦初選。跟你搶這張門票的有 ${rivals.length} 個人。`,
  };
}

/** 在初選投票前去談。談得成的派系會把票投給你。 */
export function lobbyFaction(state, data, pri, factionId, rng) {
  const p = state.player;
  if (pri.lobbied.includes(factionId)) return { ok: false, msg: '這個派系你已經談過了。' };
  if (pri.lobbied.length >= pri.lobbyBudget) return { ok: false, msg: '距離投票只剩下這幾天，你跑不了更多地方了。' };
  const party = state.parties[p.party];
  const f = party.factions.find((x) => x.id === factionId);
  if (!f) return { ok: false, msg: '找不到這個派系。' };

  const cost = 40;
  if (p.politicalCapital < cost) return { ok: false, msg: '你手上的政治資本不夠換這個人情。' };
  p.politicalCapital -= cost;
  pri.lobbied.push(factionId);

  const chance = clamp(0.2 + f.favor / 5 * 0.45 + p.attrs.sociability * 0.06 + p.partyPrestige * 0.04, 0.05, 0.92);
  if (rng.bool(chance)) {
    pri.me.member = clamp(pri.me.member + f.seatShare * 0.8, 0, 1);
    const rival = pri.rivals.find((r) => r.factionId === factionId);
    if (rival) rival.member = clamp(rival.member - f.seatShare * 0.6, 0.02, 1);
    return { ok: true, won: true, msg: `${f.name}答應在初選裡挺你。前輩說這個人情要記著，你知道他不是在開玩笑。` };
  }
  return { ok: true, won: false, msg: `${f.name}的人很客氣地泡了茶，然後很客氣地說這次已經有安排了。` };
}

/** 開票 */
export function resolvePrimary(state, data, pri, rng) {
  const p = state.player;
  // 人情牽制換到的初選幫助，在這裡才真正兌現
  const help = state.flags.primaryHelp ?? 0;
  state.flags.primaryHelp = 0;
  const all = [
    { name: p.name, isPlayer: true,
      score: pri.me.poll * 0.5 + (pri.me.member + help) * 0.5 - pri.me.stigma / 5 * 0.12 },
    ...pri.rivals.map((r) => ({ name: r.name, factionName: r.factionName, isPlayer: false,
      score: r.poll * 0.5 + r.member * 0.5 })),
  ].map((x) => ({ ...x, final: Math.max(0.01, x.score + rng.normal(0, 0.07)) }));

  const sum = all.reduce((a, x) => a + x.final, 0);
  all.forEach((x) => (x.share = x.final / sum));
  all.sort((a, b) => b.share - a.share);
  const won = all[0].isPlayer;
  const mine = all.find((x) => x.isPlayer);

  return {
    won, field: all,
    msg: won
      ? `你以 ${(mine.share * 100).toFixed(1)}% 出線。對手在記者會上表示尊重，握手的時候沒有看你的眼睛。`
      : `你以 ${(mine.share * 100).toFixed(1)}% 落敗，${all[0].name}拿到了提名。`
        + `黨中央希望你留下來輔選，但要不要接受這個安排，決定權在你手上。`,
  };
}

/** 選後結算 */
export function applyResult(state, data, run, outcome) {
  const p = state.player;
  if (outcome.won) {
    p.role = run.type === 'councilor' ? 'councilor' : run.type === 'legislator' ? 'legislator'
      : run.type === 'mayor' ? 'mayor' : run.type === 'president' ? 'president' : 'village';
    p.office = { type: run.type, scopeId: run.scopeId, name: run.name, since: state.meta.turn };
    p.fame = clamp05(p.fame + (run.type === 'president' ? 2 : run.type === 'mayor' ? 1 : 0.5));
    p.careerLog.push({ turn: state.meta.turn, kind: 'win', text: `當選${run.name}` });
    if (run.type === 'president') state.central.government.presidentParty = p.party ?? 'IND';
    if (run.type === 'mayor') state.regions[run.scopeId].politics.mayorParty = p.party ?? 'IND';
  } else {
    p.careerLog.push({ turn: state.meta.turn, kind: 'lose', text: `${run.name}落選` });
    p.fame = clamp05(p.fame - 0.2);
  }
  // 選舉補助款
  const my = outcome.results.find((r) => r.candidate.isPlayer);
  if (my && my.share >= data.elections.subsidyThreshold) {
    state.finance.campaign += my.votes * data.elections.subsidyPerVote;
  }
  state.election = null;
  return outcome;
}
