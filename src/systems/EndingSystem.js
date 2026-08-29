// @ts-check
/**
 * 退場結算與事後談。
 *
 * 事後談刻意設計成會造成遺憾：
 * 一個沒有留下什麼的人，退休之後只能看著這個國家往他反對的方向走，
 * 而且沒有人會記得他曾經反對過。
 * 有實績的人才有資格看到自己相信的東西真的長出來。
 */
import { clamp, clamp05 } from '../core/Formula.js';

const ROLE_RANK = { citizen: 0, aide: 0, village: 1, councilor: 2, legislator: 3, minister: 4, mayor: 4, president: 6 };
const ROLE_NAME = { citizen: '政治素人', aide: '議員助理', village: '里長', councilor: '縣市議員',
  legislator: '立法委員', minister: '部會首長', mayor: '縣市長', president: '總統' };

export function summarize(state, data) {
  const p = state.player;
  const wins = p.careerLog.filter((c) => c.kind === 'win');
  const losses = p.careerLog.filter((c) => c.kind === 'lose');
  const laws = p.careerLog.filter((c) => c.kind === 'law');
  const peakRole = [...wins.map((w) => roleOfWin(w)), p.role]
    .sort((a, b) => (ROLE_RANK[b] ?? 0) - (ROLE_RANK[a] ?? 0))[0] ?? 'citizen';

  const startSol = state.history[0]?.sol ?? state.flags.avgSol ?? 0;
  const endSol = state.flags.avgSol ?? 0;
  const startValues = state.history[0]?.values ?? state.values;

  // 成就分數：這決定事後談會往哪個方向寫
  const score =
    (ROLE_RANK[peakRole] ?? 0) * 12
    + wins.length * 6
    + laws.length * 9
    + clamp((endSol - startSol) * 30, -25, 40)
    + clamp((p.fame - 1) * 4, 0, 16)
    + (state.theories ?? []).filter((t) => t.level >= 3).length * 4
    - p.stigma * 7
    - losses.length * 2;

  return {
    name: p.name,
    years: state.meta.year - (data.meta.startDate.year),
    ageAtEnd: state.meta.year - p.birthYear,
    peakRole, peakRoleName: ROLE_NAME[peakRole] ?? '政治素人',
    wins: wins.length, losses: losses.length, laws: laws.length,
    lawList: laws.slice(-6).map((l) => l.text),
    stigma: p.stigma, integrity: p.integrity, fame: p.fame,
    theories: (state.theories ?? []).length,
    refinedTheories: (state.theories ?? []).filter((t) => t.level >= 3).length,
    image: p.image ? data.byId.playerImage[p.image] : null,
    solStart: startSol, solEnd: endSol, solDelta: endSol - startSol,
    valueStart: startValues, valueEnd: { ...state.values },
    score,
    tier: score >= 90 ? 'legend' : score >= 55 ? 'solid' : score >= 25 ? 'modest' : 'forgotten',
    convicted: !!state.flags.convicted,
  };
}
function roleOfWin(w) {
  const t = w.text ?? '';
  if (t.includes('總統')) return 'president';
  if (t.includes('縣市長') || t.includes('市長')) return 'mayor';
  if (t.includes('立法委員') || t.includes('立委')) return 'legislator';
  if (t.includes('議員')) return 'councilor';
  if (t.includes('里長') || t.includes('村里長')) return 'village';
  return 'citizen';
}

const AXIS_STORY = {
  centralization: {
    pos: ['中央的權力比你在的時候更集中了，地方政府連一條路要怎麼修都得先上台北跑一趟。',
      '所有的錢跟權都收回了中央，效率是高了，但沒有人再問地方要什麼。'],
    neg: ['地方拿回了財源與權限，縣市長不用再為了一筆補助跑中央，但南北的差距也拉得更開了。',
      '權力散到了二十二個縣市手上，好的地方做得很好，差的地方就這樣被留下了。'],
  },
  unification: {
    pos: ['兩岸的往來密到分不清界線，經濟數字很好看，但有些話已經沒有人在公開場合講了。',
      '交流變得理所當然，年輕人到對岸工作像出差一樣普通，而那些堅持的人成了少數。'],
    neg: ['這座島愈來愈像自己，護照上的名字換了，代價是每年編列的國防預算數字。',
      '本土認同成了不需要爭論的前提，但外面的壓力也從來沒有真正離開過。'],
  },
  marketFreedom: {
    pos: ['市場拿回了主導權，成長率很漂亮，街上的人卻愈來愈分成兩種。',
      '管制一條一條鬆綁，資本進來得很快，走的時候也很快。'],
    neg: ['政府接手了愈來愈多事情，安全網織得比從前密，但也慢得讓人不耐煩。',
      '公共部門長大了，該接住的人接住了，該長出來的產業卻沒有長出來。'],
  },
  progressivism: {
    pos: ['價值觀的爭論安靜了下來，那些當年吵到街上的事，現在寫進了課本裡。',
      '社會往前走了一大步，長輩們的失落是真的，只是沒有人替他們說話。'],
    neg: ['社會退回了比較熟悉的樣子，有人鬆了一口氣，也有人從此不再回這座島。',
      '傳統的秩序被重新肯定，秩序底下被壓住的那些聲音，也重新安靜了。'],
  },
  immigration: {
    pos: ['街上的口音多了起來，勞動力的缺口補上了，融合的陣痛則留給了下一代。',
      '門開得比從前大，來的人撐起了工廠與長照，但也撐起了新的爭論。'],
    neg: ['門關得比從前緊，本地的工作保住了，缺工的產業一個一個搬走了。',
      '邊境管得嚴實，安全感回來了，社會的年齡結構卻愈來愈難看。'],
  },
  environment: {
    pos: ['空氣確實比從前乾淨，工業區的煙囪少了幾根，那些關掉的廠也帶走了幾萬個工作。',
      '環境成了不能踩的紅線，開發案一個一個卡住，年輕人開始往有工作的地方搬。'],
    neg: ['開發的速度回來了，GDP 很好看，中南部的空品指數也回到了從前的數字。',
      '該蓋的都蓋起來了，經濟數字漂亮，只是有些地方的人不太願意再談身體的事。'],
  },
  militaryAutonomy: {
    pos: ['國防自己扛起來了，預算佔比高到排擠了別的東西，但至少那些裝備是自己的。',
      '這座島學會了不完全依賴別人，代價是每一年的預算書都在吵同一件事。'],
    neg: ['安全繫在盟友的承諾上，省下來的錢用在了別的地方，只是沒有人敢想那個承諾失效的那天。',
      '同盟關係穩固，國防支出壓得很低，而所有人都心照不宣地不去談萬一。'],
  },
  directDemocracy: {
    pos: ['什麼事都要公投一次，人民的意志被聽見了，重大建設也一個一個停在那裡。',
      '直接民主成了常態，決策慢得驚人，但沒有人再說自己沒有被問過。'],
    neg: ['決定重新回到了少數人手上，效率確實高了，只是那些人開會的時候不再有人在外面等。',
      '菁英治理被重新接受，政策品質好了一些，公民的參與感則一年比一年淡。'],
  },
};

/**
 * 事後談。
 * 有實績的人會看到自己相信的東西留了下來；
 * 沒有留下什麼的人，會看著國家往他反對的方向走。
 */
export function epilogue(state, data, sum, rng) {
  const p = state.player;
  const goodEnding = sum.score >= 55;
  const paras = [];

  // 挑三條玩家立場最鮮明的軸來講
  const axes = data.values.axes
    .map((ax) => ({ ax, mine: p.ideology[ax.id] ?? 0 }))
    .filter((x) => Math.abs(x.mine) >= 1 && AXIS_STORY[x.ax.id])
    .sort((a, b) => Math.abs(b.mine) - Math.abs(a.mine))
    .slice(0, 3);

  // 一條鮮明的軸都沒有——這種人也是存在的，而且不少。
  // 不要替他編出立場來，改成講這個國家在他不表態的那些年裡自己走到哪裡去了。
  const noConviction = axes.length === 0;
  const drifted = noConviction
    ? data.values.axes
      .map((ax) => ({ ax, moved: (sum.valueEnd[ax.id] ?? 0) - (sum.valueStart[ax.id] ?? 0) }))
      .filter((x) => AXIS_STORY[x.ax.id])
      .sort((a, b) => Math.abs(b.moved) - Math.abs(a.moved))
      .slice(0, 3)
    : [];

  for (const { ax, mine } of axes) {
    const story = AXIS_STORY[ax.id];
    // 有成就 → 往玩家的方向；沒成就 → 往相反方向
    const dir = goodEnding ? Math.sign(mine) : -Math.sign(mine);
    const lines = dir > 0 ? story.pos : story.neg;
    paras.push({
      axis: ax.id, axisName: dir > 0 ? ax.posName : ax.negName,
      aligned: dir === Math.sign(mine),
      text: rng.pick(lines),
    });
  }
  for (const { ax, moved } of drifted) {
    const story = AXIS_STORY[ax.id];
    const dir = moved >= 0 ? 1 : -1;
    paras.push({
      axis: ax.id, axisName: dir > 0 ? ax.posName : ax.negName,
      aligned: false, noStance: true,
      text: rng.pick(dir > 0 ? story.pos : story.neg),
    });
  }

  const opener = sum.convicted
    ? `${sum.name}的名字最後一次出現在新聞上，是判決確定的那一天。`
    : goodEnding
      ? `${sum.name}離開政壇那年 ${sum.ageAtEnd} 歲，卸任的記者會排了三十幾家媒體。`
      : sum.wins > 0
        ? `${sum.name}離開政壇的時候 ${sum.ageAtEnd} 歲，只有兩家媒體派了人來，其中一家是地方的。`
        : `${sum.name}最後一次登記參選失敗之後就沒有再出現了。多年以後，很少有人記得這個名字。`;

  const closer = goodEnding
    ? '很多年以後，有人在論文裡引用了他當年提的那套東西，註腳裡寫著他的名字。'
    : sum.laws > 0
      ? '他推過的那幾條法還在運作，只是條文上早就看不出來是誰提的了。'
      : '他當年在意的那些事，後來由別人以完全相反的方式解決了。';

  const regret = noConviction
    ? `他偶爾會在電視上看到這些新聞，然後轉台。這些事情往哪個方向走，他年輕的時候就沒有想過，現在更沒有理由開始想。`
    : (!goodEnding && axes.length
      ? `他偶爾會在電視上看到這些新聞。年輕的時候他相信的不是這樣，但他已經沒有位子可以說話了。`
      : null);

  return { opener, paras, closer, regret, goodEnding, noConviction };
}

export const TIER_NAME = {
  legend: '留下名字的人', solid: '做過事的人', modest: '努力過的人', forgotten: '被遺忘的人',
};
