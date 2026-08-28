// @ts-check
/** 統一的 effects 套用器：事件、法案、地方議案、預算都走這裡。 */
import { clamp, clamp05, clampBi, addPath } from '../core/Formula.js';

const STRATA_ALL = '_all';

export function applyEffects(state, data, eff, ctx = {}) {
  if (!eff) return [];
  const logs = [];
  const src = ctx.source ?? 'unknown';

  if (eff.central) {
    for (const path in eff.central) {
      const before = getNum(state.central, path);
      addPath(state.central, path, eff.central[path] * (ctx.mult ?? 1));
      clampCentral(state, path);
      logs.push({ k: 'central', path, from: before, to: getNum(state.central, path) });
    }
  }
  if (eff.national) {
    const m = { giniDelta: 'society.giniIndex', housingPriceDelta: null, foodSelfSufficiency: 'society.foodSelfSufficiency' };
    for (const k in eff.national) {
      if (k === 'housingPriceDelta') {
        for (const r of Object.values(state.regions)) r.economy.housingPriceIndex += eff.national[k];
      } else if (m[k]) addPath(state.central, m[k], eff.national[k]);
    }
  }
  if (eff.region) {
    for (const key in eff.region) {
      for (const r of targetRegions(state, key, ctx)) {
        for (const path in eff.region[key]) {
          const isRatio = /Mult$|Growth$|unemployment|rentBurden|ownRevenue|debt/.test(path);
          const v = eff.region[key][path];
          if (/ownRevenue|debt/.test(path) && Math.abs(v) < 1) {
            addPath(r, path, getNum(r, path) * v);            // 相對值
          } else addPath(r, path, v);
        }
      }
    }
  }
  if (eff.infrastructure) {
    for (const r of targetRegions(state, ctx.regionKey ?? '_player', ctx)) {
      for (const k in eff.infrastructure) {
        r.infrastructure[k] = clamp05((r.infrastructure[k] ?? 0) + eff.infrastructure[k]);
      }
    }
  }
  if (eff.popSoL) applyPop(state, data, eff.popSoL, 'sol', clamp05, ctx);
  if (eff.popMood) applyPop(state, data, eff.popMood, 'playerFavor', clampBi, ctx);
  if (eff.corpMood) {
    for (const key in eff.corpMood) {
      for (const c of Object.values(state.corporations)) {
        if (key === STRATA_ALL || c.sector === key || c.id === key) {
          c.mood = clampBi(c.mood + eff.corpMood[key]);
        }
      }
    }
  }
  if (eff.valuePressure) {
    for (const ax in eff.valuePressure) {
      state.modifiers.add({
        id: `${src}:vp:${ax}`, source: src, label: ctx.label ?? src,
        target: `value.${ax}`, op: 'add', value: eff.valuePressure[ax],
        duration: ctx.duration ?? 36, startTurn: state.meta.turn,
      });
    }
  }
  if (eff.player) {
    const p = state.player;
    for (const k in eff.player) {
      const v = eff.player[k];
      switch (k) {
        case 'fame': p.fame = clamp05(p.fame + v); break;
        case 'favorNational': p.favorNational = clampBi(p.favorNational + v); break;
        case 'integrity': p.integrity = clamp05(p.integrity + v); break;
        case 'partyPrestige': p.partyPrestige = clamp05(p.partyPrestige + v); break;
        case 'stigma': if (v > 0) p.stigma = clamp05(p.stigma + v); break;  // 只增不減
        case 'politicalCapital': p.politicalCapital = clamp(p.politicalCapital + v, 0, 999); break;
        case 'fatigue': p.fatigueRaw = clamp(p.fatigueRaw + v * 12, 0, 120); break;
        case 'funds': state.finance.campaign += v; break;
        case 'personalAssets': state.finance.personal += v; break;
      }
    }
  }
  if (eff.issueHeat) {
    for (const k in eff.issueHeat) if (k in state.issues) state.issues[k] = clamp05(state.issues[k] + eff.issueHeat[k]);
  }
  if (eff.grassroots) {
    for (const key in eff.grassroots) {
      const v = eff.grassroots[key];
      if (key === '_home') {
        const d = state.districts[state.player.homeDistrict];
        if (d) d.playerGrassroots = clamp05(d.playerGrassroots + v);
      } else if (key === '_all') {
        for (const d of Object.values(state.districts)) d.playerGrassroots = clamp05(d.playerGrassroots + v * 0.35);
      } else if (state.districts[key]) {
        state.districts[key].playerGrassroots = clamp05(state.districts[key].playerGrassroots + v);
      }
    }
  }
  if (eff.world) {
    for (const bid in eff.world) {
      const b = state.world[bid];
      if (!b) continue;
      for (const path in eff.world[bid]) {
        addPath(b, path, eff.world[bid][path]);
        if (path === 'stance') b.stance = clampBi(b.stance);
        else if (['economicLink', 'militaryPressure', 'techControl', 'narrativeInfluence'].includes(path)) b[path] = clamp05(b[path]);
      }
    }
  }
  if (eff.tagGain) {
    // 一次行為不足以貼上標籤。同一個標籤累積三次，別人才會這樣看你。
    for (const t of eff.tagGain) {
      const k = 'tagseed_' + t;
      state.counters[k] = (state.counters[k] ?? 0) + 1;
      if (state.counters[k] >= 3) grantTag(state, data, t);
    }
  }
  return logs;
}

function targetRegions(state, key, ctx) {
  if (key === '_all') return Object.values(state.regions);
  if (key === '_player') {
    const rid = ctx.regionId ?? playerRegion(state, ctx);
    return rid && state.regions[rid] ? [state.regions[rid]] : [];
  }
  return state.regions[key] ? [state.regions[key]] : [];
}
function playerRegion(state, ctx) {
  const d = state.districts[state.player.homeDistrict];
  return ctx.regionId ?? d?.regionId ?? null;
}

function applyPop(state, data, spec, field, clampFn, ctx) {
  const P = state.pops;
  const regionFilter = ctx.regionId ?? null;
  const idxOf = {};
  data.strataIds.forEach((s, i) => (idxOf[s] = i));
  for (const key in spec) {
    const v = spec[key];
    const si = key === STRATA_ALL ? -1 : idxOf[key];
    if (si === undefined) continue;
    for (let i = 0; i < P.n; i++) {
      if (si >= 0 && P.stratum[i] !== si) continue;
      if (regionFilter) {
        const d = data.districts.districts[P.district[i]];
        if (d.regionId !== regionFilter) continue;
      }
      P[field][i] = clampFn(P[field][i] + v);
    }
  }
}

function getNum(obj, path) {
  let cur = obj;
  for (const s of path.split('.')) { if (cur == null) return 0; cur = cur[s]; }
  return typeof cur === 'number' ? cur : 0;
}

function clampCentral(state, path) {
  const c = state.central;
  const lim = {
    'energy.reserveMargin': [0, 0.45], 'energy.electricityPrice': [1.5, 12],
    'energy.carbonIntensity': [0.05, 1.2], 'defense.budgetRatio': [0.01, 0.09],
    'defense.readiness': [0, 5], 'defense.asymmetricCapability': [0, 5], 'defense.domesticProduction': [0, 5],
    'diplomacy.usRelation': [-5, 5], 'diplomacy.prcRelation': [-5, 5],
    'diplomacy.japanRelation': [-5, 5], 'diplomacy.euRelation': [-5, 5],
    'society.giniIndex': [0.22, 0.6], 'society.birthRate': [0.4, 2.5],
    'society.healthcareSustainability': [0, 5], 'society.pensionSustainability': [0, 5],
    'society.socialTrust': [0, 5], 'society.foodSelfSufficiency': [0.1, 0.9],
    'society.housingAffordability': [3, 25], 'fiscal.unemployment': [0.01, 0.2],
    'fiscal.inflation': [-0.03, 0.25],
  };
  const l = lim[path];
  if (!l) return;
  const segs = path.split('.');
  let o = c; for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]];
  o[segs.at(-1)] = clamp(o[segs.at(-1)], l[0], l[1]);
}

export function grantTag(state, data, tagId) {
  if (state.tags.includes(tagId)) return false;
  const t = data.byId.tag[tagId];
  if (!t) return false;
  state.tags.push(tagId);
  const e = t.effects ?? {};
  if (e.stigma) state.player.stigma = clamp05(state.player.stigma + e.stigma);
  if (e.integrity) state.player.integrity = clamp05(state.player.integrity + e.integrity);
  if (e.fame) state.player.fame = clamp05(state.player.fame + e.fame);
  state.news.push({ turn: state.meta.turn, kind: 'tag', text: `你被貼上了「${t.name}」這個標籤。${t.desc}` });
  return true;
}

export function bumpCounter(state, data, key, n = 1) {
  if (!(key in state.counters)) state.counters[key] = 0;
  state.counters[key] += n;
  for (const t of data.tags.tags) {
    if (t.trigger?.counter === key && state.counters[key] >= t.trigger.gte) grantTag(state, data, t.id);
  }
}
