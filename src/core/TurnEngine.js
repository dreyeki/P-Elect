// @ts-check
import { Rng } from './Rng.js';
import * as World from '../systems/WorldSystem.js';
import * as Economy from '../systems/EconomySystem.js';
import * as Corp from '../systems/CorporationSystem.js';
import * as Pop from '../systems/PopSystem.js';
import * as Value from '../systems/ValueSystem.js';
import * as District from '../systems/DistrictSystem.js';
import * as Party from '../systems/PartySystem.js';
import * as Character from '../systems/CharacterSystem.js';
import * as Finance from '../systems/FinanceSystem.js';
import * as Team from '../systems/TeamSystem.js';
import * as Legis from '../systems/LegislatureSystem.js';
import * as Council from '../systems/CouncilSystem.js';
import * as Budget from '../systems/BudgetSystem.js';
import * as Media from '../systems/MediaSystem.js';
import * as Scandal from '../systems/ScandalSystem.js';
import * as Interp from '../systems/InterpellationSystem.js';
import * as Events from '../systems/EventSystem.js';
import * as Election from '../systems/ElectionSystem.js';
import * as Poll from '../systems/PollSystem.js';
import * as Show from '../systems/ShowSystem.js';
import * as Court from '../systems/CourtSystem.js';
import * as Gov from '../systems/GovernmentSystem.js';
import * as Theory from '../systems/TheorySystem.js';
import * as Image from '../systems/ImageSystem.js';
import * as People from '../systems/PeopleSystem.js';
import * as Favor from '../systems/FavorSystem.js';
import * as Invite from '../systems/InvitationSystem.js';
import * as Social from '../systems/SocialSystem.js';
import * as Semi from '../systems/SemiconductorSystem.js';
import * as Canvass from '../systems/CanvassSystem.js';
import { apOf } from '../systems/CharacterSystem.js';

const PIPELINE = [
  ['world', World.tick], ['economy', Economy.tick], ['corp', Corp.tick],
  ['pop', Pop.tick], ['value', Value.tick], ['district', District.tick],
  ['party', Party.tick], ['council', Council.tick], ['budget', Budget.tick],
  ['semi', Semi.tick],
  ['finance', Finance.tick], ['team', Team.tick], ['character', Character.tick],
  ['people', People.tick], ['favor', Favor.tick], ['invite', Invite.tick],
  ['canvassGig', Canvass.tickGigs], ['social', Social.tick],
  ['scandal', Scandal.tick], ['legis', Legis.tick], ['interp', Interp.tick],
  ['court', Court.tick], ['gov', Gov.tick], ['image', Image.tick],
  ['theory', Theory.tick], ['media', Media.tick],
  ['poll', Poll.tick], ['show', Show.tick],
];

/** 推進一個回合。回傳本回合的新聞與待決事項。 */
export function advance(state, data) {
  const rng = new Rng(state.meta.seed, state.meta.rngCounter);
  const scaleMult = state.meta.scale === 'week' ? 0.25 : 1;
  const ctx = { data, rng, scaleMult, turn: state.meta.turn };
  const news = [];
  let hospitalized = false;

  for (const [name, fn] of PIPELINE) {
    try {
      const res = fn(state, ctx) ?? {};
      if (res.news) news.push(...res.news.map((n) => ({ ...n, turn: state.meta.turn, sys: name })));
      if (res.hospitalized) hospitalized = true;
    } catch (e) {
      console.error('[turn]', name, e);
      state.log.push({ turn: state.meta.turn, level: 'error', text: `${name}: ${e.message}` });
    }
  }

  state.modifiers.tick(state.meta.turn);

  let events = [];
  if (!hospitalized) {
    const r = Events.generate(state, ctx);
    events = r.events;
  }
  state.pendingEvents = events;
  state.news = [...news, ...state.news].slice(0, 120);

  // 玩家回合重置。常駐通告會先把它該用的行動點扣掉——
  // 固定要跑的場子不會因為新的一個月到了就不用跑。
  state.player.apUsed = Canvass.gigAPCost(state, data);
  state.player.ap = apOf(state, data);

  // 歷史指標
  if (state.meta.month === 12 || state.meta.turn === 1) {
    state.history.push({
      year: state.meta.year,
      gdp: Math.round(state.central.fiscal.gdp),
      unemployment: state.central.fiscal.unemployment,
      approval: Math.round(state.flags.approval ?? 50),
      sol: state.flags.avgSol ?? 0,
      stockIndex: state.central.stockIndex,
      debtToGdp: state.central.fiscal.debtToGdp ?? 0,
      values: { ...state.values },
    });
  }

  advanceClock(state, data);
  state.meta.rngCounter = rng.counter;
  return { news, events, hospitalized };
}

function advanceClock(state, data) {
  const m = state.meta;
  if (m.scale === 'week') {
    m.weekIndex += 1;
    if (m.weekIndex >= 4) { m.weekIndex = 0; nextMonth(m); }
  } else nextMonth(m);
  m.turn += 1;
  // 重新判斷尺度
  const shouldWeek = Election.shouldUseWeekScale(state, data);
  if (shouldWeek && m.scale === 'month') { m.scale = 'week'; m.weekIndex = 0; }
  else if (!shouldWeek && m.scale === 'week') { m.scale = 'month'; m.weekIndex = 0; }
}

function nextMonth(m) {
  m.month += 1;
  if (m.month > 12) { m.month = 1; m.year += 1; }
}
