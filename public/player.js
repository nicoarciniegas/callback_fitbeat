/* global Spotify */

let player;
let trackDuration = 0;
let trackPosition = 0;
let isPaused = true;

async function getToken() {
  const res = await fetch('/auth/token');
  if (!res.ok) {
    window.location.href = '/auth/login';
    return '';
  }
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
  const statusEl = document.getElementById('status-msg');
  if (!state) {
    statusEl.innerHTML = 'Nada se está reproduciendo.<br>Abre Spotify y empieza a reproducir una canción.';
    statusEl.style.display = 'block';
    return;
  }

  const track = state.track_window.current_track;
  trackPosition = state.position;
  trackDuration  = state.duration;
  setPlaying(state.paused);

  document.getElementById('track-name').textContent  = track.name;
  document.getElementById('artist-name').textContent =
    track.artists.map(a => a.name).join(', ');

  const imgs = track.album.images;
  if (imgs && imgs.length) {
    const el = document.getElementById('album-art');
    el.src = imgs[0].url;
    el.style.display = 'block';
    document.getElementById('art-placeholder').style.display = 'none';
  }

  statusEl.style.display = 'none';
  tick();
}

window.onSpotifyWebPlaybackSDKReady = function () {
  player = new Spotify.Player({
    name: 'Fitbeat Web Player',
    getOAuthToken: cb => getToken().then(cb),
    volume: 0.8,
  });

  player.addListener('ready', ({ device_id }) => {
    console.log('[Fitbeat] Player ready:', device_id);
    const statusEl = document.getElementById('status-msg');
    statusEl.innerHTML = '<span class="dot"></span>Transfiriendo reproducción…';

    getToken().then(token => {
      fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [device_id], play: false }),
      }).catch(() => {});

      statusEl.textContent = 'Reproductor listo · Inicia la reproducción desde Spotify o presiona ▶';
    });
  });

  player.addListener('not_ready', () => {
    const statusEl = document.getElementById('status-msg');
    statusEl.textContent  = '⚠ Reproductor desconectado.';
    statusEl.style.display = 'block';
  });

  player.addListener('player_state_changed', updateUI);

  player.addListener('initialization_error', ({ message }) => {
    const statusEl = document.getElementById('status-msg');
    statusEl.textContent  = 'Error: ' + message;
    statusEl.style.display = 'block';
  });

  player.addListener('authentication_error', () => {
    window.location.href = '/auth/login';
  });

  player.addListener('account_error', () => {
    const statusEl = document.getElementById('status-msg');
    statusEl.innerHTML    = '⚠ Se requiere <strong>Spotify Premium</strong> para usar el Web Player.';
    statusEl.style.display = 'block';
  });

  document.getElementById('btn-play-pause').addEventListener('click', () => player.togglePlay());
  document.getElementById('btn-next').addEventListener('click',       () => player.nextTrack());
  document.getElementById('btn-prev').addEventListener('click',       () => player.previousTrack());

  document.getElementById('progress-bar').addEventListener('click', e => {
    if (!trackDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ms   = Math.floor(((e.clientX - rect.left) / rect.width) * trackDuration);
    player.seek(ms).then(() => { trackPosition = ms; tick(); });
  });

  setInterval(tick, 500);
  player.connect();
};
