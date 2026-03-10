const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const REDIRECTS_FILE = path.join(__dirname, 'redirects.json');
const FALLBACK_URL   = process.env.FALLBACK_URL || null;

// ── Static files (public/) ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Session / Token Store ───────────────────────────────────────────────────
const tokenStore = new Map(); // sid (64-hex) → { access_token, refresh_token, expires_at }

function parseCookies(req) {
  const cookies = {};
  const header  = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    try   { cookies[key] = decodeURIComponent(pair.slice(idx + 1).trim()); }
    catch { cookies[key] = pair.slice(idx + 1).trim(); }
  }
  return cookies;
}

function getSession(req) {
  const { fitbeat_session: sid } = parseCookies(req);
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  return tokenStore.get(sid) || null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadRedirects() {
  try {
    return JSON.parse(fs.readFileSync(REDIRECTS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Error loading redirects.json:', err.message);
    return {};
  }
}

function readView(name) {
  return fs.readFileSync(path.join(__dirname, 'views', name), 'utf-8');
}

// ── Home ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const redirects = loadRedirects();
  const entries   = Object.entries(redirects);

  const rows = entries.length
    ? entries
        .map(([from, to]) =>
          `<tr><td><a href="${from}">${from}</a></td><td><a href="${to}" target="_blank">${to}</a></td></tr>`
        )
        .join('')
    : '<tr><td colspan="2">No hay redirecciones configuradas.</td></tr>';

  res.send(readView('index.html').replace('{{rows}}', rows));
});

// ── Spotify Auth Routes ──────────────────────────────────────────────────────

// GET /auth/login — redirect to Spotify authorization page
app.get('/auth/login', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send('SPOTIFY_CLIENT_ID no está configurado en las variables de entorno.');
  }
  const state       = crypto.randomBytes(16).toString('hex');
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    scope,
    redirect_uri:  redirectUri,
    state,
  });

  res.setHeader('Set-Cookie', `spotify_auth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// GET /auth/callback — exchange authorization code for tokens
app.get('/auth/callback', async (req, res) => {
  const code  = typeof req.query.code  === 'string' ? req.query.code  : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  if (error)           return res.redirect(`/?error=${encodeURIComponent(error)}`);
  if (!code || !state) return res.redirect('/?error=missing_params');

  const cookies = parseCookies(req);
  if (!cookies.spotify_auth_state || state !== cookies.spotify_auth_state) {
    return res.redirect('/?error=state_mismatch');
  }

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('Spotify credentials not configured.');
  }
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('[auth] Token exchange failed:', tokenData);
      return res.redirect('/?error=token_exchange_failed');
    }

    const sid = crypto.randomBytes(32).toString('hex');
    tokenStore.set(sid, {
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at:    Date.now() + tokenData.expires_in * 1000,
    });

    res.setHeader('Set-Cookie', [
      `spotify_auth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `fitbeat_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
    ]);
    res.redirect('/player');
  } catch (err) {
    console.error('[auth] Token exchange error:', err);
    res.redirect('/?error=server_error');
  }
});

// GET /auth/token — returns current access token JSON (used by the SDK)
app.get('/auth/token', async (req, res) => {
  const cookies = parseCookies(req);
  const sid     = cookies.fitbeat_session;
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const session = tokenStore.get(sid);
  if (!session) return res.status(401).json({ error: 'Session not found' });

  // Auto-refresh if expiring within 2 minutes
  if (session.expires_at - Date.now() < 120_000) {
    const clientId     = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    try {
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:  'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refresh_token }),
      });
      const d = await r.json();
      if (d.access_token) {
        session.access_token = d.access_token;
        session.expires_at   = Date.now() + d.expires_in * 1000;
        if (d.refresh_token) session.refresh_token = d.refresh_token;
      }
    } catch (e) {
      console.error('[auth] Refresh error:', e);
    }
  }

  res.json({
    access_token: session.access_token,
    expires_in:   Math.floor((session.expires_at - Date.now()) / 1000),
  });
});

// GET /auth/logout
app.get('/auth/logout', (req, res) => {
  const { fitbeat_session: sid } = parseCookies(req);
  if (sid) tokenStore.delete(sid);
  res.setHeader('Set-Cookie', 'fitbeat_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.redirect('/');
});

// ── Player ───────────────────────────────────────────────────────────────────
app.get('/player', (req, res) => {
  if (!getSession(req)) return res.redirect('/auth/login');
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// ── Catch-all redirect handler ───────────────────────────────────────────────
app.use((req, res) => {
  const redirects = loadRedirects();
  const target    = redirects[req.path];

  if (target) {
    console.log(`[redirect] ${req.path} → ${target}`);
    return res.redirect(302, target);
  }

  const fallbackLink = FALLBACK_URL
    ? `<a href="${FALLBACK_URL}">Volver a la aplicación</a>`
    : '';

  const html = readView('404.html')
    .replace('{{path}}',         req.path)
    .replace('{{fallbackLink}}', fallbackLink);

  res.status(404).send(html);
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ Redirect service corriendo en http://localhost:${PORT}`);
  console.log(`  Edita redirects.json para agregar rutas.`);
});
