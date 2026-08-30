// @ts-check
/**
 * 服務處。
 *
 * 台灣的地方政治有一半發生在這個房間裡。路燈不亮、水溝堵住、勞保有問題、
 * 孩子想念的學校進不去——這些事情跟法案、跟理念、跟你在電視上講的那些話都沒有關係，
 * 但它們才是選票真正的來源。
 *
 * 這個系統要做出來的東西只有一個：**負載量**。
 * 陳情案是會堆積的。人手不夠的時候，案子不會消失，它們只是排在那裡，
 * 而每一件排太久的案子最後都會變成一個對你失望的人。
 * 這就是為什麼民代要拚命請助理，也是為什麼助理費補助這件事在台灣是政治新聞。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';

export function ensure(state) {
  state.serviceDesk ??= { queue: 0, handledTotal: 0, droppedTotal: 0, lastLoad: 0 };
  return state.serviceDesk;
}

/** 掛牌的服務處有幾間 */
export function officeCount(state) {
  return Object.values(state.districts).filter((d) => d.serviceOffice).length;
}

/* ─────────── 助理費補助 ─────────── */

/**
 * 這個身分每個月拿得到多少助理費。
 *
 * 一個立委的助理是公家出錢，一個素人的幕僚是自己出錢——
 * 所以同樣一句「我請了三個助理」，在兩個身分底下是兩件完全不同的事。
 * 這個差距大到會改變玩法，而且它是台灣政治真實存在的結構。
 */
export function aideSubsidy(state, data) {
  const S = data.staffRoles?.aideSubsidy;
  if (!S) return { monthly: 0, cover: 0, note: '' };
  const row = S.byRole?.[state.player.role];
  if (!row) return { monthly: 0, cover: 0, note: '' };
  const homeD = data.byId.district[state.player.homeDistrict];
  const region = data.byId.region[state.player.office?.regionId ?? homeD?.regionId];
  const metro = region?.type === '直轄市';

  let monthly = (metro && row.metroMonthly != null) ? row.metroMonthly : row.monthly;
  // 原住民地區的村里事務補助費加兩成
  if (row.indigenousBonus && homeD?.type === 'indigenous') monthly *= 1 + row.indigenousBonus;
  return {
    monthly: Math.round(monthly),
    cover: row.cover ?? 1,
    minHires: (metro && row.metroMinHires != null) ? row.metroMinHires : row.minHires,
    maxHires: row.maxHires,
    note: row.note ?? '',
    metro,
  };
}

/** 幕僚薪水裡有多少是公家出的，多少要自己貼 */
export function payrollSplit(state, data) {
  const salaries = state.team.reduce((a, t) => a + t.salary, 0);
  const sub = aideSubsidy(state, data);
  const covered = Math.min(salaries * sub.cover, sub.monthly);
  return {
    salaries,
    subsidy: sub.monthly,
    covered: Math.round(covered),
    outOfPocket: Math.round(Math.max(0, salaries - covered)),
    unused: Math.round(Math.max(0, sub.monthly - covered)),
    sub,
  };
}

/* ─────────── 負載量 ─────────── */

/** 這個月會進來多少陳情案 */
export function inflow(state, data) {
  const T = data.tuning?.serviceDesk ?? {};
  const offices = officeCount(state);
  if (!offices) return 0;
  const p = state.player;
  let n = (T.basePerOffice ?? 14) * offices;
  // 越有名、基層越深，找上門的人越多。這是成功本身帶來的負擔。
  n *= 1 + p.fame / 5 * (T.famePull ?? 0.9);
  const grass = Object.values(state.districts)
    .filter((d) => d.serviceOffice)
    .reduce((a, d) => a + d.playerGrassroots, 0) / Math.max(1, offices);
  n *= 1 + grass / 5 * (T.grassrootsPull ?? 0.7);
  // 有公職的人被找的機會多很多——大家知道你講得上話
  n *= (T.roleMult?.[p.role] ?? 1);
  return Math.round(n);
}

/** 這個月處理得掉多少 */
export function capacity(state, data) {
  const T = data.tuning?.serviceDesk ?? {};
  const per = T.perStaff ?? 9;
  let cap = (T.selfCapacity ?? 6);
  for (const t of state.team) {
    const w = t.role === 'service' ? (T.serviceStaffMult ?? 2.2)
      : t.role === 'aide' ? (T.aideMult ?? 1.3) : (T.otherMult ?? 0.6);
    cap += per * w * (0.5 + t.ability / 5);
  }
  return Math.round(cap);
}

export function load(state, data) {
  const cap = capacity(state, data);
  const inc = inflow(state, data);
  const q = ensure(state).queue;
  return cap > 0 ? (inc + q) / cap : (inc + q > 0 ? 9 : 0);
}

/** 負載的四個檔位，畫面上用這個講話 */
export function loadWord(x) {
  if (x <= 0.6) return { key: 'idle', text: '門可羅雀', tone: 'muted' };
  if (x <= 1.0) return { key: 'ok', text: '應付得來', tone: 'tone-ok' };
  if (x <= 1.5) return { key: 'busy', text: '人手吃緊', tone: 'tone-warn' };
  if (x <= 2.2) return { key: 'over', text: '案子堆著', tone: 'tone-warn' };
  return { key: 'crisis', text: '應接不暇', tone: 'tone-bad' };
}

/* ─────────── 每回合 ─────────── */

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const D = ensure(state);
  const T = data.tuning?.serviceDesk ?? {};
  const news = [];
  const offices = officeCount(state);
  if (!offices) { D.queue = 0; D.lastLoad = 0; return { news }; }

  const inc = Math.round(inflow(state, data) * scaleMult);
  const cap = Math.round(capacity(state, data) * scaleMult);
  const pending = D.queue + inc;
  const handled = Math.min(pending, cap);
  D.queue = pending - handled;
  D.handledTotal += handled;
  D.lastLoad = cap > 0 ? pending / cap : 9;

  // 處理掉的案子會變成好感與基層。這是台灣地方政治最基本的一條迴路。
  const gain = handled * (T.favorPerCase ?? 0.0022);
  for (const d of Object.values(state.districts)) {
    if (!d.serviceOffice) continue;
    d.playerFavor = clampBi(d.playerFavor + gain / offices);
    d.playerGrassroots = clamp05(d.playerGrassroots + gain / offices * (T.grassrootsPerFavor ?? 0.6));
  }

  // 排太久的案子會爛掉，而每一件爛掉的案子都是一個對你失望的人
  if (D.queue > (T.dropThreshold ?? 40)) {
    const dropped = Math.round((D.queue - T.dropThreshold) * (T.dropRate ?? 0.35));
    D.queue -= dropped;
    D.droppedTotal += dropped;
    for (const d of Object.values(state.districts)) {
      if (!d.serviceOffice) continue;
      d.playerFavor = clampBi(d.playerFavor - dropped * (T.favorPerDrop ?? 0.004) / offices);
    }
    if (rng.bool(0.4 * scaleMult)) {
      news.push({ kind: 'personal', text: `有位里民在你的服務處等了三個小時，最後把陳情單放在桌上就走了。他跟門口的志工說「算了，你們很忙」。那句話後來傳到你耳朵裡，你連他姓什麼都不知道。` });
    }
  }

  // 人手太閒也不是好事：那代表沒有人覺得你講得上話
  if (D.lastLoad < 0.4 && state.meta.turn % 6 === 0 && offices > 0) {
    news.push({ kind: 'personal', text: '服務處這個月只接到幾件案子，值班的志工大部分時間在整理舊資料。沒有人來找你，不是因為大家都過得很好。' });
  }

  // 過載會磨損幕僚的忠誠
  if (D.lastLoad > 2 && rng.bool(0.25 * scaleMult)) {
    const t = rng.pick(state.team.filter((x) => x.role === 'service' || x.role === 'aide'));
    if (t) {
      t.loyalty = clamp05(t.loyalty - 0.4);
      news.push({ kind: 'personal', text: `${t.name}這個月又連續加班了三個週末。他沒有抱怨，但他已經很久沒有在下班之後留下來聊天了。` });
    }
  }
  return { news };
}
