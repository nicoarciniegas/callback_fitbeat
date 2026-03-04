const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECTS_FILE = path.join(__dirname, 'redirects.json');
const FALLBACK_URL = process.env.FALLBACK_URL || null;

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
  <title>Redirect Service</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { text-align: left; padding: 10px 14px; border: 1px solid #ddd; }
    th { background: #f5f5f5; }
    a { color: #0070f3; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Redirect Service</h1>
  <p>Edita <code>redirects.json</code> para agregar o modificar redirecciones.</p>
  <table>
    <thead><tr><th>Ruta (desde)</th><th>Destino (hacia)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
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
<head><meta charset="UTF-8"><title>404 - No encontrado</title>
<style>body{font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center} a{display:inline-block;margin:8px 12px;color:#0070f3;}</style>
</head>
<body>
  <h2>404 - Redirección no encontrada</h2>
  <p>La ruta <strong>${req.path}</strong> no está configurada.</p>
  ${fallbackLink}
  <a href="/">Ver redirecciones activas</a>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`✓ Redirect service corriendo en http://localhost:${PORT}`);
  console.log(`  Edita redirects.json para agregar rutas.`);
});
