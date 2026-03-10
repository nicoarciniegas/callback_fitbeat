const express = require('express');
const crypto  = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECTS_FILE = path.join(__dirname, 'redirects.json');
const FALLBACK_URL = process.env.FALLBACK_URL || null;

// ── Session / Token Store ────────────────────────────────────────────────────
const tokenStore = new Map(); // sid (64-hex) → { access_token, refresh_token, expires_at }

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    try { cookies[key] = decodeURIComponent(pair.slice(idx + 1).trim()); }
    catch { cookies[key] = pair.slice(idx + 1).trim(); }
  }
  return cookies;
}

function getSession(req) {
  const { fitbeat_session: sid } = parseCookies(req);
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  return tokenStore.get(sid) || null;
}

// Load redirects from JSON file
function loadRedirects() {
  try {
    const data = fs.readFileSync(REDIRECTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading redirects.json:', err.message);
    return {};
  }
}

// Home - list all configured redirects
app.get('/', (req, res) => {
  const redirects = loadRedirects();
  const entries = Object.entries(redirects);

  const rows = entries.length
    ? entries
        .map(
          ([from, to]) =>
            `<tr><td><a href="${from}">${from}</a></td><td><a href="${to}" target="_blank">${to}</a></td></tr>`
        )
        .join('')
    : '<tr><td colspan="2">No hay redirecciones configuradas.</td></tr>';

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fitbeat — Redirect Service</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #111;
      border-bottom: 1px solid #222;
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    header .logo {
      font-size: 1.6rem;
      font-weight: 700;
      color: #1DB954;
      letter-spacing: -0.5px;
    }
    header .badge {
      font-size: 0.7rem;
      background: #1DB954;
      color: #000;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    header .subtitle {
      font-size: 0.78rem;
      color: #666;
      margin-left: auto;
    }
    main {
      flex: 1;
      max-width: 860px;
      width: 100%;
      margin: 40px auto;
      padding: 0 24px;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 6px;
    }
    .desc {
      font-size: 0.85rem;
      color: #888;
      margin-bottom: 24px;
    }
    .desc code {
      background: #1e1e1e;
      color: #1DB954;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 0.82em;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    thead tr { border-bottom: 1px solid #2a2a2a; }
    th {
      text-align: left;
      padding: 10px 16px;
      color: #555;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    td {
      padding: 11px 16px;
      border-bottom: 1px solid #1a1a1a;
      color: #ccc;
    }
    tbody tr:hover td { background: #111; }
    a { color: #1DB954; text-decoration: none; }
    a:hover { text-decoration: underline; }
    footer {
      text-align: center;
      padding: 24px 16px;
      font-size: 0.78rem;
      color: #444;
      border-top: 1px solid #161616;
      line-height: 1.8;
    }
    footer a { color: #666; }
    footer a:hover { color: #1DB954; }
    .spotify-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.75rem;
      color: #1DB954;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <header>
    <span class="logo">Fitbeat</span>
    <span class="badge">Beta</span>
    <span class="subtitle">Proyecto académico · Universidad Nacional de Colombia &nbsp;·&nbsp; <a href="/auth/login">&#9654; Web Player</a></span>
  </header>
  <main>
    <h1>Redirect Service</h1>
    <p class="desc">Edita <code>redirects.json</code> para agregar o modificar redirecciones.</p>
    <table>
      <thead><tr><th>Ruta (desde)</th><th>Destino (hacia)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
  <footer>
    <div>Data provided by <a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM</a></div>
    <div>
      <span class="spotify-badge">&#9654; Powered by Spotify</span>
    </div>
    <div>Fitbeat es un proyecto académico en desarrollo · <a href="https://unal.edu.co" target="_blank" rel="noopener">Universidad Nacional de Colombia</a></div>
  </footer>
</body>
</html>`);
});

// ── Spotify Auth Routes ─────────────────────────────────────────────────────

// GET /auth/login  — redirect to Spotify authorization page
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

// GET /auth/callback  — exchange authorization code for tokens
app.get('/auth/callback', async (req, res) => {
  const code  = typeof req.query.code  === 'string' ? req.query.code  : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  if (error) return res.redirect(`/?error=${encodeURIComponent(error)}`);
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

// GET /auth/token  — returns access token JSON for the current session (used by the SDK)
app.get('/auth/token', async (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.fitbeat_session;
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

// ── Player Page ───────────────────────────────────────────────────────────────
const PLAYER_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fitbeat — Player</title>
  <script src="https://sdk.scdn.co/spotify-player.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #111;
      border-bottom: 1px solid #222;
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    header .logo { font-size: 1.6rem; font-weight: 700; color: #1DB954; letter-spacing: -0.5px; text-decoration: none; }
    header .badge {
      font-size: 0.7rem; background: #1DB954; color: #000;
      font-weight: 600; padding: 2px 8px; border-radius: 999px;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    header .subtitle { font-size: 0.78rem; color: #666; }
    header nav { margin-left: auto; display: flex; gap: 12px; align-items: center; }
    header nav a {
      font-size: 0.8rem; color: #888; text-decoration: none;
      background: #1a1a1a; border: 1px solid #272727; padding: 6px 14px;
      border-radius: 6px; transition: color 0.15s, border-color 0.15s;
    }
    header nav a:hover { color: #1DB954; border-color: #1DB954; }
    main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
    }
    .player-card {
      background: #141414;
      border: 1px solid #1e1e1e;
      border-radius: 20px;
      padding: 36px 32px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    }
    .art-wrap {
      width: 230px; height: 230px;
      margin: 0 auto 22px;
      border-radius: 14px;
      overflow: hidden;
      background: #1c1c1c;
      display: flex; align-items: center; justify-content: center;
    }
    #album-art { width: 100%; height: 100%; object-fit: cover; display: none; }
    #art-placeholder svg { opacity: 0.15; }
    #track-name {
      font-size: 1.15rem; font-weight: 700; color: #fff; margin-bottom: 5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #artist-name {
      font-size: 0.88rem; color: #888; margin-bottom: 22px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .progress-wrap { margin-bottom: 18px; }
    .progress-bar {
      width: 100%; height: 4px; background: #2a2a2a;
      border-radius: 2px; margin-bottom: 7px;
      cursor: pointer; position: relative;
      transition: height 0.1s;
    }
    .progress-bar:hover { height: 6px; margin-bottom: 5px; }
    .progress-fill {
      height: 100%; background: #1DB954; border-radius: 2px;
      width: 0%; pointer-events: none;
    }
    .time-row { display: flex; justify-content: space-between; font-size: 0.72rem; color: #555; }
    .controls { display: flex; align-items: center; justify-content: center; gap: 18px; }
    .ctrl {
      background: none; border: none; color: #999;
      cursor: pointer; border-radius: 50%;
      width: 44px; height: 44px;
      display: flex; align-items: center; justify-content: center;
      transition: color 0.15s, transform 0.1s;
    }
    .ctrl:hover { color: #fff; transform: scale(1.1); }
    .ctrl.primary { background: #1DB954; color: #000; width: 58px; height: 58px; }
    .ctrl.primary:hover { background: #1ed760; transform: scale(1.04); }
    #status-msg { margin-top: 18px; font-size: 0.8rem; color: #555; line-height: 1.55; }
    .dot {
      display: inline-block; width: 7px; height: 7px;
      background: #1DB954; border-radius: 50%; margin-right: 6px;
      animation: blink 1.4s infinite;
    }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
    footer {
      text-align: center; padding: 18px 16px;
      font-size: 0.75rem; color: #333;
      border-top: 1px solid #161616;
    }
    footer a { color: #444; text-decoration: none; }
    footer a:hover { color: #1DB954; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="logo">Fitbeat</a>
    <span class="badge">Beta</span>
    <span class="subtitle">Web Player</span>
    <nav>
      <a href="/">Redirects</a>
      <a href="/auth/logout">Cerrar sesi&#243;n</a>
    </nav>
  </header>

  <main>
    <div class="player-card">
      <div class="art-wrap">
        <img id="album-art" alt="Portada del &#225;lbum" />
        <div id="art-placeholder">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="#fff">
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
          </svg>
        </div>
      </div>
      <div id="track-name">Nada en reproducci&#243;n</div>
      <div id="artist-name">&#8212;</div>

      <div class="progress-wrap">
        <div class="progress-bar" id="progress-bar">
          <div class="progress-fill" id="progress-fill"></div>
        </div>
        <div class="time-row">
          <span id="time-current">0:00</span>
          <span id="time-total">0:00</span>
        </div>
      </div>

      <div class="controls">
        <button class="ctrl" id="btn-prev" title="Anterior" aria-label="Pista anterior">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button class="ctrl primary" id="btn-play-pause" title="Reproducir / Pausar" aria-label="Reproducir o pausar">
          <svg id="icon-play" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg id="icon-pause" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </button>
        <button class="ctrl" id="btn-next" title="Siguiente" aria-label="Siguiente pista">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z"/></svg>
        </button>
      </div>

      <p id="status-msg"><span class="dot"></span>Conectando con Spotify&#8230;</p>
    </div>
  </main>

  <footer>
    &#9654; Powered by Spotify &nbsp;&middot;&nbsp;
    Fitbeat &middot; <a href="https://unal.edu.co" target="_blank" rel="noopener">Universidad Nacional de Colombia</a>
  </footer>

  <script>
    let player, trackDuration = 0, trackPosition = 0, isPaused = true;

    async function getToken() {
      const res = await fetch('/auth/token');
      if (!res.ok) { window.location.href = '/auth/login'; return ''; }
      return (await res.json()).access_token;
    }

    function fmt(ms) {
      const s = Math.floor(Math.max(ms, 0) / 1000);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function tick() {
      if (!isPaused) trackPosition = Math.min(trackPosition + 500, trackDuration);
      if (trackDuration > 0) {
        document.getElementById('progress-fill').style.width =
          (trackPosition / trackDuration * 100) + '%';
        document.getElementById('time-current').textContent = fmt(trackPosition);
        document.getElementById('time-total').textContent   = fmt(trackDuration);
      }
    }

    function setPlaying(paused) {
      isPaused = paused;
      document.getElementById('icon-play').style.display  = paused ? '' : 'none';
      document.getElementById('icon-pause').style.display = paused ? 'none' : '';
    }

    function updateUI(state) {
      if (!state) {
        document.getElementById('status-msg').innerHTML =
          'Nada se est&#225; reproduciendo.<br>Abre Spotify y empieza a reproducir una canci&#243;n.';
        document.getElementById('status-msg').style.display = 'block';
        return;
      }
      const track = state.track_window.current_track;
      trackPosition = state.position;
      trackDuration  = state.duration;
      setPlaying(state.paused);
      document.getElementById('track-name').textContent  = track.name;
      document.getElementById('artist-name').textContent =
        track.artists.map(function(a) { return a.name; }).join(', ');
      const imgs = track.album.images;
      if (imgs && imgs.length) {
        const el = document.getElementById('album-art');
        el.src = imgs[0].url;
        el.style.display = 'block';
        document.getElementById('art-placeholder').style.display = 'none';
      }
      document.getElementById('status-msg').style.display = 'none';
      tick();
    }

    window.onSpotifyWebPlaybackSDKReady = function() {
      player = new Spotify.Player({
        name: 'Fitbeat Web Player',
        getOAuthToken: function(cb) { getToken().then(cb); },
        volume: 0.8,
      });

      player.addListener('ready', function(ref) {
        var device_id = ref.device_id;
        console.log('[Fitbeat] Player ready:', device_id);
        document.getElementById('status-msg').innerHTML =
          '<span class="dot"></span>Transfiriendo reproducci&#243;n&#8230;';
        getToken().then(function(token) {
          fetch('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ device_ids: [device_id], play: false }),
          }).catch(function() {});
          document.getElementById('status-msg').textContent =
            'Reproductor listo &#183; Inicia la reproducci&#243;n desde Spotify o presiona &#9654;';
        });
      });

      player.addListener('not_ready', function() {
        document.getElementById('status-msg').textContent = '&#9888; Reproductor desconectado.';
        document.getElementById('status-msg').style.display = 'block';
      });

      player.addListener('player_state_changed', updateUI);

      player.addListener('initialization_error', function(ref) {
        document.getElementById('status-msg').textContent = 'Error: ' + ref.message;
        document.getElementById('status-msg').style.display = 'block';
      });

      player.addListener('authentication_error', function() {
        window.location.href = '/auth/login';
      });

      player.addListener('account_error', function() {
        document.getElementById('status-msg').innerHTML =
          '&#9888; Se requiere <strong>Spotify Premium</strong> para usar el Web Player.';
        document.getElementById('status-msg').style.display = 'block';
      });

      document.getElementById('btn-play-pause').addEventListener('click',
        function() { player.togglePlay(); });
      document.getElementById('btn-next').addEventListener('click',
        function() { player.nextTrack(); });
      document.getElementById('btn-prev').addEventListener('click',
        function() { player.previousTrack(); });

      document.getElementById('progress-bar').addEventListener('click', function(e) {
        if (!trackDuration) return;
        var r  = e.currentTarget.getBoundingClientRect();
        var ms = Math.floor(((e.clientX - r.left) / r.width) * trackDuration);
        player.seek(ms).then(function() { trackPosition = ms; tick(); });
      });

      setInterval(tick, 500);
      player.connect();
    };
  </script>
</body>
</html>`;

// GET /player
app.get('/player', (req, res) => {
  if (!getSession(req)) return res.redirect('/auth/login');
  res.send(PLAYER_HTML);
});

// Catch-all redirect handler
app.use((req, res) => {
  const redirects = loadRedirects();
  const target = redirects[req.path];

  if (target) {
    console.log(`[redirect] ${req.path} → ${target}`);
    return res.redirect(302, target);
  }

  const fallbackLink = FALLBACK_URL
    ? `<a href="${FALLBACK_URL}">Volver a la aplicación</a>`
    : '';

  res.status(404).send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 — Fitbeat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #111;
      border-bottom: 1px solid #222;
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    header .logo { font-size: 1.6rem; font-weight: 700; color: #1DB954; letter-spacing: -0.5px; }
    header .badge {
      font-size: 0.7rem; background: #1DB954; color: #000;
      font-weight: 600; padding: 2px 8px; border-radius: 999px;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    header .subtitle { font-size: 0.78rem; color: #666; margin-left: auto; }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 60px 24px;
      gap: 12px;
    }
    .code { font-size: 4rem; font-weight: 800; color: #1DB954; line-height: 1; }
    h2 { font-size: 1.2rem; color: #ccc; font-weight: 500; }
    .path { font-size: 0.85rem; color: #555; font-family: monospace; margin-top: 4px; }
    .links { display: flex; gap: 16px; margin-top: 20px; flex-wrap: wrap; justify-content: center; }
    a {
      color: #1DB954; text-decoration: none;
      border: 1px solid #1DB954; padding: 8px 20px;
      border-radius: 6px; font-size: 0.85rem; transition: background 0.15s;
    }
    a:hover { background: #1DB954; color: #000; }
    footer {
      text-align: center; padding: 24px 16px;
      font-size: 0.78rem; color: #444;
      border-top: 1px solid #161616; line-height: 1.8;
    }
    footer a { color: #666; }
    footer a:hover { color: #1DB954; }
    .spotify-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; color: #1DB954; font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <span class="logo">Fitbeat</span>
    <span class="badge">Beta</span>
    <span class="subtitle">Proyecto académico · Universidad Nacional de Colombia</span>
  </header>
  <main>
    <div class="code">404</div>
    <h2>Redirección no encontrada</h2>
    <p class="path">${req.path}</p>
    <div class="links">
      ${fallbackLink}
      <a href="/">Ver redirecciones activas</a>
    </div>
  </main>
  <footer>
    <div>Data provided by <a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM</a></div>
    <div><span class="spotify-badge">&#9654; Powered by Spotify</span></div>
    <div>Fitbeat es un proyecto académico en desarrollo · <a href="https://unal.edu.co" target="_blank" rel="noopener">Universidad Nacional de Colombia</a></div>
  </footer>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`✓ Redirect service corriendo en http://localhost:${PORT}`);
  console.log(`  Edita redirects.json para agregar rutas.`);
});
