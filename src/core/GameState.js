// @ts-check
import { Rng, seedFromString } from './Rng.js';
import { ModifierStack } from './Modifier.js';
import { buildPops } from './Pops.js';
import { clamp, clamp05 } from './Formula.js';
import * as Court from '../systems/CourtSystem.js';
import * as Gov from '../systems/GovernmentSystem.js';
import * as People from '../systems/PeopleSystem.js';
import * as Social from '../systems/SocialSystem.js';
import * as Semi from '../systems/SemiconductorSystem.js';
import * as Asset from '../systems/AssetSystem.js';
import { makePolitician } from '../systems/NameGen.js';

export const ROLE_ORDER = ['citizen', 'aide', 'village', 'councilor', 'legislator', 'mayor', 'minister', 'president'];
export const ROLE_NAME = {
  citizen: '政治素人', aide: '議員助理', village: '里長', councilor: '縣市議員',
  legislator: '立法委員', mayor: '縣市長', minister: '部會首長', president: '總統',
};

/** 建立一局全新的世界 */
export function createGame(data, setup) {
  const seed = seedFromString(setup.seedStr);
  const rng = new Rng(seed);
  const meta = data.meta;

  const state = {
    meta: {
      seedStr: setup.seedStr, seed, rngCounter: 0,
      turn: 1, year: meta.startDate.year, month: meta.startDate.month,
      scale: 'month', weekIndex: 0,
      dataVersion: meta.dataVersion, saveSchemaVersion: meta.saveSchemaVersion,
    },
    player: makePlayer(data, setup, rng),
    team: [],
    finance: {
      personal: 0, campaign: 0,
      donations: [], pending: [], ledger: [],
      lastDeclaredAssets: 0, declaredYear: meta.startDate.year - 1,
    },
    regions: {}, districts: {}, central: structuredClone(data.central),
    world: {}, parties: {}, corporations: {},
    values: {}, laws: {}, localBills: {}, media: {}, issues: {},
    pops: null,
    modifiers: new ModifierStack(),
    pendingEvents: [], news: [], log: [], promises: [], history: [],
    polls: [], invitations: [], court: null, presidency: null,
    cabinet: null, theories: [],
    people: {}, peopleByDistrict: {},
    socialInvites: [], favorPending: [], canvassGigs: [],
    social: null, semi: null, mediaAttack: null,
    counters: {}, tags: [], flags: {}, eventCooldown: {},
    legislature: structuredClone(data.central.government.legislature),
    session: { billsInProgress: [], budgetPhase: null },
    election: null,
  };

  // 縣市
  for (const r of data.regions.regions) {
    const c = structuredClone(r);
    c.finance.debt = c.finance.debt ?? 0;
    c.playerFavor = 0;
    c.mayorApproval = c.politics.mayorApproval;
    state.regions[r.id] = c;
  }
  // 選區
  for (const d of data.districts.districts) {
    state.districts[d.id] = {
      id: d.id, regionId: d.regionId,
      grassroots: Object.fromEntries(data.partyIds.map((p) => {
        const region = data.byId.region[d.regionId];
        const seats = region.politics.councilComposition[p] ?? 0;
        const share = seats / Math.max(1, region.councilSeats);
        return [p, clamp05(share * 9 + rng.range(-0.6, 0.6))];
      })),
      playerGrassroots: 0,
      playerFavor: 0,
      serviceOffice: false,
    };
  }
  // 世界
  for (const b of data.world.blocks) state.world[b.id] = structuredClone(b);
  // 政黨
  for (const p of data.parties.parties) {
    const c = structuredClone(p);
    c.factions.forEach((f) => {
      f.favor = 0; f.trust = 2;
      f.leaderName = makePolitician(data, rng, { party: p.id, birthYear: 2026 - rng.int(50, 72) }).name;
    });
    // 黨主席與黨團總召是玩家最常打交道的兩個人，開局就要有名字
    const chair = makePolitician(data, rng, { party: p.id, birthYear: 2026 - rng.int(52, 70), fame: 4 });
    const whip = makePolitician(data, rng, { party: p.id, birthYear: 2026 - rng.int(45, 62), fame: 3 });
    c.chair = { name: chair.name, faction: rng.pick(c.factions).id, since: 2024 + rng.int(0, 2) };
    c.whip = { name: whip.name, faction: rng.pick(c.factions).id, since: 2025 + rng.int(0, 1) };
    state.parties[p.id] = c;
  }
  // 企業
  for (const c of data.corporations.corporations) state.corporations[c.id] = structuredClone(c);
  // 價值觀
  for (const a of data.values.axes) state.values[a.id] = a.start;
  // 法律
  for (const l of data.laws.laws) state.laws[l.id] = l.defaultTier;
  // 地方議案
  for (const r of data.regions.regions) {
    state.localBills[r.id] = Object.fromEntries(data.localBills.bills.map((b) => [b.id, b.defaultTier]));
  }
  // 媒體
  for (const m of data.media.media) state.media[m.id] = structuredClone(m);
  // 議題
  for (const i of data.issues.issues) state.issues[i.id] = i.heat;
  // 計數器
  for (const c of data.tags.counters) state.counters[c] = 0;

  // POP
  state.pops = buildPops(data, rng);

  // 憲政機關：總統、行政院長、十五位大法官
  Court.init(state, data, rng);
  // 內閣部會首長、各縣市首長與副首長
  Gov.init(state, data, rng);
  // 每個選區三到七位在地政治人物。他們一開始就在那裡，不是選舉時才生出來的。
  People.init(state, data, rng);
  // 社交平台的追蹤數
  Social.init(state, data, rng);
  // 半導體產業的五個版圖
  Semi.init(state, data);

  // 起點資源
  applyStart(state, data, setup, rng);

  state.meta.rngCounter = rng.counter;
  return state;
}

function makePlayer(data, setup, rng) {
  const start = data.starts.starts.find((s) => s.id === setup.startId);
  const bg = data.backgrounds.backgrounds.find((b) => b.id === setup.backgroundId);
  const attrs = { ...(setup.baseAttrs
    ?? { stamina: 2, sociability: 2, charisma: 2, eloquence: 2, judgment: 2, boldness: 2 }) };
  for (const k in bg.attrs) attrs[k] = clamp05(attrs[k] + bg.attrs[k]);
  for (const k in setup.attrBonus ?? {}) attrs[k] = clamp05(attrs[k] + setup.attrBonus[k]);

  const age = setup.age != null
    ? clamp(setup.age, start.ageRange[0], start.ageRange[1])
    : rng.int(start.ageRange[0], start.ageRange[1]);
  return {
    name: setup.name, gender: setup.gender,
    birthYear: data.meta.startDate.year - age,
    homeDistrict: setup.homeDistrict,
    background: setup.backgroundId,
    education: setup.education, eduTerms: 0,
    role: start.role, party: setup.party ?? null,
    office: null,
    attrs,
    fame: start.fame, favorNational: 0, integrity: 3, stigma: bg.stigma ?? 0,
    partyPrestige: start.partyPrestige,
    fatigueRaw: 0, politicalCapital: 40,
    hospitalTurns: 0,
    ideology: Object.fromEntries(data.axisIds.map((a) => [a, setup.ideology?.[a] ?? 0])),
    china: Object.fromEntries(data.chinaKeys.map((k) => [k, setup.china?.[k] ?? 0])),
    followers: 0,
    image: null, imageSince: null, imageSwitches: 0,
    mediaContacts: bg.mediaContacts ?? 0,
    ap: data.meta.baseAP, apUsed: 0,
    careerLog: [],
  };
}

function applyStart(state, data, setup, rng) {
  const start = data.starts.starts.find((s) => s.id === setup.startId);
  const bg = data.backgrounds.backgrounds.find((b) => b.id === setup.backgroundId);
  state.finance.personal = Math.round(bg.personalAssets * start.assetMult);
  state.finance.campaign = start.campaignFunds;

  // 開局送一間房，同時送一筆三百萬的貸款。
  // 在台灣，這個年紀還在租屋的參選人非常少；而那間房子背著的貸款，
  // 會在往後很多時候逼玩家做出跟他的理念不一致的決定。
  Asset.ensure(state);
  Asset.grantHouse(state, data, rng);
  state.finance.lastDeclaredAssets = Asset.declarable(state);

  const home = state.districts[setup.homeDistrict];
  if (home) {
    home.playerGrassroots = clamp05(start.grassrootsHome + (bg.grassroots ?? 0));
    home.playerFavor = 1;
  }
  const region = state.regions[data.byId.district[setup.homeDistrict].regionId];
  if (region) region.playerFavor = 0.5;

  if (setup.party) {
    const p = state.parties[setup.party];
    p.factions.forEach((f) => { f.favor = start.factionFavor * 0.5; });
    const choice = data.starts.partyChoice.find((c) => c.options.includes(setup.party));
    if (choice) {
      state.finance.campaign += choice.effects.campaignFunds ?? 0;
      state.player.partyPrestige = clamp05(state.player.partyPrestige + (choice.effects.partyPrestige ?? 0));
      state.player.fame = clamp05(state.player.fame + (choice.effects.fame ?? 0));
      if (choice.effects.grassrootsBonus && home) {
        home.playerGrassroots = clamp05(home.playerGrassroots + choice.effects.grassrootsBonus);
      }
    }
  }
  // 出身背景對 POP 好感的初始偏移
  const P = state.pops;
  for (let i = 0; i < P.n; i++) {
    const sid = data.strataIds[P.stratum[i]];
    if (bg.popFavor?.[sid]) P.playerFavor[i] = bg.popFavor[sid] * 0.4;
  }
  for (const c of Object.values(state.corporations)) {
    c.mood = clamp(c.mood + (bg.corpMood ?? 0), -5, 5);
  }
}

/** 取得目前回合的 Rng（每回合固定分流，確保可重現） */
export function turnRng(state) {
  return new Rng(state.meta.seed, state.meta.rngCounter);
}
export function commitRng(state, rng) { state.meta.rngCounter = rng.counter; }
