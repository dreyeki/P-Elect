// @ts-check
import { clamp, clamp05 } from '../core/Formula.js';

export const ACTIONS = [
  { id: 'canvass', name: '選區跑攤', ap: 1, fatigue: 8, desc: '婚喪喜慶、市場、宮廟，一場一場跑。基層是這樣一點一點長出來的。' },
  { id: 'talkshow', name: '上政論節目', ap: 1, fatigue: 8, desc: '同溫層會很爽，對面會很氣，中間選民會轉台。講錯一句就是明天的頭條。' },
  { id: 'presser', name: '開記者會', ap: 1, fatigue: 8, desc: '主動設定議題，把大家的注意力拉到你想談的那件事上。' },
  { id: 'draftLaw', name: '研擬法案', ap: 1, fatigue: 8, desc: '把條文寫扎實，通過的機會才會高，也才禁得起對手挑毛病。' },
  { id: 'prepQuestion', name: '質詢準備', ap: 1, fatigue: 8, desc: '把資料讀熟、把數字背下來，上台才不會被反問到啞口無言。' },
  { id: 'fundraise', name: '募款餐會', ap: 1, fatigue: 8, desc: '選舉是很花錢的事，而錢從來不會憑空出現在專戶裡。' },
  { id: 'faction', name: '拜會派系大老', ap: 1, fatigue: 8, desc: '前輩會很客氣地泡茶給你喝，然後很自然地提起一件小事。' },
  { id: 'trainStaff', name: '培養幕僚', ap: 1, fatigue: 8, desc: '好的幕僚不是找來的，是帶出來的，忠誠也是。' },
  { id: 'visit', name: '出訪參訪', ap: 2, fatigue: 15, desc: '出去一趟很累，但回來以後你講的話會不太一樣。' },
  { id: 'study', name: '進修讀書', ap: 1, fatigue: 8, desc: '在這一行，能靜下來讀完一本書本身就是一種奢侈。' },
  { id: 'dealmaking', name: '私下協商', ap: 2, fatigue: 15, desc: '有些事在檯面上永遠談不成，但在檯面下十分鐘就有結論。' },
  { id: 'family', name: '陪伴家人', ap: 1, fatigue: -20, desc: '你已經很久沒有好好吃一頓飯了，家裡的人也已經很久沒有抱怨了。' },
  { id: 'rest', name: '休養', ap: 2, fatigue: -40, desc: '醫生說你再這樣下去會出事，你這次決定聽進去。' },
];

export function apOf(state, data) {
  const p = state.player;
  let ap = data.meta.baseAP;
  if (['mayor', 'minister', 'president'].includes(p.role)) ap += 1;
  if (state.meta.scale === 'week' && state.team.some((t) => t.role === 'manager')) ap += 1;
  if (p.attrs.stamina >= 5) ap += 1;
  if (fatigueLevel(state) >= 4) ap -= 1;
  return Math.max(1, ap);
}

export function fatigueLevel(state) { return clamp05(state.player.fatigueRaw / 24); }

export function tick(state, ctx) {
  const { rng, scaleMult } = ctx;
  const p = state.player;
  const news = [];
  const age = state.meta.year - p.birthYear;
  const agePenalty = age >= 75 ? 14 : age >= 65 ? 8 : age >= 55 ? 4 : 0;

  p.fatigueRaw = clamp(p.fatigueRaw - (10 + p.attrs.stamina * 4 - agePenalty) * scaleMult, 0, 120);
  // 沒有人會一直記得你。知名度會慢慢退回去，
  // 但地方上原本就認得你的那一點基礎不會消失，所以設一個地板。
  if (p.fame > 1.2) p.fame = Math.max(1.2, p.fame - 0.018 * scaleMult);
  p.favorNational *= 1 - 0.012 * scaleMult;

  if (p.hospitalTurns > 0) {
    p.hospitalTurns -= 1;
    if (p.hospitalTurns === 0) news.push({ kind: 'personal', text: '你出院了。醫生要你至少一個月不要排早餐會報，你笑著答應，但心裡已經在算下週的行程。' });
    return { news, hospitalized: true };
  }

  const risk = Math.max(0, (p.fatigueRaw - 45) / 150)
    * (1 + (5 - p.attrs.stamina) * 0.18)
    * (1 + agePenalty / 20);
  if (risk > 0 && rng.bool(clamp(risk, 0, 0.6) * scaleMult)) {
    p.hospitalTurns = p.fatigueRaw > 90 ? 3 : p.fatigueRaw > 70 ? 2 : 1;
    p.fatigueRaw = 0;
    p.favorNational = clamp(p.favorNational + 1, -5, 5);
    if (rng.bool(0.2)) {
      p.attrs.stamina = clamp05(p.attrs.stamina - 1);
      news.push({ kind: 'personal', text: `你在辦公室昏倒，被送進急診。醫生說這次是警訊，下次不見得會這麼幸運，你的身體已經回不到從前的狀態了。` });
    } else {
      news.push({ kind: 'personal', text: `連續幾週的行程把你壓垮了，你住院了 ${p.hospitalTurns} 個回合。支持者送來的花把病房堆滿，對手則在這段時間推進了他們的議程。` });
    }
    return { news, hospitalized: true };
  }
  return { news };
}

export function doAction(state, data, actionId, payload = {}) {
  const a = ACTIONS.find((x) => x.id === actionId);
  const p = state.player;
  if (!a) return { ok: false, msg: '沒有這個行動。' };
  if (p.apUsed + a.ap > apOf(state, data)) return { ok: false, msg: '行動點不夠了，這個回合你只能做這麼多事。' };
  p.apUsed += a.ap;
  p.fatigueRaw = clamp(p.fatigueRaw + a.fatigue, 0, 120);
  return { ok: true, action: a, payload };
}

/** 屬性成長：進修累積到門檻才會跳一級 */
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
