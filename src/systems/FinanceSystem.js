// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { officeCost } from './DistrictSystem.js';
import { bumpCounter } from './Effects.js';
import { declarable } from './AssetSystem.js';
import { payrollSplit } from './ServiceOfficeSystem.js';

const SALARY = { citizen: 0, aide: 45000, village: 50000, councilor: 120000, legislator: 190000, mayor: 240000, minister: 220000, president: 470000 };
const LIVING = { citizen: 50000, aide: 55000, village: 60000, councilor: 90000, legislator: 140000, mayor: 180000, minister: 170000, president: 250000 };

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const f = state.finance;
  const p = state.player;
  const news = [];
  const m = scaleMult;

  // 薪俸與生活開支
  f.personal += (SALARY[p.role] ?? 0) * m;
  f.personal -= (LIVING[p.role] ?? 50000) * m;
  // 投資收益
  const invest = state.flags.investRatio ?? 0;
  if (invest > 0 && f.personal > 0) {
    const ret = (state.central.stockIndex / (state.flags.lastIndex ?? state.central.stockIndex)) - 1;
    f.personal += f.personal * invest * ret;
  }
  state.flags.lastIndex = state.central.stockIndex;
  // 演講與出書
  if (p.fame >= 3) f.personal += rng.range(30000, 300000) * (p.fame - 2) * m;

  // 團隊薪資與服務處。
  // 助理費補助是台灣各層級公職差最多的一件事：立委的助理是公家出錢，
  // 素人的幕僚是自己出錢。同樣一句「我請了三個助理」，兩個身分底下是兩件事。
  const pay = payrollSplit(state, data);
  f.campaign -= pay.outOfPocket * m;
  f.campaign -= officeCost(state, data) * m;

  if (f.campaign < 0) {
    const gap = -f.campaign;
    f.campaign = 0;
    f.personal -= gap;
    if (state.meta.turn % 3 === 0) news.push({ kind: 'finance', text: '競選專戶已經見底，這個月的幕僚薪水是你從自己的帳戶墊出去的，財務長委婉地提醒你這不是長久之計。' });
  }
  if (f.personal < 0) {
    state.flags.debtTurns = (state.flags.debtTurns ?? 0) + 1;
    if (state.flags.debtTurns >= 3) {
      news.push({ kind: 'finance', text: '你的個人財務已經連續三個月是負的，銀行的電話開始打到服務處來，有幾個從來沒往來過的人主動表示願意幫忙。' });
      state.flags.debtCrisis = true;
    }
  } else state.flags.debtTurns = 0;

  // 獻金提案生成
  if (state.meta.scale === 'month' || rng.bool(0.4)) generateDonations(state, data, rng);
  // 過期
  f.pending = f.pending.filter((d) => {
    d.expiresIn -= m;
    return d.expiresIn > 0;
  });
  // 附帶條件到期檢查
  for (const d of f.donations) {
    if (!d.condition || d.settled) continue;
    d.condition.deadline -= m;
    if (d.condition.deadline <= 0) {
      d.settled = true;
      if (!checkConditionKept(state, d)) {
        p.stigma = clamp05(p.stigma + 0.5);
        const c = state.corporations[d.donorId];
        if (c) c.mood = clamp(c.mood - 3, -5, 5);
        news.push({ kind: 'finance', text: `${d.donorName}那筆錢的條件你沒有做到，對方透過中間人表達了強烈的不滿，這件事在圈子裡已經傳開了。` });
      }
    }
  }

  // 年度財產申報
  if (state.meta.month === 12 && state.meta.scale === 'month') declare(state, news);
  return { news };
}

function checkConditionKept(state, d) {
  const c = d.condition;
  if (c.type === 'lawStance') {
    const tier = state.laws[c.target];
    return c.expect === 'oppose' ? tier <= c.baselineTier : tier >= c.baselineTier;
  }
  return state.flags['cond_' + d.id] === true;
}

/**
 * 身家裡有多少比例是跟著市場跳動的。
 *
 * 財產申報要抓的是解釋不掉的增減，不是股價漲跌。
 * 一個創辦人的持股一年上下兩成很正常，那不該每年都變成一則監察機關來函的新聞。
 */
function marketShare(state) {
  const A = state.assets;
  if (!A) return 0;
  const total = Math.abs(state.finance.personal)
    + (A.holdings ?? []).reduce((a, h) => a + h.value, 0)
    + (A.house?.value ?? 0);
  if (total <= 0) return 0;
  const market = (A.holdings ?? [])
    .filter((h) => h.kind === 'stock' || h.defId === 'INV_ETF50' || h.defId === 'INV_SANDISC')
    .reduce((a, h) => a + h.value, 0);
  return Math.min(1, market / total);
}

/**
 * 年度財產申報。
 *
 * 申報的是全部身家，不是帳戶餘額——房子、投資、貸款都要寫進去。
 * 這一點很重要：一個把現金換成房子的人，帳面現金會掉一大截，
 * 但他的財產一塊錢都沒有少，不該因此被監察機關來函詢問。
 */
function declare(state, news) {
  const f = state.finance;
  const now = declarable(state);
  let diff = Math.abs(now - f.lastDeclaredAssets) / Math.max(1, Math.abs(f.lastDeclaredAssets));
  // 一個身家七成在股票上的人，帳面每年上下兩成是正常的，那不是財產來源不明。
  // 監察機關看的是解釋不掉的那一段，所以把市場部位的比例讓出來。
  diff = Math.max(0, diff - marketShare(state) * 0.25);
  if (diff > 0.20) {
    state.player.stigma = clamp05(state.player.stigma + 0.6);
    news.push({ kind: 'finance', text: '今年的財產申報和去年的差距大到監察機關主動來函詢問，媒體很快就拿到了那份對照表，你的辦公室整個下午都在接電話。' });
  } else if (diff > 0.05) {
    news.push({ kind: 'finance', text: '有記者比對了你這兩年的財產申報，寫了一則不算大但也不小的報導，標題把差額放在最前面。' });
  }
  f.lastDeclaredAssets = now;
  f.declaredYear = state.meta.year;
}

function generateDonations(state, data, rng) {
  const p = state.player;
  const f = state.finance;
  if (f.pending.length >= 3) return;
  for (const src of data.donations.sources) {
    let ok = true;
    const req = src.requires ?? {};
    if (req.favorNational != null && p.favorNational < req.favorNational) ok = false;
    if (req.stigma != null && p.stigma < req.stigma) ok = false;
    if (req.corpMood != null && !Object.values(state.corporations).some((c) => c.mood >= req.corpMood)) ok = false;
    if (req.factionFavor != null && !anyFaction(state, req.factionFavor)) ok = false;
    if (!ok) continue;
    const chance = 0.16 + p.fame * 0.05;
    if (!rng.bool(chance)) continue;

    const amount = Math.round(rng.range(src.amountRange[0], src.amountRange[1])
      * (0.6 + p.fame * 0.2) / 10000) * 10000;
    let donorName = '匿名支持者', donorId = null;
    if (src.id === 'corporate') {
      const c = rng.weighted(Object.values(state.corporations).filter((x) => x.mood >= 2), (x) => x.mood + 1)
        ?? rng.pick(Object.values(state.corporations));
      donorName = c.name; donorId = c.id;
    } else if (src.id === 'faction' && p.party) {
      const fac = rng.pick(state.parties[p.party].factions);
      donorName = fac.name;
    } else if (src.id === 'small') donorName = '小額支持者';
    else donorName = '一位不願具名的friend'.replace('friend', '朋友');

    const don = {
      id: `DON_${state.meta.turn}_${f.pending.length}_${src.id}`,
      source: src.id, sourceName: src.name, donorName, donorId, amount,
      stigmaOnAccept: src.stigma, investigationRisk: src.investigationRisk,
      flavor: rng.pick(src.flavor), expiresIn: 2, condition: null,
    };
    if (rng.bool(src.conditionChance)) {
      const ct = rng.pick(data.donations.conditionTypes);
      const law = rng.pick(data.laws.laws);
      don.condition = {
        type: ct.id,
        target: ct.id === 'lawStance' ? law.id : null,
        targetName: ct.id === 'lawStance' ? law.name : null,
        baselineTier: state.laws[law.id],
        expect: rng.bool() ? 'oppose' : 'support',
        deadline: rng.int(ct.deadlineRange[0], ct.deadlineRange[1]),
        desc: ct.desc.replace('{target}', ct.id === 'lawStance' ? law.name : '這件事'),
      };
    }
    f.pending.push(don);
    break;
  }
}

function anyFaction(state, need) {
  const pid = state.player.party;
  if (!pid) return false;
  return state.parties[pid].factions.some((f) => f.favor >= need);
}

export function acceptDonation(state, data, id) {
  const f = state.finance;
  const i = f.pending.findIndex((d) => d.id === id);
  if (i < 0) return { ok: false };
  const d = f.pending.splice(i, 1)[0];
  const finCFO = state.team.find((t) => t.role === 'finance');
  const reduce = finCFO ? (data.byId.staffRole.finance.effects.stigmaReduction ?? 0) * (finCFO.ability / 5) : 0;
  f.campaign += d.amount;
  state.player.stigma = clamp05(state.player.stigma + d.stigmaOnAccept * (1 - reduce));
  f.donations.push({ ...d, acceptedTurn: state.meta.turn, settled: false });
  f.ledger.push({ turn: state.meta.turn, kind: 'in', amount: d.amount, note: `${d.donorName}政治獻金` });
  if (d.condition) bumpCounter(state, data, 'conditionalDonation');
  return { ok: true, donation: d };
}

export function refuseDonation(state, data, id) {
  const f = state.finance;
  const i = f.pending.findIndex((d) => d.id === id);
  if (i < 0) return { ok: false };
  const d = f.pending.splice(i, 1)[0];
  if (d.condition || d.source === 'shadow') bumpCounter(state, data, 'donationRefused');
  state.player.integrity = clamp05(state.player.integrity + 0.05);
  return { ok: true, donation: d };
}

/** 從競選專戶挪錢進私帳：這是明確的犯罪，汙名會留下來 */
export function embezzle(state, amount) {
  const f = state.finance;
  const amt = Math.min(amount, f.campaign);
  f.campaign -= amt;
  f.personal += amt;
  state.player.stigma = clamp05(state.player.stigma + 0.8);
  f.ledger.push({ turn: state.meta.turn, kind: 'illegal', amount: amt, note: '競選經費挪用' });
  return amt;
}
export function transferToCampaign(state, amount) {
  const f = state.finance;
  const amt = Math.min(amount, Math.max(0, f.personal));
  f.personal -= amt; f.campaign += amt;
  f.ledger.push({ turn: state.meta.turn, kind: 'transfer', amount: amt, note: '自有資金轉入專戶' });
  return amt;
}
export { SALARY, LIVING };
