// Admin only: review reports, hide or delete bad ones, and manage sets and products.
import { get, count, post, patch, del, login, logout, getToken, ApiError, uploadCardImage, deleteCardImage, cardImageUrl } from './api.js';
import { mountChrome } from './chrome.js';
import { SITE_NAME } from './config.js';
import { RARITIES, esc, num, fmtDate, SET_ORDER, setLabel } from './lib.js';

const app = document.getElementById('app');
mountChrome('');
document.title = `Admin | ${SITE_NAME}`;

const S = { cardImages: [], cardPicsOk: true, me: null, tab: 'review', sets: [], products: [], setProducts: [], subs: [], filter: { set: '', status: 'visible', flagged: false }, page: 0, total: 0, msg: '' };
const PAGE = 40;

start();

async function start() {
  if (!getToken()) return loginView();
  try {
    const admins = await get('admins?select=user_id', { auth: true });
    if (!admins.length) { loginView('You are signed in, but this account is not set up as an admin.'); return; }
    await loadBase();
    shell();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { logout(); loginView('Your session expired. Please sign in again.'); } else loginView(e.message);
  }
}

function loginView(message = '') {
  app.innerHTML = `<div class="wrap form-wrap"><h1 class="page-title">Admin sign in</h1>
    ${message ? `<div class="notice error" role="alert"><p>${esc(message)}</p></div>` : ''}
    <form id="lf"><div class="form-row">
      <label>Email <input type="email" id="em" autocomplete="username" required></label>
      <label>Password <input type="password" id="pw" autocomplete="current-password" required></label>
      <button class="btn" type="submit">Sign in</button></div></form></div>`;
  app.querySelector('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await login(app.querySelector('#em').value.trim(), app.querySelector('#pw').value); await start(); }
    catch (err) { loginView(/invalid/i.test(err.message) ? 'That email or password is not right.' : err.message); }
  });
}

async function loadBase() {
  const [sets, products, sp] = await Promise.all([
    get(`sets?select=*&${SET_ORDER}`, { auth: true }),
    get('products?select=*&order=sort_order', { auth: true }),
    get('set_products?select=*', { auth: true }),
  ]);
  S.sets = sets; S.products = products; S.setProducts = sp;
  try { S.cardImages = await get('set_card_images?select=*', { auth: true }); S.cardPicsOk = true; } catch { S.cardImages = []; S.cardPicsOk = false; }
}

// Shrinks a picture to a sensible size in the browser before uploading (keeps pages fast and storage small).
async function shrinkImage(file, maxWidth = 2400, png = false) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); } // logos keep their see-through background
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that picture.'))), png ? 'image/png' : 'image/jpeg', 0.85));
}

function shell() {
  app.innerHTML = `<div class="wrap"><h1 class="page-title">Admin</h1>
    <div class="row-actions"><div class="seg" role="group" aria-label="Section" id="tabs">
      <button type="button" data-t="review">Review reports</button><button type="button" data-t="sets">Sets</button><button type="button" data-t="products">Products</button></div>
      <button class="btn secondary small" id="out" type="button">Sign out</button></div>
    <div id="msg" role="status">${S.msg ? `<div class="notice ok"><p>${esc(S.msg)}</p></div>` : ''}</div>
    <div id="panel"></div></div>`;
  S.msg = '';
  app.querySelector('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.tab = b.dataset.t; panel(); } });
  app.querySelector('#out').addEventListener('click', () => { logout(); loginView(); });
  panel();
}

function flash(text, bad = false) {
  const el = app.querySelector('#msg');
  if (el) el.innerHTML = `<div class="notice ${bad ? 'error' : 'ok'}"><p>${esc(text)}</p></div>`;
}

// Any failed request ends up here. An expired login sends you back to sign in.
function fail(e) {
  if (e instanceof ApiError && (e.status === 401 || e.code === 'PGRST301')) { logout(); loginView('Your session expired. Please sign in again.'); return; }
  if (e && e.code === '23505') { flash('That name, web address, or set number is already used by another set.', true); return; }
  flash(e.message || 'Something went wrong.', true);
}

function panel() {
  app.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === S.tab)));
  const p = app.querySelector('#panel');
  if (S.tab === 'review') reviewPanel(p); else if (S.tab === 'sets') setsPanel(p); else productsPanel(p);
}

// ---------- Review ----------
const prodName = (id) => (S.products.find((p) => p.id === id) || { name: 'Unknown' }).name;
const setName = (id) => { const s = S.sets.find((x) => x.id === id); return s ? setLabel(s) : '?'; };

// Flags results that are very unlikely, to help spot troll reports. A flag is a prompt to look, not a verdict.
const LIMITS = { iconic: 0.05, enchanted: 0.25, epic: 0.6, legendary: 0.9, legendary_foil: 0.5 };
function flagsFor(sub) {
  const out = [];
  for (const r of sub.reports || []) {
    if (r.is_summary) continue;
    for (const x of RARITIES) {
      if (r.packs && r[x.key] / r.packs > LIMITS[x.key] && r[x.key] >= 2) out.push(`${r[x.key]} ${x.label} in ${r.packs} packs (${prodName(r.product_id)})`);
    }
  }
  return [...new Set(out)];
}

async function reviewPanel(p) {
  p.innerHTML = `<div class="form-row">
    <label>Set <select id="fs"><option value="">All sets</option>${S.sets.map((s) => `<option value="${s.id}"${String(S.filter.set) === String(s.id) ? ' selected' : ''}>${esc(setLabel(s))}</option>`).join('')}</select></label>
    <label>Status <select id="fst">${['visible', 'hidden', 'all'].map((v) => `<option value="${v}"${S.filter.status === v ? ' selected' : ''}>${v === 'all' ? 'Visible and hidden' : v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
    <label class="checks"><input type="checkbox" id="ff"${S.filter.flagged ? ' checked' : ''}> Only unusual reports</label></div>
    <div id="list"><p class="status">Loading…</p></div><div class="row-actions" id="pager"></div>`;
  const redo = () => { S.page = 0; reviewPanel(p); };
  p.querySelector('#fs').onchange = (e) => { S.filter.set = e.target.value; redo(); };
  p.querySelector('#fst').onchange = (e) => { S.filter.status = e.target.value; redo(); };
  p.querySelector('#ff').onchange = (e) => { S.filter.flagged = e.target.checked; redo(); };
  try {
    let q = `submissions?select=id,set_id,status,created_at,reports(id,product_id,is_bulk,is_summary,quantity,item_number,slot_number,packs,iconic,enchanted,epic,legendary,legendary_foil)&order=created_at.desc&limit=${PAGE}&offset=${S.page * PAGE}`;
    let cq = 'submissions?select=id';
    for (const part of [S.filter.set && `set_id=eq.${S.filter.set}`, S.filter.status !== 'all' && `status=eq.${S.filter.status}`].filter(Boolean)) { q += '&' + part; cq += '&' + part; }
    const [subs, total] = await Promise.all([get(q, { auth: true }), count(cq, { auth: true })]);
    S.total = total;
    const nums = await numberBySet(subs);
    let shown = subs.map((s) => ({ ...s, flags: flagsFor(s), num: nums.get(s.id) }));
    if (S.filter.flagged) shown = shown.filter((s) => s.flags.length);
    p.querySelector('#list').innerHTML = shown.length ? shown.map(subHTML).join('') : '<p class="muted">Nothing to show.</p>';
    p.querySelector('#pager').innerHTML = `<span class="muted small">Showing ${S.page * PAGE + (subs.length ? 1 : 0)}-${S.page * PAGE + subs.length} of ${total}</span>
      <button class="btn secondary small" id="pv"${S.page ? '' : ' disabled'}>Newer</button><button class="btn secondary small" id="nx"${(S.page + 1) * PAGE < total ? '' : ' disabled'}>Older</button>`;
    p.querySelector('#pv').onclick = () => { S.page--; reviewPanel(p); };
    p.querySelector('#nx').onclick = () => { S.page++; reviewPanel(p); };
    p.querySelector('#list').onclick = onAction;
  } catch (e) { fail(e); }
}

// Report numbers count within each set (1, 2, 3...) rather than across the whole site. Hidden reports keep their number.
async function numberBySet(subs) {
  const nums = new Map();
  const bySet = new Map();
  for (const s of subs) { if (!bySet.has(s.set_id)) bySet.set(s.set_id, []); bySet.get(s.set_id).push(s.id); }
  await Promise.all([...bySet].map(async ([sid, ids]) => {
    const lo = Math.min(...ids), hi = Math.max(...ids);
    const [before, inRange] = await Promise.all([
      count(`submissions?select=id&set_id=eq.${sid}&id=lt.${lo}`, { auth: true }),
      get(`submissions?select=id&set_id=eq.${sid}&id=gte.${lo}&id=lte.${hi}&order=id.asc&limit=1000`, { auth: true })]);
    inRange.forEach((x, i) => nums.set(x.id, before + i + 1));
  }));
  return nums;
}

function subHTML(s) {
  // Group a submission's rows into one line per product entry.
  const groups = new Map();
  for (const r of s.reports || []) {
    const key = `${r.product_id}-${r.is_bulk}-${r.is_bulk ? r.id : r.item_number}`;
    if (!groups.has(key)) groups.set(key, { ...r, packs: 0, iconic: 0, enchanted: 0, epic: 0, legendary: 0, legendary_foil: 0 });
    const g = groups.get(key);
    g.packs += num(r.packs); RARITIES.forEach((x) => { g[x.key] += num(r[x.key]); });
  }
  const lines = [...groups.values()].map((g) =>
    `<li>${g.is_bulk ? `Bulk, ${g.quantity} × ` : ''}${esc(prodName(g.product_id))}: ${RARITIES.map((x) => `${g[x.key]} ${x.label}`).join(', ')} <span class="muted">(${g.packs} packs)</span></li>`).join('');
  const hidden = s.status === 'hidden';
  return `<div class="sub${s.flags.length ? ' flagged' : ''}${hidden ? ' hidden-sub' : ''}" data-id="${s.id}">
    <div class="sub-head"><strong title="Database ID ${s.id}">#${s.num ?? s.id} · ${esc(setName(s.set_id))}${(s.reports || []).some((r) => r.is_summary) ? ' · Imported totals' : ''}</strong><span class="muted small">${esc(fmtDate(s.created_at))}${hidden ? ' · hidden' : ''}</span></div>
    ${s.flags.length ? `<p class="flag">Unusual: ${esc(s.flags.join('; '))}</p>` : ''}
    <ul>${lines}</ul>
    <div class="row-actions">
      ${hidden ? '<button class="btn small" data-act="restore">Restore</button>' : '<button class="btn secondary small" data-act="hide">Hide from totals</button>'}
      <button class="btn danger small" data-act="delete">Delete forever</button></div></div>`;
}

async function onAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('.sub').dataset.id;
  try {
    if (b.dataset.act === 'delete') {
      if (!confirm(`Permanently delete report #${id}? This cannot be undone. Hiding it instead keeps it out of the totals and lets you change your mind.`)) return;
      await del(`submissions?id=eq.${id}`);
      flash(`Report #${id} deleted.`);
    } else {
      await patch(`submissions?id=eq.${id}`, { status: b.dataset.act === 'hide' ? 'hidden' : 'visible' });
      flash(b.dataset.act === 'hide' ? `Report #${id} is hidden and no longer counted.` : `Report #${id} is back in the totals.`);
    }
    reviewPanel(app.querySelector('#panel'));
  } catch (err) { fail(err); }
}

// ---------- Sets ----------
function cardPicsHTML(s) {
  if (!S.cardPicsOk) return '<p class="muted small">Card pictures: run <code>add-card-images.sql</code> in Supabase first, then reload this page.</p>';
  // Legendary Foil uses the Legendary picture, so it has no slot of its own.
  const tr = RARITIES.filter((r) => r.key !== 'legendary_foil' && (s.tracked_rarities || RARITIES.map((x) => x.key)).includes(r.key));
  return `<p class="muted small">Card pictures shown on the report form (optional). Pick an image and it uploads right away.</p>
    <div class="cardpics">${tr.map((r) => {
      const row = S.cardImages.find((x) => x.set_id === s.id && x.rarity === r.key);
      return `<div class="cardpic"><strong>${esc(r.label)}</strong>
        ${row ? `<img src="${esc(cardImageUrl(row))}" alt="${esc(r.label)} cards">` : '<span class="muted small">No picture yet</span>'}
        <label class="btn secondary small">${row ? 'Replace picture' : 'Choose picture'}<input type="file" accept="image/jpeg,image/png,image/webp" data-pic="${s.id}:${r.key}"></label>
        ${row ? `<button class="btn danger small" type="button" data-clearpic="${s.id}:${r.key}">Remove</button>` : ''}</div>`;
    }).join('')}</div>`;
}

function logoHTML(s) {
  if (!('logo_path' in s)) return '<p class="muted small">Set logo: run <code>add-set-logos.sql</code> in Supabase first, then reload this page.</p>';
  return `<div class="cardpic"><strong>Official logo</strong>
    ${s.logo_path ? `<img src="${esc(cardImageUrl({ path: s.logo_path, updated_at: s.logo_updated_at }))}" alt="${esc(s.name)} logo">` : '<span class="muted small">No logo yet</span>'}
    <label class="btn secondary small">${s.logo_path ? 'Replace logo' : 'Choose logo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-logo="${s.id}"></label>
    ${s.logo_path ? `<button class="btn danger small" type="button" data-clearlogo="${s.id}">Remove</button>` : ''}</div>
    <p class="muted small">Shown under "We are currently collecting data from…" on the report form. A PNG with a see-through background looks best.</p>`;
}

function setsPanel(p) {
  const has = (sid, pid) => S.setProducts.some((x) => x.set_id === sid && x.product_id === pid);
  p.innerHTML = `
    <h2>Sets</h2>
    <p class="muted">Untick "Collecting data" to make a set <strong>view only</strong>. Its data stays on the site, but nobody can send new reports to it. Tick it again to reopen.</p>
    ${S.sets.map((s) => `<fieldset data-set="${s.id}"><legend>${esc(setLabel(s))}</legend>
      <div class="checks">
        <label><input type="checkbox" data-accept="${s.id}"${s.accepting_submissions ? ' checked' : ''}> Collecting data</label>
        <span class="muted small">${s.accepting_submissions ? 'Open: people can send reports.' : 'View only.'}</span></div>
      <div class="form-row"><label>Name <input type="text" maxlength="60" data-name="${s.id}" value="${esc(s.name)}"></label>
        <label>Release date <input type="date" data-date="${s.id}" value="${esc(s.released_on || '')}"></label></div>
      <div class="form-row"><label>Set number <input type="number" min="1" step="1" data-num="${s.id}" value="${s.set_number ?? ''}"></label>
        <label>Responses from earlier tracking <input type="number" min="0" step="1" data-rc="${s.id}" value="${s.reported_count ?? ''}"></label>
        <label>Banner color <input type="color" data-color="${s.id}" value="${esc(s.accent_color || '#2f6fdb')}"></label>
        <button class="btn secondary small" type="button" data-clearcolor="${s.id}">Use automatic color</button>
        <span class="muted small">${s.accent_color ? 'Custom color.' : 'Automatic color.'}</span></div>
      <p class="muted small">Rarities tracked in this set (untick any that didn't exist or weren't counted; they're hidden on the set's page):</p>
      <div class="checks">${RARITIES.map((r) => `<label><input type="checkbox" data-tr="${s.id}:${r.key}"${(s.tracked_rarities || RARITIES.map((x) => x.key)).includes(r.key) ? ' checked' : ''}> ${esc(r.label)}</label>`).join('')}</div>
      ${logoHTML(s)}
      ${cardPicsHTML(s)}
      <p class="muted small">Products in this set:</p>
      <div class="checks">${S.products.map((pr) => `<label><input type="checkbox" data-sp="${s.id}:${pr.id}"${has(s.id, pr.id) ? ' checked' : ''}> ${esc(pr.name)}</label>`).join('')}</div>
      <div class="form-row"><label>Baseline for expected rates <select data-base="${s.id}">${S.products.map((pr) => `<option value="${pr.id}"${s.baseline_product_id === pr.id ? ' selected' : ''}>${esc(pr.name)}</option>`).join('')}</select></label></div>
    </fieldset>`).join('')}
    <h2>Add a new set</h2>
    <form id="ns"><div class="form-row">
      <label>Set number <input id="ns-num" type="number" min="1" step="1" required></label>
      <label>Name <input id="ns-name" required maxlength="60"></label>
      <label>Release date <input id="ns-date" type="date"></label>
      <label>Baseline product <select id="ns-base">${S.products.map((pr) => `<option value="${pr.id}">${esc(pr.name)}</option>`).join('')}</select></label></div>
      <p class="muted small">Products in the new set:</p>
      <div class="checks" id="ns-prods">${S.products.map((pr) => `<label><input type="checkbox" value="${pr.id}" checked> ${esc(pr.name)}</label>`).join('')}</div>
      <p><button class="btn" type="submit">Create set</button></p></form>`;
  p.onchange = async (e) => {
    const el = e.target;
    try {
      if (el.dataset.logo) {
        const file = el.files && el.files[0];
        if (!file) return;
        const set = S.sets.find((x) => x.id === Number(el.dataset.logo));
        flash('Uploading…');
        const blob = await shrinkImage(file, 1000, true);
        const path = `${set.slug}/logo.png`;
        await uploadCardImage(path, blob);
        await patch(`sets?id=eq.${set.id}`, { logo_path: path, logo_updated_at: new Date().toISOString() });
        await loadBase(); setsPanel(p); flash('Logo saved.'); return;
      }
      if (el.dataset.pic) {
        const file = el.files && el.files[0];
        if (!file) return;
        const [sid, key] = el.dataset.pic.split(':');
        const set = S.sets.find((x) => x.id === Number(sid));
        flash('Uploading…');
        const blob = await shrinkImage(file);
        const path = `${set.slug}/${key}.jpg`;
        await uploadCardImage(path, blob);
        await post('set_card_images', { set_id: set.id, rarity: key, path, updated_at: new Date().toISOString() }, { merge: true });
        await loadBase(); setsPanel(p); flash('Picture saved.'); return;
      }
      if (el.dataset.accept) { await patch(`sets?id=eq.${el.dataset.accept}`, { accepting_submissions: el.checked }); await loadBase(); setsPanel(p); flash(el.checked ? 'Collecting data again for this set.' : 'This set is now view only.'); return; }
      else if (el.dataset.color) { await patch(`sets?id=eq.${el.dataset.color}`, { accent_color: el.value }); await loadBase(); setsPanel(p); flash('Banner color saved.'); return; }
      else if (el.dataset.name) {
        const v = el.value.trim();
        if (!v) { flash('The name can\'t be empty.', true); return; }
        await patch(`sets?id=eq.${el.dataset.name}`, { name: v }); await loadBase(); setsPanel(p); flash('Name saved.'); return; }
      else if (el.dataset.date) { await patch(`sets?id=eq.${el.dataset.date}`, { released_on: el.value || null }); await loadBase(); setsPanel(p); flash('Release date saved.'); return; }
      else if (el.dataset.rc) { await patch(`sets?id=eq.${el.dataset.rc}`, { reported_count: el.value === '' ? null : Number(el.value) }); await loadBase(); setsPanel(p); flash('Saved.'); return; }
      else if (el.dataset.num) { await patch(`sets?id=eq.${el.dataset.num}`, { set_number: el.value ? Number(el.value) : null }); await loadBase(); setsPanel(p); flash('Saved.'); return; }
      else if (el.dataset.tr) {
        const [sid, key] = el.dataset.tr.split(':');
        const set = S.sets.find((x) => x.id === Number(sid));
        const cur = new Set(set.tracked_rarities || RARITIES.map((x) => x.key));
        el.checked ? cur.add(key) : cur.delete(key);
        if (!cur.size) { el.checked = true; return flash('At least one rarity must be tracked.', true); }
        await patch(`sets?id=eq.${sid}`, { tracked_rarities: RARITIES.map((x) => x.key).filter((k) => cur.has(k)) });
        await loadBase(); setsPanel(p); flash('Saved.'); return;
      } else if (el.dataset.sp) {
        const [sid, pid] = el.dataset.sp.split(':');
        if (el.checked) await post('set_products', { set_id: Number(sid), product_id: Number(pid) });
        else await del(`set_products?set_id=eq.${sid}&product_id=eq.${pid}`);
        flash('Saved.');
      } else if (el.dataset.base) { await patch(`sets?id=eq.${el.dataset.base}`, { baseline_product_id: Number(el.value) }); flash('Saved.'); }
      await loadBase();
    } catch (err) { fail(err); }
  };
  p.onclick = async (e) => {
    const lg = e.target.closest('[data-clearlogo]');
    if (lg) {
      const set = S.sets.find((x) => x.id === Number(lg.dataset.clearlogo));
      try { if (set.logo_path) await deleteCardImage(set.logo_path); await patch(`sets?id=eq.${set.id}`, { logo_path: null, logo_updated_at: null }); await loadBase(); setsPanel(p); flash('Logo removed.'); } catch (err) { fail(err); }
      return;
    }
    const pic = e.target.closest('[data-clearpic]');
    if (pic) {
      const [sid, key] = pic.dataset.clearpic.split(':');
      const row = S.cardImages.find((x) => x.set_id === Number(sid) && x.rarity === key);
      try { if (row) await deleteCardImage(row.path); await del(`set_card_images?set_id=eq.${sid}&rarity=eq.${key}`); await loadBase(); setsPanel(p); flash('Picture removed.'); } catch (err) { fail(err); }
      return;
    }
    const b = e.target.closest('[data-clearcolor]');
    if (!b) return;
    try { await patch(`sets?id=eq.${b.dataset.clearcolor}`, { accent_color: null }); await loadBase(); setsPanel(p); flash('This set now uses an automatic color.'); } catch (err) { fail(err); }
  };
  p.querySelector('#ns').onsubmit = async (e) => {
    e.preventDefault();
    const name = p.querySelector('#ns-name').value.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return flash('Enter a name for the set.', true);
    try {
      const [made] = await post('sets', { name, slug, set_number: Number(p.querySelector('#ns-num').value), released_on: p.querySelector('#ns-date').value || null, baseline_product_id: Number(p.querySelector('#ns-base').value) }, { ret: true });
      for (const cb of p.querySelectorAll('#ns-prods input:checked')) await post('set_products', { set_id: made.id, product_id: Number(cb.value) });
      S.msg = `${name} was created and is taking reports.`;
      await loadBase(); shell();
    } catch (err) { fail(err); }
  };
}

// ---------- Products ----------
function productPicHTML(pr) {
  if (!('image_path' in pr)) return '<span class="muted small">Not set up</span>';
  return `<div class="cardpic">${pr.image_path ? `<img src="${esc(cardImageUrl({ path: pr.image_path, updated_at: pr.image_updated_at }))}" alt="${esc(pr.name)}">` : '<span class="muted small">No picture</span>'}
    <label class="btn secondary small">${pr.image_path ? 'Replace' : 'Choose picture'}<input type="file" accept="image/jpeg,image/png,image/webp" data-ppic="${pr.id}"></label>
    ${pr.image_path ? `<button class="btn danger small" type="button" data-clearppic="${pr.id}">Remove</button>` : ''}</div>`;
}

function productsPanel(p) {
  p.innerHTML = `
    <h2>Products</h2>
    ${S.products.length && !('image_path' in S.products[0]) ? '<p class="notice error">To add product pictures, run <code>add-product-images.sql</code> in Supabase first, then reload this page.</p>' : '<p class="muted small">A picture for each product shows on the report form. Pick an image and it uploads right away.</p>'}
    <div class="tablewrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Picture</th><th scope="col">Packs each</th><th scope="col">Boxes reported separately</th><th scope="col">Counts as boxes</th><th scope="col">Bulk allowed</th><th scope="col"><span class="sr-only">Save</span></th></tr></thead>
    <tbody>${S.products.map((pr) => `<tr data-prow="${pr.id}"><td><input type="text" maxlength="60" data-pf="name" value="${esc(pr.name)}" aria-label="Name"></td><td>${productPicHTML(pr)}</td><td><input type="number" min="1" step="1" data-pf="packs" value="${pr.packs_per_item}" aria-label="Packs each"></td><td><input type="number" min="1" step="1" data-pf="slots" value="${pr.slots_per_item}" aria-label="Boxes reported separately"></td><td><input type="number" min="0" step="1" data-pf="box" value="${pr.box_equivalents}" aria-label="Counts as boxes"></td><td><input type="checkbox" data-pf="bulk"${pr.allows_bulk ? ' checked' : ''} aria-label="Bulk allowed"></td><td><button class="btn small" type="button" data-saveprod="${pr.id}">Save</button></td></tr>`).join('')}</tbody></table></div>
    <p class="muted small">Change a product's details above and press Save on its row. Reports already sent keep the numbers they were sent with, so only change packs or boxes if a product was set up wrong.</p>
    <h2>Add a product</h2>
    <p class="muted">After adding it, switch it on for a set in the Sets tab.</p>
    <form id="np"><div class="form-row">
      <label>Name <input id="np-name" required maxlength="60"></label>
      <label>Packs in one <input id="np-packs" type="number" min="1" step="1" required></label>
      <label>Separate results to enter <input id="np-slots" type="number" min="1" step="1" value="1" required></label>
      <label>Counts as how many boxes <input id="np-box" type="number" min="0" step="1" value="0" required></label>
      <label class="checks"><input id="np-bulk" type="checkbox" checked> Bulk allowed</label></div>
      <p class="muted small">"Separate results" is 4 for a case (one result per box) and 1 for most products. "Counts as boxes" is 4 for a case, 1 for a box, 0 for anything that shouldn't count in the All boxes rows.</p>
      <p><button class="btn" type="submit">Add product</button></p></form>`;
  p.onchange = async (e) => {
    const el = e.target;
    if (!el.dataset.ppic) return;
    const file = el.files && el.files[0];
    if (!file) return;
    const pr = S.products.find((x) => x.id === Number(el.dataset.ppic));
    try {
      flash('Uploading…');
      const blob = await shrinkImage(file, 1000);
      const path = `products/${pr.slug}.jpg`;
      await uploadCardImage(path, blob);
      await patch(`products?id=eq.${pr.id}`, { image_path: path, image_updated_at: new Date().toISOString() });
      await loadBase(); productsPanel(p); flash('Picture saved.');
    } catch (err) { fail(err); }
  };
  p.onclick = async (e) => {
    const sv = e.target.closest('[data-saveprod]');
    if (sv) {
      const row = sv.closest('tr'), f = (k) => row.querySelector(`[data-pf="${k}"]`);
      const name = f('name').value.trim(), packs = Number(f('packs').value), slots = Number(f('slots').value), box = Number(f('box').value);
      if (!name) return flash('Enter a name.', true);
      if (!(packs >= 1) || !(slots >= 1) || !(box >= 0)) return flash('Check the numbers: packs and separate results must be at least 1.', true);
      if (packs % slots !== 0) return flash('Packs must divide evenly by the number of separate results.', true);
      try { await patch(`products?id=eq.${sv.dataset.saveprod}`, { name, packs_per_item: packs, slots_per_item: slots, box_equivalents: box, allows_bulk: f('bulk').checked }); await loadBase(); productsPanel(p); flash(`${name} saved.`); } catch (err) { fail(err); }
      return;
    }
    const b = e.target.closest('[data-clearppic]');
    if (!b) return;
    const pr = S.products.find((x) => x.id === Number(b.dataset.clearppic));
    try {
      if (pr.image_path) await deleteCardImage(pr.image_path);
      await patch(`products?id=eq.${pr.id}`, { image_path: null, image_updated_at: null });
      await loadBase(); productsPanel(p); flash('Picture removed.');
    } catch (err) { fail(err); }
  };
  p.querySelector('#np').onsubmit = async (e) => {
    e.preventDefault();
    const name = p.querySelector('#np-name').value.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const packs = Number(p.querySelector('#np-packs').value), slots = Number(p.querySelector('#np-slots').value);
    if (!slug) return flash('Enter a name.', true);
    if (packs % slots !== 0) return flash('Packs must divide evenly by the number of separate results.', true);
    try {
      await post('products', { name, slug, packs_per_item: packs, slots_per_item: slots, box_equivalents: Number(p.querySelector('#np-box').value), allows_bulk: p.querySelector('#np-bulk').checked, sort_order: S.products.length + 1 });
      S.msg = `${name} was added. Switch it on for a set in the Sets tab.`;
      await loadBase(); shell();
    } catch (err) { fail(err); }
  };
}
