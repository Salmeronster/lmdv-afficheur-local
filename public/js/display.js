// LMDV Afficheur — display.js

(function () {
  'use strict';

  // --- Config injectée par le serveur via WS ---
  let appConfig = null;

  // --- Éléments DOM ---
  const body = document.body;
  const clockEl = document.getElementById('clock');
  const wsIndicator = document.getElementById('ws-status');
  const idleMessage = document.getElementById('idle-message');
  const carousel = document.getElementById('carousel');
  const idleVideo = document.getElementById('idle-video');
  const saleIdEl = document.getElementById('sale-id');
  const saleUniqueIdEl = document.getElementById('sale-unique-id');
  const saleTotal = document.getElementById('sale-total');
  const salePayment = document.getElementById('sale-payment');
  const qrTicket = document.getElementById('qr-ticket');
  const qrConcours = document.getElementById('qr-concours');
  const colConcours = document.getElementById('col-concours');
  const timerProgress = document.getElementById('timer-progress');

  // --- Horloge ---
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${h}:${m}:${s}`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // --- Carousel ---
  let carouselSlides = [];
  let carouselIndex = 0;
  let carouselTimer = null;

  function buildCarousel(items) {
    carousel.innerHTML = '';
    carouselSlides = [];
    if (!items || !items.length) {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide active';
      slide.style.background = 'var(--dark)';
      carousel.appendChild(slide);
      return;
    }
    items.forEach((src, i) => {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide' + (i === 0 ? ' active' : '');
      slide.style.backgroundImage = `url('${src}')`;
      carousel.appendChild(slide);
      carouselSlides.push(slide);
    });
  }

  function advanceCarousel() {
    if (!carouselSlides.length) return;
    carouselSlides[carouselIndex].classList.remove('active');
    carouselIndex = (carouselIndex + 1) % carouselSlides.length;
    carouselSlides[carouselIndex].classList.add('active');
  }

  function startCarousel(durationSec) {
    if (carouselTimer) clearInterval(carouselTimer);
    if (carouselSlides.length <= 1) return;
    carouselTimer = setInterval(advanceCarousel, (durationSec || 6) * 1000);
  }

  // --- Appliquer la config ---
  function applyConfig(cfg) {
    if (!cfg) return;
    appConfig = cfg;

    if (cfg.display?.idle_message) {
      idleMessage.textContent = cfg.display.idle_message;
    }

    const media = cfg.media || {};

    if (media.type === 'video' && media.video_path) {
      idleVideo.src = media.video_path;
      idleVideo.classList.add('visible');
      carousel.style.display = 'none';
      if (carouselTimer) clearInterval(carouselTimer);
    } else {
      idleVideo.classList.remove('visible');
      idleVideo.src = '';
      carousel.style.display = '';
      const items = (media.items || []).map(f => `/media/${f}`);
      buildCarousel(items);
      startCarousel(media.slide_duration_seconds || 6);
    }
  }

  // --- QR code ---
  function makeQrUrl(data) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data)}`;
  }

  // --- État vente ---
  let saleTimeout = null;

  function showSale(sale) {
    const cfg = appConfig || {};
    const duration = (cfg.display?.sale_duration_seconds || 45) * 1000;

    // Remplir les données
    saleIdEl.textContent = `#${sale.sale_id}`;

    if (sale.unique_sale_id) {
      saleUniqueIdEl.textContent = sale.unique_sale_id;
      saleUniqueIdEl.style.display = '';
    } else {
      saleUniqueIdEl.style.display = 'none';
    }

    // QR ticket (myrecei.pt ou construit depuis sale_id)
    const receiptUrl = sale.qr_code
      ? sale.qr_code
      : `https://myrecei.pt/${sale.sale_id}`;
    qrTicket.src = makeQrUrl(receiptUrl);

    // Total + paiement
    const total = sale.total_ttc || sale.total || '0.00';
    saleTotal.textContent = parseFloat(total).toLocaleString('fr-FR', {
      style: 'currency', currency: 'EUR'
    });
    salePayment.textContent = formatPayment(sale.payment_type || sale.payment || 'CB');

    // Concours
    if (cfg.display?.show_concours_block && cfg.display?.concours_url) {
      const concoursUrl = `${cfg.display.concours_url}?ticket=${sale.sale_id}`;
      qrConcours.src = makeQrUrl(concoursUrl);
      colConcours.classList.add('visible');
    } else {
      colConcours.classList.remove('visible');
    }

    // Barre timer
    timerProgress.style.transition = 'none';
    timerProgress.style.width = '100%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        timerProgress.style.transition = `width ${duration}ms linear`;
        timerProgress.style.width = '0%';
      });
    });

    // Transition vers état vente
    body.classList.add('state-sale');

    if (saleTimeout) clearTimeout(saleTimeout);
    saleTimeout = setTimeout(showIdle, duration);
  }

  function showIdle() {
    body.classList.remove('state-sale');
    if (saleTimeout) { clearTimeout(saleTimeout); saleTimeout = null; }
  }

  function formatPayment(type) {
    const map = {
      'CB': 'Carte bancaire', 'CARD': 'Carte bancaire',
      'CASH': 'Especes', 'ESP': 'Especes',
      'CHQ': 'Cheque', 'CHECK': 'Cheque',
      'PAYPAL': 'PayPal', 'TICKET': 'Ticket restaurant'
    };
    return map[String(type).toUpperCase()] || type;
  }

  // --- Mode preview URL ?preview=true ---
  function checkPreviewMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('preview') === 'true') {
      setTimeout(() => {
        showSale({
          sale_id: 99999,
          unique_sale_id: '2026-06-07-99999',
          total_ttc: '29.90',
          payment_type: 'CB',
          qr_code: null
        });
      }, 1200);
    }
  }

  // --- Wake Lock ---
  let wakeLock = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (_) { /* non supporté ou refusé */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  requestWakeLock();

  // --- WebSocket ---
  let ws = null;
  let wsRetryTimer = null;

  function connectWs() {
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      wsIndicator.classList.add('connected');
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      if (msg.type === 'config') {
        applyConfig(msg.config);
      } else if (msg.type === 'sale_closed') {
        showSale(msg.sale);
      } else if (msg.type === 'config_reload') {
        // Le serveur a rechargé la config — se reconnecter pour obtenir la nouvelle
        ws.close();
      }
    });

    ws.addEventListener('close', () => {
      wsIndicator.classList.remove('connected');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      wsIndicator.classList.remove('connected');
    });
  }

  function scheduleReconnect() {
    if (wsRetryTimer) return;
    wsRetryTimer = setTimeout(connectWs, 3000);
  }

  // --- Init ---
  // Config par défaut avant que le WS réponde
  applyConfig({
    display: {
      idle_message: 'Bienvenue a La Maison du Vapoteur',
      sale_duration_seconds: 45,
      show_concours_block: false
    },
    media: { type: 'slideshow', items: [], slide_duration_seconds: 6 }
  });

  connectWs();
  checkPreviewMode();

})();
