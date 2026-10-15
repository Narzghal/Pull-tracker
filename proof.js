// "Proof of the Data": the article is split into sections, shown one at a time as tabs.
import { mountChrome } from './chrome.js';
import { SITE_NAME } from './config.js';

mountChrome('proof');
document.title = `Proof of the Data | ${SITE_NAME}`;

const doc = document.getElementById('doc');
const list = document.getElementById('doc-tabs');
const panels = [...doc.querySelectorAll('.panel')];
let current = 0;

doc.classList.add('tabbed');
list.hidden = false;
list.innerHTML = panels.map((p, i) =>
  `<button type="button" role="tab" class="doc-tab" id="tab-${p.id}" aria-controls="${p.id}" data-i="${i}">${p.dataset.tab}</button>`).join('');
const tabs = [...list.querySelectorAll('[role=tab]')];

panels.forEach((p, i) => {
  p.setAttribute('role', 'tabpanel');
  p.setAttribute('aria-labelledby', 'tab-' + p.id);
  const nav = document.createElement('div');
  nav.className = 'panel-nav';
  nav.innerHTML =
    (i > 0 ? `<button type="button" class="btn secondary" data-step="-1">← ${panels[i - 1].dataset.tab}</button>` : '<span></span>') +
    (i < panels.length - 1 ? `<button type="button" class="btn secondary" data-step="1">${panels[i + 1].dataset.tab} →</button>` : '<span></span>');
  p.append(nav);
});

function show(i, { focus = false, push = true } = {}) {
  current = Math.max(0, Math.min(panels.length - 1, i));
  panels.forEach((p, k) => { p.hidden = k !== current; });
  tabs.forEach((t, k) => {
    t.setAttribute('aria-selected', String(k === current));
    t.tabIndex = k === current ? 0 : -1;
  });
  tabs[current].scrollIntoView({ block: 'nearest', inline: 'center' });
  if (push) { try { history.replaceState(null, '', '#' + panels[current].id); } catch { /* ignore */ } }
  if (focus) tabs[current].focus();
}

list.addEventListener('click', (e) => { const t = e.target.closest('[role=tab]'); if (t) show(Number(t.dataset.i)); });
list.addEventListener('keydown', (e) => {
  const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (k) { e.preventDefault(); show((current + k + panels.length) % panels.length, { focus: true }); }
  else if (e.key === 'Home') { e.preventDefault(); show(0, { focus: true }); }
  else if (e.key === 'End') { e.preventDefault(); show(panels.length - 1, { focus: true }); }
});
doc.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (step) { show(current + Number(step.dataset.step)); tabs[current].scrollIntoView({ block: 'center' }); window.scrollTo({ top: list.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); return; }
  const go = e.target.closest('[data-goto]');
  if (go) { e.preventDefault(); const i = panels.findIndex((p) => p.id === go.dataset.goto); if (i >= 0) show(i); }
});

function fromHash() {
  const i = panels.findIndex((p) => '#' + p.id === location.hash);
  show(i >= 0 ? i : 0, { push: false });
}
window.addEventListener('hashchange', fromHash);
fromHash();
