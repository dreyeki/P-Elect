// @ts-check
import { esc } from '../util/dom.js';

const PAD = { l: 34, r: 8, t: 8, b: 18 };

export function lineChart(series, opts = {}) {
  const w = opts.w ?? 320, h = opts.h ?? 120;
  const all = series.flatMap((s) => s.data);
  if (all.length < 2) return `<div class="xs muted">資料還不夠畫成一條線。</div>`;
  const min = opts.min ?? Math.min(...all), max = opts.max ?? Math.max(...all);
  const span = (max - min) || 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const x = (i) => PAD.l + (i / Math.max(1, n - 1)) * (w - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - min) / span) * (h - PAD.t - PAD.b);
  const paths = series.map((s) =>
    `<path d="${s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"
      fill="none" stroke="${s.color ?? 'var(--accent)'}" stroke-width="1.8" stroke-linejoin="round"/>`).join('');
  const ticks = [min, (min + max) / 2, max].map((v) =>
    `<text x="2" y="${(y(v) + 3).toFixed(1)}" font-size="8" fill="var(--fg-3)">${fmt(v)}</text>
     <line x1="${PAD.l}" x2="${w - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"
       stroke="var(--line)" stroke-width=".5"/>`).join('');
  const labels = (opts.labels ?? []).map((l, i) => i % Math.ceil(n / 5) === 0
    ? `<text x="${x(i).toFixed(1)}" y="${h - 4}" font-size="8" fill="var(--fg-3)" text-anchor="middle">${esc(l)}</text>` : '').join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${ticks}${paths}${labels}</svg>`;
}

const fmt = (v) => Math.abs(v) >= 1000 ? Math.round(v / 100) / 10 + 'k'
  : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);

export function barRows(items, opts = {}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), opts.min ?? 1);
  return items.map((i) => `
    <div class="votebar">
      <span class="vn">${esc(i.label)}</span>
      <span class="vb"><i style="width:${(Math.abs(i.value) / max * 100).toFixed(1)}%;background:${i.color ?? 'var(--accent)'}"></i></span>
      <span class="vp">${esc(i.text ?? i.value.toFixed(1))}</span>
    </div>`).join('');
}

/** 15 區塊的雷達圖 */
export function radar(items, opts = {}) {
  const size = opts.size ?? 240, cx = size / 2, cy = size / 2, r = size / 2 - 26;
  const n = items.length;
  const pt = (i, v) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rr = r * ((v + 5) / 10);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((k) =>
    `<circle cx="${cx}" cy="${cy}" r="${(r * k).toFixed(1)}" fill="none" stroke="var(--line)" stroke-width=".5"/>`).join('');
  const poly = items.map((it, i) => pt(i, it.value).map((v) => v.toFixed(1)).join(',')).join(' ');
  const labels = items.map((it, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const lx = cx + Math.cos(a) * (r + 13), ly = cy + Math.sin(a) * (r + 13);
    return `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-size="7.5" fill="var(--fg-3)"
      text-anchor="${Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'}">${esc(it.label)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${size} ${size}">${rings}
    <polygon points="${poly}" fill="rgba(78,161,255,.18)" stroke="var(--accent)" stroke-width="1.4"/>
    ${labels}</svg>`;
}

/** 台灣：以地理位置排的方格圖，行動裝置上比實際輪廓好點也好讀 */
export const MAP_LAYOUT = [
  [null, null, 'KEE', 'TPE', null],
  ['LIE', null, 'NTP', 'ILA', null],
  [null, 'HSQ', 'TYC', null, null],
  [null, 'HSC', 'MIA', 'HUA', null],
  ['KIN', 'CHA', 'TCH', null, null],
  [null, 'YUN', 'NAN', null, null],
  ['PEN', 'CYI', 'CYQ', 'TTT', null],
  [null, 'TNN', 'KHH', null, null],
  [null, 'PIF', null, null, null],
];

export function taiwanMap(cellFn) {
  const cells = MAP_LAYOUT.flat().map((id) => id
    ? cellFn(id)
    : `<div class="mapcell void"></div>`).join('');
  return `<div class="mapgrid">${cells}</div>`;
}
