// @ts-check
export class EventBus {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) { this.map.get(ev)?.delete(fn); }
  emit(ev, payload) {
    for (const fn of this.map.get(ev) ?? []) {
      try { fn(payload); } catch (e) { console.error('[bus]', ev, e); }
    }
  }
}
export const bus = new EventBus();
