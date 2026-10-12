// Small hand-built SVG charts. No outside libraries, so nothing extra to load or keep updated.
// Colors come from CSS classes (f-c1.., f-iconic..) so light and dark mode both work.
import { esc, fmtAmt, fmtInt } from './lib.js';

const cls = (i) => 'f-c' + ((i % 8) + 1);
export const bg = (i) => 'bg-c' + ((i % 8) + 1);

// Pie chart with a legend that carries the actual numbers.
export function pie({ title, slices, unit = '' }) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return `<p class="muted">No data yet.</p>`;
  let a0 = -Math.PI / 2, paths = '';
  const R = 90, C = 100;
  data.forEach((d, i) => {
    const frac = d.value / total;
    if (frac >= 0.9999) { paths += `<circle class="${cls(i)}" cx="${C}" cy="${C}" r="${R}"/>`; return; }
    const a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0), x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    paths += `<path class="${cls(i)} slice" d="M${C} ${C} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"/>`;
    a0 = a1;
  });
  const legend = data.map((d, i) =>
    `<li><span class="sw ${bg(i)}"></span><span class="lg-name">${esc(d.label)}</span><span class="lg-val">${fmtAmt(d.value)}${unit} <span class="muted">(${(d.value / total * 100).toFixed(1)}%)</span></span></li>`).join('');
  return `<div class="pie"><svg viewBox="0 0 200 200" role="img" aria-label="${esc(title)}">${paths}</svg><ul class="legend">${legend}</ul></div>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// Reported results (bars) against what the baseline rate predicts (dots).
// buckets: [{k, actual, expected}] ; rarityFill: CSS class for the bars
export function histChart({ buckets, rarityFill, title, yLabel }) {
  const W = 720, H = 280, L = 44, R = 12, T = 14, B = 40;
  const maxV = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.actual, b.expected))));
  const iw = W - L - R, ih = H - T - B, bw = iw / buckets.length;
  const y = (v) => T + ih - (v / maxV) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i) / 4;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ct" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtAmt(v)}</text>`;
  }
  buckets.forEach((b, i) => {
    const x = L + i * bw, w = Math.max(3, bw * 0.62), bx = x + (bw - w) / 2;
    if (b.actual > 0) g += `<rect class="${rarityFill}" x="${bx.toFixed(1)}" y="${y(b.actual).toFixed(1)}" width="${w.toFixed(1)}" height="${(T + ih - y(b.actual)).toFixed(1)}" rx="2"><title>${b.k} reported: ${fmtAmt(b.actual)} (expected ${b.expected.toFixed(1)})</title></rect>`;
    g += `<circle class="expected" cx="${(x + bw / 2).toFixed(1)}" cy="${y(b.expected).toFixed(1)}" r="4"><title>${b.k}: expected ${b.expected.toFixed(1)}</title></circle>`;
    if (buckets.length <= 24 || i % 2 === 0) g += `<text class="ct" x="${(x + bw / 2).toFixed(1)}" y="${H - B + 16}" text-anchor="middle">${b.k}</text>`;
  });
  g += `<text class="ct" x="${(L + iw / 2)}" y="${H - 6}" text-anchor="middle">${esc(yLabel)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg>`;
}

// Side-by-side bars: one cluster per group, one bar per series (set).
// groups: [{label, values:[number|null]}] ; series: [{name}] ; fmt: number -> text
export function groupedBars({ groups, series, fmt, title }) {
  const W = 760, H = 300, L = 54, R = 12, T = 18, B = 62;
  const vals = groups.flatMap((g) => g.values).filter((v) => v !== null && isFinite(v));
  if (!vals.length) return `<p class="muted">No data to chart for these sets yet.</p>`;
  const maxV = niceMax(Math.max(...vals));
  const iw = W - L - R, ih = H - T - B, gw = iw / groups.length;
  const y = (v) => T + ih - (v / maxV) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i) / 4;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ct" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  groups.forEach((grp, gi) => {
    const gx = L + gi * gw, inner = gw * 0.8, bw = inner / series.length;
    grp.values.forEach((v, si) => {
      if (v === null || !isFinite(v)) return;
      const x = gx + (gw - inner) / 2 + si * bw;
      g += `<rect class="${cls(si)}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${Math.max(2, bw - 2).toFixed(1)}" height="${Math.max(0, T + ih - y(v)).toFixed(1)}" rx="2"><title>${esc(series[si].name)}, ${esc(grp.label)}: ${esc(fmt(v))}</title></rect>`;
    });
    const words = grp.label.length > 16 ? [grp.label.slice(0, 15) + '…'] : [grp.label];
    g += `<text class="ct" x="${(gx + gw / 2).toFixed(1)}" y="${H - B + 18}" text-anchor="middle">${esc(words[0])}</text>`;
  });
  const legend = series.map((s, i) => `<li><span class="sw ${bg(i)}"></span>${esc(s.name)}</li>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg><ul class="legend inline">${legend}</ul>`;
}
