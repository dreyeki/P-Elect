// @ts-check
/**
 * 政論節目。
 * 沒有通告就上不了節目——這是知名度在遊戲裡最真實的門檻。
 */
import { clamp, clamp05, clampBi } from '../core/Formula.js';
import { bumpCounter } from './Effects.js';
import { bumpCounter as bumpAttr } from './CanvassSystem.js';
import { teamBonus } from './TeamSystem.js';
import * as Theory from './TheorySystem.js';

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  state.invitations ??= [];
  const news = [];

  // 舊通告過期
  state.invitations = state.invitations.filter((i) => (i.expiresIn -= 1) > 0);

  const p = state.player;
  const hotIssue = Object.entries(state.issues).sort((a, b) => b[1] - a[1])[0];

  for (const show of data.shows.shows) {
    if (state.invitations.some((i) => i.showId === show.id)) continue;
    if (p.fame < show.fameNeed) continue;
    const media = state.media[show.mediaId];
    const rel = media?.playerRelation ?? 0;

    // 台灣的政論節目各有各的主場。製作單位平常找的就是自己觀眾想看的那一邊，
    // 所以同一個人掛不同的黨籍，收到的通告完全不是同一批。
    // 偶爾找對面的人來當沙包是另一回事，那個機率壓低但不會是零。
    const myLean = p.party ? (state.parties[p.party]?.platform.unification ?? 0) : 0;
    const affinity = 1 - Math.abs(show.bias - myLean) / 12;
    const partyPull = p.party ? (show.partyAffinity?.[p.party] ?? 1) : 0.85;
    let chance = (0.05
      + p.fame * 0.055
      + affinity * 0.14
      + rel * 0.02
      + (state.flags.recentBuzz ?? 0) * 0.05
      - show.difficulty * 0.012) * partyPull;
    if (state.meta.scale === 'week') chance *= 1.7;      // 選戰期大家都在搶來賓
    if (p.stigma >= 3) chance *= show.riskBonus ? 1.6 : 0.7;   // 爆料節目反而更想找你

    if (rng.bool(clamp(chance, 0, 0.55) * (state.meta.scale === 'week' ? 1 : scaleMult))) {
      state.invitations.push({
        showId: show.id, showName: show.name,
        topic: hotIssue[0], topicName: data.byId.issue[hotIssue[0]].name,
        expiresIn: state.meta.scale === 'week' ? 2 : 2,
        turn: state.meta.turn,
      });
    }
  }
  state.flags.recentBuzz = Math.max(0, (state.flags.recentBuzz ?? 0) - 0.4 * scaleMult);
  if (state.invitations.length > 5) state.invitations = state.invitations.slice(-5);
  return { news };
}

/** 上節目：表現分決定一切 */
export function appear(state, data, showId, rng, theoryId = null) {
  const inv = state.invitations.find((i) => i.showId === showId);
  if (!inv) return { ok: false, msg: '你手上沒有這個節目的通告。' };
  const show = data.byId.show[showId];
  const p = state.player;

  // 引用理論：講得出一套東西的人，在節目上的份量完全不一樣
  let theoryBonus = 0, theoryDef = null;
  if (theoryId && Theory.has(state, theoryId)) {
    theoryDef = data.byId.theory[theoryId];
    theoryBonus = Theory.citeBonus(state, data, theoryId, inv.topic) * 7;
    Theory.use(state, data, theoryId);
  }

  const prep = state.flags.showPrep ?? 0;
  const spokesperson = teamBonus(state, data, 'mediaFrame');
  const score = theoryBonus + p.attrs.eloquence * 11
    + p.attrs.judgment * 6
    + p.attrs.charisma * 5
    + prep * 6
    + spokesperson * 22
    + (state.issues[inv.topic] ?? 2) * 2
    - show.difficulty * 8
    + rng.range(-16, 16);

  const perf = clamp05(Math.round((score - 8) / 11));
  state.invitations = state.invitations.filter((i) => i !== inv);
  state.flags.showPrep = 0;
  state.flags.recentBuzz = clamp((state.flags.recentBuzz ?? 0) + 0.5 + perf * 0.3, 0, 4);

  // 觀眾組成決定這場表演打到誰
  const P = state.pops;
  const gain = (perf - 2) * 0.13;
  for (let i = 0; i < P.n; i++) {
    const gid = data.genIds[P.gen[i]];
    const sid = data.strataIds[P.stratum[i]];
    const w = (show.gen[gid] ?? 1) * (show.strata[sid] ?? show.strata._all ?? 1);
    if (w < 0.35) continue;
    P.playerFavor[i] = clampBi(P.playerFavor[i] + gain * w * (show.reach / 5));
  }
  p.fame = clamp05(p.fame + (perf >= 3 ? 0.12 : 0.05) * (show.reach / 4));
  // 通告費入個人帳戶。一個月只有兩點行動點，上一次節目佔掉半個月，
  // 那半個月換到的錢應該讓玩家有感覺。
  state.finance.personal += show.fee ?? 0;

  const media = state.media[show.mediaId];
  if (media) media.playerRelation = clampBi(media.playerRelation + (perf >= 3 ? 0.4 : perf <= 1 ? -0.3 : 0.1));

  let text, extra = '';
  if (perf >= 5) {
    p.politicalCapital = Math.min(999, p.politicalCapital + 30);
    bumpCounter(state, data, 'expertSpeech');
    text = `你今天講得非常好。有一段被剪成短片，隔天早上還在各群組裡轉，連對面的支持者都在討論你講的那句話。`;
  } else if (perf === 4) {
    p.politicalCapital = Math.min(999, p.politicalCapital + 15);
    text = `你在節目上占了上風，主持人最後還主動問你下次要不要再來。`;
  } else if (perf === 3) {
    text = `整場表現得體，該講的都講到了，沒有出錯，也沒有特別亮眼的地方。`;
  } else if (perf === 2) {
    text = `你講得中規中矩，錄完之後製作單位很客氣地送你到門口，沒有提下一次。`;
  } else if (perf === 1) {
    p.favorNational = clampBi(p.favorNational - 0.3);
    bumpCounter(state, data, 'interpellationFail');
    text = `你有兩題明顯答不出來，鏡頭掃到你的時候正好在翻資料，那個畫面被截圖了。`;
  } else {
    p.favorNational = clampBi(p.favorNational - 0.6);
    p.integrity = clamp05(p.integrity - 0.2);
    bumpCounter(state, data, 'interpellationFail');
    text = `這一集是災難。你講錯了一個很基本的數字，主持人當場糾正，剪出來的片段現在是全網最紅的十五秒。`;
  }
  if (show.riskBonus && perf <= 1 && rng.bool(show.riskBonus * 3)) {
    p.stigma = clamp05(p.stigma + 0.3);
    extra = '節目最後主持人拿出一份文件問你，你當下沒有正面回答，那份文件現在在別人手上。';
  }
  // 引用的理論如果打中了節目的觀眾，效果會再放大
  if (theoryDef && perf >= 3) {
    const P2 = state.pops;
    for (let i = 0; i < P2.n; i++) {
      const sid = data.strataIds[P2.stratum[i]];
      const w = theoryDef.strataAppeal?.[sid] ?? 0;
      if (Math.abs(w) < 0.1) continue;
      P2.playerFavor[i] = clampBi(P2.playerFavor[i] + w * 0.05 * (perf - 2));
    }
    for (const ax in theoryDef.axis ?? {}) {
      state.modifiers.add({
        id: `theory:${theoryDef.id}:${ax}`, source: 'theory', label: theoryDef.name,
        target: `value.${ax}`, op: 'add', value: theoryDef.axis[ax] * 0.4,
        duration: 12, startTurn: state.meta.turn,
      });
    }
  }
  // 上了幾次節目之後，你不再需要看小抄也能把一段話講得有頭有尾
  const milestone = bumpAttr(state, data, 'show');
  return { ok: true, perf, show, text, extra, theory: theoryDef, milestone };
}

export function prepare(state) {
  state.flags.showPrep = clamp05((state.flags.showPrep ?? 0) + 1.5);
}
