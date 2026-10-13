// One set's page: the main table, expected pull rates, expected-vs-reported chart, and pies.
import { get, count } from './api.js';
import { mountChrome } from './chrome.js';
import { SITE_NAME } from './config.js';
import {
  RARITIES, RARITY_CLASS, FILL_CLASS, THIN, SET_ORDER, setLabel, currentSet, DASH, esc, num, fmtInt, fmtAmt, fmtPct, fmtPPC, fmtDate, hueFor,
  buildTable, binomPmf, atLeast, baselineRates, histFor, histStats, showError,
} from './lib.js';
import { pie, histChart } from './charts.js';

const app = document.getElementById('app');
mountChrome('set');
init();

async function init() {
  app.innerHTML = '<div class="wrap"><p class="status">Loading…</p></div>';
  try {
    const sets = await get(`sets?select=*&${SET_ORDER}`);
    if (!sets.length) { app.innerHTML = '<div class="wrap"><h1>No sets yet</h1><p>Sets are added from the admin page.</p></div>'; return; }
    const slug = new URLSearchParams(location.search).get('set');
    const set = slug ? sets.find((s) => s.slug === slug) : currentSet(sets);
    if (!set) { app.innerHTML = '<div class="wrap"><h2>Set not found</h2><p><a href="history.html">See all sets</a></p></div>'; return; }
    const id = set.id;
    const [sp, totals, hist, reports, last] = await Promise.all([
      get(`set_products?select=products(*)&set_id=eq.${id}`),
      get(`set_totals?select=*&set_id=eq.${id}`),
      get(`item_histogram?select=*&set_id=eq.${id}`),
      count(`submissions?select=id&set_id=eq.${id}&status=eq.visible`),
      get(`submissions?select=created_at&set_id=eq.${id}&status=eq.visible&order=created_at.desc&limit=1`),
    ]);
    const products = sp.map((x) => x.products).filter(Boolean).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    document.title = `${set.name} pull rates | ${SITE_NAME}`;
    render({ sets, set, products, totals, hist, reports, last: last[0] ? last[0].created_at : null });
  } catch (e) { showError(app.querySelector('.wrap') || app, e, init); }
}

function render({ sets, set, products, totals, hist, reports, last }) {
  const t = buildTable(products, totals);
  const baseline = products.find((p) => p.id === set.baseline_product_id);
  const baseRow = baseline ? t.rows.find((r) => r.key === 'p' + baseline.id) : null;
  const rates = baselineRates(baseRow);

  const options = sets.map((s) => `<option value="${esc(s.slug)}"${s.id === set.id ? ' selected' : ''}>${esc(setLabel(s))}</option>`).join('');
  const hasData = t.overall.packs > 0;

  app.innerHTML = `
    <header class="banner" id="banner"><div class="wrap">
      <h1>Choose a set to see reported results</h1>
      <div class="controls">
        <label>Showing set <select id="setpick" aria-label="Choose a set">${options}</select></label>
        ${set.accepting_submissions ? '<a class="btn" href="submit.html?set=' + encodeURIComponent(set.slug) + '">Report your pulls</a>' : '<span class="viewonly">View only. This set is no longer collecting reports.</span>'}
      </div>
      <dl class="facts">
        <div><dt>Reports</dt><dd>${fmtInt(reports)}</dd></div>
        <div><dt>Packs opened</dt><dd>${fmtInt(t.overall.packs)}</dd></div>
        ${t.overall.boxes !== undefined ? `<div><dt>Boxes opened</dt><dd>${fmtAmt(t.overall.boxes)}</dd></div>` : ''}
        ${last ? `<div><dt>Latest report</dt><dd>${esc(fmtDate(last))}</dd></div>` : ''}
      </dl>
    </div></header>
    <div class="wrap" id="body"></div>`;
  const banner = document.getElementById('banner');
  banner.style.setProperty('--hue', hueFor(set.slug));
  // A set can have its own color (picked in the admin page). Otherwise the banner color comes from the set's name.
  const accent = /^#[0-9a-f]{6}$/i.test(set.accent_color || '') ? set.accent_color : null;
  for (const el of [banner, app]) { el.classList.toggle('has-accent', !!accent); if (accent) el.style.setProperty('--accent', accent); }
  document.getElementById('setpick').addEventListener('change', (e) => { location.href = 'set.html?set=' + encodeURIComponent(e.target.value); });

  const body = document.getElementById('body');
  if (!hasData) {
    body.innerHTML = set.accepting_submissions
      ? `<h2>No pulls reported yet</h2><p>Nobody has reported pulls for this set yet. <a href="submit.html?set=${encodeURIComponent(set.slug)}">Be the first to report</a>.</p>`
      : `<h2>No pulls were collected</h2><p>This set is view only, and no pulls were collected for it.</p>`;
    return;
  }

  body.innerHTML = `
    <h2>Pulls by product</h2>
    <p class="muted">Every report counts, including the unlucky ones. Bulk rows are totals from people who opened several of a product and didn't track each one.</p>
    <div class="seg" role="group" aria-label="Choose columns" id="viewseg">
      <button type="button" data-view="all" aria-pressed="false">All columns</button>
      <button type="button" data-view="pulls" aria-pressed="false">Pulls</button>
      <button type="button" data-view="ppc" aria-pressed="false">Packs per card</button>
      <button type="button" data-view="chance" aria-pressed="false">Chance per pack</button>
    </div>
    <div class="tablewrap"><table id="main" class="view-all">${mainTable(t)}</table></div>
    <p class="cap">Packs per card is packs opened divided by cards pulled. Chance per pack is the same information as a percentage. <em>Italic figures</em> come from fewer than ${THIN} pulls, so treat them as rough.</p>

    <h2>Expected pull rates</h2>
    ${expectedIntro(baseline, baseRow, rates)}
    <div id="expected">${rates ? expectedTables(products, baseline, rates, hist) : ''}</div>

    <h2>Reported results against the expected spread</h2>
    <div id="histbox">${rates ? '' : '<p class="muted">Needs reports for the baseline product first.</p>'}</div>

    <h2>Where the data comes from</h2>
    <div class="two" id="pies"></div>`;

  // Column view: on narrow screens start with one group; on wide screens show everything.
  const table = document.getElementById('main');
  const setView = (v) => {
    table.className = 'view-' + v;
    document.querySelectorAll('#viewseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  };
  document.getElementById('viewseg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
  setView(window.matchMedia('(min-width: 1100px)').matches ? 'all' : 'pulls');

  if (rates) histSection(document.getElementById('histbox'), products, baseline, rates, hist);

  const detailRows = t.rows.filter((r) => !r.empty);
  document.getElementById('pies').innerHTML = `
    <div><h3>Packs opened</h3>${pie({ title: 'Packs opened by product', slices: detailRows.map((r) => ({ label: r.label, value: r.packs })) })}</div>
    <div><h3>Reported product</h3>${pie({ title: 'Product reported', slices: detailRows.map((r) => ({ label: r.label, value: r.amount })) })}</div>`;
}

// ---------- Main table ----------
function mainTable(t) {
  const head = `
    <thead>
      <tr><th rowspan="2" scope="col">Product</th><th rowspan="2" scope="col">Amount</th><th rowspan="2" scope="col">Packs</th>
        <th class="grp g-pulls" colspan="5" scope="colgroup">Pulls</th>
        <th class="grp g-ppc" colspan="5" scope="colgroup">Packs per card</th>
        <th class="grp g-chance" colspan="5" scope="colgroup">Chance per pack</th></tr>
      <tr>${['g-pulls', 'g-ppc', 'g-chance'].map((g) => RARITIES.map((r, i) =>
        `<th scope="col" class="${RARITY_CLASS[r.key]} ${g}${i === 0 ? ' sep' : ''}">${r.label}</th>`).join('')).join('')}</tr>
    </thead>`;
  const line = (r, extra = '') => {
    const cells = (g, fn) => RARITIES.map((x, i) => {
      const pulls = r.counts[x.key], thin = !r.empty && pulls < THIN ? ' thin' : '';
      return `<td class="n ${RARITY_CLASS[x.key]} ${g}${i === 0 ? ' sep' : ''}${g === 'g-pulls' ? '' : thin}">${fn(pulls)}</td>`;
    }).join('');
    return `<tr class="${r.kind}${r.empty ? ' empty' : ''}${extra}">
      <td>${esc(r.label)}</td>
      <td class="n">${r.empty || r.amount === null ? DASH : fmtAmt(r.amount)}</td>
      <td class="n">${r.empty ? DASH : fmtInt(r.packs)}</td>
      ${cells('g-pulls', (p) => (r.empty ? DASH : fmtInt(p)))}
      ${cells('g-ppc', (p) => (r.empty || !p ? DASH : fmtPPC(r.packs / p)))}
      ${cells('g-chance', (p) => (r.empty ? DASH : fmtPct(p / r.packs)))}
    </tr>`;
  };
  return head + `<tbody>${t.rows.map((r) => line(r)).join('')}${line(t.overall)}${t.rollups.map((r) => line(r)).join('')}</tbody>`;
}

// ---------- Expected pull rates ----------
function expectedIntro(baseline, baseRow, rates) {
  if (!baseline) return '<p class="muted">No baseline product has been chosen for this set.</p>';
  if (!rates) return `<p class="muted">Expected rates are built from individually tracked ${esc(baseline.name)} reports, and there aren't any yet.</p>`;
  return `<p>Every expected figure starts from one rate per rarity: the chance per pack seen in the ${fmtInt(baseRow.packs)} packs of individually tracked <strong>${esc(baseline.name)}</strong> reports. We use ${esc(baseline.name)} reports because they include every box, lucky or not. The figures below say how likely a single product is to give a certain result if packs behave like that baseline.</p>`;
}

function expectedTables(products, baseline, rates, hist) {
  const pm = (p, rarity) => binomPmf(p.packs_per_item, rates[rarity]);
  const simple = (key, label) => `
    <div><h3>${label}</h3><div class="tablewrap"><table>
      <thead><tr><th scope="col">Product</th><th scope="col">Chance of at least 1</th></tr></thead>
      <tbody>${products.map((p) => `<tr class="${p.id === baseline.id ? 'baseline' : ''}"><td>${esc(p.name)}</td><td class="n">${fmtPct(atLeast(pm(p, key), 1))}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  const epicRows = products.map((p) => {
    const st = histStats(histFor(hist, p.id, 'epic'));
    if (!st) return `<tr><td>${esc(p.name)}</td><td class="n">${DASH}</td><td class="n">${DASH}</td><td class="n">${DASH}</td><td class="n">${DASH}</td></tr>`;
    const pmf = pm(p, 'epic');
    const chance = st.mode === 0 ? pmf[0] : atLeast(pmf, st.mode);
    const how = st.mode === 0 ? 'none' : `${st.mode} or more`;
    return `<tr class="${p.id === baseline.id ? 'baseline' : ''}"><td>${esc(p.name)}</td><td class="n">${st.mode}</td><td class="n">${fmtPct(chance)} <span class="pct-note">${how}</span></td><td class="n">${st.max}</td><td class="n">${st.min}</td></tr>`;
  }).join('');
  return `<div class="two">${simple('iconic', 'Iconic')}${simple('enchanted', 'Enchanted')}</div>
    <h3>Epic</h3>
    <div class="tablewrap"><table>
      <thead><tr><th scope="col">Product</th><th scope="col">Most common result</th><th scope="col">Chance of that result</th><th scope="col">Most seen</th><th scope="col">Fewest seen</th></tr></thead>
      <tbody>${epicRows}</tbody></table></div>
    <p class="cap">"Most common result" is the number of Epics reported most often in one product. "Chance of that result" is how likely the baseline rate says it is: either none at all, or that many or more.</p>`;
}

// ---------- Expected vs reported chart ----------
function histSection(box, products, baseline, rates, hist) {
  const withData = products.filter((p) => histFor(hist, p.id, 'epic').length || RARITIES.some((r) => histFor(hist, p.id, r.key).length));
  if (!withData.length) { box.innerHTML = '<p class="muted">No individually tracked products yet.</p>'; return; }
  box.innerHTML = `
    <p class="muted">Bars show how many products gave each result. Dots show how many the baseline rate predicts. When bars and dots line up, the baseline describes the data well.</p>
    <div class="chart-controls">
      <label>Product<select id="hp">${withData.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>Rarity<select id="hr">${RARITIES.map((r) => `<option value="${r.key}"${r.key === 'epic' ? ' selected' : ''}>${r.label}</option>`).join('')}</select></label>
    </div><div id="hchart"></div>`;
  const draw = () => {
    const p = products.find((x) => x.id === Number(box.querySelector('#hp').value));
    const rk = box.querySelector('#hr').value;
    const rows = histFor(hist, p.id, rk), st = histStats(rows);
    if (!st) { box.querySelector('#hchart').innerHTML = '<p class="muted">No reports for this combination yet.</p>'; return; }
    const pmf = binomPmf(p.packs_per_item, rates[rk]);
    let hi = st.max;
    for (let k = st.max + 1; k < pmf.length; k++) if (pmf[k] * st.total >= 0.05) hi = k; else break;
    const by = Object.fromEntries(rows.map((r) => [r.pulls, r.items]));
    const buckets = [];
    for (let k = 0; k <= Math.min(hi, pmf.length - 1); k++) buckets.push({ k, actual: by[k] || 0, expected: pmf[k] * st.total });
    const label = RARITIES.find((r) => r.key === rk).label;
    box.querySelector('#hchart').innerHTML =
      histChart({ buckets, rarityFill: FILL_CLASS[rk], title: `${label} per ${p.name}: reported against expected`, yLabel: `${label} pulled in one ${p.name}` }) +
      `<p class="cap">Based on ${fmtInt(st.total)} ${esc(p.name)} reported individually.</p>`;
  };
  box.querySelector('#hp').addEventListener('change', draw);
  box.querySelector('#hr').addEventListener('change', draw);
  draw();
}
