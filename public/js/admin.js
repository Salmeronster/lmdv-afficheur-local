// LMDV Admin — admin.js

(function () {
  'use strict';

  // --- Navigation par onglets ---
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.admin-section');

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;
      navItems.forEach(b => b.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`section-${target}`)?.classList.add('active');
    });
  });

  // --- Toast ---
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // --- API helpers ---
  async function apiGet(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function apiPost(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function apiDelete(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // --- Statut serveur ---
  async function refreshStatus() {
    try {
      const s = await apiGet('/api/status');
      document.getElementById('polling-dot').classList.toggle('active', s.polling);
      document.getElementById('clients-count').textContent = s.connectedClients || 0;
    } catch (_) {}
  }
  setInterval(refreshStatus, 3000);
  refreshStatus();

  // --- Boutons "Simuler une vente" globaux ---
  async function sendPreview() {
    try {
      await apiPost('/api/preview', {});
      toast('Simulation envoyee aux tablettes');
    } catch (e) {
      toast(`Erreur: ${e.message}`, 'error');
    }
  }

  document.getElementById('btn-preview-sidebar')?.addEventListener('click', sendPreview);
  document.getElementById('btn-preview-medias')?.addEventListener('click', sendPreview);
  document.getElementById('btn-preview-vente')?.addEventListener('click', sendPreview);
  document.getElementById('btn-preview-apercu')?.addEventListener('click', sendPreview);

  // ============================================================
  // SECTION MEDIAS
  // ============================================================

  let mediaOrder = [];
  let currentMediaType = 'slideshow';

  // Toggle slideshow / video
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMediaType = btn.dataset.type;
      document.getElementById('mode-slideshow').classList.toggle('hidden', currentMediaType !== 'slideshow');
      document.getElementById('mode-video').classList.toggle('hidden', currentMediaType !== 'video');
    });
  });

  // Slider durée slide
  const slideDur = document.getElementById('slide-duration');
  const slideDurVal = document.getElementById('slide-duration-val');
  slideDur?.addEventListener('input', () => { slideDurVal.textContent = `${slideDur.value}s`; });

  // Charger la grille de médias
  async function loadMediaGrid() {
    const files = await apiGet('/api/media');
    const cfg = await apiGet('/api/config');
    const orderedItems = cfg.media?.items || [];

    // Récupérer les fichiers images (sans vidéos)
    const imageFiles = files.filter(f => ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(f.ext));

    // Respecter l'ordre config si présent
    mediaOrder = orderedItems.length
      ? orderedItems.map(name => imageFiles.find(f => f.filename === name)).filter(Boolean)
      : imageFiles;

    // Ajouter les fichiers non encore dans l'ordre
    imageFiles.forEach(f => {
      if (!mediaOrder.find(m => m.filename === f.filename)) mediaOrder.push(f);
    });

    renderMediaGrid();

    // Appliquer config
    if (cfg.media?.slide_duration_seconds) {
      slideDur.value = cfg.media.slide_duration_seconds;
      slideDurVal.textContent = `${cfg.media.slide_duration_seconds}s`;
    }

    if (cfg.media?.type === 'video') {
      document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === 'video');
      });
      document.getElementById('mode-slideshow').classList.add('hidden');
      document.getElementById('mode-video').classList.remove('hidden');
      currentMediaType = 'video';
      if (cfg.media.video_path) {
        const vid = document.getElementById('video-preview');
        vid.src = cfg.media.video_path;
        vid.classList.remove('hidden');
      }
    }
  }

  function renderMediaGrid() {
    const grid = document.getElementById('media-grid');
    grid.innerHTML = '';
    mediaOrder.forEach((file, i) => {
      const item = document.createElement('div');
      item.className = 'media-item';
      item.draggable = true;
      item.dataset.filename = file.filename;
      item.innerHTML = `
        <img src="${file.url}" alt="${file.filename}" loading="lazy">
        <span class="media-item-order">${i + 1}</span>
        <button class="media-item-delete" title="Supprimer">×</button>
      `;

      item.querySelector('.media-item-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await apiDelete(`/api/media/${file.filename}`);
          mediaOrder = mediaOrder.filter(f => f.filename !== file.filename);
          renderMediaGrid();
          toast('Media supprime');
        } catch (e) {
          toast(`Erreur: ${e.message}`, 'error');
        }
      });

      // Drag & drop réordonnancement
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', file.filename);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', (e) => { e.preventDefault(); });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const srcName = e.dataTransfer.getData('text/plain');
        const srcIdx = mediaOrder.findIndex(f => f.filename === srcName);
        const tgtIdx = mediaOrder.findIndex(f => f.filename === file.filename);
        if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return;
        const [moved] = mediaOrder.splice(srcIdx, 1);
        mediaOrder.splice(tgtIdx, 0, moved);
        renderMediaGrid();
      });

      grid.appendChild(item);
    });
  }

  // Upload images
  function setupDropZone(dropZoneId, inputId, acceptVideo = false) {
    const zone = document.getElementById(dropZoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      uploadFiles(Array.from(e.dataTransfer.files), acceptVideo);
    });
    input.addEventListener('change', () => {
      uploadFiles(Array.from(input.files), acceptVideo);
      input.value = '';
    });
  }

  async function uploadFiles(files, isVideo) {
    const bar = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-progress-fill');
    if (bar) bar.classList.add('active');

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fd = new FormData();
      fd.append('file', file);

      await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/media/upload');
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && fill) {
            fill.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText);
            if (isVideo) {
              const vid = document.getElementById('video-preview');
              vid.src = `/media/${data.filename}`;
              vid.classList.remove('hidden');
            } else {
              loadMediaGrid();
            }
            toast(`${file.name} uploade`);
          } else {
            toast(`Erreur upload: ${xhr.status}`, 'error');
          }
          resolve();
        });
        xhr.addEventListener('error', () => { toast('Erreur reseau', 'error'); resolve(); });
        xhr.send(fd);
      });
    }

    if (fill) fill.style.width = '0%';
    if (bar) bar.classList.remove('active');
  }

  setupDropZone('drop-zone-images', 'file-input-images', false);
  setupDropZone('drop-zone-video', 'file-input-video', true);

  // Enregistrer médias
  document.getElementById('btn-save-medias')?.addEventListener('click', async () => {
    try {
      const patch = {
        media: {
          type: currentMediaType,
          items: mediaOrder.map(f => f.filename),
          slide_duration_seconds: parseInt(slideDur?.value || '6'),
          video_path: currentMediaType === 'video'
            ? (document.getElementById('video-preview')?.src?.split('/media/')[1] ? `/media/${document.getElementById('video-preview').src.split('/media/')[1]}` : '')
            : ''
        }
      };
      await apiPost('/api/config', patch);
      toast('Configuration médias enregistree');
    } catch (e) {
      toast(`Erreur: ${e.message}`, 'error');
    }
  });

  loadMediaGrid();

  // ============================================================
  // SECTION VENTE
  // ============================================================

  const saleDur = document.getElementById('sale-duration');
  const saleDurVal = document.getElementById('sale-duration-val');
  saleDur?.addEventListener('input', () => { saleDurVal.textContent = `${saleDur.value}s`; });

  document.getElementById('btn-save-vente')?.addEventListener('click', async () => {
    try {
      const patch = {
        display: {
          sale_duration_seconds: parseInt(saleDur?.value || '45'),
          concours_url: document.getElementById('concours-url')?.value || '',
          show_concours_block: document.getElementById('toggle-concours')?.checked || false
        }
      };
      await apiPost('/api/config', patch);
      toast('Configuration vente enregistree');
    } catch (e) {
      toast(`Erreur: ${e.message}`, 'error');
    }
  });

  // ============================================================
  // SECTION BOUTIQUE
  // ============================================================

  // Afficher/masquer API key
  document.getElementById('btn-toggle-apikey')?.addEventListener('click', () => {
    const inp = document.getElementById('hib-apikey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Tester connexion Hiboutik
  document.getElementById('btn-test-hiboutik')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('test-result');
    const account = document.getElementById('hib-account')?.value?.trim();
    const email = document.getElementById('hib-email')?.value?.trim();
    const apiKey = document.getElementById('hib-apikey')?.value?.trim();
    const storeId = document.getElementById('hib-storeid')?.value?.trim();

    if (!account || !email || !apiKey || !storeId) {
      resultEl.textContent = 'Remplissez tous les champs avant de tester.';
      resultEl.className = 'test-result error';
      resultEl.classList.remove('hidden');
      return;
    }

    resultEl.textContent = 'Test en cours...';
    resultEl.className = 'test-result';
    resultEl.classList.remove('hidden');

    try {
      const auth = btoa(`${email}:${apiKey}`);
      const url = `https://${account}.hiboutik.com/api/sales/?store_id=${storeId}`;
      const r = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        resultEl.textContent = 'Connexion reussie ! Hiboutik repond correctement.';
        resultEl.className = 'test-result ok';
      } else {
        resultEl.textContent = `Echec HTTP ${r.status} — verifiez vos identifiants.`;
        resultEl.className = 'test-result error';
      }
    } catch (e) {
      resultEl.textContent = `Impossible de contacter Hiboutik: ${e.message}`;
      resultEl.className = 'test-result error';
    }
  });

  document.getElementById('btn-save-boutique')?.addEventListener('click', async () => {
    const apiKey = document.getElementById('hib-apikey')?.value?.trim();
    const patch = {
      hiboutik: {
        account: document.getElementById('hib-account')?.value?.trim() || '',
        email: document.getElementById('hib-email')?.value?.trim() || '',
        store_id: parseInt(document.getElementById('hib-storeid')?.value || '1'),
        ...(apiKey ? { api_key: apiKey } : {})
      },
      server: {
        port: parseInt(document.getElementById('server-port')?.value || '3000')
      }
    };
    try {
      await apiPost('/api/config', patch);
      toast('Configuration boutique enregistree - redemarrez le serveur si le port a change');
    } catch (e) {
      toast(`Erreur: ${e.message}`, 'error');
    }
  });

  // ============================================================
  // CHARGEMENT CONFIG INITIALE
  // ============================================================

  async function loadInitialConfig() {
    try {
      const cfg = await apiGet('/api/config');

      // Boutique
      if (cfg.hiboutik) {
        const h = cfg.hiboutik;
        document.getElementById('hib-account').value = h.account || '';
        document.getElementById('hib-email').value = h.email || '';
        document.getElementById('hib-storeid').value = h.store_id || 1;
      }
      if (cfg.server) {
        document.getElementById('server-port').value = cfg.server.port || 3000;
      }

      // Vente
      if (cfg.display) {
        const d = cfg.display;
        if (saleDur && d.sale_duration_seconds) {
          saleDur.value = d.sale_duration_seconds;
          saleDurVal.textContent = `${d.sale_duration_seconds}s`;
        }
        if (d.concours_url) document.getElementById('concours-url').value = d.concours_url;
        if (document.getElementById('toggle-concours')) {
          document.getElementById('toggle-concours').checked = !!d.show_concours_block;
        }
      }
    } catch (e) {
      toast(`Chargement config echoue: ${e.message}`, 'error');
    }
  }

  loadInitialConfig();

})();
