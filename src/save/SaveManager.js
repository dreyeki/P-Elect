// @ts-check
import { Pops } from '../core/Pops.js';
import { ModifierStack } from '../core/Modifier.js';
import { migrate, CURRENT_SCHEMA } from './migrations.js';

const KEY = 'p-election:save:';
const SLOTS = ['auto', '1', '2', '3'];

export function serialize(state) {
  const out = { ...state };
  out.pops = state.pops.toJSON();
  out.modifiers = state.modifiers.toJSON();
  return {
    saveSchemaVersion: CURRENT_SCHEMA,
    dataVersion: state.meta.dataVersion,
    savedAt: new Date().toISOString(),
    turn: state.meta.turn,
    label: `${state.meta.year} 年 ${state.meta.month} 月・${state.player.name}`,
    state: out,
  };
}

export function deserialize(save) {
  const s = migrate(save);
  const st = s.state;
  st.pops = Pops.fromJSON(st.pops);
  st.modifiers = new ModifierStack(st.modifiers ?? []);
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
  try { return deserialize(JSON.parse(raw)); }
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
  return deserialize(JSON.parse(text));
}
