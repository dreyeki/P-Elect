// @ts-check
/**
 * 私有財產：房子、貸款、投資。
 *
 * 政治人物的錢分成三本帳，這一本是他自己的。
 * 它不會直接決定選票，但它決定了很多事情的價錢——
 * 一個背著房貸、每個月要還四萬多的人，在面對一張支票的時候，
 * 想的事情跟一個沒有負債的人不一樣。這個系統的目的就是把那個壓力做出來。
 *
 * 三件事在這裡發生：
 *   1. 開局送一間房，同時送一筆三百萬的貸款。
 *   2. 借錢。額度看職位，因為銀行看的從來不是你這個人。
 *   3. 投資。有穩的、有好的、有一次性的行情，也有純粹的詐騙。
 */
import { clamp, clamp05 } from '../core/Formula.js';

/* ─────────── 初始化 ─────────── */

export function ensure(state) {
  state.assets ??= {
    house: null, loans: [], holdings: [], scamOffer: null,
    scamHistory: [], loanHistory: [],
  };
  state.assets.loans ??= [];
  state.assets.holdings ??= [];
  state.assets.scamHistory ??= [];
  state.assets.loanHistory ??= [];
  return state.assets;
}

/**
 * 開局就在名下的股票、土地與房產。
 *
 * 這是 v0.6.3 加的，理由很簡單：舊版把企業家的家底寫成四千萬，
 * 可是他自己的介紹寫的是千億企業創辦人。那不合理。
 *
 * 家底分成兩塊，因為現實裡本來就是兩塊：
 *   **現金**可以直接拿去用；
 *   **股票、土地、房產**名下有，但不是現金——要用就得賣，而賣有代價。
 *
 * 企業家的十幾億是自家公司的持股，而那些持股同時也是公司的控制權；
 * 政二代的底氣是三代人陸續買下來的土地，那些地平常一毛錢都變不出來。
 * 這個分法讓「有錢」跟「花得出去」變成兩件事。
 */
export function grantEstate(state, data, setup) {
  const A = ensure(state);
  const age = state.meta.year - state.player.birthYear;
  const start = data.starts.starts.find((x) => x.id === setup.startId);
  const bg = data.backgrounds.backgrounds.find((b) => b.id === setup.backgroundId);
  const specs = [...(start?.estate ?? []), ...(bg?.estate ?? [])];
  for (const e of specs) {
    const value = curveAt(e, age);
    if (value <= 0) continue;
    A.holdings.push({
      id: `${e.id}_start`,
      defId: e.id,
      name: e.name,
      kind: e.kind ?? 'realty',
      inherited: true,
      founderStake: !!e.founderStake,
      cost: Math.round(value),
      value: Math.round(value),
      since: 0,
      appreciation: e.appreciationPerYear ?? 0.02,
      liquidity: e.liquidity ?? 0.85,
      sellTax: e.sellTax ?? 0.2,
      sellStigma: e.sellStigma ?? 0,
      desc: e.desc ?? '',
      sellNews: e.sellNews ?? '',
    });
  }
  return A.holdings.filter((h) => h.inherited);
}

/** 年齡的二次函數。跟 GameState.wealthAt 是同一條式子，這裡是為了不互相 import。 */
function curveAt(w, age) {
  if (!w) return 0;
  const y = Math.max(0, age - (w.sinceAge ?? 25));
  const v = (w.base ?? 0) + (w.perYear ?? 0) * y + (w.perYear2 ?? 0) * y * y;
  return Math.min(w.cap ?? Infinity, Math.max(w.floor ?? 0, v));
}

/** 開局的自有住宅。父母幫忙付的頭期，剩下的自己揹。 */
export function grantHouse(state, data, rng, setup = null) {
  const A = ensure(state);
  const H = data.personalFinance?.housing;
  if (!H || A.house) return null;
  // 「父母幫忙付了頭期款，剩下的你自己揹」寫給素人是對的，
  // 寫給一個二十二億身家的企業家就很荒謬。有家底的起點各自帶自己的房子。
  const OV = data.starts.starts.find((x) => x.id === setup?.startId)?.housing ?? null;
  const region = state.regions[data.byId.district[state.player.homeDistrict]?.regionId];
  // 家鄉的房價會影響這間房子值多少錢，但貸款餘額是固定的——
  // 台北的房子比較貴，不代表你借得比較少，只代表你的頭期款比較痛。
  // housingPriceIndex 以全國平均 100 為基準：台北 168、雲林 55，
  // 同一筆頭期款在兩個地方買到的東西差很多，這件事本身就是台灣政治的題目。
  const priceIdx = clamp((region?.economy?.housingPriceIndex ?? 100) / 100, 0.6, 1.9);
  const base = rng.range(H.baseValueRange[0], H.baseValueRange[1]);
  A.house = {
    value: Math.round(base * priceIdx * (OV?.valueMult ?? 1) / 10000) * 10000,
    mortgage: OV?.mortgage != null ? OV.mortgage : H.mortgage,
    rate: H.mortgageRate,
    termYears: H.termYears,
    monthsPaid: 0,
    desc: OV?.descOwn ?? H.descOwn,
  };
  return A.house;
}

/* ─────────── 貸款 ─────────── */

const ANNUAL_INCOME = (state, data) => {
  const R = data.personalFinance?.loanRules?.monthlyIncomeByRole ?? {};
  return (R[state.player.role] ?? 45000) * 12;
};

export function totalDebt(state) {
  const A = ensure(state);
  return A.loans.reduce((a, l) => a + l.balance, 0) + (A.house?.mortgage ?? 0);
}
export function debtRatio(state, data) {
  return totalDebt(state) / Math.max(1, ANNUAL_INCOME(state, data));
}
export function netWorth(state) {
  const A = ensure(state);
  const inv = A.holdings.reduce((a, h) => a + h.value, 0);
  return state.finance.personal + inv + (A.house?.value ?? 0) - totalDebt(state);
}

/** 這筆貸款現在最多借得到多少 */
export function capOf(state, data, loanId) {
  const A = ensure(state);
  const def = (data.personalFinance?.loans ?? []).find((l) => l.id === loanId);
  if (!def) return 0;
  const p = state.player;

  if (def.requiresHouse) {
    if (!A.house) return 0;
    const R = data.personalFinance.housing.refinance ?? {};
    const room = A.house.value * (R.maxLTV ?? 0.8) - A.house.mortgage
      - A.loans.filter((l) => l.defId === loanId).reduce((a, l) => a + l.balance, 0);
    return Math.max(0, Math.floor(room / 10000) * 10000);
  }

  let cap = def.baseCap * (def.byRole?.[p.role] ?? 1);
  // 農會看的是你在地方上的份量，不是你的扣繳憑單
  if (def.grassrootsBonus) {
    const home = state.districts[p.homeDistrict];
    cap *= 1 + (home?.playerGrassroots ?? 0) / 5 * def.grassrootsBonus;
  }
  // 銀行看的是收入。這兩種邏輯的差別，就是台灣地方政治的一半。
  if (def.incomeMultiplier) {
    cap = Math.min(cap, ANNUAL_INCOME(state, data) / 12 * def.incomeMultiplier);
  }
  const taken = A.loans.filter((l) => l.defId === loanId).reduce((a, l) => a + l.balance, 0);
  return Math.max(0, Math.floor((cap - taken) / 10000) * 10000);
}

/** 借不借得到，以及借不到的理由 */
export function loanState(state, data, loanId) {
  const def = (data.personalFinance?.loans ?? []).find((l) => l.id === loanId);
  if (!def) return { ok: false, why: '沒有這種貸款。', cap: 0 };
  const A = ensure(state);
  if (def.requiresHouse && !A.house) return { ok: false, why: '你名下沒有房子可以拿去增貸。', cap: 0 };
  const rules = data.personalFinance?.loanRules ?? {};
  const ratio = debtRatio(state, data);
  if (ratio >= (rules.refuseRatio ?? 20)) {
    return { ok: false, why: '你身上的負債已經超過年收入的二十倍，沒有人願意再借給你。', cap: 0 };
  }
  const cap = capOf(state, data, loanId);
  if (cap < 100000) return { ok: false, why: '以你現在的身分與既有負債，額度剩不到十萬，跑一趟不划算。', cap };
  return { ok: true, cap, warn: ratio >= (rules.warnRatio ?? 12) };
}

/** 等額本息的每月攤還 */
export function monthlyPayment(principal, annualRate, years) {
  const r = annualRate / 12, n = years * 12;
  if (r <= 0) return principal / n;
  return principal * r / (1 - Math.pow(1 + r, -n));
}

export function borrow(state, data, loanId, amount) {
  const st = loanState(state, data, loanId);
  if (!st.ok) return { ok: false, msg: st.why };
  const def = data.personalFinance.loans.find((l) => l.id === loanId);
  const amt = Math.min(Math.max(100000, Math.round(amount / 10000) * 10000), st.cap);
  const A = ensure(state);

  if (def.requiresHouse) {
    // 增貸是把餘額直接加回房貸本身，利率換成增貸的那一條
    A.house.mortgage += amt;
    A.house.rate = (A.house.rate + def.rate) / 2;
  }
  A.loans.push({
    id: `${loanId}_${state.meta.turn}`,
    defId: loanId, name: def.name,
    principal: amt, balance: amt,
    rate: def.rate, termYears: def.termYears,
    monthly: Math.round(monthlyPayment(amt, def.rate, def.termYears)),
    takenTurn: state.meta.turn,
  });
  state.finance.personal += amt;
  A.loanHistory.push({ turn: state.meta.turn, id: loanId, amount: amt });

  // 農會的錢帶著人情。借的時候沒有人提條件，要用的時候才會有人打電話來。
  let extra = '';
  if (def.favorCost) {
    state.player.favorOwed = (state.player.favorOwed ?? 0) + def.favorCost;
    extra = '總幹事只說了一句「有需要再講」，那句話的意思你們都懂。';
  }
  return {
    ok: true, amount: amt,
    msg: `${def.name}核撥 ${Math.round(amt / 10000)} 萬元，每月要還 ${Math.round(monthlyPayment(amt, def.rate, def.termYears) / 1000)} 千。${extra}`,
    warn: st.warn,
  };
}

/** 提前清償一筆貸款 */
export function repay(state, data, loanRowId) {
  const A = ensure(state);
  const l = A.loans.find((x) => x.id === loanRowId);
  if (!l) return { ok: false, msg: '找不到這筆貸款。' };
  if (state.finance.personal < l.balance) return { ok: false, msg: '你的個人帳戶不夠一次還清。' };
  state.finance.personal -= l.balance;
  A.loans = A.loans.filter((x) => x.id !== loanRowId);
  return { ok: true, msg: `你把${l.name}一次還清了。少掉的那筆月付，在往後每一個決定裡都會有感覺。` };
}

/* ─────────── 投資 ─────────── */

export function investOptions(state, data) {
  const p = state.player;
  const list = [];
  for (const inv of data.personalFinance?.investments ?? []) {
    const u = inv.unlock ?? {};
    if (u.judgment != null && p.attrs.judgment < u.judgment) continue;
    list.push({ ...inv, scam: false });
  }
  // 判斷太低的人，看到的世界裡就是有這些機會。
  // 遊戲不標示哪一個是詐騙，但每一段話裡都留了線索。
  for (const sc of data.personalFinance?.scams ?? []) {
    const u = sc.unlock ?? {};
    if (u.judgmentMax != null && p.attrs.judgment > u.judgmentMax) continue;
    list.push({ ...sc, scam: true });
  }
  return list;
}

export function buy(state, data, defId, amount) {
  const A = ensure(state);
  const def = investOptions(state, data).find((x) => x.id === defId);
  if (!def) return { ok: false, msg: '你的選單裡沒有這個標的。' };
  const amt = Math.round(amount / 10000) * 10000;
  if (amt < (def.minAmount ?? 100000)) {
    return { ok: false, msg: `這個標的的最低申購是 ${Math.round((def.minAmount ?? 100000) / 10000)} 萬。` };
  }
  if (state.finance.personal < amt) return { ok: false, msg: '你的個人帳戶沒有這麼多現金。' };
  state.finance.personal -= amt;
  const row = {
    id: `${defId}_${state.meta.turn}`,
    defId, name: def.name, scam: !!def.scam,
    cost: amt, value: amt, since: state.meta.turn, busted: false,
  };
  if (def.scam) {
    const [a, b] = def.ruinTurns ?? [3, 9];
    row.bustAt = state.meta.turn + Math.round((a + b) / 2);
    row.ruinChance = def.ruinChance ?? 0.8;
    row.bustText = def.bust;
  }
  A.holdings.push(row);
  return { ok: true, msg: def.scam ? def.pitch : `你把 ${Math.round(amt / 10000)} 萬放進了${def.name}。`, row };
}

/**
 * 賣掉一筆部位。
 *
 * 一般的投資賣掉就是賣掉，家產不一樣：
 *   **稅**——土地增值稅動輒三成，證交稅只有千分之三，這個差別大到會改變決策
 *   **市場衝擊**——一塊地不是掛上去就有人接，急著脫手就要讓價
 *   **新聞**——政治人物賣祖產、創辦人減碼，這兩件事都會被寫
 *   **控制權**——創辦人賣掉的每一張都是在把公司交出去一點，剩下的也跟著縮水
 *
 * 所以「有錢」跟「花得出去」是兩件事，而這正是家底要分成現金與資產的理由。
 */
export function sell(state, data, rowId, ratio = 1) {
  const A = ensure(state);
  const h = A.holdings.find((x) => x.id === rowId);
  if (!h) return { ok: false, msg: '找不到這筆投資。' };
  const part = clamp(ratio, 0.05, 1);
  const book = h.value * part;

  // 一般投資沒有摩擦，家產有
  const liq = h.inherited ? (h.liquidity ?? 0.85) : 1;
  const tax = h.inherited ? (h.sellTax ?? 0) : 0;
  // 一次出清比分批賣更傷：急著脫手就要讓價
  const haste = h.inherited ? 1 - (1 - liq) * part : 1;
  const gross = book * haste;
  const taxed = Math.round(gross * (1 - tax));

  const costPart = h.cost * part;
  if (part >= 0.999) A.holdings = A.holdings.filter((x) => x.id !== rowId);
  else { h.value -= book; h.cost -= costPart; }
  state.finance.personal += taxed;

  const lines = [];
  const pnl = taxed - costPart;
  lines.push(part >= 0.999
    ? `你把${h.name}全部出清，入袋 ${Math.round(taxed / 10000)} 萬。`
    : `你賣掉了${h.name}的${Math.round(part * 100)}%，入袋 ${Math.round(taxed / 10000)} 萬。`);
  if (tax > 0) {
    lines.push(`光是稅就繳掉 ${Math.round(gross * tax / 10000)} 萬。這一項在賣之前很少有人真的算過。`);
  }
  if (haste < 0.98) {
    lines.push(`急著脫手讓掉了 ${Math.round(book * (1 - haste) / 10000)} 萬。想賣好價錢的人不會一次全丟出來。`);
  }

  // 創辦人減碼：剩下的持股會跟著縮水，因為市場的解讀就是這樣
  if (h.founderStake && part > 0.08) {
    const hit = clamp(part * 0.55, 0, 0.4);
    const rest = A.holdings.find((x) => x.id === rowId);
    if (rest) {
      rest.value *= 1 - hit;
      lines.push(`剩下的持股跟著縮水 ${(hit * 100).toFixed(0)}%，也就是 ${Math.round(rest.value / (1 - hit) * hit / 10000)} 萬。`);
    }
  }
  if (h.inherited && h.sellNews && part > 0.15) {
    lines.push(h.sellNews);
    if (h.sellStigma) {
      state.player.stigma = clamp05(state.player.stigma + h.sellStigma * part);
    }
  }

  return { ok: true, pnl, amount: taxed, partial: part < 0.999, msg: lines.join('\n\n') };
}

/**
 * SNDC 那一段行情。
 *
 * 開局的頭幾個月記憶體超級循環，這是一次性的，錯過就沒有了。
 * 用固定的月複利把總倍數攤平，玩家看得到它在漲，
 * 但要不要抱到最後、抱多久，是他自己的判斷——那才是判斷四的意義。
 */
function scriptedMult(def, turn) {
  const sr = def?.scriptedRun;
  if (!sr) return null;
  if (turn < sr.startTurn || turn > sr.endTurn) return null;
  const months = Math.max(1, sr.endTurn - sr.startTurn);
  return Math.pow(sr.totalMultiple, 1 / months);
}

/* ─────────── 每回合 ─────────── */

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const A = ensure(state);
  const news = [];
  const m = scaleMult;
  const PF = data.personalFinance ?? {};

  /* 房子：緩慢增值，房貸按月攤還 */
  if (A.house) {
    A.house.value *= 1 + (PF.housing?.appreciationPerYear ?? 0.025) / 12 * m;
    if (A.house.mortgage > 0) {
      const pay = monthlyPayment(A.house.mortgage, A.house.rate, Math.max(1, A.house.termYears)) * m;
      const interest = A.house.mortgage * A.house.rate / 12 * m;
      A.house.mortgage = Math.max(0, A.house.mortgage - (pay - interest));
      state.finance.personal -= pay;
      A.house.monthsPaid += m;
      if (A.house.mortgage <= 0) {
        news.push({ kind: 'finance', text: '房貸最後一期扣完了。你看著那張對帳單看了一會兒，然後把它收起來，沒有跟任何人講。' });
      }
    }
  }

  /* 貸款：按月攤還，還完就從清單消失 */
  for (const l of [...A.loans]) {
    const interest = l.balance * l.rate / 12 * m;
    const pay = Math.min(l.monthly * m, l.balance + interest);
    l.balance = Math.max(0, l.balance + interest - pay);
    state.finance.personal -= pay;
    if (l.balance <= 1) {
      A.loans = A.loans.filter((x) => x.id !== l.id);
      news.push({ kind: 'finance', text: `${l.name}還完了。你把最後那張繳款單留了下來，理由自己也講不太出來。` });
    }
  }

  /* 投資：跟著大盤走，各自加上自己的超額報酬與波動 */
  const idxNow = state.central.stockIndex;
  const idxPrev = state.flags.assetLastIndex ?? idxNow;
  const idxRet = idxPrev > 0 ? (idxNow / idxPrev - 1) : 0;
  state.flags.assetLastIndex = idxNow;

  for (const h of [...A.holdings]) {
    const def = (PF.investments ?? []).find((x) => x.id === h.defId)
      ?? (PF.scams ?? []).find((x) => x.id === h.defId);
    // 家產不在 personalFinance 的清單裡，它的參數帶在自己身上
    if (!def && !h.inherited) continue;

    if (h.scam) {
      // 帳面上一直在漲，而且漲得很漂亮。這就是它們的樣子。
      h.value *= 1 + (def.promisedReturn ?? 0.4) / 12 * m;
      if (state.meta.turn >= (h.bustAt ?? 9999) && !h.busted) {
        if (rng.bool(h.ruinChance ?? 0.8)) {
          h.busted = true;
          h.value = 0;
          A.holdings = A.holdings.filter((x) => x.id !== h.id);
          A.scamHistory.push({ turn: state.meta.turn, defId: h.defId, lost: h.cost });
          state.player.stigma = clamp05(state.player.stigma + (PF.scamRules?.stigmaOnBust ?? 0.5));
          news.push({ kind: 'finance', text: h.bustText ?? '那筆投資出事了。' });
        } else {
          // 沒爆的那一次不是你眼光好，是你運氣好
          h.bustAt = state.meta.turn + 6;
        }
      }
      continue;
    }

    // 家產走自己的增值率。土地不會因為加權指數跌了就變便宜，
    // 創辦人的持股則跟著公司走，波動比大盤大。
    if (h.inherited) {
      const drift = (h.appreciation ?? 0.02) / 12 * m;
      const vol = h.kind === 'stock' ? rng.range(-0.035, 0.035) * m : rng.range(-0.004, 0.004) * m;
      h.value = Math.max(0, h.value * (1 + drift + vol));
      continue;
    }

    const scripted = scriptedMult(def, state.meta.turn);
    if (scripted != null) {
      h.value *= Math.pow(scripted, m);
      continue;
    }
    if (def.trackIndex) {
      h.value *= 1 + idxRet + (def.excessReturn ?? 0) / 12 * m;
    } else {
      const vol = (def.volatility ?? 0) / Math.sqrt(12);
      h.value *= 1 + (def.annualReturn ?? 0) / 12 * m + (vol ? rng.range(-vol, vol) * m : 0);
    }
    h.value = Math.max(0, h.value);
  }

  /* 詐騙的推銷會自己找上判斷不高的人 */
  const offerChance = (PF.scamRules?.offerChancePerTurn ?? 0.1) * m;
  if (!A.scamOffer && state.player.attrs.judgment <= 2 && state.finance.personal > 500000
      && rng.bool(offerChance)) {
    const pool = (PF.scams ?? []).filter((sc) =>
      !A.scamHistory.some((x) => x.defId === sc.id) && state.finance.personal >= sc.minAmount);
    if (pool.length) {
      const sc = rng.pick(pool);
      A.scamOffer = { id: sc.id, name: sc.name, pitch: sc.pitch, minAmount: sc.minAmount, expiresIn: 2 };
    }
  } else if (A.scamOffer) {
    A.scamOffer.expiresIn -= m;
    if (A.scamOffer.expiresIn <= 0) A.scamOffer = null;
  }

  /* 還不出來的時候 */
  const rules = PF.loanRules ?? {};
  if (state.finance.personal < 0 && totalDebt(state) > 0
      && rng.bool((rules.collectionCallChance ?? 0.12) * m)) {
    news.push({ kind: 'finance', text: '銀行的催收專員打到服務處來，接電話的志工不知道要怎麼回答，只好說你不在。這件事很快就會有人知道。' });
    state.player.stigma = clamp05(state.player.stigma + (rules.defaultStigma ?? 1.2) * 0.15);
  }

  return { news };
}

/** 財產申報要看的是全部，不是只有現金 */
export function declarable(state) {
  return Math.round(netWorth(state));
}
