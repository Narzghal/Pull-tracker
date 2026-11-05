/* Disc Golf Tracker - talks to Supabase directly over its web API.
   No outside libraries. Only the public "publishable" key is used here. */
(function () {
  'use strict';
  const DG = (window.DG = window.DG || {});
  const cfg = window.DG_CONFIG || {};
  // Accepts the address with or without extra bits on the end (like /rest/v1/), so a copy-paste slip still works.
  const BASE = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, '');
  const KEY = String(cfg.supabaseKey || '').trim();
  const SESSION_KEY = 'dg.session';

  const listeners = [];
  let session = DG.store.get(SESSION_KEY, null);
  let refreshing = null;

  function decodeJwt(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(part + '==='.slice((part.length + 3) % 4)))));
    } catch (e) {
      return null;
    }
  }

  function normalizeSession(data) {
    if (!data || !data.access_token) return null;
    const claims = decodeJwt(data.access_token) || {};
    const expiresAt = data.expires_at || claims.exp || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Number(expiresAt),
      user_id: (data.user && data.user.id) || claims.sub,
      email: (data.user && data.user.email) || claims.email || '',
    };
  }

  function setSession(s) {
    session = s;
    if (s) DG.store.set(SESSION_KEY, s);
    else DG.store.remove(SESSION_KEY);
    listeners.forEach((fn) => {
      try { fn(s); } catch (e) { console.error(e); }
    });
  }

  // Keep tabs in step with each other.
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY) return;
    session = DG.store.get(SESSION_KEY, null);
    listeners.forEach((fn) => fn(session));
  });

  function apiError(status, data) {
    const err = new Error(
      (data && (data.message || data.msg || data.error_description || data.error)) || `Request failed (${status})`);
    err.status = status;
    err.code = (data && (data.error_code || data.code)) || '';
    err.details = data;
    return err;
  }

  async function raw(path, opts) {
    const o = opts || {};
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    let res;
    try {
      res = await fetch(BASE + path, {
        method: o.method || 'GET',
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
    } catch (e) {
      const err = new Error('network');
      err.code = 'network';
      throw err;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { message: text }; }
    }
    if (!res.ok) throw apiError(res.status, data);
    return data;
  }

  async function refresh() {
    if (!session || !session.refresh_token) return null;
    if (!refreshing) {
      const rt = session.refresh_token;
      refreshing = raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: rt } })
        .then((data) => {
          const s = normalizeSession(data);
          setSession(s);
          return s;
        })
        .catch((err) => {
          // Another tab may have refreshed first; use its session if it did.
          const stored = DG.store.get(SESSION_KEY, null);
          if (stored && stored.refresh_token !== rt) {
            session = stored;
            return stored;
          }
          if (err.code !== 'network') setSession(null);
          throw err;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function validToken() {
    if (!session) return null;
    if (session.expires_at * 1000 - Date.now() < 60 * 1000) {
      const s = await refresh();
      return s && s.access_token;
    }
    return session.access_token;
  }

  async function authed(path, opts) {
    const o = Object.assign({}, opts);
    o.token = o.anon ? null : await validToken();
    try {
      return await raw(path, o);
    } catch (err) {
      if (err.status === 401 && session && !o.retried) {
        await refresh();
        return authed(path, Object.assign({}, opts, { retried: true }));
      }
      throw err;
    }
  }

  async function selectAll(table, select, order) {
    const out = [];
    let offset = 0;
    // Page through until an empty page, so any server row limit is respected.
    for (let guard = 0; guard < 500; guard++) {
      const rows = await authed(`/rest/v1/${table}?select=${encodeURIComponent(select || '*')}` +
        `&order=${encodeURIComponent(order)}&limit=1000&offset=${offset}`);
      if (!rows || !rows.length) break;
      out.push(...rows);
      offset += rows.length;
    }
    return out;
  }

  DG.api = {
    kind: 'supabase',
    configured: !!(BASE && KEY && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(BASE + '/')),
    session: () => session,
    onAuth(fn) { listeners.push(fn); },

    async signIn(email, password) {
      const data = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      setSession(normalizeSession(data));
      return session;
    },

    async signUp({ code, name, email, password }) {
      const data = await raw('/auth/v1/signup', {
        method: 'POST',
        body: { email, password, data: { invite_code: code, display_name: name } },
      });
      const s = normalizeSession(data);
      if (s) setSession(s);
      return { session: s, needsConfirm: !s };
    },

    async signOut() {
      const token = session && session.access_token;
      setSession(null);
      if (token) {
        try { await raw('/auth/v1/logout', { method: 'POST', token }); } catch (e) { /* already signed out */ }
      }
    },

    async requestReset(email) {
      const redirect = location.origin + location.pathname;
      await raw('/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect), { method: 'POST', body: { email } });
    },

    async updatePassword(password) {
      await authed('/auth/v1/user', { method: 'PUT', body: { password } });
    },

    /** Handles the link from a password-reset email. Returns 'recovery', 'error' or null. */
    handleAuthRedirect() {
      const h = location.hash.replace(/^#/, '');
      if (!/(^|&)(access_token|error)=/.test(h)) return null;
      const p = new URLSearchParams(h);
      history.replaceState(null, '', location.pathname + location.search);
      if (p.get('error')) {
        DG.authRedirectError = p.get('error_description') || p.get('error');
        return 'error';
      }
      setSession(normalizeSession({
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token'),
        expires_at: Number(p.get('expires_at')) || undefined,
        expires_in: Number(p.get('expires_in')) || 3600,
      }));
      return p.get('type') === 'recovery' ? 'recovery' : 'signin';
    },

    async loadAll() {
      const [profiles, courses, holes, rounds, round_players, bag_discs, hole_notes] = await Promise.all([
        selectAll('profiles', 'id,display_name,is_admin,created_at', 'id.asc'),
        selectAll('courses', '*', 'id.asc'),
        selectAll('holes', '*', 'id.asc'),
        selectAll('rounds', '*', 'id.asc'),
        selectAll('round_players', '*', 'round_id.asc,player_id.asc'),
        selectAll('bag_discs', '*', 'id.asc'),
        selectAll('hole_notes', 'hole_id,note,updated_at', 'hole_id.asc'), // only your own (database rule)
      ]);
      return { profiles, courses, holes, rounds, round_players, bag_discs, hole_notes };
    },
    loadInvites: () => selectAll('invites', '*', 'created_at.desc'),
    /** Rows where one column equals a value, e.g. one live round and its players. */
    selectWhere: (table, col, val) =>
      authed(`/rest/v1/${table}?select=*&${encodeURIComponent(col)}=eq.${encodeURIComponent(val)}`),
    loadCatalog: () => selectAll('disc_catalog', 'id,name,brand,category,speed,glide,turn,fade', 'id.asc'),

    rpc(name, args) {
      return authed('/rest/v1/rpc/' + name, { method: 'POST', body: args || {}, anon: name === 'check_invite' && !session });
    },

    /** Admin: asks this site's Cloudflare Worker to email a backup right now. */
    async emailBackup() {
      const send = async (token) => {
        let res;
        try {
          res = await fetch('/api/backup-now', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
        } catch (e) {
          throw Object.assign(new Error('network'), { code: 'network' });
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (!data && res.status === 404) throw new Error("The email backup isn't on the site yet. Upload the latest site files.");
          throw apiError(res.status, data);
        }
        return data;
      };
      const token = await validToken();
      if (!token) throw Object.assign(new Error('not_signed_in'), { code: 'not_signed_in' });
      try {
        return await send(token);
      } catch (err) {
        if (err.status !== 401) throw err;
        const s = await refresh();
        if (!s) throw err;
        return send(s.access_token);
      }
    },
  };
})();
