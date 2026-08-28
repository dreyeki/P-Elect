// @ts-check
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { bumpCounter, applyEffects } from './Effects.js';
import { teamBonus } from './TeamSystem.js';

export const STYLES = [
  { id: 'reason', name: '理性論述', attr: 'judgment',
    desc: '把數據攤開來一條一條講，講給聽得懂的人聽。',
    success: { integrity: 0.3, popMood: { whitecollar: 0.4, techpro: 0.5 } },
    fail: { text: '沒有人記得你今天講了什麼。' } },
  { id: 'clash', name: '激烈對撞', attr: 'eloquence', boldMin: 3,
    desc: '把音量拉高，把質詢台變成擂台，讓片段自己在網路上跑。',
    success: { fame: 0.6, popMood: { student: 0.5, bluecollar: 0.3 } },
    fail: { favorNational: -0.4, text: '中間選民只看到一個在鏡頭前發脾氣的人。' } },
  { id: 'data', name: '數據轟炸', attr: 'judgment',
    desc: '把調閱來的資料一頁一頁放上去，讓對方沒有地方閃。',
    success: { fame: 0.4, opponentDamage: 1.2 },
    fail: { integrity: -0.6, text: '你引用的那份資料被查出有誤，這件事比質詢本身還大條。' } },
  { id: 'moral', name: '道德訴求', attr: 'charisma',
    desc: '不談技術細節，只談這件事對不對得起誰。',
    success: { favorNational: 0.5, issueHeat: 1 },
    fail: { stigma: 0.3, text: '對方反問了一句「那你自己呢」，全場都笑了。' } },
  { id: 'expose', name: '爆料', attr: 'judgment', boldMin: 4,
    desc: '把手上那個資料夾打開，賭上你的信用。',
    success: { fame: 1.2, opponentDamage: 2.5 },
    fail: { stigma: 0.5, integrity: -1, text: '爆料被證實有誤，對方已經委任律師提告。' } },
];

export function styleAvailable(state, style) {
  const b = state.player.attrs.boldness;
  if (style.boldMin != null && b < style.boldMin) return false;
  return true;
}

export function prepare(state) {
  state.flags.interpPrep = clamp05((state.flags.interpPrep ?? 0) + 1.5);
}

export function run(state, data, styleId, topicId, rng) {
  const p = state.player;
  const style = STYLES.find((s) => s.id === styleId);
  if (!style || !styleAvailable(state, style)) return { ok: false, msg: '以你現在的性格，你做不出這種事。' };

  const prep = state.flags.interpPrep ?? 0;
  const intel = state.flags.intel?.[topicId] ?? 1;
  const heat = state.issues[topicId] ?? 2;
  const policyStaff = teamBonus(state, data, 'interpellationPrep');

  const mine = p.attrs[style.attr] * 8 + prep * 10 + intel * 6 + heat * 3
    + policyStaff * 4 + rng.range(-10, 10);
  const oppBase = 12 + (state.central.government.cabinetCohesion) * 3;
  const theirs = oppBase + rng.range(-10, 10) + (state.central.government.presidentParty === p.party ? -6 : 6);
  const diff = mine - theirs;

  state.flags.interpPrep = 0;
  const outcome = diff >= 30 ? 'great' : diff >= 10 ? 'good' : diff >= -9 ? 'draw' : diff >= -29 ? 'bad' : 'terrible';

  const eff = { player: {}, popMood: {}, issueHeat: {} };
  let text = '';
  if (outcome === 'great' || outcome === 'good') {
    const m = outcome === 'great' ? 1.6 : 1;
    for (const k in style.success) {
      if (k === 'popMood') for (const s in style.success.popMood) eff.popMood[s] = style.success.popMood[s] * m;
      else if (k === 'issueHeat') eff.issueHeat[topicId] = style.success.issueHeat * m;
      else if (k === 'opponentDamage') state.flags.opponentDamage = (state.flags.opponentDamage ?? 0) + style.success[k] * m;
      else eff.player[k] = style.success[k] * m;
    }
    eff.player.fame = (eff.player.fame ?? 0) + (outcome === 'great' ? 0.6 : 0.25);
    eff.player.politicalCapital = (eff.player.politicalCapital ?? 0) + (outcome === 'great' ? 25 : 10);
    text = outcome === 'great'
      ? '這一段被剪成片段之後在網路上跑了整個晚上，隔天早上的每一份報紙都放在頭版的位置。'
      : '你在質詢台上占了上風，對方的回應明顯沒有準備好，媒體給了你不小的版面。';
    if (styleId === 'data' || styleId === 'reason') bumpCounter(state, data, 'expertSpeech');
    if (styleId === 'expose') bumpCounter(state, data, 'exposeSuccess');
    if (styleId === 'clash') bumpCounter(state, data, 'aggressiveAct');
  } else if (outcome === 'draw') {
    text = '整場質詢平淡地結束，沒有人被說服，也沒有人被激怒，晚上的新聞連一秒鐘都沒有給。';
  } else {
    for (const k in style.fail) { if (k !== 'text') eff.player[k] = style.fail[k] * (outcome === 'terrible' ? 1.8 : 1); }
    eff.player.fame = (eff.player.fame ?? 0) + (outcome === 'terrible' ? 0.2 : 0);
    text = (style.fail.text ?? '') + (outcome === 'terrible'
      ? '對方的團隊已經把這一段剪好，明天開始就會出現在他們的社群帳號上。' : '');
    bumpCounter(state, data, 'interpellationFail');
  }
  applyEffects(state, data, eff, { source: 'interp' });
  return { ok: true, outcome, diff: Math.round(diff), text, style };
}

/** 答詢方 */
export const REPLIES = [
  { id: 'detail', name: '正面詳答', desc: '把數字一條一條講清楚，賭對方沒有做功課。' },
  { id: 'promise', name: '承諾改進', desc: '先把火滅掉，代價是這句話會被寫進紀錄裡。', makesPromise: true },
  { id: 'dodge', name: '迴避轉移', desc: '把問題導到另一件事上，能拖多久算多久。', boldMax: 3 },
  { id: 'counter', name: '強硬反擊', desc: '直接嗆回去，讓支持者覺得爽。', boldMin: 3 },
  { id: 'scapegoat', name: '切割下屬', desc: '把責任推給承辦人員，你自己乾淨脫身。' },
];

export function reply(state, data, replyId, topicId, rng) {
  const r = REPLIES.find((x) => x.id === replyId);
  const p = state.player;
  if (!r) return { ok: false };
  if (r.boldMin != null && p.attrs.boldness < r.boldMin) return { ok: false, msg: '你做不出這種強硬的樣子。' };
  if (r.boldMax != null && p.attrs.boldness > r.boldMax) return { ok: false, msg: '以你的性格，這種迴避只會顯得更難看。' };

  const eff = { player: {}, popMood: {} };
  let text = '';
  switch (replyId) {
    case 'detail': {
      const ok = p.attrs.judgment * 12 + rng.range(-20, 20) > 40;
      if (ok) { eff.player.integrity = 0.3; eff.player.favorNational = 0.3; text = '你把整件事從頭到尾說明了一遍，質詢的委員後來沒有再追問下去。'; }
      else { eff.player.favorNational = -0.4; text = '你講得越多，破綻就越多，最後連自己人都不太敢接話。'; }
      break;
    }
    case 'promise':
      state.promises.push({ turn: state.meta.turn, deadline: state.meta.turn + 12, topic: topicId, text: '在議場上承諾改善' });
      eff.player.favorNational = 0.3;
      text = '你當場做出承諾，現場的氣氛緩和下來，但這句話已經被逐字記錄下來了。';
      break;
    case 'dodge':
      eff.player.favorNational = -0.2;
      text = '你把問題帶到另一個方向，傷害減輕了一半，代價是隔天所有的標題都寫著答非所問。';
      break;
    case 'counter':
      eff.player.fame = 0.4; eff.popMood.student = 0.3; eff.player.favorNational = -0.5;
      bumpCounter(state, data, 'aggressiveAct');
      text = '你直接反擊回去，議場一度中斷。支持者覺得痛快，中間選民覺得可怕。';
      break;
    case 'scapegoat': {
      eff.player.stigma = 0.4;
      const t = state.team[0];
      if (t) t.loyalty = clamp05(t.loyalty - 1);
      state.central.government.cabinetCohesion = clamp05(state.central.government.cabinetCohesion - 0.5);
      text = '你把責任推給了承辦的同仁，記者會結束以後，辦公室裡沒有人跟你說話。';
      break;
    }
  }
  applyEffects(state, data, eff, { source: 'reply' });
  return { ok: true, text };
}

/** 承諾清單到期檢查 */
export function tick(state, ctx) {
  const { data, scaleMult } = ctx;
  const news = [];
  for (const pr of [...state.promises]) {
    if (state.meta.turn < pr.deadline) continue;
    if (!pr.fulfilled) {
      applyEffects(state, data, {
        player: { stigma: 0.3, favorNational: -0.4 },
        issueHeat: { [pr.topic]: 1 },
      }, { source: 'promise' });
      news.push({ kind: 'promise', text: `你當初在議場上做的承諾到今天為止都沒有兌現，對手今天拿著逐字稿開了記者會，那段影片重新在網路上流傳。` });
    }
    state.promises = state.promises.filter((x) => x !== pr);
  }
  return { news };
}
