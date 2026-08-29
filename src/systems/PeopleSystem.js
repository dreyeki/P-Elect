// @ts-check
/**
 * 選區裡的人。
 *
 * 對手不是選舉開始的那一刻才生出來的。他們一直都在那裡——
 * 在同一個市場跑攤、在同一場告別式上香、在同一個議場裡坐你隔壁。
 * 你看著他們一起變老、往上爬、出事，或者某一年就不再出現了。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { makeName } from './NameGen.js';

const nextId = (state) => 'P' + (state.flags.peopleSeq = (state.flags.peopleSeq ?? 0) + 1).toString(36);

/** 開局在每個選區配置三到七位在地政治人物 */
export function init(state, data, rng) {
  state.people = {};
  state.peopleByDistrict = {};
  const cfg = data.people;
  for (const d of data.districts.districts) {
    const n = clamp(Math.round(rng.range(cfg.perDistrict.min, cfg.perDistrict.max + 0.49)
      + d.urbanity * cfg.perDistrict.urbanityBonus), cfg.perDistrict.min, cfg.perDistrict.max);
    const ids = [];
    for (let i = 0; i < n; i++) {
      const p = spawn(state, data, rng, d.id, { veteranChance: 0.28 });
      ids.push(p.id);
    }
    state.peopleByDistrict[d.id] = ids;
  }
  return { count: Object.keys(state.people).length };
}

/** 生一個新人物。district 決定他的地盤，opts 可以指定政黨或空降身分 */
export function spawn(state, data, rng, districtId, opts = {}) {
  const cfg = data.people;
  const arc = rng.weighted(cfg.archetypes, (a) => a.weight);
  const d = data.byId.district[districtId];
  const region = data.byId.region[d.regionId];
  const age = rng.int(arc.ageRange[0], arc.ageRange[1]);
  const birthYear = state.meta.year - age;

  // 政黨：依該縣市議會的實際組成抽，這樣藍區就會長出藍的人
  const comp = region.politics.councilComposition ?? {};
  const pool = data.partyIds.map((pid) => ({ pid, w: (comp[pid] ?? 0) + 0.35 }));
  const party = opts.party ?? (rng.bool(0.12) ? null : rng.weighted(pool, (x) => x.w).pid);

  const traits = [];
  const nTrait = rng.bool(0.35) ? 2 : 1;
  const shuffled = rng.shuffle(cfg.traits);
  for (let i = 0; i < nTrait; i++) traits.push(shuffled[i].id);

  const jitter = () => rng.int(-1, 1);
  const p = {
    id: nextId(state),
    name: makeName(data, rng, birthYear),
    birthYear,
    gender: rng.bool(0.72) ? 'male' : 'female',
    archetype: arc.id,
    party,
    districtId,
    regionId: d.regionId,
    traits,
    attrs: {
      stamina: clamp05(3 + jitter()),
      sociability: clamp05((arc.attrs.sociability ?? 2) + jitter()),
      charisma: clamp05((arc.attrs.charisma ?? 2) + jitter()),
      eloquence: clamp05((arc.attrs.eloquence ?? 2) + jitter()),
      judgment: clamp05((arc.attrs.judgment ?? 2) + jitter()),
      boldness: clamp05((arc.attrs.boldness ?? 2) + jitter()),
    },
    fame: clamp05(arc.fame + (opts.parachute ? cfg.parachute.fameBonus : 0) + rng.range(-0.6, 0.8)),
    grassroots: clamp05(arc.grassroots + (opts.parachute ? cfg.parachute.grassrootsPenalty : 0) + rng.range(-0.7, 0.7)),
    stigma: clamp05((arc.stigmaBase ?? 0) + (rng.bool(0.2) ? 1 : 0)),
    funds: Math.round(rng.range(300000, 4000000) * (traits.includes('TR_MONEYED') ? 2.2 : 1)),
    followers: Math.round(rng.range(500, 40000) * (traits.includes('TR_VIRAL') ? 4 : 1)),
    role: 'citizen',
    relation: 'neutral',
    favor: 0,
    wins: 0, losses: 0,
    parachute: !!opts.parachute,
    since: state.meta.turn,
  };
  // 資深的人已經在位子上，這件事會直接反映在知名度與基層
  if (opts.veteranChance && rng.bool(opts.veteranChance) && age >= 40) {
    p.role = rng.bool(0.75) ? 'councilor' : 'legislator';
    p.wins = rng.int(1, 4);
    p.fame = clamp05(p.fame + 0.8 + p.wins * 0.2);
    p.grassroots = clamp05(p.grassroots + 0.6);
  }
  state.people[p.id] = p;
  (state.peopleByDistrict[districtId] ??= []).push(p.id);
  return p;
}

/** 每回合：能力與聲量緩慢移動，每季補人與淘汰 */
export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  if (!state.people) return {};
  const cfg = data.people;
  const news = [];
  const quarterly = state.meta.scale === 'month' && state.meta.month % 3 === 1;

  for (const p of Object.values(state.people)) {
    const tr = p.traits.map((t) => data.people.traits.find((x) => x.id === t)).filter(Boolean);
    const fameG = tr.reduce((a, t) => a * (t.fameGrowth ?? 1), 1);
    const grassG = tr.reduce((a, t) => a * (t.grassrootsGrowth ?? 1), 1);
    const stigG = tr.reduce((a, t) => a + (t.stigmaGrowth ?? 0), 0);

    // 沒有人會一直被記得，但在地經營不會憑空消失
    p.fame = clamp05(p.fame + (p.fame < 1.2 ? 0.004 : -0.006) * fameG * scaleMult);
    p.grassroots = clamp05(p.grassroots + (p.role === 'citizen' ? 0.004 : 0.010) * grassG * scaleMult);
    if (stigG > 0 && rng.bool(0.02 * scaleMult)) p.stigma = clamp05(p.stigma + stigG);
    p.followers = Math.round(p.followers * (1 + (tr.some((t) => t.id === 'TR_VIRAL') ? 0.012 : 0.003) * scaleMult));
  }

  if (!quarterly) return { news };

  // ── 每季：補新人
  const preElection = (state.flags.monthsToElection ?? 99) <= 14;
  const Q = cfg.quarterlyIntake;
  for (const d of data.districts.districts) {
    const ids = state.peopleByDistrict[d.id] ?? [];
    if (ids.length >= Q.maxPerDistrict) continue;
    const p = (Q.base + d.urbanity * Q.urbanity) * (preElection ? Q.preElectionMult : 1);
    if (rng.bool(clamp(p, 0, 0.9))) spawn(state, data, rng, d.id);
  }

  // ── 每季：有人退出
  const A = cfg.attrition;
  for (const [did, ids] of Object.entries(state.peopleByDistrict)) {
    if (ids.length <= cfg.perDistrict.min) continue;
    for (const id of ids.slice()) {
      const p = state.people[id];
      if (!p) continue;
      const age = state.meta.year - p.birthYear;
      const chance = A.base + p.losses * A.perLoss
        + (age >= 70 ? A.ageOver70 : 0) + (p.stigma >= 3 ? A.stigmaOver3 : 0);
      if (!rng.bool(clamp(chance, 0, 0.5))) continue;
      retire(state, id);
      if (p.fame >= 2.5 && did === state.player.homeDistrict) {
        news.push({ kind: 'party', text: `${p.name}宣布不再參與下一次選舉，理由講得很體面。這個選區少了一個對手，也少了一個知道所有事情的人。` });
      }
    }
  }
  return { news };
}

/**
 * 存檔用的精簡表示。
 *
 * 一千個 NPC 如果照原樣序列化會佔掉半個 MB，多數空間浪費在
 * 0.4713817834854126 這種完全沒有意義的小數位上。
 * 抽象量本來就只顯示成四個字，兩位小數已經比玩家看得到的細很多。
 */
export function packPeople(people) {
  const r2 = (v) => Math.round((v ?? 0) * 100) / 100;
  const out = {};
  for (const [id, p] of Object.entries(people ?? {})) {
    out[id] = {
      ...p,
      fame: r2(p.fame), grassroots: r2(p.grassroots), stigma: r2(p.stigma), favor: r2(p.favor),
      attrs: Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      funds: Math.round(p.funds / 1000) * 1000,
      followers: Math.round(p.followers / 100) * 100,
    };
    delete out[id].regionId;   // 由 districtId 推得，不必存
  }
  return out;
}

/** 讀檔時把省下來的欄位補回去 */
export function unpackPeople(people, data) {
  for (const p of Object.values(people ?? {})) {
    p.regionId ??= data.byId.district[p.districtId]?.regionId ?? null;
  }
  return people;
}

function retire(state, id) {
  const p = state.people[id];
  if (!p) return;
  const arr = state.peopleByDistrict[p.districtId];
  if (arr) state.peopleByDistrict[p.districtId] = arr.filter((x) => x !== id);
  delete state.people[id];
}

/** 同選區的人，依威脅度排序 */
export function inDistrict(state, districtId) {
  return (state.peopleByDistrict?.[districtId] ?? [])
    .map((id) => state.people[id]).filter(Boolean)
    .sort((a, b) => threat(b) - threat(a));
}

/** 威脅度：這個人現在有多難對付。玩家看到的是四字語詞而不是這個數字。 */
export function threat(p) {
  return clamp(p.fame * 0.42 + p.grassroots * 0.34 + (p.role !== 'citizen' ? 0.9 : 0)
    + p.wins * 0.18 - p.stigma * 0.16, 0, 5);
}

/**
 * 產生一場選舉的對手。
 * 議員層級幾乎全部來自本地，因為那個層級靠的是誰家的喜宴你有到；
 * 立委以上才會出現黨中央派來的人，而空降的人知名度高、基層薄。
 */
export function candidatesFor(state, data, run, rng, count) {
  const cfg = data.people;
  const level = run.type ?? 'councilor';
  const homeId = state.player.homeDistrict;
  const homeD = data.byId.district[homeId];
  const out = [];

  // 本地人優先，同一個選區的排前面，同縣市的次之
  const local = inDistrict(state, homeId).filter((p) => p.id !== state.player.id);
  const sameRegion = Object.values(state.people)
    .filter((p) => p.regionId === homeD.regionId && p.districtId !== homeId)
    .sort((a, b) => threat(b) - threat(a));

  for (const p of local) {
    if (out.length >= count) break;
    out.push(toCandidate(p, false));
  }
  for (const p of sameRegion) {
    if (out.length >= count) break;
    if (level === 'councilor' && !rng.bool(0.25)) continue;
    out.push(toCandidate(p, false));
  }

  // 空降：從別的縣市派來的人
  const pChute = cfg.parachute.byLevel[level] ?? 0.05;
  if (out.length < count + 1 && rng.bool(pChute)) {
    const far = Object.values(state.people)
      .filter((p) => p.regionId !== homeD.regionId && p.fame >= 2.4);
    const pick = far.length ? rng.pick(far) : spawn(state, data, rng, homeId, { parachute: true });
    const c = toCandidate(pick, true);
    c.fame = clamp05(c.fame + cfg.parachute.fameBonus);
    c.grassroots = clamp05(c.grassroots + cfg.parachute.grassrootsPenalty);
    c.backlash = cfg.parachute.localBacklash;
    out.unshift(c);
  }

  // 真的不夠就現生，但這是最後手段
  while (out.length < count) out.push(toCandidate(spawn(state, data, rng, homeId), false));
  return out.slice(0, count);
}

function toCandidate(p, parachute) {
  return {
    personId: p.id, name: p.name, party: p.party ?? 'IND',
    fame: p.fame, stigma: p.stigma, attrs: { ...p.attrs },
    grassroots: p.grassroots, parachute,
    isPlayer: false,
  };
}

/** 選舉結果回寫到人物身上，讓他們的生涯真的會累積 */
export function recordResult(state, results) {
  for (const r of results) {
    const id = r.candidate?.personId;
    if (!id || !state.people[id]) continue;
    const p = state.people[id];
    if (r.won) { p.wins += 1; p.fame = clamp05(p.fame + 0.5); p.role = r.role ?? p.role; }
    else { p.losses += 1; p.fame = clamp05(p.fame - 0.15); }
  }
}

/** 找一個適合來邀你站台或來欠你人情的人 */
export function pickAcquaintance(state, data, rng, opts = {}) {
  const pool = Object.values(state.people ?? {}).filter((p) => {
    if (opts.sameParty && p.party !== state.player.party) return false;
    if (opts.minFame != null && p.fame < opts.minFame) return false;
    if (opts.local && p.districtId !== state.player.homeDistrict) return false;
    return true;
  });
  if (!pool.length) return null;
  return rng.weighted(pool, (p) => 0.3 + p.fame * 0.6 + Math.abs(p.favor) * 0.8);
}
