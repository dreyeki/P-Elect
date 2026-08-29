// @ts-check
/**
 * 內閣與地方首長。
 * 部會首長由行政院長提請總統任命，不需要立法院同意，但要站上質詢台。
 * 副首長的人數依地方制度法：直轄市二人（人口逾兩百五十萬者三人），
 * 縣市一人（人口一百二十五萬以上者二人）。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { makePolitician } from './NameGen.js';

export function deputyCount(region, data) {
  const rule = data.cabinet.deputyMayorRule;
  const r = region.type === '直轄市' ? rule.municipality : rule.county;
  let n = r.base;
  if (region.population.total >= r.extraIfPopulationOver) n += r.extra;
  return n;
}

export function init(state, data, rng) {
  const rulingParty = state.central.government.presidentParty;
  const traits = data.cabinet.cabinetTraits;

  state.cabinet = data.cabinet.ministries.map((m) => {
    const t = rng.pick(traits);
    const p = makePolitician(data, rng, {
      party: rng.bool(0.7) ? rulingParty : null,
      birthYear: state.meta.year - rng.int(48, 66),
      fame: rng.int(2, 4),
    });
    return {
      ministryId: m.id, name: p.name, party: p.party,
      trait: t.id, traitName: t.name,
      competence: clamp05(2.5 + t.competence + rng.range(-1, 1)),
      approval: clamp(rng.range(28, 52), 5, 90),
      since: state.meta.year - rng.int(0, 2),
      isPlayer: false,
    };
  });

  // 各縣市的副首長
  for (const r of Object.values(state.regions)) {
    const n = deputyCount(r, data);
    r.deputies = Array.from({ length: n }, () => {
      const p = makePolitician(data, rng, {
        party: rng.bool(0.75) ? r.politics.mayorParty : null,
        birthYear: state.meta.year - rng.int(46, 64),
      });
      return { name: p.name, party: p.party, competence: clamp05(rng.range(1.5, 4.5)) };
    });
    const mp = makePolitician(data, rng, { party: r.politics.mayorParty, birthYear: state.meta.year - rng.int(45, 65), fame: 3 });
    r.politics.mayorName = mp.name;
  }
}

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const news = [];
  if (!state.cabinet) return { news };

  const presApproval = state.presidency?.approval ?? 45;
  for (const m of state.cabinet) {
    const def = data.byId.ministry[m.ministryId];
    const target = clamp(presApproval - 4 + (m.competence - 2.5) * 5 + issuePressure(state, def.field) * -4, 8, 82);
    m.approval = clamp(m.approval + (target - m.approval) * 0.10 * scaleMult, 5, 92);

    // 滿意度過低的部長會被換掉
    if (m.approval < 18 && rng.bool(0.09 * scaleMult) && !m.isPlayer) {
      const p = makePolitician(data, rng, {
        party: rng.bool(0.7) ? state.central.government.presidentParty : null,
        birthYear: state.meta.year - rng.int(48, 66),
      });
      const t = rng.pick(data.cabinet.cabinetTraits);
      news.push({
        kind: 'cabinet',
        text: `${def.name}長${m.name}今天請辭獲准，行政院隨即發布由${p.name}接任。`
          + `外界普遍認為這是${issueName(data, def.field)}議題持續延燒之後不得不做的處置。`,
      });
      Object.assign(m, { name: p.name, party: p.party, trait: t.id, traitName: t.name,
        competence: clamp05(2.5 + t.competence + rng.range(-1, 1)), approval: 40, since: state.meta.year });
    }
  }

  // 內閣的整體能力會回饋到施政效率
  const avg = state.cabinet.reduce((a, m) => a + m.competence, 0) / state.cabinet.length;
  state.central.government.cabinetCohesion = clamp05(
    state.central.government.cabinetCohesion + (avg - state.central.government.cabinetCohesion) * 0.02 * scaleMult);
  return { news };
}

function issuePressure(state, field) {
  const map = { security: 'security', crossStrait: 'crossStrait', defense: 'defense', economy: 'economy',
    education: 'education', corruption: 'corruption', employment: 'employment', healthcare: 'healthcare',
    environment: 'environment', society: 'housing' };
  return state.issues[map[field] ?? field] ?? 2;
}
function issueName(data, field) {
  const m = { security: '治安', crossStrait: '兩岸', defense: '國防', economy: '經濟', education: '教育',
    corruption: '貪腐', employment: '就業', healthcare: '醫療', environment: '環境', society: '社會' };
  return m[field] ?? '相關';
}

/** 玩家出任部會首長 */
export function appointPlayer(state, data, ministryId) {
  const m = state.cabinet.find((x) => x.ministryId === ministryId);
  if (!m) return { ok: false };
  m.isPlayer = true;
  m.name = state.player.name;
  m.party = state.player.party;
  m.competence = clamp05((state.player.attrs.judgment + state.player.attrs.eloquence) / 2);
  state.player.role = 'minister';
  state.player.office = { type: 'minister', scopeId: ministryId, name: data.byId.ministry[ministryId].name + '長', since: state.meta.turn };
  return { ok: true };
}

export function cabinetSummary(state, data) {
  if (!state.cabinet) return [];
  return state.cabinet.map((m) => ({ ...m, def: data.byId.ministry[m.ministryId] }))
    .sort((a, b) => b.def.influence - a.def.influence || b.approval - a.approval);
}
