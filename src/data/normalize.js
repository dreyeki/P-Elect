// @ts-check
/**
 * 事件文本是由內容端撰寫的，數值習慣與引擎不同（他們用 0~100 的直覺尺度）。
 * 這裡在載入時做一次性換算，讓引擎只看到正規化後的值。
 * 換算表放在這裡而不是散在事件檔裡，內容端才能專心寫文本。
 */
const PLAYER_SCALE = {
  fame: 1 / 14, integrity: 1 / 12, partyPrestige: 1 / 12, favorNational: 1 / 8,
  stigma: 1 / 6, politicalCapital: 8, fatigue: 1 / 8,
  funds: 100000, personalAssets: 5000,
};

const BLOCK_SCALE = {
  popMood: 1 / 6, popSoL: 1 / 4, corpMood: 1 / 6,
  issueHeat: 1 / 3, grassroots: 1 / 3,
};

/** 事件寫的 central 路徑 → 引擎實際欄位（值另乘係數）。未列出者一律丟棄。 */
const CENTRAL_MAP = {
  'fiscal.gdpGrowth': ['fiscal.gdpGrowth', 1],
  'fiscal.balance': ['fiscal.debtOutstanding', -20000],
  'fiscal.taxRevenue': ['fiscal.debtOutstanding', -20000],
  'fiscal.debtRatio': ['fiscal.debtOutstanding', 260000],
  'economy.gdpGrowth': ['fiscal.gdpGrowth', 1],
  'economy.cpi': ['fiscal.inflation', 1],
  'economy.unemployment': ['fiscal.unemployment', 1],
  'economy.stockIndex': ['stockIndex', 22000],
  'energy.reserveMargin': ['energy.reserveMargin', 1],
  'energy.renewShare': ['energy.mix.renewable', 1],
  'energy.emissions': ['energy.carbonIntensity', 1],
  'energy.priceIndex': ['energy.electricityPrice', 3.15],
  'energy.utilityDeficit': ['energy.tpecDeficit', 4000],
  'defense.budgetShare': ['defense.budgetRatio', 1],
  'defense.readiness': ['defense.readiness', 5],
  'defense.localContent': ['defense.domesticProduction', 5],
  'diplomacy.intlSpace': ['diplomacy.intlOrgParticipation', 5],
  'security.counterInfiltration': ['society.infiltration', -5],
  'social.birthRate': ['society.birthRate', 1],
  'social.crimeRate': ['society.crimeRate', 100],
  'social.careCapacity': ['society.healthcareSustainability', 5],
  'health.capacity': ['society.healthcareSustainability', 5],
  'health.insuranceDeficit': ['society.healthcareSustainability', -5],
  'politics.governability': ['government.cabinetCohesion', 5],
  'politics.partyStability': ['government.cabinetCohesion', 5],
  'education.quality': ['society.socialTrust', 2],
  'social.welfareSpend': ['society.pensionSustainability', 5],
};

const REGION_MAP = {
  'economy.gdpGrowth': ['economy.gdpGrowth', 1],
  'economy.housingSupply': ['economy.housingPriceIndex', -60],
  'infra.quality': ['__infra.transport', 8],
  'infra.floodDefense': ['__infra.disasterResilience', 12],
  'infra.transitDeficit': ['__infra.transport', -12],
  'infra.transitEfficiency': ['__infra.transport', 10],
  'environment.quality': ['__infra.water', 8],
  'environment.wasteCapacity': ['__infra.water', 8],
  'health.localCapacity': ['__infra.medical', 10],
  'education.quality': ['__infra.education', 10],
  'education.efficiency': ['__infra.education', 8],
  'social.careCoverage': ['__infra.medical', 8],
};

export function normalizeEvents(data) {
  for (const ev of data.events) {
    for (const opt of ev.options) {
      opt.effects = normalizeEffects(opt.effects);
    }
  }
}

export function normalizeEffects(eff) {
  if (!eff) return {};
  const out = {};
  for (const blk in eff) {
    const v = eff[blk];
    if (blk === 'tagGain') { out.tagGain = v; continue; }
    if (blk === 'valuePressure') { out.valuePressure = { ...v }; continue; }
    if (blk === 'player') {
      out.player = {};
      for (const k in v) if (PLAYER_SCALE[k] != null) out.player[k] = v[k] * PLAYER_SCALE[k];
      continue;
    }
    if (BLOCK_SCALE[blk] != null) {
      out[blk] = {};
      for (const k in v) out[blk][k] = v[k] * BLOCK_SCALE[blk];
      continue;
    }
    if (blk === 'world') {
      out.world = {};
      for (const id in v) {
        const target = id === 'SEMI' ? 'GLOBAL' : id === 'IO' ? 'INTLORG' : id;
        out.world[target] = {};
        for (const k in v[id]) out.world[target][k] = v[id][k] * (k === 'stance' ? 1 / 8 : 1 / 5);
      }
      continue;
    }
    if (blk === 'central') {
      out.central = {};
      for (const path in v) {
        const m = CENTRAL_MAP[path];
        if (!m) continue;
        out.central[m[0]] = (out.central[m[0]] ?? 0) + v[path] * m[1];
      }
      if (!Object.keys(out.central).length) delete out.central;
      continue;
    }
    if (blk === 'region') {
      out.region = {}; const infra = {};
      for (const key in v) {
        out.region[key] = {};
        for (const path in v[key]) {
          const m = REGION_MAP[path];
          if (!m) continue;
          if (m[0].startsWith('__infra.')) infra[m[0].slice(8)] = (infra[m[0].slice(8)] ?? 0) + v[key][path] * m[1];
          else out.region[key][m[0]] = (out.region[key][m[0]] ?? 0) + v[key][path] * m[1];
        }
        if (!Object.keys(out.region[key]).length) delete out.region[key];
      }
      if (!Object.keys(out.region).length) delete out.region;
      if (Object.keys(infra).length) out.infrastructure = infra;
      continue;
    }
    out[blk] = v;
  }
  return out;
}
