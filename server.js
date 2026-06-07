import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import chokidar from 'chokidar';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Logging horodate ---
function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

// --- Config ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(__dirname, 'config.example.json');
const MEDIA_DIR = path.join(__dirname, 'public', 'media');

let config = {};
let pollingTimer = null;
let lastSaleId = null;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log('INFO', 'config.json absent - creation depuis config.example.json');
    fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
  }
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    log('INFO', `Config chargee - compte: ${config.hiboutik?.account}, port: ${config.server?.port}`);
  } catch (err) {
    log('ERROR', `Lecture config.json echouee: ${err.message}`);
  }
}

// --- Assure les dossiers necessaires ---
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// --- Multer ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

// --- WebSocket clients ---
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

// --- Polling Hiboutik ---
function startPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  const interval = config.display?.poll_interval_ms || 3000;
  pollingTimer = setInterval(pollHiboutik, interval);
  log('INFO', `Polling demarre (intervalle: ${interval}ms)`);
}

async function pollHiboutik() {
  const { account, email, api_key, store_id } = config.hiboutik || {};
  if (!account || !email || !api_key || !store_id) return;

  const url = `https://${account}.hiboutik.com/api/sales/?store_id=${store_id}`;
  const auth = Buffer.from(`${email}:${api_key}`).toString('base64');

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      log('WARN', `Hiboutik HTTP ${res.status}`);
      return;
    }

    const raw = await res.json();
    const data = Array.isArray(raw) ? raw : (raw.sales || raw.data || [raw]);

    if (!data.length) return;

    data.sort((a, b) => {
      const da = new Date(b.completed_at || b.created_at || 0);
      const db = new Date(a.completed_at || a.created_at || 0);
      return da - db;
    });

    const latest = data[0];
    if (!latest || !latest.sale_id) return;

    if (String(latest.sale_id) !== String(lastSaleId)) {
      if (lastSaleId !== null) {
        log('INFO', `Nouvelle vente detectee: #${latest.sale_id}`);
        broadcast({ type: 'sale_closed', sale: latest });
      }
      lastSaleId = String(latest.sale_id);
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      log('WARN', 'Hiboutik timeout - nouvelle tentative au prochain cycle');
    } else {
      log('WARN', `Hiboutik indisponible: ${err.message}`);
    }
  }
}

// --- Express ---
const app = express();
app.use(express.json());

// Middleware localhost-only pour /admin et /api
app.use(['/admin', '/api'], (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    return res.status(403).json({ error: 'Acces admin reserve au PC local' });
  }
  next();
});

// Statique public/
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes HTML ---
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- API config ---
app.get('/api/config', (req, res) => {
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.hiboutik) delete safe.hiboutik.api_key;
  res.json(safe);
});

app.post('/api/config', (req, res) => {
  try {
    const incoming = req.body;
    const merged = Object.assign({}, config, incoming);
    if (incoming.hiboutik) {
      merged.hiboutik = Object.assign({}, config.hiboutik, incoming.hiboutik);
      if (!incoming.hiboutik.api_key) {
        merged.hiboutik.api_key = config.hiboutik?.api_key || '';
      }
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    log('ERROR', `Ecriture config: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- API media ---
app.post('/api/media/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
  log('INFO', `Media uploade: ${req.file.filename}`);
  res.json({ ok: true, filename: req.file.filename });
});

app.delete('/api/media/:filename', (req, res) => {
  const name = path.basename(req.params.filename);
  const target = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Fichier introuvable' });
  try {
    fs.unlinkSync(target);
    log('INFO', `Media supprime: ${name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/media', (req, res) => {
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.gif']);
  const files = fs.readdirSync(MEDIA_DIR)
    .filter(f => allowed.has(path.extname(f).toLowerCase()))
    .map(f => ({
      filename: f,
      url: `/media/${f}`,
      ext: path.extname(f).toLowerCase().slice(1)
    }));
  res.json(files);
});

// --- API preview ---
const FAKE_SALE = {
  sale_id: 99999,
  unique_sale_id: '2026-06-7-99999',
  completed_at: new Date().toISOString(),
  total_ttc: '29.90',
  payment_type: 'CB',
  qr_code: null,
  store_id: 1
};

app.post('/api/preview', (req, res) => {
  const fakeSale = Object.assign({}, FAKE_SALE, { completed_at: new Date().toISOString() });
  broadcast({ type: 'sale_closed', sale: fakeSale });
  log('INFO', 'Preview envoye aux clients WS');
  res.json({ ok: true });
});

// --- API status ---
app.get('/api/status', (req, res) => {
  res.json({
    polling: pollingTimer !== null,
    lastSaleId,
    connectedClients: clients.size,
    uptime: Math.floor(process.uptime())
  });
});

// --- Serveur HTTP + WebSocket ---
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  clients.add(ws);
  log('INFO', `Client WS connecte (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    log('INFO', `Client WS deconnecte (${clients.size} restants)`);
  });

  ws.on('error', (err) => {
    log('WARN', `WS erreur: ${err.message}`);
    clients.delete(ws);
  });

  // Envoyer la config publique au client qui se connecte
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.hiboutik) delete safe.hiboutik.api_key;
  ws.send(JSON.stringify({ type: 'config', config: safe }));
});

// --- Chokidar config.json ---
chokidar.watch(CONFIG_PATH, { ignoreInitial: true }).on('change', () => {
  log('INFO', 'config.json modifie - rechargement...');
  loadConfig();
  startPolling();
  broadcast({ type: 'config_reload' });
});

// --- Demarrage ---
loadConfig();

const PORT = config.server?.port || 3000;
server.listen(PORT, () => {
  log('INFO', `Serveur demarre sur le port ${PORT}`);
  log('INFO', `Afficheur tablette : http://[IP-DU-PC]:${PORT}/display`);
  log('INFO', `Interface admin    : http://localhost:${PORT}/admin`);
  startPolling();
});

server.on('error', (err) => {
  log('ERROR', `Serveur: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    log('ERROR', `Port ${PORT} deja utilise. Modifiez server.port dans config.json`);
    process.exit(1);
  }
});
