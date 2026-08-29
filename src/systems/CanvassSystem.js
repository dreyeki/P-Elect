// @ts-check
/**
 * 跑攤。
 *
 * 這是這個遊戲裡最常被按下去的一個按鈕，所以它最不能重複。
 * 二十二個場景乘以三種結果共六十六段文本，配上一個不重複佇列，
 * 玩家連續跑六十次都不會看到同一段話。
 *
 * 表現得夠好的場子，對方會問你要不要固定來。答應之後那個場子
 * 每回合自動扣一點行動點、穩定產出基層，而且不再跳文本——
 * 因為同一段話看第二次，就是在浪費玩家的時間。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';

/**
 * 這個選區跑得到的場景。
 * 都市化決定哪些場合在這裡存在——臺東沒有捷運站出口，信義區沒有漁港碼頭。
 * slack 是放寬的幅度：候選人本來就會往鄰近的鄉鎮跑，
 * 這讓最偏遠的選區也湊得出六十段不重複的文本，而不必扭曲表現的機率。
 */
export function scenesFor(data, district, gigs = new Set(), slack = 0) {
  return data.canvass.scenes.filter((sc) => {
    if (gigs.has(sc.id)) return false;                 // 已經固定跑的場子不再抽
    const [lo, hi] = sc.urbanity;
    return district.urbanity >= lo - slack && district.urbanity <= hi + slack;
  });
}

const MEMBER_ROLES = ['councilor', 'legislator', 'mayor', 'minister', 'president'];

/**
 * 這一段話現在說得通嗎。
 *
 * 兩件事會讓它說不通：
 * 一是它假設有人記得你來過，但畫面上方正掛著「第一次」的敘述——兩段會互相打臉；
 * 二是它假設你有服務處或民代身分，而你其實兩個都沒有。
 * 沒有服務處的人留不下服務處的電話，不是民代的人也沒有議事堂可以站上去。
 */
export function textFits(state, sc, branchIndex, firstTimeActive) {
  const b = sc.branches[branchIndex];
  if (!b) return false;
  if (b.assumesHistory && firstTimeActive) return false;
  for (const req of [sc.requires, b.requires]) {
    if (req === 'office') {
      const d = state.districts[state.player.homeDistrict];
      const hasOffice = d?.serviceOffice || MEMBER_ROLES.includes(state.player.role);
      if (!hasOffice) return false;
    }
    if (req === 'member' && !MEMBER_ROLES.includes(state.player.role)) return false;
  }
  return true;
}

/**
 * 這一次跑得怎麼樣。不是純擲骰，屬性與基層都真的算進去。
 * 回傳 0（漂亮）／1（普通）／2（出狀況）。
 */
export function rollBranch(state, data, districtId, rng) {
  const R = data.canvass.branchRoll;
  const a = state.player.attrs;
  const grass = state.districts[districtId]?.playerGrassroots ?? 0;
  const fat = state.player.fatigueRaw;
  const good = clamp(R.goodBase + a.sociability * R.socia + a.charisma * R.charisma
    + a.eloquence * R.eloquence + grass * R.grass - fat * R.fatiguePenalty, 0.03, 0.72);
  const bad = clamp(R.badBase + (a.sociability + a.charisma + a.eloquence) * R.badPerAttr
    + fat * R.badPerFatigue, 0.02, 0.55);
  const roll = rng.next();
  if (roll < good) return 0;
  if (roll > 1 - bad) return 2;
  return 1;
}

/**
 * 挑場景。
 *
 * 先擲出這一次的表現，再從還沒出現過這個結果的場景裡挑一個——
 * 順序反過來的話，同一個場景的三種結果會互相排擠，
 * 玩家在鄉下選區跑不到二十次就開始看到重複的段落。
 * 表現本身不受影響，被調整的只是「這一次發生在哪裡」。
 */
export function pickScene(state, data, districtId, rng, branchIndex, firstTimeActive = false) {
  const d = data.byId.district[districtId];
  const recent = state.flags.canvassRecent ??= [];
  const seen = new Set(recent);
  const gigs = new Set((state.canvassGigs ?? []).map((g) => g.sceneId));
  const fits = (sc, bi) => textFits(state, sc, bi, firstTimeActive);

  // 第一步：本地就有、說得通、而且還沒出現過這個結果的場合。
  // 絕大多數情況在這裡就結束了。
  for (const slack of [0, 1, 2]) {
    const pool = scenesFor(data, d, gigs, slack).filter((sc) => fits(sc, branchIndex));
    const fresh = pool.filter((sc) => !seen.has(sc.id + ':' + branchIndex));
    if (fresh.length) return { scene: rng.pick(fresh), branchIndex };
  }

  // 第二步：這個結果在附近每一種場合都發生過了。
  // 與其讓玩家看第二次同樣的段落，不如讓這一次的結果往旁邊挪一格——
  // 跑遍所有場子都是同一種收穫，本來也不太合理。
  const wide = scenesFor(data, d, gigs, 2);
  const order = branchIndex === 1 ? [0, 2] : [1, branchIndex === 0 ? 2 : 0];
  for (const bi of order) {
    const pool = wide.filter((sc) => fits(sc, bi));
    const fresh = pool.filter((sc) => !seen.has(sc.id + ':' + bi));
    if (fresh.length) return { scene: rng.pick(fresh), branchIndex: bi };
  }

  // 第三步：真的全部跑遍了，挑最久沒看過而且說得通的那一段
  const usable = wide.filter((sc) => fits(sc, branchIndex));
  const pool = usable.length ? usable : wide.filter((sc) => fits(sc, 1));
  if (!pool.length) return { scene: data.canvass.scenes[0], branchIndex: 1 };
  const bi = usable.length ? branchIndex : 1;
  let oldest = pool[0], oldestPos = Infinity;
  for (const sc of pool) {
    const pos = recent.lastIndexOf(sc.id + ':' + bi);
    if (pos < oldestPos) { oldestPos = pos; oldest = sc; }
  }
  return { scene: oldest, branchIndex: bi };
}

/**
 * 跑一攤。回傳這一次的文本與結果，並記進不重複佇列。
 */
export function run(state, data, districtId, rng) {
  // 前兩次跑攤時，畫面上方掛著「第一次」「第二次」的專屬敘述。
  // 那兩次底下就不能出現有人記得你來過的段落，否則兩段會互相打臉。
  // 門檻直接讀 firstTimes 的設定，兩邊才不會各改各的而失去同步。
  const visits = state.actionCount?.canvass ?? 0;
  const firstTimeActive = visits <= (data.firstTimes?.occurrences ?? 2);
  const rolled = rollBranch(state, data, districtId, rng);
  const { scene, branchIndex: bi } = pickScene(state, data, districtId, rng, rolled, firstTimeActive);
  const br = scene.branches[bi];
  const key = scene.id + ':' + bi;

  const recent = state.flags.canvassRecent ??= [];
  recent.push(key);
  while (recent.length > (data.canvass.noRepeatWindow ?? 60)) recent.shift();

  const q = br.q;
  const TG = data.tuning?.grassroots ?? {};
  const base = TG.canvassGain ?? 0.2;
  const mult = q > 0 ? (TG.canvassGoodMult ?? 1.9) : q < 0 ? (TG.canvassBadMult ?? 0.35) : 1;

  const d = state.districts[districtId];
  const gain = base * mult;
  d.playerGrassroots = clamp05(d.playerGrassroots + gain);
  d.playerFavor = clampBi(d.playerFavor + 0.25 * mult);
  if (q < 0) state.player.fame = clamp05(state.player.fame - 0.03);
  else state.player.fame = clamp05(state.player.fame + 0.02 * mult);

  // 這一攤特別打得到哪些人：把好感押在該場合的主力階層上
  applyStrataFavor(state, data, districtId, scene.strata ?? {}, 0.22 * mult);

  // 跑攤累積會換到交際
  const milestone = bumpCounter(state, data, 'canvass');

  // 表現漂亮的場子，對方會問你要不要固定來
  let gig = null;
  const SG = data.canvass.standingGig;
  if (q > 0 && (state.canvassGigs?.length ?? 0) < SG.maxSlots
      && d.playerGrassroots >= SG.requiresGrassroots && rng.bool(SG.chancePerGoodRun)) {
    gig = { sceneId: scene.id, name: scene.name, districtId, since: state.meta.turn, active: false };
  }

  return { scene, branchIndex: bi, quality: q, text: br.text, lead: scene.lead, gain, gig, milestone };
}

function applyStrataFavor(state, data, districtId, strata, amount) {
  const di = data.districts.districts.findIndex((x) => x.id === districtId);
  if (di < 0) return;
  const P = state.pops;
  for (let i = 0; i < P.n; i++) {
    if (P.district[i] !== di) continue;
    const sid = data.strataIds[P.stratum[i]];
    P.playerFavor[i] = clampBi(P.playerFavor[i] + amount * (strata[sid] ?? 1) * 0.5);
  }
}

/**
 * 屬性成長的里程碑。
 * 做同一件事做到一定次數，那件事需要的能力就會自己長出來——
 * 這比坐在房間裡「進修」要合理得多。
 */
export function bumpCounter(state, data, kind) {
  const M = data.tuning?.milestones ?? {};
  const map = {
    canvass: { key: 'cntCanvass', need: M.canvassForSociability ?? 5, attr: 'sociability',
      text: '跑了這麼多場之後，你發現自己已經能在三十秒之內判斷一桌人裡誰說了算。交際變好了。' },
    show: { key: 'cntShow', need: M.showsForEloquence ?? 5, attr: 'eloquence',
      text: '上了幾次節目之後，你不再需要看小抄也能把一段話講得有頭有尾。口才變好了。' },
    theory: { key: 'cntTheory', need: M.theoriesForJudgment ?? 1, attr: 'judgment',
      text: '把想法整理成一套講得出來的東西，這件事本身就改變了你看問題的方式。判斷變好了。' },
    stream: { key: 'cntStream', need: M.streamsForBoldness ?? 8, attr: 'boldness',
      text: '被留言區洗過那麼多次以後，你上台之前已經不會手抖了。氣魄變好了。' },
  };
  const m = map[kind];
  if (!m) return null;
  const c = state.counters[m.key] = (state.counters[m.key] ?? 0) + 1;
  if (c !== m.need) return null;          // 只在剛好跨過門檻那一次給
  const before = state.player.attrs[m.attr];
  state.player.attrs[m.attr] = clamp05(before + 1);
  if (state.player.attrs[m.attr] === before) return null;
  return { attr: m.attr, text: m.text };
}

/** 常駐通告：每回合自動跑，不再跳文本 */
export function tickGigs(state, data) {
  const gigs = (state.canvassGigs ?? []).filter((g) => g.active);
  if (!gigs.length) return { news: [] };
  const SG = data.canvass.standingGig;
  for (const g of gigs) {
    const d = state.districts[g.districtId];
    if (!d) continue;
    d.playerGrassroots = clamp05(d.playerGrassroots + SG.grassrootsPerTurn);
    d.playerFavor = clampBi(d.playerFavor + SG.favorPerTurn);
  }
  return { news: [] };
}

/** 常駐通告佔用的行動點，在回合開始就先扣掉 */
export function gigAPCost(state, data) {
  const n = (state.canvassGigs ?? []).filter((g) => g.active).length;
  return n * (data.canvass?.standingGig?.apCost ?? 1);
}
