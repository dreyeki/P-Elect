// @ts-check
/**
 * 修正值堆疊。任何加成都不直接改基礎值，而是壓進這裡，
 * 讓 UI 能回答「我的支持度為什麼是 52%」。
 */
export class ModifierStack {
  constructor(list = []) { this.list = list; }

  add(mod) {
    // mod: { id, source, label, target, op:'add'|'mult', value, duration, startTurn }
    const i = this.list.findIndex((m) => m.id === mod.id);
    if (i >= 0) this.list[i] = mod; else this.list.push(mod);
  }
  removeBySource(source) { this.list = this.list.filter((m) => m.source !== source); }
  remove(id) { this.list = this.list.filter((m) => m.id !== id); }

  /** 回傳 target 的加總結果與明細 */
  resolve(target, base = 0) {
    let add = 0, mult = 1;
    const parts = [];
    for (const m of this.list) {
      if (m.target !== target) continue;
      if (m.op === 'mult') { mult *= 1 + m.value; parts.push(m); }
      else { add += m.value; parts.push(m); }
    }
    return { value: (base + add) * mult, add, mult, parts };
  }
  get(target, base = 0) { return this.resolve(target, base).value; }
  explain(target) { return this.list.filter((m) => m.target === target); }

  tick(turn) {
    this.list = this.list.filter((m) => m.duration < 0 || turn - m.startTurn < m.duration);
  }
  toJSON() { return this.list; }
}
