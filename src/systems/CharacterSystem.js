// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { take as takeFirst } from './FirstTimeSystem.js';
import { canSet as imageDue } from './ImageSystem.js';

/**
 * 行動選單。
 * 開局只有跑攤和進修——一個沒有職位、沒有知名度、沒有團隊的人，
 * 本來就沒有太多事情可以做。其餘的隨著身分改變逐步解鎖。
 */
export const ACTIONS = [
  { id: 'canvass', name: '選區跑攤', ap: 1, fatigue: 8,
    desc: '婚喪喜慶、市場、宮廟，一場一場跑。基層是這樣一點一點長出來的。' },
  { id: 'theory', name: '組織理論', ap: 1, fatigue: 8, deferred: true,
    desc: '把零散的想法整理成一套講得出來的東西。上節目、選舉、質詢，靠的都是這個。' },

  { id: 'invitations', name: '出席邀約', ap: 0, fatigue: 0, deferred: true,
    unlock: { invites: 1 }, unlockText: '手上要有人邀你才有得出席',
    desc: '婚宴、告別式、運動會、企業活動。自己去最有用，派助理去至少人有到。' },
  { id: 'livestream', name: '開直播', ap: 1, fatigue: 6, deferred: true,
    unlock: { boldness: 3 }, unlockText: '氣魄要到「沉穩持重」才撐得住留言區',
    desc: '沒有剪接沒有重來，講錯的那一句會被單獨剪出來播一個禮拜。' },
  { id: 'streetSpeech', name: '街頭宣講', ap: 1, fatigue: 11, deferred: true,
    unlock: { boldness: 4 }, unlockText: '氣魄要到「敢作敢當」才站得上那個定點',
    desc: '站在一個沒有人有義務停下來的地方，講三十分鐘給不特定的人聽。' },

  { id: 'talkshow', name: '上政論節目', ap: 1, fatigue: 8, deferred: true,
    unlock: { invitation: true }, unlockText: '要先收到節目通告',
    desc: '同溫層會很爽，對面會很氣，中間選民會轉台。講錯一句就是明天的頭條。' },
  { id: 'showPrep', name: '節目準備', ap: 1, fatigue: 6,
    unlock: { invitation: true }, unlockText: '手上有通告才需要準備',
    desc: '把稿子背熟、把可能被問的都想過一遍，上去才不會被主持人牽著走。' },
  { id: 'presser', name: '開記者會', ap: 1, fatigue: 8,
    unlock: { fame: 1 }, unlockText: '知名度到「略有耳聞」才會有記者來',
    desc: '主動設定議題，把大家的注意力拉到你想談的那件事上。' },
  { id: 'fundraise', name: '募款', ap: 1, fatigue: 6, deferred: true,
    desc: '餐會、小額捐、拜訪建商。三種管道測量的是三件不同的事，價錢也不一樣。' },
  { id: 'rally', name: '舉辦造勢', ap: 2, fatigue: 16, deferred: true,
    unlock: { fame: 1, funds: 120000 }, unlockText: '要有一點知名度，專戶裡也要租得起場地',
    desc: '租場地、動員人、準備講稿。空著一半的場子比不辦還糟，因為鏡頭一定會拍那一半。' },
  { id: 'fastForward', name: '快轉半年', ap: 0, fatigue: 0, deferred: true,
    unlock: { noOffice: true }, unlockText: '有公職在身的人，沒有半年可以跳過去',
    desc: '把接下來半年一次過完。這半年你要拿去換錢、換身體、換學歷，還是換基層？' },
  { id: 'finances', name: '處理私人財務', ap: 0, fatigue: 0, deferred: true,
    desc: '貸款、增貸、投資。這一本帳不會直接決定選票，但它決定很多事情的價錢。' },
  { id: 'commissionPoll', name: '委託民調', ap: 1, fatigue: 4, deferred: true,
    unlock: { fame: 1, funds: 200000 }, unlockText: '要有一點知名度，專戶也要有二十萬',
    desc: '公開民調不會告訴你想知道的事。自己出錢做的那一份才會。' },
  { id: 'faction', name: '拜會派系大老', ap: 1, fatigue: 8,
    unlock: { party: true, fame: 1 }, unlockText: '要有政黨，而且對方得先聽過你',
    desc: '前輩會很客氣地泡茶給你喝，然後很自然地提起一件小事。' },
  { id: 'trainStaff', name: '培養幕僚', ap: 1, fatigue: 8,
    unlock: { team: 1 }, unlockText: '你得先有幕僚',
    desc: '好的幕僚不是找來的，是帶出來的，忠誠也是。' },
  { id: 'draftLaw', name: '研擬法案', ap: 1, fatigue: 8,
    unlock: { roles: ['councilor', 'legislator', 'mayor', 'minister', 'president'] },
    unlockText: '要有民意代表或首長的身分',
    desc: '把條文寫扎實，通過的機會才會高，也才禁得起對手挑毛病。' },
  { id: 'prepQuestion', name: '質詢準備', ap: 1, fatigue: 8,
    unlock: { roles: ['councilor', 'legislator'] }, unlockText: '要當上議員或立委才有質詢權',
    desc: '把資料讀熟、把數字背下來，上台才不會被反問到啞口無言。' },
  { id: 'visit', name: '出訪參訪', ap: 2, fatigue: 15,
    unlock: { roles: ['councilor', 'legislator', 'mayor', 'minister', 'president'] },
    unlockText: '要有公職身分才排得到行程',
    desc: '出去一趟很累，但回來以後你講的話會不太一樣。' },
  { id: 'setImage', name: '主打形象', ap: 1, fatigue: 4, deferred: true,
    unlock: { fame: 1, imageDue: true }, unlockText: '沒人認識你的時候，主打什麼都沒有意義',
    desc: '決定你要讓人記住哪一句話。一句話要立起來要兩年，這兩年之內不用再決定一次。' },
  { id: 'retire', name: '退出政壇', ap: 0, fatigue: 0, deferred: true,
    unlock: { minTurn: 12 }, unlockText: '才剛開始就要走，這句話沒有份量',
    desc: '把位子交出去，把服務處收掉，然後看看自己這些年到底留下了什麼。' },
  { id: 'dealmaking', name: '私下協商', ap: 2, fatigue: 15,
    unlock: { fame: 2, politicalCapital: 40 }, unlockText: '要有一定份量，別人才願意跟你談',
    desc: '有些事在檯面上永遠談不成，但在檯面下十分鐘就有結論。' },
];

/** 這個行動現在能不能做，以及為什麼不能 */
export function actionState(state, data, a) {
  if (!a.unlock) return { unlocked: true };
  const u = a.unlock, p = state.player;
  if (u.fame != null && p.fame < u.fame) return { unlocked: false, why: a.unlockText };
  if (u.party && !p.party) return { unlocked: false, why: a.unlockText };
  if (u.team != null && state.team.length < u.team) return { unlocked: false, why: a.unlockText };
  if (u.funds != null && state.finance.campaign < u.funds) return { unlocked: false, why: a.unlockText };
  if (u.politicalCapital != null && p.politicalCapital < u.politicalCapital) return { unlocked: false, why: a.unlockText };
  if (u.roles && !u.roles.includes(p.role)) return { unlocked: false, why: a.unlockText };
  if (u.invitation && !(state.invitations ?? []).length) return { unlocked: false, why: a.unlockText };
  if (u.invites != null && (state.socialInvites ?? []).length < u.invites) return { unlocked: false, why: a.unlockText };
  if (u.boldness != null && p.attrs.boldness < u.boldness) return { unlocked: false, why: a.unlockText };
  if (u.minTurn != null && state.meta.turn < u.minTurn) return { unlocked: false, why: a.unlockText };
  // 形象兩年才需要重新決定一次。中間這段時間不是不能改，是不該改——
  // 把選項收起來，玩家就不會每個月都在那裡猶豫一件本來就該放著的事。
  // 有公職的人每個月都有非做不可的事，快轉這個選項對他沒有意義
  if (u.noOffice) {
    const blocked = data.fastForward?.blockedRoles ?? [];
    if (blocked.includes(p.role) || state.election || state.meta.scale === 'week') {
      return { unlocked: false, why: a.unlockText };
    }
  }
  if (u.imageDue && !imageDue(state, data)) {
    return { unlocked: false, why: '這句話才剛立起來，現在改只會讓人覺得你沒有中心思想' };
  }
  return { unlocked: true };
}

export function availableActions(state, data) {
  return ACTIONS.filter((a) => actionState(state, data, a).unlocked);
}
export function lockedActions(state, data) {
  return ACTIONS.map((a) => ({ a, st: actionState(state, data, a) })).filter((x) => !x.st.unlocked);
}

/**
 * 每回合的行動點。
 *
 * 固定兩點，不因為職位、團隊、體力或疲勞而變動。
 * 一個縣市長一個月能親自做的事情，並不會比一個素人多——
 * 差別在於他做的每一件事份量比較重，而不是他能做比較多件。
 * 把這個數字鎖死，玩家的每一次取捨才是真的取捨。
 *
 * 硬撐的空間留在 maxAPWithOverdraft，那是另一回事：
 * 那不是你變得比較有時間，是你把身體先借出去用。
 */
export function apOf(state, data) {
  return Math.max(1, data.tuning?.actionPoints?.fixed
    ?? data.tuning?.start?.baseAP ?? data.meta.baseAP);
}

/** 可以硬撐的上限：行動點用完之後還能再借幾點 */
export function maxAPWithOverdraft(state, data) {
  const T = data.tuning?.actionPoints ?? {};
  return apOf(state, data) + (T.allowOverdraft === false ? 0 : (T.maxOverdraft ?? 2));
}

export function fatigueLevel(state) { return clamp05(state.player.fatigueRaw / 24); }

export function tick(state, ctx) {
  const { rng, scaleMult, data } = ctx;
  const p = state.player;
  const news = [];
  const age = state.meta.year - p.birthYear;
  const TF = data.tuning?.fatigue ?? {};
  const AGE = TF.agePenalty ?? { 55: 4, 65: 8, 75: 14 };
  const agePenalty = age >= 75 ? AGE['75'] : age >= 65 ? AGE['65'] : age >= 55 ? AGE['55'] : 0;

  p.fatigueRaw = clamp(p.fatigueRaw
    - ((TF.recoverBase ?? 10) + p.attrs.stamina * (TF.recoverPerStamina ?? 4) - agePenalty) * scaleMult, 0, 120);
  // 沒有人會一直記得你。知名度會慢慢退回去，
  // 但地方上原本就認得你的那一點基礎不會消失，所以設一個地板。
  if (p.fame > 1.2) p.fame = Math.max(1.2, p.fame - 0.018 * scaleMult);
  p.favorNational *= 1 - 0.012 * scaleMult;

  if (p.hospitalTurns > 0) {
    p.hospitalTurns -= 1;
    if (p.hospitalTurns === 0) news.push({ kind: 'personal', text: '你出院了。醫生要你至少一個月不要排早餐會報，你笑著答應，但心裡已經在算下週的行程。' });
    return { news, hospitalized: true };
  }

  const risk = Math.max(0, (p.fatigueRaw - (TF.hospitalThreshold ?? 45)) / (TF.hospitalRiskDivisor ?? 150))
    * (1 + (5 - p.attrs.stamina) * (TF.hospitalStaminaFactor ?? 0.18))
    * (1 + agePenalty / 20);
  if (risk > 0 && rng.bool(clamp(risk, 0, 0.6) * scaleMult)) {
    p.hospitalTurns = p.fatigueRaw > 90 ? 3 : p.fatigueRaw > 70 ? 2 : 1;
    p.fatigueRaw = 0;
    p.favorNational = clamp(p.favorNational + 1, -5, 5);
    if (rng.bool(TF.permanentStaminaLossChance ?? 0.2)) {
      p.attrs.stamina = clamp05(p.attrs.stamina - 1);
      news.push({ kind: 'personal', text: `你在辦公室昏倒，被送進急診。醫生說這次是警訊，下次不見得會這麼幸運，你的身體已經回不到從前的狀態了。` });
    } else {
      news.push({ kind: 'personal', text: `連續幾週的行程把你壓垮了，你住院了 ${p.hospitalTurns} 個回合。支持者送來的花把病房堆滿，對手則在這段時間推進了他們的議程。` });
    }
    return { news, hospitalized: true };
  }
  return { news };
}

/**
 * 執行一個行動。
 * 標記為 deferred 的行動只是「打開選單」，這一步不扣行動點——
 * 玩家看完之後決定不做，不應該白白損失一個月。
 * 真正做下去的時候由呼叫端再叫一次 commit()。
 */
export function doAction(state, data, actionId, payload = {}) {
  const a = ACTIONS.find((x) => x.id === actionId);
  if (!a) return { ok: false, msg: '沒有這個行動。' };
  if (a.deferred) {
    const left = maxAPWithOverdraft(state, data) - state.player.apUsed;
    if (a.ap > left) return { ok: false, msg: '真的撐不住了，這個月再怎麼硬排也排不下。' };
    return { ok: true, deferred: true, action: a, payload };
  }
  return spendAP(state, data, a.ap, a.fatigue, { action: a, payload });
}

/**
 * 真的做下去了，這時才扣行動點。
 *
 * firstKey 是給選單型行動用的：募款底下有三種管道，
 * 第一次辦餐會跟第一次去拜訪建商是兩件完全不同的事，
 * 專屬文本自然也不該共用同一個計數器。
 */
export function commit(state, data, actionId, firstKey = null) {
  const a = ACTIONS.find((x) => x.id === actionId);
  if (!a) return { ok: false, msg: '沒有這個行動。' };
  return spendAP(state, data, a.ap, a.fatigue, { action: a, firstKey });
}

/**
 * 花行動點。用完之後還可以再硬撐幾點，
 * 但每超支一點都有機率讓你在這個月的某個晚上突然覺得撐不下去。
 */
export function spendAP(state, data, ap, fatigue = 0, extra = {}) {
  const T = data.tuning?.actionPoints ?? {};
  const p = state.player;
  const normal = apOf(state, data);
  const hardMax = maxAPWithOverdraft(state, data);
  if (p.apUsed + ap > hardMax) {
    return { ok: false, msg: '真的撐不住了，這個月再怎麼硬排也排不下。' };
  }
  // 行動點真的被扣掉的這一刻，才算這個行動做過一次。
  // 打開選單看一看不算——deferred 的行動走的是 commit()，也會到這裡。
  const first = extra.action ? takeFirst(state, data, extra.firstKey ?? extra.action.id) : null;
  // 放進 flags 讓任何一個結果視窗都撿得到——deferred 的行動有八個不同的收尾點，
  // 逐一把回傳值接過去只會漏掉其中幾個。
  if (first) state.flags.pendingFirst = first;

  const before = Math.max(0, p.apUsed - normal);
  p.apUsed += ap;
  const after = Math.max(0, p.apUsed - normal);
  const over = after - before;
  p.fatigueRaw = clamp(p.fatigueRaw + fatigue, 0, 120);
  let overdraftHit = 0;
  if (over > 0) {
    const rng = state._apRng ?? null;
    for (let i = 0; i < over; i++) {
      const roll = rng ? rng.next() : Math.random();
      if (roll < (T.overdraftFatigueChance ?? 0.55)) overdraftHit += T.overdraftFatiguePerPoint ?? 14;
    }
    p.fatigueRaw = clamp(p.fatigueRaw + overdraftHit, 0, 120);
  }
  return { ok: true, over, overdraftHit, first, ...extra };
}

/**
 * 屬性成長：累積到門檻才會跳一級。
 * 另有一套里程碑機制在 CanvassSystem.bumpCounter——
 * 做同一件事做到一定次數，那件事需要的能力會自己長出來。
 */
export function study(state, attr) {
  const key = 'study_' + attr;
  state.flags[key] = (state.flags[key] ?? 0) + 1;
  const need = 4 + state.player.attrs[attr] * 4;
  if (state.flags[key] >= need) {
    state.flags[key] = 0;
    state.player.attrs[attr] = clamp05(state.player.attrs[attr] + 1);
    return true;
  }
  return false;
}

/** 氣魄決定哪些選項會出現：太慫的做不到，太衝的做不出退縮的樣子 */
export function boldnessAllows(state, opt) {
  const b = state.player.attrs.boldness;
  if (opt.boldMin != null && b < opt.boldMin) return false;
  if (opt.boldMax != null && b > opt.boldMax) return false;
  return true;
}
