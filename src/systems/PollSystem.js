// @ts-check
/**
 * 民調不會憑空出現。
 * 沒有人做，玩家就不知道自己的支持度；想知道得準，就要自己掏錢委託。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { nationalSupport } from './PopSystem.js';
import { approval as trueApproval } from './MediaSystem.js';
import { mobilization } from './DistrictSystem.js';

const FAME_TO_APPEAR = 2;   // 知名度低於這個級數，全國民調不會把你列進去

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

/** 產一份民調。讀數 = 真值 + 房效應 + 抽樣誤差。 */
export function makePoll(state, data, rng, ps, scope, scopeId, internal) {
  const errMult = internal ? data.pollsters.internalErrorMult : 1;
  const err = ps.sampleError * errMult;
  const houseGreen = internal ? 0 : -ps.bias * 0.9;   // bias 為正偏藍，綠營讀數往下

  const trueSup = nationalSupport(state, data);
  const partySupport = {};
  for (const pid in trueSup) {
    const p = state.parties[pid];
    const lean = p ? p.platform.unification : 0;     // 正數偏統合（藍），負數偏本土（綠）
    const shift = houseGreen * (lean < 0 ? 1 : lean > 0 ? -1 : 0) * 0.6;
    partySupport[pid] = clamp(trueSup[pid] * 100 + shift + rng.normal(0, err * 0.35), 0, 100);
  }
  // 正規化回 100
  const sum = Object.values(partySupport).reduce((a, b) => a + b, 0) || 1;
  for (const k in partySupport) partySupport[k] = partySupport[k] / sum * 100;

  const realApproval = trueApproval(state, data, null);
  const fame = state.player.fame;
  const running = !!state.election?.run;
  const listed = internal || running || fame >= FAME_TO_APPEAR;

  const poll = {
    turn: state.meta.turn, year: state.meta.year, month: state.meta.month,
    pollsterId: ps.id, pollsterName: ps.name, pollsterShort: ps.short,
    credibility: ps.credibility, bias: internal ? 0 : ps.bias, error: err,
    internal, scope, scopeId,
    scopeName: scope === 'nation' ? '全國'
      : scope === 'region' ? (data.byId.region[scopeId]?.name ?? '')
        : (data.byId.district[scopeId]?.name ?? ''),
    partySupport,
    presidentApproval: clamp(state.presidency?.approval ?? state.central.government.presidentApproval
      + houseGreen * (state.parties[state.central.government.presidentParty]?.platform.unification < 0 ? 1 : -1) * 0.8
      + rng.normal(0, err * 0.4), 2, 96),
    playerListed: listed,
    playerApproval: listed
      ? clamp(realApproval + houseGreen * 0.5 + rng.normal(0, err), 1, 97) : null,
    sampleSize: internal ? 1500 : Math.round(rng.range(1000, 1400)),
  };

  if (scope !== 'nation' && state.election?.run) {
    poll.race = buildRace(state, data, rng, err);
  }
  return poll;
}

function buildRace(state, data, rng, err) {
  const e = state.election;
  if (!e?.poll) return null;
  return e.poll.map((c) => ({
    name: c.name, party: c.party, isPlayer: c.isPlayer,
    share: clamp(c.share * 100 + rng.normal(0, err * 0.6), 0, 100),
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

const scopeName = (s) => ({ nation: '全國', region: '縣市', district: '選區' }[s] ?? s);

export function latestPublic(state) {
  return (state.polls ?? []).find((p) => !p.internal) ?? null;
}
export function latestAny(state) { return (state.polls ?? [])[0] ?? null; }
export { scopeName, FAME_TO_APPEAR };
