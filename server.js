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

  // Endpoint correct Hiboutik : /closed_sales/{store_id}/{year}/{month}/{day}
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dy = String(now.getDate()).padStart(2, '0');
  const url = `https://${account}.hiboutik.com/api/closed_sales/${store_id}/${y}/${mo}/${dy}`;
  const auth = Buffer.from(`${email}:${api_key}`).toString('base64');

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
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
        // Module concours : MDD + webhook LMDV + email Brevo
        processConcours(latest, `Basic ${auth}`, account);
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

// ═══════════════════════════════════════════════════════════════
// MODULE CONCOURS — détection MDD + webhook LMDV + email Brevo
// ═══════════════════════════════════════════════════════════════

// Détection MDD en cascade pour boutiques franchisées
// Cascade : 1. EAN dans liste config  2. Nom produit regex
function detectMdd(items, mddEans = []) {
  // Cascade MDD :
  // Niveau 1 — EAN exact (liste dans config.concours.mdd_eans)
  // Niveau 2 — Marques : Les Intemporels | Cities | LMDV x Montréal Original | VapeHits | gamme DIY LMDV
  const MDD_PATTERN = /intemporel|cities|montr[eé]al[\s-]*original|vapehits|vape\s*hits|lmdv/i;
  return items.some(item => {
    // Niveau 1 — EAN exact
    const ean = String(item.product_barcode || item.barcode || item.ean || '').trim();
    if (ean && mddEans.length > 0 && mddEans.includes(ean)) return true;
    // Niveau 2 — Nom, modèle, marque (tous les champs texte disponibles)
    const name = [
      item.product_model,
      item.product_name,
      item.product_desc,
      item.products_desc,
      item.product_brand_name,
      item.label,
      item.short_label
    ].filter(Boolean).join(' ');
    return MDD_PATTERN.test(name);
  });
}

async function processConcours(sale, authHeader, account) {
  const concours = config.concours;
  if (!concours?.enabled) return;

  const saleId   = String(sale.sale_id);
  const storeName = concours.store_name || account;
  const eventSlug = concours.event_slug || 'coupe-du-monde-2026';

  try {
    // 1. Récupérer les lignes de la vente
    const itemsRes = await fetch(
      `https://${account}.hiboutik.com/api/sale_items/${saleId}/`,
      { headers: { Authorization: authHeader, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000) }
    );
    const rawItems = itemsRes.ok ? await itemsRes.json() : [];
    const items    = Array.isArray(rawItems) ? rawItems : [];

    // 2. Détection MDD (cascade EAN → nom)
    const isMdd = detectMdd(items, concours.mdd_eans || []);
    log('INFO', `Ticket #${saleId} - MDD: ${isMdd} (${items.length} produits)`);

    // 3. Envoyer webhook vers API LMDV (déduplication Supabase)
    const webhookUrl    = concours.lmdv_webhook_url;
    const webhookSecret = concours.lmdv_webhook_secret;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': webhookSecret || ''
        },
        body: JSON.stringify({
          ticket_id:  saleId,
          store_name: storeName,
          event_slug: eventSlug,
          is_mdd:     isMdd,
          source:     'franchise-local'
        }),
        signal: AbortSignal.timeout(10000)
      }).then(r => {
        if (!r.ok) log('WARN', `Webhook LMDV HTTP ${r.status}`);
        else        log('INFO', `Webhook LMDV OK - ticket #${saleId} enregistré`);
      }).catch(e => log('WARN', `Webhook LMDV échec: ${e.message}`));
    }

    // 4. Récupérer l'email du client
    const customerId = sale.customer_id;
    if (!customerId || !concours.brevo_key) return;

    const custRes = await fetch(
      `https://${account}.hiboutik.com/api/customer/${customerId}/`,
      { headers: { Authorization: authHeader, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000) }
    );
    if (!custRes.ok) { log('WARN', `Client ${customerId} non trouvé`); return; }
    const custRaw  = await custRes.json();
    const customer = Array.isArray(custRaw) ? custRaw[0] : custRaw;
    const email    = customer?.email;
    if (!email) { log('INFO', `Ticket #${saleId} - pas d'email client`); return; }

    // 5. Envoyer email Brevo
    const concoursUrl = concours.concours_url || 'https://lmdv-concours.vercel.app';
    const inscriptionUrl = `${concoursUrl}?ticket=${saleId}&store=${encodeURIComponent(storeName)}`;

    const emailPayload = {
      sender: { name: 'La Maison du Vapoteur', email: 'hello@lamaisonduvapoteur.fr' },
      to: [{ email }],
      subject: '⚽ Votre ticket pour la Coupe du Vapoteur 2026 !',
      htmlContent: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#1C2135;color:#fff;padding:32px;border-radius:12px">
  <h1 style="color:#FF766C;font-size:24px;margin-bottom:8px">⚽ La Coupe du Vapoteur 2026</h1>
  <p style="color:rgba(255,255,255,0.8);margin-bottom:24px">Merci pour votre achat chez <strong>${storeName}</strong> !</p>
  <div style="background:rgba(255,255,255,0.08);border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">
    <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:4px">Votre numéro de ticket</div>
    <div style="font-size:32px;font-weight:bold;color:#fff;letter-spacing:0.1em">#${saleId}</div>
    ${isMdd ? `<div style="margin-top:12px;background:rgba(255,118,108,0.2);border:1px solid #FF766C;border-radius:6px;padding:8px;font-size:13px;color:#FF766C">⭐ Produit LMDV détecté — vous obtenez <strong>2 participations</strong> !</div>` : ''}
  </div>
  <a href="${inscriptionUrl}" style="display:block;background:#FF766C;color:#fff;text-align:center;padding:16px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;margin-bottom:20px">
    🎯 M'inscrire au concours
  </a>
  <p style="font-size:12px;color:rgba(255,255,255,0.4);text-align:center">
    Votre ticket : #${saleId} — Boutique : ${storeName}<br>
    Conservez ce numéro pour vous inscrire avant le 19 juillet 2026.
  </p>
</div>`
    };

    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': concours.brevo_key, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
      signal: AbortSignal.timeout(10000)
    }).then(r => {
      if (!r.ok) log('WARN', `Brevo HTTP ${r.status}`);
      else        log('INFO', `Email envoyé à ${email} - ticket #${saleId}`);
    }).catch(e => log('WARN', `Brevo échec: ${e.message}`));

  } catch (err) {
    log('WARN', `processConcours erreur: ${err.message}`);
  }
}
