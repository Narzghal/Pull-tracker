/* Disc Golf Tracker - Cloudflare Worker.
   1. Serves the website files in the "public" folder.
   2. Every day: sends a tiny "ping" to the database so the free plan never pauses it.
   3. Every week (Sunday evening): emails you a backup of all the data, through Resend.
   4. The "Email me a backup now" button on the Admin page.

   The Supabase address and PUBLIC key are read from public/config.js.
   The backup email needs three settings, saved in Cloudflare as Secrets
   (this Worker > Settings > Variables and Secrets), never in any file:
     RESEND_API_KEY  your Resend API key
     BACKUP_EMAIL    where backups go (the email you signed up to Resend with)
     BACKUP_CODE     the backup code from the database setup */
import { Buffer } from 'node:buffer';

const WEEKLY = '41 3 * * 1'; // 03:41 UTC Monday = Sunday evening in Utah
const TIME_ZONE = 'America/Denver';
const FROM = 'Disc Golf Tracker <onboarding@resend.dev>';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/backup-now') return backupNow(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === WEEKLY ? weeklyBackup(env) : dailyCheckIn(env));
  },
};

/* ------------------------------------------------------------ settings */
async function readConfig(env) {
  const res = await env.ASSETS.fetch(new Request('https://site.local/config.js'));
  const text = await res.text();
  const url = (text.match(/supabaseUrl\s*:\s*["']([^"']+)["']/) || [])[1];
  const key = (text.match(/supabaseKey\s*:\s*["']([^"']+)["']/) || [])[1];
  if (!url || !key) return null;
  return { url: url.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, ''), key: key.trim() };
}

function rpc(cfg, name, args, token) {
  const headers = { apikey: cfg.key, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(`${cfg.url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args || {}) });
}

async function errorText(res) {
  const text = await res.text().catch(() => '');
  try {
    const d = JSON.parse(text);
    return d.message || d.msg || d.error || text || `status ${res.status}`;
  } catch (e) {
    return text.slice(0, 300) || `status ${res.status}`;
  }
}

/* ------------------------------------------------------------ 2. daily check-in */
async function dailyCheckIn(env) {
  const cfg = await readConfig(env);
  if (!cfg) {
    console.log('Daily check-in skipped: config.js does not have the Supabase details yet.');
    return;
  }
  const r = await rpc(cfg, 'ping', {});
  console.log('Daily check-in finished with status', r.status);
}

/* ------------------------------------------------------------ backups */
function today() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}
function prettyDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Gets both backup files from the database, using the backup code. */
async function takeBackup(cfg, opts) {
  const args = { p_code: opts.code };
  const [dataRes, sheetRes] = await Promise.all([
    rpc(cfg, 'backup_data', args),
    rpc(cfg, 'backup_sheet', args),
  ]);
  if (!dataRes.ok) throw Object.assign(new Error(await errorText(dataRes)), { status: dataRes.status });
  if (!sheetRes.ok) throw Object.assign(new Error(await errorText(sheetRes)), { status: sheetRes.status });
  // The full backup is passed along exactly as the database sent it (no unpacking), which keeps
  // the Worker well inside Cloudflare's free-plan time limit even after years of rounds.
  const data = Buffer.from(await dataRes.arrayBuffer());
  const sheet = await sheetRes.json();
  return { data, csv: Buffer.from(sheet.csv || '', 'utf8'), counts: sheet.counts || {} };
}

async function sendEmail(env, msg) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'disc-golf-tracker',
    },
    body: JSON.stringify(Object.assign({ from: FROM, to: [env.BACKUP_EMAIL] }, msg)),
  });
  if (!res.ok) {
    const text = await errorText(res);
    console.log('Resend did not send the email:', res.status, text);
    throw Object.assign(new Error(text), { status: 502, resend: true });
  }
  return res.json().catch(() => ({}));
}

async function sendBackup(env, backup, why) {
  const day = today();
  const c = backup.counts;
  const text = [
    why === 'manual' ? 'Here is the backup you asked for from the Admin page.' : 'Your weekly disc golf backup is attached.',
    '',
    `It has ${plural(c.rounds || 0, 'finished round')}, ${plural(c.players || 0, 'player')} and ${plural(c.courses || 0, 'course')}` +
      (c.live_rounds ? ` (plus ${plural(c.live_rounds, 'round')} still being played).` : '.'),
    '',
    `disc-golf-backup-${day}.json`,
    '  Everything on the site: players, courses, holes, rounds, scores and bags.',
    '  Keep this one. It can rebuild the site if anything ever goes wrong.',
    '',
    `disc-golf-rounds-${day}.csv`,
    '  Every finished round, one row per player. Opens in Excel or Google Sheets.',
    '',
    'Private hole notes are never included, so they stay private.',
  ].join('\n');
  return sendEmail(env, {
    subject: `Disc golf backup - ${prettyDate(day)}`,
    text,
    attachments: [
      { filename: `disc-golf-backup-${day}.json`, content: backup.data.toString('base64'), content_type: 'application/json' },
      { filename: `disc-golf-rounds-${day}.csv`, content: backup.csv.toString('base64'), content_type: 'text/csv' },
    ],
  });
}

function emailSettingsMissing(env) {
  return ['RESEND_API_KEY', 'BACKUP_EMAIL'].filter((k) => !String(env[k] || '').trim());
}

/* ------------------------------------------------------------ 3. weekly backup */
async function weeklyBackup(env) {
  const missing = emailSettingsMissing(env);
  if (missing.length) {
    console.log('Weekly backup skipped: these Cloudflare secrets are not set yet:', missing.join(', '));
    return;
  }
  let reason = '';
  try {
    const cfg = await readConfig(env);
    if (!cfg) reason = "The site's config.js doesn't have the Supabase details.";
    else if (!String(env.BACKUP_CODE || '').trim()) reason = 'The BACKUP_CODE secret is not set in Cloudflare.';
    else {
      const backup = await takeBackup(cfg, { code: String(env.BACKUP_CODE).trim() });
      await sendBackup(env, backup, 'weekly');
      console.log('Weekly backup emailed.');
      return;
    }
  } catch (e) {
    if (e.resend) return; // Resend itself refused, so a second email would fail too. It's in the log.
    reason = /backup_code_wrong/.test(e.message) ? CODE_WRONG : `The database said: ${e.message}`;
  }
  console.log('Weekly backup failed:', reason);
  try {
    await sendEmail(env, {
      subject: "Disc golf backup didn't work this week",
      text: [
        "This week's automatic backup didn't work, so nothing is attached.",
        '',
        `Reason: ${reason}`,
        '',
        'To get a backup now, open your site, go to Admin > Backups and click "Email me a backup now" or "Download".',
      ].join('\n'),
    });
  } catch (e) { /* already logged */ }
}

/* ------------------------------------------------------------ 4. "Email me a backup now" */
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const CODE_WRONG = 'The backup code saved in Cloudflare (BACKUP_CODE) does not match the database. ' +
  'If you made a new backup code on the Admin page, paste it into the BACKUP_CODE secret in Cloudflare.';

/* Takes the backup exactly like the weekly email does (with the backup code), so this
   button also proves the weekly backup will work. Only the admin can use it. */
async function backupNow(request, env) {
  if (request.method !== 'POST') return reply(405, { message: 'Use the button on the Admin page.' });
  const token = ((request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/) || [])[1];
  if (!token) return reply(401, { message: 'Sign in first.' });
  const cfg = await readConfig(env);
  if (!cfg) return reply(503, { message: "The site's config.js doesn't have the Supabase details yet." });

  const who = await rpc(cfg, 'is_admin', {}, token);
  if (who.status === 401) return reply(401, { message: 'Your sign-in ran out. Sign in again and try once more.' });
  if (!who.ok) return reply(502, { message: await errorText(who) });
  if ((await who.json()) !== true) return reply(403, { code: 'admin_only', message: 'Only the admin can do that.' });

  const missing = ['RESEND_API_KEY', 'BACKUP_EMAIL', 'BACKUP_CODE'].filter((k) => !String(env[k] || '').trim());
  if (missing.length) {
    const names = missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0];
    return reply(503, { code: 'backup_not_set_up', message: `Email backups aren't set up yet. Add ${names} in Cloudflare.` });
  }
  let backup;
  try {
    backup = await takeBackup(cfg, { code: String(env.BACKUP_CODE).trim() });
  } catch (e) {
    return reply(502, { message: /backup_code_wrong/.test(e.message) ? CODE_WRONG : `The database said: ${e.message}` });
  }
  try {
    await sendBackup(env, backup, 'manual');
  } catch (e) {
    return reply(502, { code: 'resend_refused', message: e.message });
  }
  return reply(200, { ok: true, sentTo: env.BACKUP_EMAIL });
}
