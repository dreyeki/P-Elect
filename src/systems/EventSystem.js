// @ts-check
import { evalTrigger } from '../core/Expr.js';
import { applyEffects } from './Effects.js';
import { clamp } from '../core/Formula.js';

/**
 * 事件條件求值用的上下文。這是一層「視圖」：
 * 事件文本作者用直覺的名字寫條件，這裡負責把它們對應到引擎的真實欄位。
 */
export function buildContext(state, data) {
  const homeD = data.byId.district[state.player.homeDistrict];
  const region = homeD ? state.regions[homeD.regionId] : Object.values(state.regions)[0];
  const c = state.central;
  const P = state.pops;

  let houseIdx = 0, popW = 0, rentIdx = 0;
  for (const r of Object.values(state.regions)) {
    houseIdx += r.economy.housingPriceIndex * r.population.total;
    rentIdx += r.economy.rentBurden * r.population.total;
    popW += r.population.total;
  }
  houseIdx /= Math.max(1, popW);
  rentIdx = rentIdx / Math.max(1, popW) * 100;

  const party = state.player.party ? state.parties[state.player.party] : null;
  const facFavors = party ? party.factions.map((f) => f.favor) : [0];
  const facTension = party ? (Math.max(...facFavors) - Math.min(...facFavors)) / 2 : 0;
  const totalSeats = Object.values(state.legislature).reduce((a, b) => a + b, 0) || 113;
  const monthsToElec = state.flags.monthsToElection ?? 99;

  const infraAvg = (k) => Object.values(state.regions)
    .reduce((a, r) => a + r.infrastructure[k] * r.population.total, 0) / Math.max(1, popW);

  const central = {
    fiscal: c.fiscal,
    diplomacy: { ...c.diplomacy, intlSpace: c.diplomacy.intlOrgParticipation },
    defense: { ...c.defense, budgetShare: c.defense.budgetRatio },
    society: c.society,
    monetary: c.monetary,
    stockIndex: c.stockIndex,
    economy: {
      gdp: c.fiscal.gdp, gdpGrowth: c.fiscal.gdpGrowth,
      unemployment: c.fiscal.unemployment,
      cpi: c.fiscal.inflation,
      stockIndex: c.stockIndex,
      housePriceIndex: houseIdx,
      rentIndex: rentIdx,
      exportGrowth: c.fiscal.gdpGrowth * 1.6 + state.world.GLOBAL.cycle * 0.04,
      fdi: 3 + state.world.USA.stance * 0.3 + avgCorpMood(state) * 0.4,
      tourismIndex: 100 * (1 + state.world.CHN.stance * 0.06 + state.world.ASEAN.cycle * 0.1),
      laborCost: 100 * (1 + state.modifiers.get('econ.wageCost', 0) * 0.1),
      laborShortage: clampNum(2.5 - c.fiscal.unemployment * 40, 0, 5),
      migrantWorkers: 780000 * (1 + state.values.immigration * 0.08),
      creditGrowth: c.monetary.m2Growth,
    },
    energy: {
      ...c.energy,
      renewShare: c.energy.mix.renewable,
      carbonFee: tierValue(state, data, 'LAW_CARBON_FEE', [100, 300, 500, 1000], 100),
      emissions: c.energy.carbonIntensity * 100,
      gasReserveDays: clampNum(11 + c.energy.reserveMargin * 40, 5, 30),
      gridAge: clampNum(3.4 - infraAvg('energy') * 0.4, 0, 5),
      oilPrice: 80 * (1 - state.world.MEA.cycle * 0.35),
      storageCapacity: clampNum(1.4 + c.energy.mix.renewable * 6, 0, 5),
      utilityDeficit: c.energy.tpecDeficit,
    },
    water: { reservoirLevel: clampNum(state.flags.reservoir ?? 62, 0, 100) },
    health: {
      capacity: c.society.healthcareSustainability,
      epidemicRisk: clampNum(state.flags.epidemicRisk ?? 1.2, 0, 5),
    },
    labor: { disputeIndex: clampNum(avgMilitancy(state), 0, 5) },
    safety: {
      foodInspection: clampNum(2.4 + (state.flags.budgetAlloc?.justice ?? 0.005) * 200, 0, 5),
      inspectionRate: clampNum(2.6 + infraAvg('medical') * 0.2, 0, 5),
      transportSafety: clampNum(infraAvg('transport') * 0.7 + 1, 0, 5),
    },
    security: { infraRisk: clampNum(state.world.CHN.militaryPressure * 0.8, 0, 5) },
    social: {
      birthRate: c.society.birthRate, elderRatio: c.society.agingRatio,
      crimeRate: c.society.crimeRate,
      careCapacity: clampNum(c.society.healthcareSustainability * 0.8 + 0.6, 0, 5),
    },
    tech: { digitalService: infraAvg('digital') },
  };

  const world = {};
  for (const k in state.world) world[k] = state.world[k];
  world.SEMI = state.world.GLOBAL;
  world.IO = state.world.INTLORG;

  return {
    central, world, values: state.values, issueHeat: state.issues,
    region: {
      ...region,
      economy: {
        ...region.economy,
        industryShare: region.economy.industryMix.secondary,
        agriShare: region.economy.sectors.agriculture + region.economy.sectors.fishery,
        fishery: region.economy.sectors.fishery,
      },
      infra: { transitDeficit: clampNum(5 - region.infrastructure.transport, 0, 5) },
      education: { schoolUtilization: clampNum(0.5 + region.population.ageStructure.young * 2, 0.2, 1.2) },
      geo: geoOf(region.id),
    },
    player: {
      fame: state.player.fame, stigma: state.player.stigma, integrity: state.player.integrity,
      partyPrestige: state.player.partyPrestige, politicalCapital: state.player.politicalCapital,
      fatigue: state.player.fatigueRaw / 24,
      role: state.player.role, age: state.meta.year - state.player.birthYear,
      funds: state.finance.campaign, personalAssets: state.finance.personal,
      favorNational: state.player.favorNational,
    },
    party: {
      cohesion: party?.cohesion ?? 3, publicImage: party?.publicImage ?? 2,
      support: party?.support ?? 0.1,
      seatShare: party ? (state.legislature[party.id] ?? 0) / totalSeats : 0,
      factionTension: facTension,
      primarySeason: monthsToElec <= 8 ? 1 : 0,
      chairElection: (state.meta.year % 2 === 0 && state.meta.month === 7) ? 1 : 0,
      whipPressure: clampNum(5 - (party?.cohesion ?? 3), 0, 5),
      youthShare: 0.22,
    },
    turn: state.meta.turn, year: state.meta.year, month: state.meta.month,
  };
}

const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function tierValue(state, data, lawId, values, fallback) {
  const t = state.laws[lawId];
  return t == null ? fallback : (values[t] ?? fallback);
}
function avgCorpMood(state) {
  const cs = Object.values(state.corporations);
  return cs.reduce((a, c) => a + c.mood, 0) / Math.max(1, cs.length);
}
function avgMilitancy(state) {
  const P = state.pops;
  let s = 0, w = 0;
  for (let i = 0; i < P.n; i++) { s += P.militancy[i] * P.size[i]; w += P.size[i]; }
  return s / Math.max(1, w);
}
const GEO = {
  TPE: { coastal: 0, floodRisk: 2, mountainous: 1, seismicRisk: 2, typhoonRisk: 2 },
  NTP: { coastal: 1, floodRisk: 3, mountainous: 2, seismicRisk: 2, typhoonRisk: 3 },
  TYC: { coastal: 1, floodRisk: 2, mountainous: 2, seismicRisk: 2, typhoonRisk: 3 },
  TCH: { coastal: 1, floodRisk: 2, mountainous: 3, seismicRisk: 3, typhoonRisk: 2 },
  TNN: { coastal: 1, floodRisk: 4, mountainous: 1, seismicRisk: 3, typhoonRisk: 3 },
  KHH: { coastal: 1, floodRisk: 3, mountainous: 2, seismicRisk: 2, typhoonRisk: 3 },
  KEE: { coastal: 1, floodRisk: 3, mountainous: 3, seismicRisk: 2, typhoonRisk: 4 },
  HSC: { coastal: 1, floodRisk: 2, mountainous: 0, seismicRisk: 2, typhoonRisk: 2 },
  CYI: { coastal: 0, floodRisk: 3, mountainous: 0, seismicRisk: 3, typhoonRisk: 3 },
  HSQ: { coastal: 1, floodRisk: 2, mountainous: 3, seismicRisk: 2, typhoonRisk: 2 },
  MIA: { coastal: 1, floodRisk: 2, mountainous: 3, seismicRisk: 3, typhoonRisk: 2 },
  CHA: { coastal: 1, floodRisk: 3, mountainous: 1, seismicRisk: 3, typhoonRisk: 3 },
  NAN: { coastal: 0, floodRisk: 3, mountainous: 5, seismicRisk: 4, typhoonRisk: 3 },
  YUN: { coastal: 1, floodRisk: 4, mountainous: 1, seismicRisk: 3, typhoonRisk: 4 },
  CYQ: { coastal: 1, floodRisk: 4, mountainous: 3, seismicRisk: 3, typhoonRisk: 4 },
  PIF: { coastal: 1, floodRisk: 4, mountainous: 3, seismicRisk: 2, typhoonRisk: 5 },
  ILA: { coastal: 1, floodRisk: 4, mountainous: 4, seismicRisk: 3, typhoonRisk: 5 },
  HUA: { coastal: 1, floodRisk: 3, mountainous: 5, seismicRisk: 5, typhoonRisk: 4 },
  TTT: { coastal: 1, floodRisk: 3, mountainous: 5, seismicRisk: 4, typhoonRisk: 5 },
  PEN: { coastal: 1, floodRisk: 2, mountainous: 0, seismicRisk: 1, typhoonRisk: 5 },
  KIN: { coastal: 1, floodRisk: 1, mountainous: 0, seismicRisk: 1, typhoonRisk: 3 },
  LIE: { coastal: 1, floodRisk: 1, mountainous: 2, seismicRisk: 1, typhoonRisk: 3 },
};
function geoOf(id) { return GEO[id] ?? { coastal: 1, floodRisk: 2, mountainous: 2, seismicRisk: 3, typhoonRisk: 3 }; }

export function generate(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const context = buildContext(state, data);
  const role = state.player.role;
  const pool = [];

  for (const ev of data.events) {
    const cd = state.eventCooldown[ev.id] ?? 0;
    if (cd > state.meta.turn) continue;
    if (ev.requires?.minTurn && state.meta.turn < ev.requires.minTurn) continue;
    if (ev.requires?.roles && !ev.requires.roles.includes(mapRole(role))) continue;
    if (ev.trigger && !evalTrigger(ev.trigger, context)) continue;
    let w = ev.weight ?? 50;
    for (const tid of state.tags) {
      const t = data.byId.tag[tid];
      const ew = t?.effects?.eventWeight;
      if (ew && ew[ev.category]) w *= ew[ev.category];
    }
    pool.push({ ev, w });
  }
  if (!pool.length) return { events: [] };

  const count = clamp(Math.round(rng.range(1, 4.4) * (state.meta.scale === 'week' ? 0.7 : 1)), 1, 4);
  const out = [];
  const used = new Set();
  for (let i = 0; i < count && pool.length; i++) {
    const pick = rng.weighted(pool.filter((p) => !used.has(p.ev.id)), (p) => p.w);
    if (!pick) break;
    used.add(pick.ev.id);
    state.eventCooldown[pick.ev.id] = state.meta.turn + Math.round((pick.ev.cooldown ?? 12) * 0.7);
    out.push(materialize(state, data, pick.ev, context));
  }
  return { events: out };
}

function mapRole(role) {
  if (role === 'councilor') return 'councilor';
  if (role === 'legislator') return 'legislator';
  if (['mayor', 'minister', 'president'].includes(role)) return 'mayor';
  return 'citizen';
}

/** 把 {region} {value} 這類佔位符填上當前世界的實際內容 */
function materialize(state, data, ev, context) {
  const homeD = data.byId.district[state.player.homeDistrict];
  const region = homeD ? state.regions[homeD.regionId] : Object.values(state.regions)[0];
  const dict = {
    region: region?.name ?? '本地',
    district: homeD?.name ?? '本選區',
    reserveMargin: (state.central.energy.reserveMargin * 100).toFixed(1),
    unemployment: (state.central.fiscal.unemployment * 100).toFixed(1),
    inflation: (state.central.fiscal.inflation * 100).toFixed(1),
    stockIndex: state.central.stockIndex.toLocaleString('zh-TW'),
    year: state.meta.year, month: state.meta.month,
    topIndustry: topIndustry(region),
    playerName: state.player.name,
  };
  const fill = (s) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => dict[k] ?? m);
  return {
    id: ev.id, category: ev.category,
    headline: fill(ev.headline), body: fill(ev.body),
    options: ev.options.map((o, i) => ({ idx: i, text: fill(o.text), hint: fill(o.hint), effects: o.effects })),
  };
}

function topIndustry(region) {
  if (!region) return '製造業';
  const names = { semiconductor: '半導體', electronics: '電子', petrochemical: '石化', steel: '鋼鐵', machinery: '機械', food: '食品', textile: '紡織', finance: '金融', retail: '零售', tourism: '觀光', logistics: '物流', agriculture: '農業', fishery: '漁業', publicSector: '公部門', other: '其他' };
  let best = 'other', v = -1;
  for (const k in region.economy.sectors) {
    if (k === 'publicSector' || k === 'other') continue;
    if (region.economy.sectors[k] > v) { v = region.economy.sectors[k]; best = k; }
  }
  return names[best] ?? '製造業';
}

export function resolve(state, data, event, optionIdx) {
  const opt = event.options[optionIdx];
  if (!opt) return null;
  applyEffects(state, data, opt.effects, { source: 'event:' + event.id, label: event.headline, duration: 24 });
  state.news.push({ turn: state.meta.turn, kind: event.category, text: `${event.headline}——你選擇了「${opt.text}」。` });
  return opt;
}
