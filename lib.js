// Shared helpers: formatting, the table math, and the probability math behind "expected pull rate".
import { SET_HUES } from './config.js';

export const RARITIES = [
  { key: 'iconic', label: 'Iconic' },
  { key: 'enchanted', label: 'Enchanted' },
  { key: 'epic', label: 'Epic' },
  { key: 'legendary', label: 'Legendary' },
  { key: 'legendary_foil', label: 'Legendary Foil' },
];
export const RARITY_CLASS = { iconic: 'r-iconic', enchanted: 'r-enchanted', epic: 'r-epic', legendary: 'r-legendary', legendary_foil: 'r-foil' };
export const FILL_CLASS = { iconic: 'f-iconic', enchanted: 'f-enchanted', epic: 'f-epic', legendary: 'f-legendary', legendary_foil: 'f-foil' };
// Sets are listed newest first by set number.
export const SET_ORDER = 'order=set_number.desc.nullslast,created_at.desc';
export const setLabel = (s) => (s.set_number != null ? `${s.set_number} - ${s.name}` : s.name);
// The set shown by default: the newest set that is still collecting reports, otherwise the newest set.
export const currentSet = (sets) => sets.find((s) => s.accepting_submissions) || sets[0];
export const THIN = 20; // fewer pulls than this = flagged as a rough figure

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v) => Number(v) || 0;
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const fmtAmt = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const fmtPct = (x) => (x * 100).toFixed(2) + '%';
export const fmtPPC = (v) => (v >= 25 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const DASH = '—';

export function hueFor(slug) {
  if (SET_HUES[slug] !== undefined) return SET_HUES[slug];
  let h = 0; for (const c of String(slug)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// ---------- Table math ----------
function mk(key, label, kind, parts) {
  const r = { key, label, kind, amount: 0, packs: 0, counts: Object.fromEntries(RARITIES.map((x) => [x.key, 0])) };
  for (const { t, m } of parts) {
    r.amount += num(t.amount) * m;
    r.packs += num(t.packs);
    for (const x of RARITIES) r.counts[x.key] += num(t[x.key]);
  }
  r.empty = r.packs === 0;
  return r;
}

// products: the set's products (sorted). totals: rows of the set_totals view for this set.
export function trackedOf(set) {
  const t = set && Array.isArray(set.tracked_rarities) ? set.tracked_rarities : null;
  return t ? RARITIES.filter((r) => t.includes(r.key)) : RARITIES;
}

// Products listed in the same order as the spreadsheet: Troves, Prerelease Box, Individual Sealed Box, Sealed Case (anything else after).
const PRODUCT_ORDER = ['trove', 'prerelease-box', 'sealed-box', 'sealed-case'];
export function sortProducts(products) {
  const rank = (p) => { const i = PRODUCT_ORDER.indexOf(p.slug); return i < 0 ? PRODUCT_ORDER.length : i; };
  return [...products].sort((a, b) => rank(a) - rank(b));
}

export function buildTable(products, totals, hideEmpty = false) {
  products = sortProducts(products);
  const by = (pid, bulk) => totals.filter((t) => t.product_id === pid && !!t.is_bulk === bulk);
  const as = (list, m = 1) => list.map((t) => ({ t, m }));
  const rows = [];
  for (const p of products) {
    rows.push(mk('p' + p.id, p.name, 'detail', as(by(p.id, false))));
    if (p.allows_bulk) rows.push(mk('b' + p.id, 'Bulk ' + p.name, 'bulk', as(by(p.id, true))));
  }
  const overall = mk('overall', 'Overall', 'overall', as(totals));
  overall.amount = null; // mixing troves and boxes in one "amount" would be misleading

  const rollups = [];
  const boxy = products.filter((p) => p.box_equivalents > 0);
  for (const p of boxy) {
    if (p.allows_bulk && by(p.id, true).some((t) => num(t.packs) > 0)) rollups.push(mk('r' + p.id, p.name + ' total', 'rollup', as([...by(p.id, false), ...by(p.id, true)])));
  }
  if (boxy.length) {
    const all = boxy.flatMap((p) => as([...by(p.id, false), ...by(p.id, true)], p.box_equivalents));
    const allBulk = boxy.flatMap((p) => as(by(p.id, true), p.box_equivalents));
    const ab = mk('allboxes', 'All boxes (a case counts as 4)', 'rollup', all);
    const abk = mk('allbulk', 'All bulk boxes (a case counts as 4)', 'rollup', allBulk);
    rollups.push(ab);
    if (!abk.empty) rollups.push(abk);
    overall.boxes = ab.amount;
  }
  return { rows: hideEmpty ? rows.filter((r) => !r.empty) : rows, overall, rollups };
}

// ---------- Probability ----------
// Probability of exactly k hits in n packs, for k = 0..n.
export function binomPmf(n, p) {
  const out = new Array(n + 1).fill(0);
  if (p <= 0) { out[0] = 1; return out; }
  if (p >= 1) { out[n] = 1; return out; }
  const q = 1 - p;
  out[0] = Math.pow(q, n);
  for (let k = 1; k <= n; k++) out[k] = (out[k - 1] * (n - k + 1) / k) * (p / q);
  return out;
}
export const atLeast = (pmf, k) => { let s = 0; for (let i = Math.max(k, 0); i < pmf.length; i++) s += pmf[i]; return Math.min(1, s); };

// Chance per pack for each rarity, taken from the baseline product's individually tracked reports.
export function baselineRates(baseRow) {
  if (!baseRow || !baseRow.packs) return null;
  return Object.fromEntries(RARITIES.map((r) => [r.key, baseRow.counts[r.key] / baseRow.packs]));
}

// Reported results for one product and rarity: [{pulls, items}] sorted by pulls.
export function histFor(hist, productId, rarity) {
  return hist.filter((h) => h.product_id === productId && h.rarity === rarity)
    .map((h) => ({ pulls: num(h.pulls), items: num(h.items) })).sort((a, b) => a.pulls - b.pulls);
}
export function histStats(rows) {
  if (!rows.length) return null;
  let mode = rows[0];
  for (const r of rows) if (r.items > mode.items) mode = r; // ties keep the lower number
  return { mode: mode.pulls, modeItems: mode.items, max: rows[rows.length - 1].pulls, min: rows[0].pulls, total: rows.reduce((s, r) => s + r.items, 0) };
}

export function showError(el, err, retry) {
  el.innerHTML = `<div class="notice error" role="alert"><p><strong>Couldn't load the data.</strong> ${esc(err && err.message ? err.message : 'Something went wrong.')}</p>${retry ? '<p><button class="btn" type="button" id="retry">Try again</button></p>' : ''}</div>`;
  if (retry) el.querySelector('#retry').addEventListener('click', retry);
}
