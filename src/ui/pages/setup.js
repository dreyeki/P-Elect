// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { randomSeedString } from '../../core/Rng.js';
import { word } from '../../util/scale.js';
import { loadSetupPrefs, hasSetupPrefs } from '../../save/SaveManager.js';

export const ATTRS = [
  ['stamina', '體力', '疲勞恢復得快，比較不會倒下'],
  ['sociability', '交際', '派系、幕僚、募款都靠這個'],
  ['charisma', '魅力', '選舉的個人票與鏡頭表現'],
  ['eloquence', '口才', '質詢、辯論、上節目'],
  ['judgment', '判斷', '看穿事件的隱藏資訊、法案品質'],
  ['boldness', '氣魄', '決定你看得到哪些選項'],
];

export const setupDraft = {
  step: 0,
  attrs: { stamina: 2, sociability: 2, charisma: 2, eloquence: 2, judgment: 2, boldness: 2 },
  seedStr: randomSeedString(),
  name: '龍天台', gender: 'm', education: '大學', age: 35,
  startId: 'rookie', backgroundId: null, homeDistrict: null, homeRegion: 'KHH',
  party: null, partyMode: null,
  ideology: {},
  china: {},
};

/**
 * 把建角草稿初始化一次。
 *
 * 順序是：資料檔的預設值 → 上一局實際用過的選擇。
 * 多數人開第二局的時候只想改一兩個地方，讓他從頭再點一次
 * 姓名、年齡、家鄉、十三條軸跟七個維度是沒有道理的。
 * 上一局的紀錄會先用現在的資料檔驗過，驗不過的項目才退回預設值。
 */
export function initDraft(data, { usePrefs = true } = {}) {
  const d = setupDraft;
  const def = data.starts.defaults ?? {};
  d.name = def.name ?? d.name;
  d.gender = def.gender ?? d.gender;
  d.education = def.education ?? d.education;
  d.age = def.age ?? d.age;
  d.startId = def.startId ?? d.startId;
  d.homeRegion = def.homeRegion ?? d.homeRegion;
  d.homeDistrict = null;
  d.backgroundId = null;
  d.partyMode = null;
  d.party = null;
  d.attrs = { stamina: 2, sociability: 2, charisma: 2, eloquence: 2, judgment: 2, boldness: 2 };
  d.ideology = {};
  d.china = {};
  for (const ax of data.values.axes) d.ideology[ax.id] = 0;
  for (const dim of data.china.dims) d.china[dim.id] = 0;
  d.restoredFrom = null;

  if (usePrefs) {
    const prev = loadSetupPrefs(data);
    if (prev) {
      for (const k of ['name', 'gender', 'education', 'age', 'startId', 'backgroundId',
        'homeDistrict', 'homeRegion', 'partyMode', 'party']) {
        if (prev[k] !== undefined) d[k] = prev[k];
      }
      if (prev.attrs) d.attrs = { ...d.attrs, ...prev.attrs };
      if (prev.ideology) d.ideology = { ...d.ideology, ...prev.ideology };
      if (prev.china) d.china = { ...d.china, ...prev.china };
      // 家鄉如果被帶回來了，縣市要跟著對上，不然選單會顯示錯的縣市
      const home = data.byId.district[d.homeDistrict];
      if (home) d.homeRegion = home.regionId;
      d.restoredFrom = prev.savedAt ?? true;
    }
  }
  d.step = 0;
  return d;
}

/**
 * 開局選項要付的屬性點。
 * 有職位、有錢的開局比較舒服，那份舒服要從你本人的能力裡扣。
 *
 * 政黨不算在裡面。加入哪一個黨是開局之後的第一個決定，不是建角的一部分——
 * 而且那個決定的代價本來就寫在遊戲裡：大黨要排隊，小黨天花板低。
 * 再從屬性點扣一次是收兩次錢。
 */
export function attrBudget(data) {
  const d = setupDraft;
  const total = data.tuning?.start?.attributePoints ?? 16;
  const st = data.starts.starts.find((x) => x.id === d.startId);
  const bg = data.backgrounds.backgrounds.find((x) => x.id === d.backgroundId);
  const cost = (st?.attrCost ?? 0) + (bg?.attrCost ?? 0);
  return { total, cost, cap: Math.max(6, total - cost) };
}

export function setupPage(data) {
  const d = setupDraft;
  const steps = ['起點', '出身', '屬性', '家鄉', '立場', '種子'];
  const restored = d.restoredFrom ? `
    <div class="restoreline">
      沿用了你上一局的設定。
      <button class="lnk" data-act="setup-reset">全部改回預設值</button>
    </div>` : '';
  const nav = `<div class="btn-row" style="margin-bottom:14px">${steps.map((n, i) =>
    `<button class="btn ${d.step === i ? 'primary' : 'ghost'}" data-act="setup-step" data-id="${i}">${n}</button>`).join('')}</div>`;
  const body = [stepStart, stepBg, stepAttrs, stepHome, stepIdeo, stepSeed][d.step](data);
  const ready = d.backgroundId && d.homeDistrict && d.name.trim();
  return html`
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:24px;font-weight:800;letter-spacing:.06em">選舉人生</div>
      <div class="xs muted" style="letter-spacing:.3em;margin-top:4px">福爾摩沙・2026</div>
    </div>
    ${raw(restored)}${raw(nav)}${raw(body)}
    <div class="btn-row" style="margin-top:16px">
      ${raw(d.step > 0 ? `<button class="btn ghost" data-act="setup-step" data-id="${d.step - 1}">上一步</button>` : '')}
      ${raw(d.step < 4 ? `<button class="btn primary" data-act="setup-step" data-id="${d.step + 1}">下一步</button>`
    : `<button class="btn primary full" data-act="start-game" ${ready ? '' : 'disabled'}>開始</button>`)}
    </div>
    ${raw(!ready && d.step === 5 ? `<div class="warnline">${esc(missingText(d))}</div>` : '')}
    <div class="btn-row" style="margin-top:20px">
      <button class="btn ghost xs" data-act="load-game" data-id="auto">讀取自動存檔</button>
      <button class="btn ghost xs" data-act="load-game" data-id="1">讀取欄位一</button>
      <button class="btn ghost xs" data-act="import-save">匯入存檔檔案</button>
    </div>`;
}

/** 還缺什麼。與其寫「還有欄位沒完成」，不如直接講是哪一項。 */
function missingText(d) {
  const miss = [];
  if (!d.name.trim()) miss.push('姓名');
  if (!d.backgroundId) miss.push('出身背景');
  if (!d.homeDistrict) miss.push('家鄉選區');
  return `還沒有決定：${miss.join('、')}。`;
}

function stepStart(data) {
  const d = setupDraft;
  return html`
    <div class="setup-step">
      <h3>你從哪裡開始</h3>
      <div class="pick">${raw(data.starts.starts.map((s) => `
        <button data-act="setup-start" data-id="${esc(s.id)}" class="${d.startId === s.id ? 'on' : ''}">
          <div class="pt">${esc(s.name)}　<span class="xs muted">${'★'.repeat(s.difficulty)}</span>
            ${s.attrCost ? `<span class="chip warn xs">屬性 −${s.attrCost}</span>` : ''}</div>
          <div class="pd">${esc(s.desc)}</div>
          <div class="pd" style="margin-top:5px;color:var(--fg-2)">${esc(s.path)}</div>
          <div class="pd" style="margin-top:4px;color:var(--fg-2)">${esc(s.costNote ?? '')}</div>
        </button>`).join(''))}</div>
      <div class="xs muted" style="margin-top:10px;line-height:1.75">
        兩種起點都要從基層打起。這是刻意的——這個遊戲的核心就是爬上去的那段路。<br>
        比較舒服的開局會先扣掉一部分屬性點，因為那些現成的資源本來就是別人先付過的。
      </div>
    </div>
    <div class="setup-step">
      <h3>基本資料</h3>
      <div class="field"><label>姓名</label>
        <input type="text" data-change="setup-name" value="${esc(d.name)}" placeholder="請輸入姓名" maxlength="8"></div>
      <div class="field"><label>性別</label>
        <select data-change="setup-gender">
          <option value="x" ${d.gender === 'x' ? 'selected' : ''}>不指定</option>
          <option value="m" ${d.gender === 'm' ? 'selected' : ''}>男</option>
          <option value="f" ${d.gender === 'f' ? 'selected' : ''}>女</option>
        </select></div>
      <div class="field"><label>學歷</label>
        <select data-change="setup-edu">
          ${raw(['高中職', '大學', '碩士', '博士', '海外名校'].map((e) =>
      `<option ${d.education === e ? 'selected' : ''}>${e}</option>`).join(''))}
        </select></div>
      <div class="field"><label>年齡</label>
        <select data-change="setup-age">
          ${raw(ageOptions(data).map((a) =>
      `<option value="${a}" ${d.age === a ? 'selected' : ''}>${a} 歲</option>`).join(''))}
        </select></div>
      <div class="xs muted" style="margin-top:6px;line-height:1.7">
        年齡會影響體力恢復與住院風險，也決定「青年世代」這個形象你還掛不掛得上去。
      </div>
    </div>`;
}

function ageOptions(data) {
  const st = data.starts.starts.find((x) => x.id === setupDraft.startId)
    ?? data.starts.starts[0];
  const [lo, hi] = st.ageRange;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

function stepBg(data) {
  const d = setupDraft;
  const ATTR = { stamina: '體力', sociability: '交際', charisma: '魅力', eloquence: '口才', judgment: '判斷', boldness: '氣魄' };
  return html`<div class="setup-step"><h3>你以前是做什麼的</h3>
    <div class="pick">${raw(data.backgrounds.backgrounds.map((b) => {
    const plus = Object.entries(b.attrs).map(([k, v]) => `${ATTR[k]}${v > 0 ? '+' : ''}${v}`).join('、');
    const costTag = b.attrCost ? `<span class="chip warn xs">屬性 −${b.attrCost}</span>` : '';
    return `<button data-act="setup-bg" data-id="${esc(b.id)}" class="${d.backgroundId === b.id ? 'on' : ''}">
      ${costTag}
        <div class="pt">${esc(b.name)}</div>
        <div class="pd">${esc(b.desc)}</div>
        <div class="pd" style="margin-top:5px">${esc(plus)}　私產 ${(b.personalAssets / 10000).toLocaleString()} 萬${b.stigma ? '　汙名 微有瑕疵' : ''}</div>
      </button>`;
  }).join(''))}</div></div>`;
}

function stepAttrs(data) {
  const d = setupDraft;
  const B = attrBudget(data);
  const cap = B.cap;
  const max = data.tuning?.start?.attributeMax ?? 4;
  const used = Object.values(d.attrs).reduce((a, b) => a + b, 0);
  const left = cap - used;
  const rows = ATTRS.map(([k, name, note]) => {
    const v = d.attrs[k];
    return `<div class="attrrow">
      <span class="ar-n">${esc(name)}</span>
      <span class="ar-w">${esc(data.scales.linear[k][v])}</span>
      <span class="ar-p">${Array.from({ length: 6 }, (_, i) =>
      `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>
      <span class="ar-b">
        <button class="btn ghost xs" data-act="attr-down" data-id="${k}" ${v <= 0 ? 'disabled' : ''}>−</button>
        <button class="btn ghost xs" data-act="attr-up" data-id="${k}" ${(v >= max || left <= 0) ? 'disabled' : ''}>＋</button>
      </span>
      <span class="ar-d">${esc(note)}</span>
    </div>`;
  }).join('');
  return html`<div class="setup-step">
    <h3>你是什麼樣的人</h3>
    <div class="xs muted" style="line-height:1.8;margin-bottom:10px">
      總額 ${B.total} 點，開局選項已經先扣掉 ${B.cost} 點，剩下 ${cap} 點可以分配，單項上限 ${max} 點。
      出身背景的屬性加成會另外疊上去。<br>
      沒有一種分配是最強的——氣魄低的人看不到某些選項，但也不會被自己的衝動害死。
    </div>
    <div style="text-align:center;margin-bottom:10px">
      <span class="chip ${left === 0 ? 'on' : 'warn'}">剩下 ${left} 點</span>
    </div>
    ${raw(rows)}
    <div class="btn-row"><button class="btn ghost" data-act="attr-reset">重設成平均</button></div>
  </div>`;
}

function stepHome(data) {
  const d = setupDraft;
  const regions = data.regions.regions;
  const ds = data.districts.districts.filter((x) => x.regionId === d.homeRegion && x.type === 'general');
  return html`<div class="setup-step"><h3>你的家鄉</h3>
    <div class="field"><label>縣市</label>
      <select data-change="setup-region">
        ${raw(regions.map((r) => `<option value="${r.id}" ${d.homeRegion === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join(''))}
      </select></div>
    <div class="pick">${raw(ds.map((x) => `
      <button data-act="setup-district" data-id="${esc(x.id)}" class="${d.homeDistrict === x.id ? 'on' : ''}">
        <div class="pt">${esc(x.name)}</div>
        <div class="pd">${esc(x.areas.join('、'))}｜人口 ${x.population.toLocaleString()}｜應選 ${x.seats} 席</div>
      </button>`).join(''))}</div>
    <div class="xs muted" style="margin-top:10px;line-height:1.75">
      家鄉選區的基層組織會比別的地方高，好感也會多一點。這是你唯一的起跑優勢。
    </div></div>`;
}

function stepIdeo(data) {
  const d = setupDraft;
  return html`<div class="setup-step"><h3>你相信什麼</h3>
    ${raw(data.values.axes.map((ax) => `
      <div class="axis">
        <div class="axis-h"><span>${esc(ax.negName)}</span><span>${esc(ax.posName)}</span></div>
        <input type="range" min="-5" max="5" step="1" value="${d.ideology[ax.id]}"
          data-change="setup-ideo" data-id="${esc(ax.id)}" style="width:100%">
        <div class="axis-t">${d.ideology[ax.id] === 0 ? '沒有特別的看法'
      : esc((d.ideology[ax.id] < 0 ? ax.negName : ax.posName)) + '・' + esc(['', '微弱', '略有', '明顯', '強烈', '極度'][Math.abs(d.ideology[ax.id])])}</div>
      </div>`).join(''))}
    <div class="xs muted" style="line-height:1.75">
      這組座標決定哪些選民天生就跟你合得來。它不會限制你的選擇，但會決定你講的話有沒有人聽得進去。
    </div></div>
  <div class="setup-step"><h3>你怎麼看對岸</h3>
    <div class="xs muted" style="line-height:1.75;margin-bottom:10px">
      統獨是這座島上最多人在意的一件事，把它壓成一條線太粗糙了。
      這七個維度彼此獨立：你可以認為對岸很強但沒有惡意，也可以欣賞那邊的文化同時反對開放陸資。
    </div>
    ${raw(data.china.dims.map((dim) => `
      <div class="axis">
        <div class="axis-h"><span>${esc(dim.negName)}</span><span>${esc(dim.posName)}</span></div>
        <input type="range" min="-5" max="5" step="1" value="${d.china[dim.id] ?? 0}"
          data-change="setup-china" data-id="${esc(dim.id)}" style="width:100%">
        <div class="axis-t">${(d.china[dim.id] ?? 0) === 0 ? '沒有特別的看法'
      : esc(((d.china[dim.id] ?? 0) < 0 ? dim.negName : dim.posName)) + '・'
        + esc(['', '微弱', '略有', '明顯', '強烈', '極度'][Math.abs(d.china[dim.id] ?? 0)])}</div>
      </div>`).join(''))}
  </div>`;
}

function stepSeed(data) {
  const d = setupDraft;
  return html`<div class="setup-step"><h3>世界的種子</h3>
    <div class="field"><label>種子</label>
      <input type="text" data-change="setup-seed" value="${esc(d.seedStr)}" maxlength="16"></div>
    <button class="btn ghost" data-act="reroll-seed">重新產生一組</button>
    <div class="xs muted" style="margin-top:12px;line-height:1.8">
      種子決定所有政治人物的長相、各地數值的初始擾動、事件抽到哪一則、
      重大轉折發生在哪一年，還有每一場選舉那個看不見的隨機數。
      同一組種子重開一局，這個世界會長得一模一樣，不一樣的只有你的選擇。
    </div>
  </div>
  <div class="setup-step"><h3>確認</h3>
    <div class="card tight">
      ${row('姓名', esc(d.name || '（未填）'))}
      ${row('起點', esc(data.starts.starts.find((s) => s.id === d.startId)?.name ?? ''))}
      ${row('出身', esc(data.backgrounds.backgrounds.find((b) => b.id === d.backgroundId)?.name ?? '（未選）'))}
      ${row('屬性點', `${Object.values(d.attrs).reduce((a, b) => a + b, 0)} / ${attrBudget(data).cap}`)}
      ${row('家鄉', esc(data.byId.district[d.homeDistrict]?.name ?? '（未選）'))}
      ${row('種子', esc(d.seedStr))}
    </div>
    <div class="xs muted" style="margin-top:10px;line-height:1.75">
      開局後的第一件事，是決定要加入大黨、加入小黨，還是誰都不靠。
      那個決定不花屬性點，但它會塑造你接下來八年的整個玩法。
    </div>
  </div>`;
}
const row = (k, v) => `<div class="row"><span class="row-k">${k}</span><span class="row-v">${v}</span></div>`;
