// @ts-check
const FILES = [
  'meta', 'scales', 'naming', 'districts', 'regions', 'central', 'world',
  'corporations', 'parties', 'laws', 'localBills', 'values', 'pops',
  'media', 'issues', 'budget', 'elections', 'starts', 'backgrounds',
  'tags', 'staffRoles', 'donations', 'pollsters', 'shows', 'constitution',
  'tuning', 'theories', 'images', 'cabinet',
  'china', 'people', 'canvass', 'favors', 'invitations', 'semiconductor', 'social',
  'reactions', 'firstTimes',
];
const EVENT_FILES = ['economy', 'energy', 'crossStrait', 'disaster', 'society', 'scandal', 'party', 'personal'];

import { normalizeEvents } from './normalize.js';

/** 單檔版把資料直接內嵌在頁面裡，就不用（也不能）走 fetch */
async function readJSON(rel) {
  const embedded = globalThis.__PE_DATA;
  if (embedded) {
    if (!(rel in embedded)) throw new Error(`內嵌資料缺少 ${rel}`);
    return embedded[rel];
  }
  const res = await fetch(`./${rel}`);
  if (!res.ok) throw new Error(`載入 ${rel} 失敗：${res.status}`);
  return res.json();
}

export async function loadData(onProgress = () => {}) {
  const data = {};
  let done = 0;
  const total = FILES.length + 1;

  await Promise.all(FILES.map(async (f) => {
    data[f] = await readJSON(`data/${f}.json`);
    onProgress(++done / total, f);
  }));

  const eventPacks = await Promise.all(EVENT_FILES.map(async (f) =>
    (await readJSON(`data/events/${f}.json`)).events));
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
    pollster: Object.fromEntries(d.pollsters.pollsters.map((p) => [p.id, p])),
    show: Object.fromEntries(d.shows.shows.map((s) => [s.id, s])),
    theory: Object.fromEntries(d.theories.theories.map((t) => [t.id, t])),
    playerImage: Object.fromEntries(d.images.playerImages.map((i) => [i.id, i])),
    partyImage: Object.fromEntries(d.images.partyImages.map((i) => [i.id, i])),
    ministry: Object.fromEntries(d.cabinet.ministries.map((m) => [m.id, m])),
    chinaDim: Object.fromEntries(d.china.dims.map((x) => [x.id, x])),
    chinaReason: Object.fromEntries(d.china.reasons.map((x) => [x.id, x])),
    canvassScene: Object.fromEntries(d.canvass.scenes.map((x) => [x.id, x])),
    favorKind: Object.fromEntries(d.favors.kinds.map((x) => [x.id, x])),
    invitation: Object.fromEntries(d.invitations.kinds.map((x) => [x.id, x])),
    semiSegment: Object.fromEntries(d.semiconductor.segments.map((x) => [x.id, x])),
    mediaAttack: Object.fromEntries(d.reactions.events.map((x) => [x.id, x])),
  };
  d.strataIds = d.pops.strata.map((s) => s.id);
  d.genIds = d.pops.generations.map((g) => g.id);
  d.partyIds = d.parties.parties.map((p) => p.id);
  d.axisIds = d.values.axes.map((a) => a.id);
  d.issueIds = d.issues.issues.map((i) => i.id);
  d.chinaKeys = d.china.dims.map((x) => x.id);
  d.reasonKeys = d.china.reasons.map((x) => x.id);
}
