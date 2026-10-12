// List of every set, newest first, each linking to its own page.
import { get, count } from './api.js';
import { mountChrome } from './chrome.js';
import { SITE_NAME } from './config.js';
import { esc, num, fmtInt, fmtDate, showError, SET_ORDER, setLabel } from './lib.js';

const app = document.getElementById('app');
mountChrome('history');
document.title = `All sets | ${SITE_NAME}`;
init();

async function init() {
  try {
    const [sets, totals] = await Promise.all([
      get(`sets?select=*&${SET_ORDER}`),
      get('set_totals?select=set_id,packs,has_summary'),
    ]);
    const reports = await Promise.all(sets.map((s) => count(`submissions?select=id&set_id=eq.${s.id}&status=eq.visible`)));
    const anyDate = sets.some((s) => s.released_on);
    const packs = {}, summ = {};
    totals.forEach((t) => { packs[t.set_id] = (packs[t.set_id] || 0) + num(t.packs); if (t.has_summary) summ[t.set_id] = true; });
    app.innerHTML = `<div class="wrap">
      <h1 class="page-title">All sets</h1>
      <p class="muted">Each set keeps its own data. Open one to see its full breakdown, or <a href="compare.html">compare sets side by side</a>.</p>
      ${sets.length ? `<div class="tablewrap"><table>
        <thead><tr><th scope="col">Set</th>${anyDate ? '<th scope="col">Released</th>' : ''}<th scope="col">Reports</th><th scope="col">Packs opened</th><th scope="col">Status</th></tr></thead>
        <tbody>${sets.map((s, i) => `<tr><td><a href="set.html?set=${encodeURIComponent(s.slug)}">${esc(setLabel(s))}</a></td>
          ${anyDate ? `<td class="n">${s.released_on ? esc(fmtDate(s.released_on + 'T12:00:00')) : '—'}</td>` : ''}
          <td class="n">${summ[s.id] ? 'Totals only' : fmtInt(reports[i])}</td><td class="n">${fmtInt(packs[s.id] || 0)}</td>
          <td class="n">${s.accepting_submissions ? 'Collecting data' : 'View only'}</td></tr>`).join('')}</tbody></table></div>` : '<p>No sets yet.</p>'}
    </div>`;
  } catch (e) { showError(app, e, init); }
}
