// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { randomSeedString } from '../../core/Rng.js';
import { word } from '../../util/scale.js';

export const setupDraft = {
  step: 0,
  seedStr: randomSeedString(),
  name: '', gender: 'x', education: '大學',
  startId: 'rookie', backgroundId: null, homeDistrict: null, homeRegion: 'KHH',
  party: null, partyMode: null,
  ideology: { centralization: 0, unification: 0, marketFreedom: 0, progressivism: 0, immigration: 0, environment: 0, militaryAutonomy: 0, directDemocracy: 0 },
};

export function setupPage(data) {
  const d = setupDraft;
  const steps = ['起點', '出身', '家鄉', '立場', '種子'];
  const nav = `<div class="btn-row" style="margin-bottom:14px">${steps.map((n, i) =>
    `<button class="btn ${d.step === i ? 'primary' : 'ghost'}" data-act="setup-step" data-id="${i}">${n}</button>`).join('')}</div>`;
  const body = [stepStart, stepBg, stepHome, stepIdeo, stepSeed][d.step](data);
  const ready = d.backgroundId && d.homeDistrict && d.name.trim();
  return html`
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:24px;font-weight:800;letter-spacing:.06em">選舉人生</div>
      <div class="xs muted" style="letter-spacing:.3em;margin-top:4px">福爾摩沙・2026</div>
    </div>
    ${raw(nav)}${raw(body)}
    <div class="btn-row" style="margin-top:16px">
      ${raw(d.step > 0 ? `<button class="btn ghost" data-act="setup-step" data-id="${d.step - 1}">上一步</button>` : '')}
      ${raw(d.step < 4 ? `<button class="btn primary" data-act="setup-step" data-id="${d.step + 1}">下一步</button>`
    : `<button class="btn primary full" data-act="start-game" ${ready ? '' : 'disabled'}>開始</button>`)}
    </div>
    ${raw(!ready && d.step === 4 ? '<div class="warnline">還有必填的欄位沒有完成。</div>' : '')}
    <div class="btn-row" style="margin-top:20px">
      <button class="btn ghost xs" data-act="load-game" data-id="auto">讀取自動存檔</button>
      <button class="btn ghost xs" data-act="load-game" data-id="1">讀取欄位一</button>
      <button class="btn ghost xs" data-act="import-save">匯入存檔檔案</button>
    </div>`;
}

function stepStart(data) {
  const d = setupDraft;
  return html`
    <div class="setup-step">
      <h3>你從哪裡開始</h3>
      <div class="pick">${raw(data.starts.starts.map((s) => `
        <button data-act="setup-start" data-id="${esc(s.id)}" class="${d.startId === s.id ? 'on' : ''}">
          <div class="pt">${esc(s.name)}　<span class="xs muted">${'★'.repeat(s.difficulty)}</span></div>
          <div class="pd">${esc(s.desc)}</div>
          <div class="pd" style="margin-top:5px;color:var(--fg-2)">${esc(s.path)}</div>
        </button>`).join(''))}</div>
      <div class="xs muted" style="margin-top:10px;line-height:1.75">
        兩種起點都要從基層打起。這是刻意的——這個遊戲的核心就是爬上去的那段路。
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
    </div>`;
}

function stepBg(data) {
  const d = setupDraft;
  const ATTR = { stamina: '體力', sociability: '交際', charisma: '魅力', eloquence: '口才', judgment: '判斷', boldness: '氣魄' };
  return html`<div class="setup-step"><h3>你以前是做什麼的</h3>
    <div class="pick">${raw(data.backgrounds.backgrounds.map((b) => {
    const plus = Object.entries(b.attrs).map(([k, v]) => `${ATTR[k]}${v > 0 ? '+' : ''}${v}`).join('、');
    return `<button data-act="setup-bg" data-id="${esc(b.id)}" class="${d.backgroundId === b.id ? 'on' : ''}">
        <div class="pt">${esc(b.name)}</div>
        <div class="pd">${esc(b.desc)}</div>
        <div class="pd" style="margin-top:5px">${esc(plus)}　私產 ${(b.personalAssets / 10000).toLocaleString()} 萬${b.stigma ? '　汙名 微有瑕疵' : ''}</div>
      </button>`;
  }).join(''))}</div></div>`;
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
    </div></div>`;
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
      ${row('家鄉', esc(data.byId.district[d.homeDistrict]?.name ?? '（未選）'))}
      ${row('種子', esc(d.seedStr))}
    </div>
    <div class="xs muted" style="margin-top:10px;line-height:1.75">
      開局後的第一件事，是決定要加入大黨、加入小黨，還是誰都不靠。
    </div>
  </div>`;
}
const row = (k, v) => `<div class="row"><span class="row-k">${k}</span><span class="row-v">${v}</span></div>`;
