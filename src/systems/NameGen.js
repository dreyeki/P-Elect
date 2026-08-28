// @ts-check
export function makeName(data, rng, birthYear = 1980) {
  const n = data.naming;
  const sur = rng.weighted(n.surnames, (s) => s.w).s;
  const decade = birthYear < 1965 ? '1950' : birthYear < 1985 ? '1970' : birthYear < 1998 ? '1990' : '2000';
  const pool = n.givenNames[decade] ?? n.givenNames['1970'];
  const gender = rng.bool() ? 'male' : 'female';
  const chars = pool[gender] ?? pool.male;
  const given = rng.bool(0.85) ? rng.pick(chars) + rng.pick(chars) : rng.pick(chars);
  const full = sur + given;
  if (n.blacklist?.includes(full)) return makeName(data, rng, birthYear);
  return full;
}

export function makePolitician(data, rng, opts = {}) {
  const birthYear = opts.birthYear ?? (2026 - rng.int(35, 68));
  return {
    id: 'npc_' + Math.floor(rng.next() * 1e6).toString(36),
    name: makeName(data, rng, birthYear),
    birthYear,
    party: opts.party ?? null,
    faction: opts.faction ?? null,
    attrs: {
      eloquence: rng.int(1, 5), judgment: rng.int(1, 5), charisma: rng.int(1, 5),
      sociability: rng.int(1, 5), boldness: rng.int(0, 5), stamina: rng.int(1, 5),
    },
    fame: opts.fame ?? rng.int(1, 4),
    integrity: rng.int(1, 5),
    stigma: rng.bool(0.25) ? rng.int(1, 3) : 0,
    ambition: rng.int(1, 5),
  };
}
