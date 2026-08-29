// @ts-check
import { Pops } from '../core/Pops.js';
import { ModifierStack } from '../core/Modifier.js';
import { packPeople, unpackPeople } from '../systems/PeopleSystem.js';
import { migrate, CURRENT_SCHEMA } from './migrations.js';

const KEY = 'p-election:save:';
const PREF_KEY = 'p-election:setup';
const SLOTS = ['auto', '1', '2', '3'];

// 讀檔時要把省下來的欄位補回去，需要資料檔查表。開機時設一次就好。
let DATA = null;
export function setData(d) { DATA = d; }

export function serialize(state) {
  const out = { ...state };
  out.pops = state.pops.toJSON();
  out.modifiers = state.modifiers.toJSON();
  out.people = packPeople(state.people);
  out.assets = packAssets(state.assets);
  return {
    saveSchemaVersion: CURRENT_SCHEMA,
    dataVersion: state.meta.dataVersion,
    savedAt: new Date().toISOString(),
    turn: state.meta.turn,
    label: `${state.meta.year} 年 ${state.meta.month} 月・${state.player.name}`,
    state: out,
  };
}

/**
 * 私有財產的存檔壓縮。
 * 房價與部位市值每個回合都在跑小數，存到元以下沒有任何意義，
 * 而那些小數點會讓存檔多出好幾 KB。
 */
function packAssets(A) {
  if (!A) return null;
  const r = (v) => Math.round(v ?? 0);
  return {
    ...A,
    house: A.house ? { ...A.house, value: r(A.house.value), mortgage: r(A.house.mortgage) } : null,
    loans: (A.loans ?? []).map((l) => ({ ...l, balance: r(l.balance) })),
    holdings: (A.holdings ?? []).map((h) => ({ ...h, value: r(h.value), cost: r(h.cost) })),
  };
}

export function deserialize(save, data = DATA) {
  const s = migrate(save);
  const st = s.state;
  st.pops = Pops.fromJSON(st.pops);
  st.modifiers = new ModifierStack(st.modifiers ?? []);
  if (data) unpackPeople(st.people, data);
  // 舊存檔沒有這一本帳。補一個空的比在每個呼叫點寫 ?. 安全。
  st.assets ??= { house: null, loans: [], holdings: [], scamHistory: [], loanHistory: [], scamOffer: null };
  st.assets.loans ??= [];
  st.assets.holdings ??= [];
  st.assets.scamHistory ??= [];
  st.assets.loanHistory ??= [];
  return st;
}

export function save(state, slot = 'auto') {
  try {
    const payload = JSON.stringify(serialize(state));
    localStorage.setItem(KEY + slot, payload);
    return { ok: true, bytes: payload.length };
  } catch (e) {
    return { ok: false, msg: e.name === 'QuotaExceededError'
      ? '瀏覽器的儲存空間已經滿了，請先匯出並刪除舊的存檔。' : String(e.message) };
  }
}

export function load(slot = 'auto') {
  let raw = null;
  try { raw = localStorage.getItem(KEY + slot); } catch { return null; }
  if (!raw) return null;
  try { return deserialize(JSON.parse(raw), DATA); }
  catch (e) { console.error('[save] 讀檔失敗', e); return null; }
}

export function listSlots() {
  return SLOTS.map((s) => {
    let raw = null;
    try { raw = localStorage.getItem(KEY + s); } catch { return { slot: s, empty: true }; }
    if (!raw) return { slot: s, empty: true };
    try {
      const o = JSON.parse(raw);
      return { slot: s, empty: false, label: o.label, savedAt: o.savedAt, turn: o.turn, bytes: raw.length };
    } catch { return { slot: s, empty: true, broken: true }; }
  });
}

export function remove(slot) { try { localStorage.removeItem(KEY + slot); } catch {} }

/* ─────────── 開局偏好 ───────────
 * 上一局是怎麼開的，下一局就從那裡開始。
 * 這跟存檔是兩件事：存檔存的是一個世界，這裡存的只是建角畫面上的那幾個選擇。
 * 所以它獨立一個鍵，刪存檔不會把它一起刪掉。
 */
const PREF_FIELDS = ['name', 'gender', 'education', 'age', 'startId', 'backgroundId',
  'homeDistrict', 'homeRegion', 'partyMode', 'party', 'attrs', 'ideology', 'china'];

export function saveSetupPrefs(draft) {
  try {
    const out = { v: 1, savedAt: new Date().toISOString() };
    for (const k of PREF_FIELDS) out[k] = structuredClone(draft[k]);
    localStorage.setItem(PREF_KEY, JSON.stringify(out));
    return true;
  } catch { return false; }
}

/**
 * 讀回上一局的選擇。
 * 資料檔可能已經改過（選區被刪、軸被改名、出身被拿掉），
 * 所以每一項都要拿現在的資料檔驗一次，驗不過的就退回預設值——
 * 不能因為一次資料更新就讓玩家的建角畫面壞掉。
 */
export function loadSetupPrefs(data) {
  let raw = null;
  try { raw = localStorage.getItem(PREF_KEY); } catch { return null; }
  if (!raw) return null;
  let o;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || o.v !== 1) return null;

  const out = {};
  const has = (list, id) => id != null && list.some((x) => x.id === id);
  if (typeof o.name === 'string' && o.name.trim()) out.name = o.name.slice(0, 8);
  if (['m', 'f', 'x'].includes(o.gender)) out.gender = o.gender;
  if (['高中職', '大學', '碩士', '博士', '海外名校'].includes(o.education)) out.education = o.education;
  if (has(data.starts.starts, o.startId)) out.startId = o.startId;
  if (has(data.backgrounds.backgrounds, o.backgroundId)) out.backgroundId = o.backgroundId;
  if (data.byId.district[o.homeDistrict]) out.homeDistrict = o.homeDistrict;
  if (data.byId.region[o.homeRegion]) out.homeRegion = o.homeRegion;
  if (has(data.starts.partyChoice, o.partyMode)) out.partyMode = o.partyMode;
  if (o.party === null || data.byId.party[o.party]) out.party = o.party;

  // 年齡要落在該起點允許的範圍內，起點換過的話就夾回去
  const st = data.starts.starts.find((x) => x.id === (out.startId ?? data.starts.defaults?.startId));
  if (Number.isFinite(o.age) && st) {
    out.age = Math.min(st.ageRange[1], Math.max(st.ageRange[0], Math.round(o.age)));
  }
  // 屬性只收現在還存在的六項，而且要在 0~5
  if (o.attrs && typeof o.attrs === 'object') {
    const a = {};
    for (const k of ['stamina', 'sociability', 'charisma', 'eloquence', 'judgment', 'boldness']) {
      const v = o.attrs[k];
      a[k] = Number.isFinite(v) ? Math.min(5, Math.max(0, Math.round(v))) : 2;
    }
    out.attrs = a;
  }
  // 價值觀與兩岸只收現在還存在的軸
  if (o.ideology) {
    const ax = {};
    for (const x of data.values.axes) {
      const v = o.ideology[x.id];
      ax[x.id] = Number.isFinite(v) ? Math.min(5, Math.max(-5, Math.round(v))) : 0;
    }
    out.ideology = ax;
  }
  if (o.china) {
    const cn = {};
    for (const x of data.china.dims) {
      const v = o.china[x.id];
      cn[x.id] = Number.isFinite(v) ? Math.min(5, Math.max(-5, Math.round(v))) : 0;
    }
    out.china = cn;
  }
  out.savedAt = o.savedAt;
  return out;
}

export function clearSetupPrefs() { try { localStorage.removeItem(PREF_KEY); } catch {} }
export function hasSetupPrefs() {
  try { return !!localStorage.getItem(PREF_KEY); } catch { return false; }
}

export function exportFile(state) {
  const blob = new Blob([JSON.stringify(serialize(state))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `選舉人生_${state.meta.year}年${state.meta.month}月_${state.player.name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importFile(file) {
  const text = await file.text();
  return deserialize(JSON.parse(text), DATA);
}
