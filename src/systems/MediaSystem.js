// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { nationalSupport } from './PopSystem.js';

export function tick(state, ctx) {
  const { data, scaleMult, rng } = ctx;
  // 議題熱度自然衰減
  for (const iss of data.issues.issues) {
    state.issues[iss.id] = clamp05(state.issues[iss.id] - iss.decay * scaleMult);
  }
  // 媒體立場更新
  const support = nationalSupport(state, data);
  const rulingParty = state.central.government.presidentParty;
  const rulingBias = biasOfParty(state, rulingParty);
  let loudest = null, loudestV = -1;
  for (const pid in support) if (support[pid] > loudestV) { loudestV = support[pid]; loudest = pid; }

  for (const m of Object.values(state.media)) {
    if (m.biasMode === 'government') {
      m.bias = clampBi(m.bias + (rulingBias - m.bias) * 0.08 * scaleMult);
      m.credibility = clamp05(m.credibility - 0.004 * scaleMult);
    } else if (m.biasMode === 'follower') {
      m.bias = clampBi(m.bias + (biasOfParty(state, loudest) - m.bias) * 0.06 * scaleMult);
    }
    m.playerRelation = clampBi(m.playerRelation * (1 - 0.01 * scaleMult));
  }

  // 媒體框架：影響 POP 意識形態漂移
  const frame = {};
  let reachSum = 0;
  for (const m of Object.values(state.media)) {
    const w = m.reach * m.credibility;
    reachSum += w;
    frame.unification = (frame.unification ?? 0) + m.bias * 0.5 * w;
    frame.progressivism = (frame.progressivism ?? 0) - m.bias * 0.3 * w;
    frame.marketFreedom = (frame.marketFreedom ?? 0) + m.bias * 0.2 * w;
  }
  for (const k in frame) frame[k] = clampBi(frame[k] / Math.max(1, reachSum));
  state.flags.mediaFrame = frame;

  // 民調
  state.flags.approval = approval(state, data, rng);
  return {};
}

function biasOfParty(state, pid) {
  const p = state.parties[pid];
  if (!p) return 0;
  return clampBi(p.platform.unification * 1.1);
}

export function approval(state, data, rng) {
  const P = state.pops;
  let favSum = 0, w = 0;
  for (let i = 0; i < P.n; i++) { favSum += ((P.playerFavor[i] + 5) / 10) * P.size[i]; w += P.size[i]; }
  const favTerm = favSum / Math.max(1, w);
  const solTrend = clamp((state.flags.solTrend ?? 0) * 40 + 0.5, 0, 1);
  const p = state.player;
  const image = clamp((p.integrity - p.stigma * 1.5 + 5) / 10, 0, 1);
  const mediaNet = clamp((Object.values(state.media)
    .reduce((a, m) => a + m.playerRelation * m.reach, 0) / 60 + 0.5), 0, 1);
  const issueFit = 0.5;
  const base = 0.32 * favTerm + 0.24 * solTrend + 0.20 * issueFit + 0.12 * image + 0.12 * mediaNet;
  return clamp(base * 100 + (rng ? rng.normal(0, 1.6) : 0), 3, 95);
}

/** 依媒體立場產生同一則新聞的不同標題 */
export function frameHeadline(state, data, baseText, subjectBias = 0) {
  const out = [];
  for (const m of Object.values(state.media)) {
    if (m.reach < 3) continue;
    const align = -Math.abs(m.bias - subjectBias) / 10 + 0.5;
    out.push({ media: m.name, tone: align > 0.4 ? 'friendly' : 'hostile', text: baseText });
  }
  return out;
}

export function pressConference(state, data, issueId, rng) {
  const p = state.player;
  const roll = p.attrs.eloquence * 10 + p.attrs.charisma * 6 + p.fame * 5 + rng.range(-15, 15);
  const gain = clamp(roll / 40, 0.3, 2.2);
  state.issues[issueId] = clamp05(state.issues[issueId] + gain);
  p.fame = clamp05(p.fame + gain * 0.12);
  for (const m of Object.values(state.media)) {
    m.playerRelation = clampBi(m.playerRelation + (roll > 40 ? 0.2 : -0.05));
  }
  return {
    gain,
    text: roll > 55
      ? `你把議題設定得很成功，晚間新聞有三台把你的說法放在開頭，接下來幾天大家談的都是這件事。`
      : roll > 25
        ? `記者會平順地結束，該講的都講了，版面不大但方向是對的。`
        : `到場的記者比預期少，提問也集中在別的事情上，這場記者會等於白開了。`,
  };
}
