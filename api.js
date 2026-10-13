// Talks to the database. Visitors can read data and send a report; only a logged-in admin can change anything.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const REST = SUPABASE_URL + '/rest/v1/';
const TOKEN_KEY = 'pt_admin_token';

// Messages the database sends when the admin's login has run out (they last about an hour).
export const EXPIRED = /exp"? claim|jwt expired|invalid jwt|token is expired/i;

export class ApiError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

export function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked: stay logged in for this page only */ }
}

async function request(url, { method = 'GET', body, headers = {}, auth = false } = {}) {
  const h = { apikey: SUPABASE_KEY, ...headers };
  if (auth) { const t = getToken(); if (t) h.Authorization = 'Bearer ' + t; }
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Could not reach the database. Check your connection and try again.');
  }
  if (!res.ok) {
    let j = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    const msg = (j && (j.message || j.error_description || j.msg)) || `Request failed (${res.status}).`;
    throw new ApiError(msg, EXPIRED.test(msg) ? 401 : res.status, (j && j.code) || '');
  }
  return res;
}

export async function get(path, { auth = false } = {}) { return (await request(REST + path, { auth })).json(); }

// Counts rows without downloading them.
export async function count(path, { auth = false } = {}) {
  try {
    const r = await request(REST + path, { method: 'HEAD', auth, headers: { Prefer: 'count=exact' } });
    const total = (r.headers.get('Content-Range') || '').split('/')[1];
    return total && total !== '*' ? Number(total) : 0;
  } catch (e) {
    if (e.status === 416) return 0;
    throw e;
  }
}

// Sends a report. With a Turnstile token it goes through the checking function; without one it goes straight to the database.
export async function submitReport(args, token) {
  if (!token) return rpc('submit_report', args);
  return (await request(SUPABASE_URL + '/functions/v1/submit-report', {
    method: 'POST',
    body: { set_slug: args.p_set_slug, agreed: args.p_agreed, items: args.p_items, token },
  })).json();
}

export async function rpc(name, args) { return (await request(REST + 'rpc/' + name, { method: 'POST', body: args })).json(); }

// Admin-only writes (the database refuses these unless you are logged in as the admin).
export async function post(path, body, { ret = false, merge = false } = {}) {
  const prefer = (ret ? 'return=representation' : 'return=minimal') + (merge ? ',resolution=merge-duplicates' : '');
  const r = await request(REST + path, { method: 'POST', body, auth: true, headers: { Prefer: prefer } });
  return ret ? r.json() : null;
}
export async function patch(path, body) { await request(REST + path, { method: 'PATCH', body, auth: true, headers: { Prefer: 'return=minimal' } }); }
export async function del(path) { await request(REST + path, { method: 'DELETE', auth: true, headers: { Prefer: 'return=minimal' } }); }

export async function login(email, password) {
  const r = await request(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const j = await r.json();
  setToken(j.access_token);
  return j;
}
export function logout() { setToken(null); }

// ---------- Card pictures (stored in Supabase storage; only the admin can change them) ----------
const STORAGE = SUPABASE_URL + '/storage/v1/object/';
export const cardImageUrl = (row) => `${STORAGE}public/card-images/${row.path}?v=${encodeURIComponent(row.updated_at || '')}`;

export async function uploadCardImage(path, blob) {
  let res;
  try {
    res = await fetch(STORAGE + 'card-images/' + path, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + getToken(), 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
      body: blob,
    });
  } catch { throw new ApiError('Could not reach the database. Check your connection and try again.'); }
  if (!res.ok) {
    let j = null; try { j = await res.json(); } catch { /* not JSON */ }
    const msg = (j && (j.message || j.error)) || `Upload failed (${res.status}).`;
    throw new ApiError(msg, EXPIRED.test(msg) ? 401 : res.status);
  }
}
export async function deleteCardImage(path) {
  const res = await fetch(STORAGE + 'card-images/' + path, { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + getToken() } }).catch(() => null);
  if (res && !res.ok && res.status !== 404) {
    let j = null; try { j = await res.json(); } catch { /* not JSON */ }
    const msg = (j && (j.message || j.error)) || '';
    if (EXPIRED.test(msg)) throw new ApiError(msg, 401);
  }
  if (!res || (!res.ok && res.status !== 404)) throw new ApiError('Could not remove the picture. Try again.');
}
