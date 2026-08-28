// @ts-check
export const CURRENT_SCHEMA = 1;

export const migrations = {
  1: (s) => s,
  // 之後每次改動 GameState 結構就 +1 並在這裡補一個函式。永不破壞舊存檔。
};

export function migrate(save) {
  let s = save;
  let v = s.saveSchemaVersion ?? 1;
  while (v < CURRENT_SCHEMA) {
    v += 1;
    s = migrations[v](s);
    s.saveSchemaVersion = v;
  }
  return s;
}
