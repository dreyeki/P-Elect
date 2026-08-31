// @ts-check
/**
 * 人群試作（POP Lab）。
 *
 * 這是一個**獨立的沙盒**，跟遊戲裡真正在跑的 5,850 個 POP 沒有任何連結。
 * 它存在的理由只有一個：把「一個人為什麼支持你」拆開來看。
 *
 * 目前遊戲裡的支持度是一條公式算出來的浮點數——你只看得到結果，
 * 看不到那個結果是由哪幾件事加起來的。這個沙盒把每一項都列出來：
 *
 *     基礎不情願 −20　政黨認同 +42　媒體宣傳 +30　兩岸立場落差 −20　→ 合計 +32
 *
 * 兩個值刻意分開：
 *   **支持度** −100～+100，負是不支持、正是支持
 *   **激進度** 0～100，這個人願意為了這件事做到什麼程度
 *
 * 分開之後很多台灣政治的現象才解釋得通：一個人可以「很支持但很消極」
 * （會投票但不會幫你發文宣），也可以「不太支持但很激進」（不投你，但會去你的場子鬧）。
 *
 * 確認這套拆解合理之後，再考慮要不要接回主系統。**現在先不接。**
 */
import { clamp } from '../core/Formula.js';
import { Rng, seedFromString } from '../core/Rng.js';

const GEN_NAME = { youth: '青年', middle: '中壯', senior: '樂齡' };

/** 依權重抽一個 key */
function pickWeighted(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

/**
 * 生一個人。
 *
 * 這裡的每一個欄位都要能對應到現實裡一件講得出來的事，
 * 不然拆解出來的加值就只是在裝飾一個隨機數。
 */
function makePerson(data, rng, i) {
  const L = data.popLab;
  const stratum = pickWeighted(rng, L.profiles.strataWeight);
  const gen = pickWeighted(rng, L.profiles.generationWeight);
  const sName = data.byId.stratum[stratum]?.name ?? stratum;

  // 政黨傾向。無黨派的比例刻意放高——台灣有一半的人不認任何一個黨。
  const partyRoll = rng.next();
  const partyIds = data.partyIds;
  const party = partyRoll < 0.46 ? null : partyIds[rng.int(0, partyIds.length - 1)];

  return {
    id: 'LAB' + i,
    stratum, stratumName: sName,
    gen, genName: GEN_NAME[gen] ?? gen,
    female: rng.bool(0.5),
    party,
    // −5～+5，鐘形而不是均勻。
    // 均勻分佈會讓一半的人變成極端派，那不是台灣（也不是任何地方）的樣子；
    // 兩個均勻亂數取平均就得到一個夠用的鐘形，多數人落在中間，兩端很稀疏。
    china: Math.round((rng.range(-5, 5) + rng.range(-5, 5)) / 2 * 10) / 10,
    econ: Math.round((rng.range(-5, 5) + rng.range(-5, 5)) / 2 * 10) / 10,
    mediaExposure: rng.range(0, 1),
    localTie: rng.range(0, 1),
    wellbeing: rng.range(0, 1),
    grievance: rng.range(0, 1),
    online: gen === 'youth' ? rng.range(0.4, 1) : gen === 'middle' ? rng.range(0.2, 0.9) : rng.range(0, 0.6),
    education: stratum === 'techpro' || stratum === 'whitecollar' || stratum === 'student'
      ? rng.range(0.6, 1) : rng.range(0.1, 0.8),
    organized: stratum === 'farmer' || stratum === 'retiree' || stratum === 'publicsvc'
      ? rng.range(0.3, 1) : rng.range(0, 0.7),
  };
}

/** 玩家那一邊的設定。沒有存檔的時候用一組中性的預設值。 */
export function playerProfileFrom(state, data) {
  const p = state?.player;
  return {
    party: p?.party ?? null,
    china: p?.china?.friendly ?? 0,
    econ: p?.ideology?.marketFreedom ?? 0,
    fame: p?.fame ?? 2,
    stigma: p?.stigma ?? 0,
    gen: p ? (state.meta.year - p.birthYear < 45 ? 'youth' : state.meta.year - p.birthYear < 60 ? 'middle' : 'senior') : 'middle',
  };
}

/** 兩個黨站不站同一邊 */
function partyRelation(data, a, b) {
  if (!a || !b) return 'none';
  if (a === b) return 'same';
  const pa = data.byId.party[a]?.platform, pb = data.byId.party[b]?.platform;
  if (!pa || !pb) return 'none';
  const gap = Math.abs((pa.unification ?? 0) - (pb.unification ?? 0));
  if (Math.sign(pa.unification ?? 0) === Math.sign(pb.unification ?? 0) && gap < 2.5) return 'friendly';
  return gap > 4 ? 'opposite' : 'none';
}

/** 算一項加值。回傳 null 表示這一項在這個人身上是零，畫面上不用列。 */
function evalTerm(term, person, me, data) {
  let v = 0, detail = '';
  switch (term.kind) {
    case 'flat':
      v = term.value;
      break;
    case 'party': {
      const rel = partyRelation(data, person.party, me.party);
      v = term[rel] ?? 0;
      const pn = person.party ? (data.byId.party[person.party]?.shortName ?? person.party) : '無黨派';
      detail = rel === 'same' ? `他也是${pn}`
        : rel === 'opposite' ? `他是${pn}，跟你站對面`
          : rel === 'friendly' ? `他是${pn}，跟你同一邊`
            : person.party ? `他是${pn}，跟你沒有交集` : '他不認任何一個黨';
      break;
    }
    case 'scaled':
      v = (person[term.source] ?? 0) * term.max;
      break;
    case 'axisGap': {
      const gap = Math.abs((person[term.axis] ?? 0) - (me[term.axis] ?? 0));
      // 差 0 給滿分，差 10（兩端）扣滿分
      v = term.max * (1 - gap / 3.5);
      v = clamp(v, -term.max, term.max);
      detail = `他 ${person[term.axis] > 0 ? '+' : ''}${person[term.axis]}，你 ${me[term.axis] > 0 ? '+' : ''}${(me[term.axis] ?? 0).toFixed(1)}`;
      break;
    }
    case 'generation':
      v = term[person.gen] ?? 0;
      // 年紀大的候選人在長輩裡的加成反過來
      if (me.gen === 'senior') v = -v * 0.7;
      break;
    case 'wellbeing':
      v = (person.wellbeing - 0.5) * 2 * term.max;
      break;
    case 'identityStrength': {
      const strength = Math.max(Math.abs(person.china), Math.abs(person.econ)) / 5;
      v = strength * term.max;
      break;
    }
    default:
      v = 0;
  }
  return { id: term.id, name: term.name, value: Math.round(v), why: term.why, detail };
}

/** 這個人的支持度與激進度，以及每一項的拆解 */
export function evaluate(person, me, data) {
  const L = data.popLab;
  const sup = L.support.terms.map((t) => evalTerm(t, person, me, data));
  // 汙名要用玩家的值，不是這個人的
  for (const row of sup) if (row.id === 'STIGMA') row.value = Math.round(me.stigma / 5 * -28);
  // 媒體宣傳吃玩家的知名度
  for (const row of sup) if (row.id === 'MEDIA') {
    row.value = Math.round(person.mediaExposure * (me.fame / 5) * 30);
  }
  const mil = L.militancy.terms.map((t) => evalTerm(t, person, me, data));

  const support = clamp(sup.reduce((a, r) => a + r.value, 0), -100, 100);
  const militancy = clamp(mil.reduce((a, r) => a + r.value, 0), 0, 100);
  const keep = (rows, terms) => rows.filter((r) =>
    r.value !== 0 || terms.find((t) => t.id === r.id)?.alwaysShow);
  return {
    support, militancy,
    // 政黨認同就算是 0 也要列出來——「他不認任何一個黨」本身就是資訊
    supportTerms: keep(sup, L.support.terms),
    militancyTerms: keep(mil, L.militancy.terms),
    supportBand: bandOf(L.bands.support, support),
    militancyBand: bandOf(L.bands.militancy, militancy),
  };
}

function bandOf(bands, v) {
  return bands.find((b) => v >= b.min) ?? bands[bands.length - 1];
}

/**
 * 抽 60 個人出來，每一個都算好拆解。
 * 種子固定的話結果一樣，這樣才比較得出「改一個參數之後差在哪裡」。
 */
export function sample(state, data, seedStr = 'LAB', me = null) {
  const L = data.popLab;
  const rng = new Rng(seedFromString(String(seedStr)), 0);
  const profile = me ?? playerProfileFrom(state, data);
  const n = L.sampleSize ?? 60;
  const people = [];
  for (let i = 0; i < n; i++) {
    const person = makePerson(data, rng, i);
    people.push({ ...person, ...evaluate(person, profile, data) });
  }
  return { people, profile, seedStr };
}

/** 一批人的整體樣貌。畫面上要先看到分佈，再看細項。 */
export function summarize(result, data) {
  const L = data.popLab;
  const { people } = result;
  const n = people.length || 1;
  const avgS = people.reduce((a, p) => a + p.support, 0) / n;
  const avgM = people.reduce((a, p) => a + p.militancy, 0) / n;
  const bandCount = (bands, key) => bands.map((b) => ({
    ...b, n: people.filter((p) => bandOf(bands, p[key]).name === b.name).length,
  }));
  // 支持但消極、反對但激進——這兩格才是把兩個值分開的理由
  const quad = {
    loyal: people.filter((p) => p.support >= 20 && p.militancy >= 45).length,
    passive: people.filter((p) => p.support >= 20 && p.militancy < 45).length,
    hostile: people.filter((p) => p.support < -20 && p.militancy >= 45).length,
    quiet: people.filter((p) => p.support < -20 && p.militancy < 45).length,
    swing: people.filter((p) => p.support > -20 && p.support < 20).length,
  };
  return {
    n, avgS, avgM, quad,
    supportBands: bandCount(L.bands.support, 'support'),
    militancyBands: bandCount(L.bands.militancy, 'militancy'),
  };
}
