// @ts-check
const FILES = [
  'meta', 'scales', 'naming', 'districts', 'regions', 'central', 'world',
  'corporations', 'parties', 'laws', 'localBills', 'values', 'pops',
  'media', 'issues', 'budget', 'elections', 'starts', 'backgrounds',
  'tags', 'staffRoles', 'donations',
];
const EVENT_FILES = ['economy', 'energy', 'crossStrait', 'disaster', 'society', 'scandal', 'party', 'personal'];

import { normalizeEvents } from './normalize.js';

export async function loadData(onProgress = () => {}) {
  const data = {};
  let done = 0;
  const total = FILES.length + 1;

  await Promise.all(FILES.map(async (f) => {
    const res = await fetch(`./data/${f}.json`);
    if (!res.ok) throw new Error(`載入 data/${f}.json 失敗：${res.status}`);
    data[f] = await res.json();
    onProgress(++done / total, f);
  }));

  const eventPacks = await Promise.all(EVENT_FILES.map(async (f) => {
    const res = await fetch(`./data/events/${f}.json`);
    if (!res.ok) throw new Error(`載入 data/events/${f}.json 失敗`);
    return (await res.json()).events;
  }));
  data.events = eventPacks.flat();
  onProgress(1, 'events');

  index(data);
  normalizeEvents(data);
  return data;
}

function index(d) {
  d.byId = {
    region: Object.fromEntries(d.regions.regions.map((r) => [r.id, r])),
    district: Object.fromEntries(d.districts.districts.map((x) => [x.id, x])),
    party: Object.fromEntries(d.parties.parties.map((p) => [p.id, p])),
    law: Object.fromEntries(d.laws.laws.map((l) => [l.id, l])),
    bill: Object.fromEntries(d.localBills.bills.map((b) => [b.id, b])),
    axis: Object.fromEntries(d.values.axes.map((a) => [a.id, a])),
    world: Object.fromEntries(d.world.blocks.map((b) => [b.id, b])),
    corp: Object.fromEntries(d.corporations.corporations.map((c) => [c.id, c])),
    media: Object.fromEntries(d.media.media.map((m) => [m.id, m])),
    issue: Object.fromEntries(d.issues.issues.map((i) => [i.id, i])),
    stratum: Object.fromEntries(d.pops.strata.map((s) => [s.id, s])),
    tag: Object.fromEntries(d.tags.tags.map((t) => [t.id, t])),
    staffRole: Object.fromEntries(d.staffRoles.roles.map((r) => [r.id, r])),
    event: Object.fromEntries(d.events.map((e) => [e.id, e])),
  };
  d.strataIds = d.pops.strata.map((s) => s.id);
  d.genIds = d.pops.generations.map((g) => g.id);
  d.partyIds = d.parties.parties.map((p) => p.id);
  d.axisIds = d.values.axes.map((a) => a.id);
  d.issueIds = d.issues.issues.map((i) => i.id);
}
