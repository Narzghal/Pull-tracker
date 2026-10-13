// Put sets side by side. Compares per-pack rates, so sets with different numbers of reports stay comparable.
import { get } from './api.js';
import { mountChrome } from './chrome.js';
import { SITE_NAME } from './config.js';
import { RARITIES, trackedOf, THIN, DASH, esc, num, fmtInt, fmtPct, fmtPPC, showError, SET_ORDER, setLabel } from './lib.js';
import { groupedBars, bg } from './charts.js';

const app = document.getElementById('app');
mountChrome('compare');
document.title = `Compare sets | ${SITE_NAME}`;

const st = { sets: [], products: [], totals: [], picked: new Set(), rarity: 'epic', metric: 'chance' };
init();

async function init() {
  try {
    const [sets, products, totals] = await Promise.all([
      get(`sets?select=*&${SET_ORDER}`),
      get('products?select=*&order=sort_order'),
      get('set_totals?select=*'),
    ]);
    st.sets = [...sets].reverse(); st.products = products; st.totals = totals; // oldest first
    const withData = new Set(totals.filter((t) => num(t.packs) > 0).map((t) => t.set_id));
    sets.filter((s) => withData.has(s.id)).slice(0, 4).forEach((s) => st.picked.add(s.id));
    shell();
    draw();
  } catch (e) { showError(app, e, init); }
}

function shell() {
  app.innerHTML = `<div class="wrap">
    <h1 class="page-title">Compare sets</h1>
    <p class="muted">Pick the sets to compare. Rates are per pack, so a set with fewer reports can still be compared fairly, though small samples are less certain.</p>
    <div class="notice"><p><strong>Keep in mind:</strong> starting with Wilds Unknown (set 12), pull rates changed noticeably. There is enough evidence to show the change was intentional on the packaging side. Be careful when comparing sets before Wilds Unknown with Wilds Unknown and later sets, because they were not produced the same way.</p></div>
    <fieldset><legend>Sets</legend><div class="checks" id="setchecks">${st.sets.map((s) =>
      `<label><input type="checkbox" value="${s.id}"${st.picked.has(s.id) ? ' checked' : ''}> ${esc(setLabel(s))}</label>`).join('')}</div></fieldset>
    <div class="seg" role="group" aria-label="Rarity" id="rseg">${RARITIES.map((r) => `<button type="button" data-r="${r.key}" aria-pressed="false">${r.label}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Measure" id="mseg">
      <button type="button" data-m="chance" aria-pressed="false">Chance per pack</button>
      <button type="button" data-m="ppc" aria-pressed="false">Packs per card</button>
    </div>
    <div id="out"></div></div>`;
  app.querySelector('#setchecks').addEventListener('change', (e) => {
    const id = Number(e.target.value);
    e.target.checked ? st.picked.add(id) : st.picked.delete(id);
    draw();
  });
  app.querySelector('#rseg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.rarity = b.dataset.r; draw(); } });
  app.querySelector('#mseg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.metric = b.dataset.m; draw(); } });
}

// Group definitions: each product (detailed + bulk together), all boxes, and everything.
function groupsFor(setIds) {
  const rows = st.totals.filter((t) => setIds.includes(t.set_id));
  const sum = (list) => {
    // pk[rarity] counts only packs from sets that tracked that rarity, so older sets don't dilute the rate.
    const o = { packs: 0, pk: {} }; RARITIES.forEach((r) => { o[r.key] = 0; o.pk[r.key] = 0; });
    list.forEach((t) => {
      const tracked = trackedOf(st.sets.find((s) => s.id === t.set_id));
      o.packs += num(t.packs);
      RARITIES.forEach((r) => { if (tracked.includes(r)) { o[r.key] += num(t[r.key]); o.pk[r.key] += num(t.packs); } });
    });
    return o;
  };
  const groups = [{ label: 'Overall', ...sum(rows) }];
  st.products.forEach((p) => groups.push({ label: p.name, ...sum(rows.filter((t) => t.product_id === p.id)) }));
  const boxy = new Set(st.products.filter((p) => p.box_equivalents > 0).map((p) => p.id));
  if (boxy.size > 1) groups.push({ label: 'All boxes', ...sum(rows.filter((t) => boxy.has(t.product_id))) });
  return groups;
}

function draw() {
  document.querySelectorAll('#rseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.r === st.rarity)));
  document.querySelectorAll('#mseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === st.metric)));
  const out = app.querySelector('#out');
  const chosen = st.sets.filter((s) => st.picked.has(s.id));
  if (!chosen.length) { out.innerHTML = '<p class="muted">Choose at least one set above.</p>'; return; }

  const cols = chosen.map((s) => ({ name: s.name, groups: groupsFor([s.id]) }));
  if (chosen.length > 1) cols.push({ name: 'All selected combined', groups: groupsFor(chosen.map((s) => s.id)), combined: true });
  const labels = cols[0].groups.map((g) => g.label);
  const value = (g) => {
    const pulls = g[st.rarity], pk = g.pk[st.rarity];
    if (!pk || (st.metric === 'ppc' && !pulls)) return null;
    return st.metric === 'chance' ? pulls / pk : pk / pulls;
  };
  const fmt = (v) => (st.metric === 'chance' ? fmtPct(v) : fmtPPC(v));
  const rLabel = RARITIES.find((r) => r.key === st.rarity).label;

  const keep = labels.map((l, i) => cols.some((c) => c.groups[i].pk[st.rarity] > 0));
  const shownIdx = labels.map((_, i) => i).filter((i) => keep[i]);
  if (!shownIdx.length) { out.innerHTML = '<p class="muted">None of the selected sets have data for this rarity.</p>'; return; }

  const head = `<tr><th scope="col">${esc(rLabel)}</th>${cols.map((c, i) => `<th scope="col">${i < chosen.length ? `<span class="sw ${bg(i)}"></span> ` : ''}${esc(c.name)}</th>`).join('')}</tr>`;
  const body = shownIdx.map((i) => `<tr class="${i === 0 ? 'overall' : ''}"><td>${esc(labels[i])}</td>${cols.map((c) => {
    const g = c.groups[i], v = value(g), pk = g.pk[st.rarity], thin = pk && g[st.rarity] < THIN ? ' thin' : '';
    return `<td class="n${thin}">${v === null ? DASH : fmt(v)}<br><span class="pct-note">${pk ? fmtInt(g[st.rarity]) + ' pulls, ' + fmtInt(pk) + ' packs' : (g.packs ? 'not tracked' : 'no reports')}</span></td>`;
  }).join('')}</tr>`).join('');

  const series = chosen.map((s) => ({ name: s.name }));
  const chart = groupedBars({
    title: `${rLabel} ${st.metric === 'chance' ? 'chance per pack' : 'packs per card'} by set`,
    groups: shownIdx.map((i) => ({ label: labels[i], values: cols.slice(0, chosen.length).map((c) => value(c.groups[i])) })),
    series, fmt,
  });
  out.innerHTML = `
    <h2>${esc(rLabel)}, ${st.metric === 'chance' ? 'chance per pack' : 'packs per card'}</h2>
    ${chart}
    <h3>The numbers</h3>
    <div class="tablewrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <p class="cap">${st.metric === 'chance' ? 'Higher means the rarity shows up more often.' : 'Lower means the rarity shows up more often.'} <em>Italic figures</em> come from fewer than ${THIN} pulls.</p>`;
}
