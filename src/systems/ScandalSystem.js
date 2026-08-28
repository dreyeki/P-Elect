// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';
import { teamBonus } from './TeamSystem.js';

export function tick(state, ctx) {
  const { data, rng, scaleMult } = ctx;
  const p = state.player;
  const news = [];

  if (state.flags.investigation) {
    const inv = state.flags.investigation;
    inv.turnsLeft -= scaleMult;
    if (inv.turnsLeft <= 0) {
      const resist = teamBonus(state, data, 'investigationResist');
      const guilt = clamp(p.stigma / 5 * 0.7 + (inv.severity ?? 0.3) - resist, 0.05, 0.92);
      if (rng.bool(guilt)) {
        p.integrity = clamp05(p.integrity - 2);
        p.stigma = clamp05(p.stigma + 1.5);
        inv.result = 'indicted';
        news.push({ kind: 'scandal', text: `檢方今天正式對你提起公訴，起訴書洋洋灑灑寫了三十幾頁。黨中央下午發出聲明表示尊重司法，措辭客氣但距離拉得很開。` });
        if (rng.bool(0.35)) {
          state.flags.convicted = true;
          news.push({ kind: 'scandal', text: `法院一審宣判有罪，你的政治生涯到此為止。走出法庭的時候，只有兩三個老支持者還站在門口。` });
        }
      } else {
        p.stigma = clamp05(p.stigma + 0.7);
        inv.result = 'cleared';
        news.push({ kind: 'scandal', text: `檢方今天做出不起訴處分。你在服務處前面對媒體說了「清白終於還給我了」，但那份卷宗會一直躺在那裡，任何人都可以再翻出來。` });
      }
      state.flags.investigation = null;
    }
    return { news };
  }

  if (p.stigma >= 2) {
    const risk = (p.stigma - 1.5) * 0.12 * scaleMult;
    if (rng.bool(risk)) {
      state.flags.investigation = {
        turnsLeft: rng.int(3, 8),
        severity: clamp(p.stigma / 5 * 0.5, 0.1, 0.6),
        startTurn: state.meta.turn,
      };
      news.push({ kind: 'scandal', text: `檢調今天上午發動搜索，你的服務處與住處都被列在名單上。你在第一時間發出聲明表示全力配合調查，電話從那之後就沒有停過。` });
    }
  }
  return { news };
}

export const CRISIS_OPTIONS = [
  { id: 'capital', name: '動用政治資本壓下來', cost: { politicalCapital: 120 }, effect: { severity: -0.25 },
    desc: '找到能說得上話的人，把這件事的力道降下來，代價是你欠的人情又多了一筆。' },
  { id: 'faction', name: '請派系出面護航', requiresFactionFavor: 4, effect: { severity: -0.3 },
    desc: '派系願意動員黨團替你擋，但這個人情將來一定要還。' },
  { id: 'scapegoat', name: '推出替罪羊', effect: { severity: -0.35, stigma: 0.4, loyalty: -1 },
    desc: '把責任推到底下的人身上，你自己乾淨脫身，代價是團隊裡再也沒有人真的信你。' },
  { id: 'resign', name: '主動請辭止血', effect: { severity: -0.6, resign: true },
    desc: '把位子交出來，讓火燒不到後面。汙名不會再增加，但你失去了現在的所有籌碼。' },
  { id: 'fight', name: '正面對抗到底', boldMin: 4, effect: { severity: 0.1, favorNational: 0.3 },
    desc: '開記者會逐條反駁，賭自己站得住腳。支持者會被激勵，但如果最後被起訴，跌得更重。' },
];
