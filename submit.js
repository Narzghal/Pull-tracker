// The submission form. Checks everything in the browser first; the database checks it again.
import { get, rpc, cardImageUrl } from './api.js';
import { mountChrome } from './chrome.js';
import { SITE_NAME } from './config.js';
import { RARITIES as ALL_RARITIES, trackedOf, RARITY_CLASS, esc, SET_ORDER, setLabel } from './lib.js';

const app = document.getElementById('app');
mountChrome('submit');
document.title = `Report your pulls | ${SITE_NAME}`;

const MAX_ENTRIES = 40;
const state = { sets: [], set: null, products: [], consent: null, entries: [], nextId: 1, sending: false, done: null, errors: {} };

init();

async function init() {
  try {
    const sets = await get(`sets?select=*&${SET_ORDER}`);
    state.sets = sets.filter((s) => s.accepting_submissions);
    if (!state.sets.length) {
      app.innerHTML = '<div class="wrap form-wrap"><h1>Reporting is closed</h1><p>No set is taking reports right now. Check back when the next set is out.</p></div>';
      return;
    }
    const wanted = new URLSearchParams(location.search).get('set');
    await chooseSet(state.sets.find((s) => s.slug === wanted) || state.sets[0]);
  } catch (e) {
    app.innerHTML = `<div class="wrap form-wrap"><div class="notice error" role="alert"><p><strong>Couldn't load the form.</strong> ${esc(e.message)}</p><p><button class="btn" id="retry" type="button">Try again</button></p></div></div>`;
    app.querySelector('#retry').addEventListener('click', init);
  }
}

async function chooseSet(set) {
  const sp = await get(`set_products?select=products(*)&set_id=eq.${set.id}`);
  state.set = set;
  RARITIES = trackedOf(set);
  state.products = sp.map((x) => x.products).filter(Boolean).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  state.entries = [];
  state.errors = {};
  state.cardImgs = await findCardImages(set);
  render();
}

// Card pictures: the ones uploaded in the admin page, plus (as a backup) files named cards/<set-slug>/<rarity>.jpg in the site.
// Only rarities that have a picture get a button on the form.
async function findCardImages(set) {
  const out = {};
  try {
    const rows = await get(`set_card_images?select=rarity,path,updated_at&set_id=eq.${set.id}`);
    for (const r of rows) out[r.rarity] = cardImageUrl(r);
  } catch { /* the pictures table isn't set up yet: fall back to files */ }
  const probe = (r) => new Promise((resolve) => {
    const url = `cards/${encodeURIComponent(set.slug)}/${r.key}.jpg`;
    const img = new Image();
    img.onload = () => resolve([r.key, url]);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  const extra = await Promise.all(RARITIES.filter((r) => !out[r.key]).map(probe));
  return { ...Object.fromEntries(extra.filter(Boolean)), ...out };
}

let RARITIES = ALL_RARITIES; // narrowed to the chosen set's tracked rarities in chooseSet
const zeroCounts = () => Object.fromEntries(RARITIES.map((r) => [r.key, '0']));
const prod = (id) => state.products.find((p) => p.id === id);

function addEntry(productId) {
  if (state.entries.length >= MAX_ENTRIES) return;
  const p = prod(productId);
  state.entries.push({ id: state.nextId++, productId, bulk: false, qty: '', rows: Array.from({ length: p.slots_per_item }, zeroCounts) });
  renderEntries();
  const last = app.querySelector('#entries .entry:last-child input');
  if (last) last.focus();
}

function render() {
  const set = state.set;
  app.innerHTML = `
  <div class="wrap form-wrap">
    <h1>Report your pulls</h1>
    <p>This tracker collects pulls from sealed product in every language except Japanese and Chinese. It is a fan-made project, and the numbers are only as good as the reports, so please record <strong>every</strong> opening, lucky or not. Leaving out the unlucky or the too-lucky ones skews the data.</p>
    <p class="muted">Reports are anonymous, with no account or email. They can't be edited after you send them, so check your numbers first.</p>

    <form id="f" novalidate>
      <fieldset>
        <legend>Which set?</legend>
        <label for="setsel" class="visually-hidden">Set</label>
        <select id="setsel">${state.sets.map((s) => `<option value="${esc(s.slug)}"${s.id === set.id ? ' selected' : ''}>${esc(setLabel(s))}</option>`).join('')}</select>
      </fieldset>

      <fieldset id="consent">
        <legend>Before you start</legend>
        <p>I have read the above and <strong>I agree to be accurate in reporting my pulls</strong>. I understand this is community-sourced data and should not be used to try to prove a guarantee of pull rates, as Ravensburger has said there are no guarantees.</p>
        ${[['yes', 'Yes, I read and agree'], ['noread', "No, I didn't read but I agree"], ['no', "I don't agree"]].map(([v, t]) =>
          `<label class="radio"><input type="radio" name="consent" value="${v}"${state.consent === v ? ' checked' : ''}> <span>${t}</span></label>`).join('')}
        <p class="field-error" id="consent-msg" role="alert"></p>
      </fieldset>

      <div id="after-consent"></div>
      <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" id="website" tabindex="-1" autocomplete="off"></label></div>
    </form>
  </div>`;
  const f = app.querySelector('#f');
  f.querySelector('#setsel').addEventListener('change', (e) => chooseSet(state.sets.find((s) => s.slug === e.target.value)));
  f.querySelectorAll('input[name=consent]').forEach((r) => r.addEventListener('change', () => { state.consent = r.value; renderAfterConsent(); }));
  renderAfterConsent();
}

function renderAfterConsent() {
  const box = app.querySelector('#after-consent');
  const msg = app.querySelector('#consent-msg');
  msg.textContent = '';
  if (state.consent === 'no') {
    box.innerHTML = '<div class="notice"><p>You need to agree to report accurately to send pulls. Thanks for stopping by.</p></div>';
    return;
  }
  if (!state.consent) { box.innerHTML = ''; return; }
  box.innerHTML = `
    ${cardsHTML()}
    <h2>What did you open?</h2>
    <p>Add each product you opened. If you tracked every one separately, add them one by one. If you only kept running totals for several, choose "bulk totals" inside the entry.</p>
    <div class="chipbar" role="group" aria-label="Add a product">${state.products.map((p) => `<button class="btn secondary" type="button" data-add="${p.id}">Add ${esc(p.name)}</button>`).join('')}</div>
    <div id="entries" aria-live="polite"></div>
    <div id="summary-errors" class="notice error" role="alert" hidden></div>
    <p><button class="btn" id="send" type="submit">Send report</button></p>`;
  box.querySelector('.chipbar').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) addEntry(Number(b.dataset.add)); });
  app.querySelector('#f').onsubmit = onSubmit;
  const entries = box.querySelector('#entries');
  entries.addEventListener('input', onInput);
  entries.addEventListener('change', onChange);
  entries.addEventListener('click', onClick);
  entries.addEventListener('focusin', (e) => { if (e.target.matches('input[type=number]')) e.target.select(); });
  renderEntries();
}

function label(entry) {
  const p = prod(entry.productId);
  const same = state.entries.filter((e) => e.productId === entry.productId);
  return entry.bulk ? `${p.name}: bulk totals` : `${p.name} ${same.indexOf(entry) + 1}`;
}

function entryHTML(entry) {
  const p = prod(entry.productId);
  const err = state.errors[entry.id];
  const rowsHTML = entry.rows.map((row, ri) => {
    const title = !entry.bulk && p.slots_per_item > 1 ? `<div class="rowlabel">Box ${ri + 1} of ${p.slots_per_item}</div>` : '';
    return title + RARITIES.map((r) => `
      <label class="${RARITY_CLASS[r.key]}-label">${r.label}
        <input type="number" inputmode="numeric" min="0" step="1" data-id="${entry.id}" data-row="${ri}" data-key="${r.key}" value="${esc(row[r.key])}"></label>`).join('');
  }).join('');
  return `
  <fieldset class="entry" data-id="${entry.id}">
    <legend>${esc(label(entry))}</legend>
    <div class="entry-head">
      ${p.allows_bulk ? `<div class="mode" role="radiogroup" aria-label="How did you track this?">
        <label class="radio"><input type="radio" name="mode-${entry.id}" value="single" data-mode="${entry.id}"${entry.bulk ? '' : ' checked'}> <span>One ${esc(p.name)}, tracked on its own</span></label>
        <label class="radio"><input type="radio" name="mode-${entry.id}" value="bulk" data-mode="${entry.id}"${entry.bulk ? ' checked' : ''}> <span>Several, as bulk totals</span></label>
      </div>` : '<span></span>'}
      <button class="btn danger small" type="button" data-remove="${entry.id}">Remove</button>
    </div>
    ${entry.bulk ? `<label>How many ${esc(p.name)} did you open? <span class="muted">(2 or more)</span>
      <input type="number" inputmode="numeric" min="2" step="1" data-id="${entry.id}" data-qty="1" value="${esc(entry.qty)}"></label>
      <p class="muted small">Enter the combined total for all of them.</p>` : ''}
    <div class="counts">${rowsHTML}</div>
    <p class="field-error" id="err-${entry.id}" role="alert">${esc(err || '')}</p>
  </fieldset>`;
}

// The fixed "Cards To Report" pictures shown before the entries (Iconic, Enchanted, Epic, Legendary).
function cardsHTML() {
  const imgs = state.cardImgs || {};
  const shown = ['iconic', 'enchanted', 'epic', 'legendary'].map((k) => RARITIES.find((r) => r.key === k)).filter((r) => r && imgs[r.key]);
  if (!shown.length) return '';
  return `<section class="cardsref" aria-labelledby="cards-h">
    <h2 id="cards-h">Cards To Report</h2>
    <p>These are the cards we're looking for in ${esc(state.set.name)}. As you open your products, count how many of each you pull and report them below. Legendary Foil counts the foil copies of your Legendary cards. Tap a picture to see it full size.</p>
    <div class="cardgrid">${shown.map((r) => `<figure>
      <figcaption class="${RARITY_CLASS[r.key]}">${esc(r.label)}</figcaption>
      <a href="${esc(imgs[r.key])}" target="_blank" rel="noopener"><img class="cardimg" src="${esc(imgs[r.key])}" alt="The ${esc(r.label)} cards in ${esc(state.set.name)}" loading="lazy"></a>
    </figure>`).join('')}</div>
  </section>`;
}

function renderEntries() {
  const box = app.querySelector('#entries');
  if (!box) return;
  box.innerHTML = state.entries.length ? state.entries.map(entryHTML).join('') : '<p class="muted">Nothing added yet. Use the buttons above.</p>';
  const send = app.querySelector('#send');
  if (send) send.disabled = !state.entries.length || state.sending;
}

function onInput(e) {
  const el = e.target;
  const entry = state.entries.find((x) => x.id === Number(el.dataset.id));
  if (!entry) return;
  if (el.dataset.qty) entry.qty = el.value;
  else if (el.dataset.key) entry.rows[Number(el.dataset.row)][el.dataset.key] = el.value;
}
function onChange(e) {
  const el = e.target;
  if (!el.dataset.mode) return;
  const entry = state.entries.find((x) => x.id === Number(el.dataset.mode));
  const p = prod(entry.productId);
  entry.bulk = el.value === 'bulk';
  entry.rows = Array.from({ length: entry.bulk ? 1 : p.slots_per_item }, zeroCounts);
  entry.qty = '';
  delete state.errors[entry.id];
  renderEntries();
}
function onClick(e) {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  state.entries = state.entries.filter((x) => x.id !== Number(b.dataset.remove));
  renderEntries();
}

// ---------- Checking and sending ----------
const isCount = (s) => /^\d+$/.test(String(s).trim());

function validate() {
  const errors = {};
  const problems = [];
  state.entries.forEach((entry) => {
    const p = prod(entry.productId);
    const name = label(entry);
    let qty = 1;
    if (entry.bulk) {
      if (!isCount(entry.qty) || Number(entry.qty) < 2 || Number(entry.qty) > 2000) { errors[entry.id] = `Enter how many ${p.name} you opened, between 2 and 2,000. For just one, choose "One ${p.name}" instead.`; return; }
      qty = Number(entry.qty);
    }
    const packsPerRow = entry.bulk ? qty * p.packs_per_item : p.packs_per_item / p.slots_per_item;
    for (let ri = 0; ri < entry.rows.length; ri++) {
      const row = entry.rows[ri], where = entry.rows.length > 1 ? ` (box ${ri + 1})` : '';
      for (const r of RARITIES) {
        if (!isCount(row[r.key])) { errors[entry.id] = `${name}${where}: ${r.label} needs a whole number, 0 or more.`; return; }
        if (Number(row[r.key]) > packsPerRow) { errors[entry.id] = `${name}${where}: ${row[r.key]} ${r.label} is more than the ${packsPerRow} packs it contains. Check the number.`; return; }
      }
      if (RARITIES.some((r) => r.key === 'legendary_foil') && Number(row.legendary_foil) > Number(row.legendary)) { errors[entry.id] = `${name}${where}: Legendary Foil (${row.legendary_foil}) can't be more than Legendary (${row.legendary}). Foils are part of your Legendary count.`; return; }
    }
  });
  Object.values(errors).forEach((m) => problems.push(m));
  return { errors, problems };
}

function payload() {
  return state.entries.map((entry) => ({
    product: prod(entry.productId).slug,
    bulk: entry.bulk,
    quantity: entry.bulk ? Number(entry.qty) : 1,
    counts: entry.rows.map((row) => Object.fromEntries(RARITIES.map((r) => [r.key, Number(row[r.key])]))),
  }));
}

async function onSubmit(ev) {
  ev.preventDefault();
  if (state.sending) return;
  const summary = app.querySelector('#summary-errors');
  summary.hidden = true;
  if (!state.consent || state.consent === 'no') return;
  if (!state.entries.length) { summary.hidden = false; summary.innerHTML = '<p>Add at least one product before sending.</p>'; return; }
  const { errors, problems } = validate();
  state.errors = errors;
  renderEntries();
  if (problems.length) {
    summary.hidden = false;
    summary.innerHTML = `<p><strong>Fix ${problems.length === 1 ? 'this' : 'these'} before sending:</strong></p><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
    const first = app.querySelector('.entry .field-error:not(:empty)');
    if (first) first.closest('.entry').scrollIntoView({ block: 'center' });
    return;
  }
  // Hidden trap field: real people never fill it in. Pretend it worked so bots don't learn anything.
  if (app.querySelector('#website').value) { finish(); return; }
  state.sending = true;
  const send = app.querySelector('#send');
  send.disabled = true; send.textContent = 'Sending…';
  try {
    await rpc('submit_report', { p_set_slug: state.set.slug, p_agreed: true, p_items: payload() });
    finish();
  } catch (e) {
    state.sending = false;
    send.disabled = false; send.textContent = 'Send report';
    summary.hidden = false;
    summary.innerHTML = `<p><strong>Your report was not sent.</strong> ${esc(friendly(e))}</p><p>Nothing was saved, so it's safe to try again.</p>`;
  }
}

function friendly(e) {
  const m = e.message || '';
  if (/closed to new submissions/i.test(m)) return 'This set is no longer taking reports.';
  if (/violates check constraint/i.test(m)) return 'One of the numbers is not possible for that product. Check each count against the pack total.';
  return m || 'Something went wrong.';
}

function finish() {
  state.sending = false;
  const set = state.set;
  app.innerHTML = `
  <div class="wrap form-wrap">
    <h1>Thank you</h1>
    <div class="notice ok" role="status"><p>Your ${esc(set.name)} report was added. It's already included in the totals.</p></div>
    <p><a class="btn" href="set.html?set=${encodeURIComponent(set.slug)}">See the ${esc(set.name)} data</a>
       <button class="btn secondary" type="button" id="again">Report more</button></p>
  </div>`;
  app.querySelector('#again').addEventListener('click', () => { state.consent = 'yes'; state.entries = []; state.errors = {}; render(); });
  window.scrollTo(0, 0);
}
