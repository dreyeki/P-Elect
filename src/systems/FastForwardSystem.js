// @ts-check
/**
 * 快轉半年。
 *
 * 一個沒有職位的人，一個月能做的事情就是那幾件。連按十二次結束回合
 * 不會讓故事變好，只會讓玩家覺得這個遊戲在浪費他的時間。
 * 所以給他一個把半年一次過完的選項，並且讓他決定這半年要拿去換什麼：
 * 錢、身體、學歷，還是基層。
 *
 * 快轉不是暫停。世界照常運轉——別人的生涯在累積，經濟在跑，
 * 沒有你的選舉一樣會開票。這才是這個選項真正的代價。
 */
import { clamp, clamp05 } from '../core/Formula.js';

export function config(data) { return data.fastForward ?? {}; }
export function options(data) { return config(data).options ?? []; }

/** 現在能不能快轉，以及為什麼不能 */
export function state(st, data) {
  const C = config(data);
  if ((C.blockedRoles ?? []).includes(st.player.role)) {
    return { ok: false, why: C.blockedText };
  }
  if (st.election) return { ok: false, why: C.electionText };
  if (st.meta.scale === 'week') return { ok: false, why: C.electionText };
  // 選舉就在眼前的時候不給跳，否則玩家會一路快轉過自己的登記日
  const { months } = monthsToElection(st, data);
  if (months != null && months <= (C.months ?? 6)) {
    return { ok: false, why: C.electionText };
  }
  return { ok: true };
}

function monthsToElection(st, data) {
  const { year, month } = st.meta;
  for (const s of data.elections.schedule) {
    const diff = (s.year - year) * 12 + (s.month - month);
    if (diff >= 0) return { months: diff, sched: s };
  }
  return { months: null, sched: null };
}

/** 這條進修路線的下一階，以及還要念幾個學期 */
export function nextDegree(st, data) {
  const E = config(data).education ?? {};
  const ladder = E.ladder ?? [];
  const cur = st.player.education;
  const i = ladder.indexOf(cur);
  // 海外名校之類的學歷不在階梯上，那條路已經走完了
  if (i < 0 || i >= ladder.length - 1) return null;
  const next = ladder[i + 1];
  const step = E.steps?.[next];
  if (!step) return null;
  const done = st.player.eduTerms ?? 0;
  return { degree: next, step, done, left: Math.max(0, step.terms - done) };
}

/**
 * 真的跳過去。
 *
 * 每個月照樣跑一次完整的模擬管線，所以世界不會因為玩家沒有在看就停下來。
 * 中途只要出現選舉、住院或大事，就停在那一個月——
 * 快轉是一種方便，不該變成一種讓玩家錯過東西的機制。
 */
export function run(st, data, optionId, advance, rng) {
  const C = config(data);
  const opt = options(data).find((o) => o.id === optionId);
  if (!opt) return { ok: false, msg: '沒有這個選項。' };
  const gate = state(st, data);
  if (!gate.ok) return { ok: false, msg: gate.why };

  const total = C.months ?? 6;
  const p = st.player;
  const home = st.districts[p.homeDistrict];
  const SAL = data.fastForward?.incomeByRole ?? null;
  const lines = [];
  let months = 0, interrupted = null;

  // 進修在跳之前先結帳，錢不夠就當場擋下來
  let deg = null;
  if (optionId === 'FF_STUDY') {
    deg = nextDegree(st, data);
    if (!deg) return { ok: false, msg: (C.education?.topText) ?? '你的學歷已經到頂了。' };
    if (st.finance.personal < deg.step.tuitionPerTerm) {
      return { ok: false, msg: `這個學期的學費是 ${Math.round(deg.step.tuitionPerTerm / 10000)} 萬，你現在付不出來。` };
    }
    st.finance.personal -= deg.step.tuitionPerTerm;
  }

  for (let i = 0; i < total; i++) {
    // 這半年你在做的事
    if (opt.incomeMult) {
      const base = (data.fastForward?.baseIncome ?? 55000);
      st.finance.personal += Math.round(base * opt.incomeMult);
    }
    if (opt.costPerMonth) st.finance.personal -= opt.costPerMonth;
    if (opt.fatiguePerMonth) p.fatigueRaw = clamp(p.fatigueRaw + opt.fatiguePerMonth, 0, 120);
    if (opt.fameDrift) p.fame = clamp05(p.fame + opt.fameDrift);
    if (opt.grassrootsDrift && home) {
      home.playerGrassroots = clamp05(home.playerGrassroots + opt.grassrootsDrift);
    }
    if (opt.grassrootsGain && home) {
      // 蹲點的回報遞減：越深的基層越難再往上長一格
      const room = (5 - home.playerGrassroots) / 5;
      home.playerGrassroots = clamp05(home.playerGrassroots + opt.grassrootsGain / total * (0.4 + room));
    }

    const res = advance(st, data) ?? {};
    months += 1;
    if (res.news?.length) lines.push(...res.news.slice(0, 2).map((n) => n.text));

    // 最後一個月不算被打斷——半年已經過完了，
    // 那時候才冒出來的事情屬於下一個回合，不該讓玩家以為自己被截斷了。
    const last = i === total - 1;
    if (st.election) { if (!last) interrupted = 'election'; break; }
    if (p.hospitalTurns > 0) { if (!last) interrupted = 'hospital'; break; }
    if ((st.pendingEvents ?? []).length >= (C.eventInterruptAt ?? 5)) {
      if (!last) interrupted = 'event';
      break;
    }
  }

  /* 這半年換到了什麼 */
  const gains = [];
  if (opt.fatigueClear) { p.fatigueRaw = 0; gains.push('身體終於歸零了'); }
  if (opt.staminaChance && rng.bool(opt.staminaChance)) {
    p.attrs.stamina = clamp05(p.attrs.stamina + 1);
    gains.push('體力＋1');
  }
  if (opt.sociabilityChance && rng.bool(opt.sociabilityChance)) {
    p.attrs.sociability = clamp05(p.attrs.sociability + 1);
    gains.push('交際＋1');
  }

  // 學期照算。被一則新聞打斷不會讓你的課白上，
  // 只有第一個月就停下來（等於根本沒開學）才把學費退回去。
  let degreeDone = null;
  if (deg && months === 0) st.finance.personal += deg.step.tuitionPerTerm;
  else if (deg) {
    p.eduTerms = (p.eduTerms ?? 0) + 1;
    if (p.eduTerms >= deg.step.terms) {
      p.education = deg.degree;
      p.eduTerms = 0;
      degreeDone = deg.degree;
      p.attrs[deg.step.attr] = clamp05(p.attrs[deg.step.attr] + 1);
      p.fame = clamp05(p.fame + (deg.step.fameGain ?? 0));
      gains.push(`${deg.degree}到手，${attrName(deg.step.attr)}＋1`);
    } else {
      gains.push(`${deg.degree}還要念 ${deg.step.terms - p.eduTerms} 個學期`);
    }
  }

  /* 敘述 */
  let text = opt.text;
  if (optionId === 'FF_WORK' && st.finance.personal < 0) text = opt.textPoor ?? text;
  if (optionId === 'FF_REST' && p.attrs.stamina <= 2) text = opt.textSick ?? text;
  if (optionId === 'FF_GROUND' && (home?.playerGrassroots ?? 0) < 1.5) text = opt.textThin ?? text;
  if (degreeDone) text = (C.education?.doneText ?? '{degree}').replace('{degree}', degreeDone);

  return {
    ok: true, months, interrupted, text, gains,
    interruptText: interrupted ? C.interrupt?.[interrupted] : '',
    news: lines.slice(0, 6),
    name: opt.name,
  };
}

function attrName(id) {
  return { stamina: '體力', sociability: '交際', charisma: '魅力',
    eloquence: '口才', judgment: '判斷', boldness: '氣魄' }[id] ?? id;
}
