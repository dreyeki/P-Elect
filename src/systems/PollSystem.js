// @ts-check
/**
 * 民調不會憑空出現。
 * 沒有人做，玩家就不知道自己的支持度；想知道得準，就要自己掏錢委託。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { nationalSupport, chinaMood } from './PopSystem.js';
import { N_CHINA, N_IDENT, CHINA_KEYS } from '../core/Pops.js';
import { approval as trueApproval } from './MediaSystem.js';
import { mobilization } from './DistrictSystem.js';

export const FAME_TO_APPEAR = 2;   // 知名度低於這個級數，全國民調不會把你列進去

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const news = [];
  state.polls ??= [];

  // 玩家委託的內參民調，隔一回合交件
  if (state.flags.commissionedPoll) {
    const c = state.flags.commissionedPoll;
    c.turnsLeft -= 1;
    if (c.turnsLeft <= 0) {
      const poll = makePoll(state, data, rng, data.byId.pollster[c.pollsterId], c.scope, c.scopeId, true);
      state.polls.unshift(poll);
      state.flags.commissionedPoll = null;
      news.push({ kind: 'poll', text: `你委託的內參民調交件了。${poll.pollsterName}的人強調這份不會外流，數字比公開的那幾家準得多。` });
    }
  }

  // 各家依自己的節奏發布
  for (const ps of data.pollsters.pollsters) {
    if (state.meta.turn % ps.freq !== 0) continue;
    if (!rng.bool(ps.publishChance * (state.meta.scale === 'week' ? 0.55 : 1))) continue;
    const scope = pickScope(state, data, ps, rng);
    const poll = makePoll(state, data, rng, ps, scope.type, scope.id, false);
    state.polls.unshift(poll);
    if (poll.playerListed && Math.abs(poll.playerApproval - (state.flags.lastPublicApproval ?? poll.playerApproval)) > 6) {
      news.push({
        kind: 'poll',
        text: `${ps.name}公布最新調查，你的支持度來到 ${poll.playerApproval.toFixed(1)}%，`
          + `跟上一份相比出現了不小的落差，幕僚正在確認是趨勢還是雜訊。`,
      });
    }
    if (poll.playerListed) state.flags.lastPublicApproval = poll.playerApproval;
  }
  state.polls = state.polls.slice(0, 40);

  // 公開民調會回頭影響政壇：領先的黨團結度上升，落後的派系開始躁動
  const latest = state.polls.find((p) => !p.internal && p.scope === 'nation');
  if (latest) {
    for (const pid in latest.partySupport) {
      const party = state.parties[pid];
      if (!party) continue;
      const delta = latest.partySupport[pid] - (party.support ?? 0.1) * 100;
      party.cohesion = clamp05(party.cohesion + delta * 0.004 * scaleMult);
    }
    state.flags.publishedApproval = latest.playerListed ? latest.playerApproval : null;
  }
  return { news };
}

function pickScope(state, data, ps, rng) {
  const inCampaign = state.meta.scale === 'week';
  const homeD = data.byId.district[state.player.homeDistrict];
  if (inCampaign && ps.scopes.includes('district') && rng.bool(0.5)) {
    return { type: 'district', id: state.player.homeDistrict };
  }
  if (inCampaign && ps.scopes.includes('region') && rng.bool(0.45)) {
    return { type: 'region', id: homeD?.regionId };
  }
  return { type: 'nation', id: null };
}

/**
 * 95% 信心水準下的最大誤差，單位是百分點。
 * 這是統計學的定義，不是手填的數字：n 越大誤差越小，比例越極端誤差也越小。
 */
export function marginOfError(sampleSize, designEffect = 1, p = 0.5) {
  return 1.96 * Math.sqrt(Math.max(1e-6, p * (1 - p)) / Math.max(1, sampleSize))
    * Math.sqrt(designEffect) * 100;
}

/**
 * 產一份民調。讀數 = 真值 + 房效應 + 非抽樣偏差 + 抽樣誤差。
 * 抽樣誤差按各黨自己的比例算，所以支持度 3% 的小黨誤差只有正負一個百分點左右，
 * 不會像過去那樣憑空跳到兩位數。
 */
export function makePoll(state, data, rng, ps, scope, scopeId, internal) {
  const n = ps.sampleSize;
  const deff = ps.designEffect ?? 1;
  const shrink = internal ? data.pollsters.internalErrorMult : 1;
  const headlineMoe = marginOfError(n, deff) * shrink;
  const bias = internal ? 0 : (ps.nonSamplingBias ?? 0);
  const houseGreen = internal ? 0 : -ps.bias * 0.9;   // bias 為正偏藍，綠營讀數往下

  const trueSup = nationalSupport(state, data);
  const partySupport = {};
  for (const pid in trueSup) {
    const party = state.parties[pid];
    const lean = party ? party.platform.unification : 0;   // 正數偏統合（藍），負數偏本土（綠）
    const truth = trueSup[pid];
    // 房效應只在藍綠之間搬動，而且按該黨的規模等比例分配，不會把小黨吹大
    const shift = houseGreen * (lean < 0 ? 1 : lean > 0 ? -1 : 0) * 0.6 * (truth / 0.4);
    // 抽樣誤差用該黨自己的比例算
    const sd = marginOfError(n, deff, truth) / 1.96 * shrink;
    const nonSampling = rng.normal(0, bias * 0.35) * (truth / 0.4);
    partySupport[pid] = clamp(truth * 100 + shift + nonSampling + rng.normal(0, sd), 0, 100);
  }
  // 正規化回 100
  const sum = Object.values(partySupport).reduce((a, b) => a + b, 0) || 1;
  for (const k in partySupport) partySupport[k] = partySupport[k] / sum * 100;

  const err = headlineMoe;
  const realApproval = trueApproval(state, data, null);
  const fame = state.player.fame;
  const running = !!state.election?.run;
  const listed = internal || running || fame >= (data.tuning?.poll?.fameToAppear ?? FAME_TO_APPEAR);

  const poll = {
    turn: state.meta.turn, year: state.meta.year, month: state.meta.month,
    pollsterId: ps.id, pollsterName: ps.name, pollsterShort: ps.short,
    credibility: ps.credibility, bias: internal ? 0 : ps.bias,
    error: err, sampleSize: n, designEffect: deff, nonSamplingBias: bias,
    internal, scope, scopeId,
    scopeName: scope === 'nation' ? '全國'
      : scope === 'region' ? (data.byId.region[scopeId]?.name ?? '')
        : (data.byId.district[scopeId]?.name ?? ''),
    partySupport,
    presidentApproval: clamp((state.presidency?.approval ?? state.central.government.presidentApproval)
      + houseGreen * (state.parties[state.central.government.presidentParty]?.platform.unification < 0 ? 1 : -1) * 0.8
      + rng.normal(0, bias * 0.4)
      + rng.normal(0, marginOfError(n, deff, (state.presidency?.approval ?? 44) / 100) / 1.96 * shrink), 2, 96),
    playerListed: listed,
    playerApproval: listed
      ? clamp(realApproval + houseGreen * 0.5 + rng.normal(0, bias * 0.4)
        + rng.normal(0, marginOfError(n, deff, realApproval / 100) / 1.96 * shrink), 1, 97) : null,
  };

  if (scope !== 'nation' && state.election?.run) {
    poll.race = buildRace(state, data, rng, err);
  }
  // 每一家都有自己的招牌題組。切法本身就是一種立場。
  poll.specialty = ps.specialty ?? null;
  poll.extra = buildSpecialty(state, data, rng, ps, poll, shrink);
  // 部會首長的滿意度也是問出來的，不是從資料庫裡讀出來的
  poll.ministers = ministerApproval(state, data, rng, n, deff, shrink, bias);
  return poll;
}

/**
 * 各家民調的招牌題組。
 * 這是玩家真正會拿來做決定的東西——同一個世界，九種切法。
 */
function buildSpecialty(state, data, rng, ps, poll, shrink) {
  const kind = ps.specialty?.id;
  if (!kind) return null;
  const P = state.pops;
  const n = ps.sampleSize, deff = ps.designEffect ?? 1;
  const noise = (share) => rng.normal(0, marginOfError(n, deff, share) / 1.96 * shrink);

  if (kind === 'crosstab') {
    const groups = data.pollsters.crosstabGroups.map((g) => {
      const agg = aggregate(state, data, (i) => matchGroup(state, data, g, i));
      return {
        id: g.id, name: g.name, desc: g.desc,
        share: agg.share * 100,
        top: agg.top, topShare: clamp(agg.topShare * 100 + noise(agg.topShare), 0, 100),
        turnout: clamp(agg.turnout * 100 + rng.normal(0, 2), 20, 95),
        enthusiasm: agg.enthusiasm,
      };
    });
    return { kind, groups };
  }

  if (kind === 'issueSalience') {
    const rows = data.issues.issues.map((iss) => {
      let w = 0, tot = 0;
      for (let i = 0; i < P.n; i++) {
        const st = data.pops.strata[P.stratum[i]];
        w += (st.issueWeights[iss.id] ?? 0) * (1 + state.issues[iss.id] * 0.3) * P.size[i];
        tot += P.size[i];
      }
      return { id: iss.id, name: iss.name, weight: w / Math.max(1, tot) };
    });
    const sum = rows.reduce((a, r) => a + r.weight, 0) || 1;
    rows.forEach((r) => { r.pct = clamp(r.weight / sum * 100 + rng.normal(0, 1.4), 0, 100); });
    rows.sort((a, b) => b.pct - a.pct);
    return { kind, rows: rows.slice(0, 8) };
  }

  if (kind === 'identity') {
    const ident = ['localist', 'chinese', 'dual', 'apathetic'];
    const out = [0, 0, 0, 0];
    let w = 0;
    for (let i = 0; i < P.n; i++) {
      for (let k = 0; k < N_IDENT; k++) out[k] += P.identity[i * N_IDENT + k] * P.size[i];
      w += P.size[i];
    }
    const identity = ident.map((k, i) => ({
      id: k, pct: clamp(out[i] / Math.max(1, w) * 100 + noise(out[i] / w), 0, 100),
    }));
    const cn = chinaMood(state);
    return {
      kind, identity,
      china: CHINA_KEYS.map((k) => ({
        id: k,
        name: data.byId.chinaDim[k]?.name ?? k,
        negName: data.byId.chinaDim[k]?.negName ?? '',
        posName: data.byId.chinaDim[k]?.posName ?? '',
        value: cn[k] + rng.normal(0, 0.18),
      })),
      reasons: reasonMix(state, data),
    };
  }

  if (kind === 'genderAge') {
    const g = state.flags.genderSupport ?? { male: {}, female: {} };
    const rows = data.partyIds.map((pid) => ({
      id: pid, name: state.parties[pid].shortName ?? state.parties[pid].name,
      male: clamp((g.male[pid] ?? 0) * 100 + noise(g.male[pid] ?? 0), 0, 100),
      female: clamp((g.female[pid] ?? 0) * 100 + noise(g.female[pid] ?? 0), 0, 100),
    }));
    rows.forEach((r) => { r.gap = r.male - r.female; });
    rows.sort((a, b) => (b.male + b.female) - (a.male + a.female));
    // 青年世代的落差另外拉一列出來，因為那才是真正在變的地方
    const youth = aggregateGender(state, data, (i) => data.genIds[P.gen[i]] === 'youth');
    return { kind, rows: rows.slice(0, 5), youthGap: youth };
  }

  if (kind === 'regionBreak') {
    const six = ['TPE', 'NTP', 'TYC', 'TCH', 'TNN', 'KHH'];
    const mk = (label, filter) => {
      const agg = aggregate(state, data, filter);
      return { label, top: agg.top, topShare: clamp(agg.topShare * 100 + noise(agg.topShare), 0, 100), share: agg.share * 100 };
    };
    const dIdx = data.districts.districts;
    return { kind, rows: [
      mk('六都', (i) => six.includes(dIdx[P.district[i]].regionId)),
      mk('非六都', (i) => !six.includes(dIdx[P.district[i]].regionId)),
    ] };
  }

  if (kind === 'headToHead') {
    const sup = poll.partySupport;
    const sorted = Object.entries(sup).sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (sorted.length < 2) return { kind, rows: [] };
    const [a, b] = sorted;
    const tot = a[1] + b[1] || 1;
    return { kind, rows: [
      { id: a[0], name: state.parties[a[0]]?.shortName ?? a[0], pct: clamp(a[1] / tot * 100 + rng.normal(0, 1.8), 0, 100) },
      { id: b[0], name: state.parties[b[0]]?.shortName ?? b[0], pct: clamp(b[1] / tot * 100 + rng.normal(0, 1.8), 0, 100) },
    ] };
  }

  if (kind === 'trend') {
    const prev = (state.polls ?? []).filter((x) => x.pollsterId === ps.id).slice(0, 3);
    return { kind, rows: Object.keys(poll.partySupport).map((pid) => ({
      id: pid, name: state.parties[pid]?.shortName ?? pid,
      now: poll.partySupport[pid],
      delta: prev.length ? poll.partySupport[pid] - (prev[0].partySupport[pid] ?? poll.partySupport[pid]) : 0,
    })).sort((a, b) => b.now - a.now).slice(0, 5) };
  }

  if (kind === 'quickTake') {
    const iss = data.issues.issues.slice().sort((a, b) => state.issues[b.id] - state.issues[a.id])[0];
    const yes = clamp(45 + state.issues[iss.id] * 6 + rng.normal(0, 5), 5, 95);
    return { kind, question: `你認為政府在「${iss.name}」上的處理，是否符合你的期待？`,
      yes, no: 100 - yes - 8, unsure: 8 };
  }

  if (kind === 'openWeb') {
    return { kind, warning: '本調查為網路開放自填，填答者非隨機抽樣。統計誤差算得很漂亮，但那個誤差不包含填的人跟投票的人不是同一群這件事。' };
  }
  return null;
}

function matchGroup(state, data, g, i) {
  const P = state.pops;
  const d = data.districts.districts[P.district[i]];
  const gen = data.genIds[P.gen[i]];
  const st = data.strataIds[P.stratum[i]];
  if (g.gen && gen !== g.gen) return 0;
  if (g.strata && !g.strata.includes(st)) return 0;
  if (g.urbanMin != null && d.urbanity < g.urbanMin) return 0;
  if (g.urbanMax != null && d.urbanity > g.urbanMax) return 0;
  if (g.female === true) return P.femaleShare[i];
  if (g.female === false) return 1 - P.femaleShare[i];
  return 1;
}

/** 一群人的支持度、投票意願與熱情。weightFn 回傳 0~1 的納入比例。 */
function aggregate(state, data, weightFn) {
  const P = state.pops, nP = data.partyIds.length;
  const sup = new Float64Array(nP);
  let w = 0, turn = 0, enth = 0, all = 0;
  for (let i = 0; i < P.n; i++) {
    all += P.size[i];
    const f = typeof weightFn === 'function' ? weightFn(i) : 1;
    if (!f) continue;
    const sz = P.size[i] * f;
    for (let p = 0; p < nP; p++) sup[p] += P.support[i * nP + p] * sz;
    turn += P.turnoutBase[i] * sz;
    enth += P.enthusiasm[i] * sz;
    w += sz;
  }
  let top = null, topShare = 0;
  data.partyIds.forEach((pid, p) => {
    const v = sup[p] / Math.max(1, w);
    if (v > topShare) { topShare = v; top = state.parties[pid]?.shortName ?? pid; }
  });
  return { top, topShare, turnout: turn / Math.max(1, w), enthusiasm: enth / Math.max(1, w), share: w / Math.max(1, all) };
}

function aggregateGender(state, data, filter) {
  const P = state.pops, nP = data.partyIds.length;
  const m = new Float64Array(nP), f = new Float64Array(nP);
  let wm = 0, wf = 0;
  for (let i = 0; i < P.n; i++) {
    if (filter && !filter(i)) continue;
    const fs = P.femaleShare[i], ms = 1 - fs;
    for (let p = 0; p < nP; p++) {
      m[p] += P.support[i * nP + p] * P.size[i] * ms;
      f[p] += P.support[i * nP + p] * P.size[i] * fs;
    }
    wm += P.size[i] * ms; wf += P.size[i] * fs;
  }
  let best = null, gap = 0;
  data.partyIds.forEach((pid, p) => {
    const g = (m[p] / Math.max(1, wm)) - (f[p] / Math.max(1, wf));
    if (Math.abs(g) > Math.abs(gap)) { gap = g; best = state.parties[pid]?.shortName ?? pid; }
  });
  return { party: best, gap: gap * 100 };
}

/** 兩岸態度的主要理由分佈 */
function reasonMix(state, data) {
  const P = state.pops;
  const out = new Float64Array(data.reasonKeys.length);
  let w = 0;
  for (let i = 0; i < P.n; i++) { out[P.chinaReason[i]] += P.size[i]; w += P.size[i]; }
  return data.reasonKeys.map((k, i) => ({
    id: k, name: data.byId.chinaReason[k]?.name ?? k, pct: out[i] / Math.max(1, w) * 100,
  }));
}

/**
 * 部會首長的滿意度。
 * 這也是問出來的，不是從資料庫讀出來的——玩家看到的永遠是帶著誤差的數字。
 */
function ministerApproval(state, data, rng, n, deff, shrink, bias) {
  if (!Array.isArray(state.cabinet) || !state.cabinet.length) return null;
  // 部會的子樣本比全國小，所以誤差比頭條數字大上不少
  const sd = marginOfError(Math.max(300, Math.round(n / 3)), deff, 0.45) / 1.96 * shrink;
  return state.cabinet.map((m) => ({
    id: m.ministryId,
    name: data.byId.ministry[m.ministryId]?.name ?? m.ministryId,
    holder: m.name,
    approval: clamp((m.approval ?? 45) + rng.normal(0, sd) + rng.normal(0, bias * 0.5), 2, 96),
    moe: sd * 1.96,
  })).sort((a, b) => b.approval - a.approval);
}

function buildRace(state, data, rng, err) {
  // err 這裡只用來估計樣本規模，選區民調的樣本通常比全國小
  const e = state.election;
  if (!e?.poll) return null;
  return e.poll.map((c) => ({
    name: c.name, party: c.party, isPlayer: c.isPlayer,
    share: clamp(c.share * 100 + rng.normal(0, marginOfError(err.n ?? 900, 1.2, c.share) / 1.96), 0, 100),
  }));
}

/** 玩家委託民調 */
export function commission(state, data, pollsterId, scope) {
  const ps = data.byId.pollster[pollsterId];
  if (!ps) return { ok: false, msg: '找不到這家民調公司。' };
  if (!ps.scopes.includes(scope)) return { ok: false, msg: `${ps.short}不接${scopeName(scope)}層級的案子。` };
  if (state.flags.commissionedPoll) return { ok: false, msg: '你已經有一份委託在進行中了。' };
  const cost = Math.round(ps.commission * (data.pollsters.commissionScopeMult[scope] ?? 1));
  if (state.finance.campaign < cost) return { ok: false, msg: '專戶裡的錢不夠付這筆委託。' };

  const homeD = data.byId.district[state.player.homeDistrict];
  state.finance.campaign -= cost;
  state.finance.ledger.push({ turn: state.meta.turn, kind: 'out', amount: cost, note: `委託${ps.short}民調` });
  state.flags.commissionedPoll = {
    pollsterId, scope, turnsLeft: 1,
    scopeId: scope === 'nation' ? null : scope === 'region' ? homeD?.regionId : state.player.homeDistrict,
  };
  return { ok: true, cost, msg: `你委託了${ps.short}做一份內參民調，費用 ${(cost / 10000).toFixed(0)} 萬元，下個回合交件。` };
}

export const scopeName = (s) => ({ nation: '全國', region: '縣市', district: '選區' }[s] ?? s);

export function latestPublic(state) {
  return (state.polls ?? []).find((p) => !p.internal) ?? null;
}
export function latestAny(state) { return (state.polls ?? [])[0] ?? null; }
