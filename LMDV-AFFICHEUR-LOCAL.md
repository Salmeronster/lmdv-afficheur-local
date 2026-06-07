# LMDV Afficheur Client Local — Documentation Projet

> Afficheur de caisse personnalisé, temps réel fin de vente, 100% local, zéro dépendance serveur LMDV.

---

## Vue d'ensemble

Ce projet remplace l'afficheur natif Hiboutik (`ac.hiboutik.net`) par une solution entièrement maîtrisée, s'exécutant sur le réseau local de chaque boutique franchisée. Les données ne transitent à aucun moment par les serveurs LMDV.

### Problèmes résolus vs `ac.hiboutik.net`

| Problème natif | Solution |
|---|---|
| Produits qui disparaissent pendant la vente | État persistant maintenu jusqu'à clôture |
| Design non personnalisable | 100% HTML/CSS/JS maîtrisé |
| Données transitant par Hiboutik | API locale directe |
| Impossible d'ajouter le concours LMDV | Bloc QR code concours intégré |
| Pas de contenu entre les ventes | Slideshow / vidéo configurable |

---

## Architecture technique

```
┌─────────────────────────────────────────────────────┐
│  RÉSEAU LOCAL FRANCHISÉ                             │
│                                                     │
│  ┌──────────────┐    poll 3s     ┌───────────────┐  │
│  │  API Hiboutik│◄───────────────│  server.js    │  │
│  │  (internet)  │────JSON────────│  Node.js      │  │
│  └──────────────┘                │  :3000        │  │
│                                  └───────┬───────┘  │
│                                          │ WebSocket │
│                                  ┌───────▼───────┐  │
│                                  │  Tablette     │  │
│                                  │  /display     │  │
│                                  └───────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Principe de fonctionnement

1. `server.js` interroge l'API Hiboutik toutes les **3 secondes** via `GET /sales/`
2. Il compare le `sale_id` de la dernière vente clôturée avec celui en mémoire
3. Si nouveau → diffuse l'événement à tous les clients WebSocket connectés
4. La page `/display` reçoit l'événement et met à jour l'affichage instantanément
5. Après la durée configurée, retour au mode idle (slideshow / vidéo)

---

## Stack technique

| Composant | Technologie | Rôle |
|---|---|---|
| Serveur | Node.js 18+ / Express | API proxy + WebSocket server |
| Temps réel | WebSocket natif (ws) | Push vers le display |
| Display | HTML5 / CSS3 / Vanilla JS | Interface tablette |
| Wrapper natif | Capacitor (Ionic) | App Android/iOS anti-veille |
| Alternative wrapper | Electron | App desktop Windows/Mac |
| Anti-veille browser | Screen Wake Lock API | Fallback sans wrapper natif |

---

## États de l'afficheur

```
┌─────────────┐     nouvelle vente      ┌─────────────────────┐
│             │◄────────────────────────│                     │
│   IDLE      │                         │   VENTE AFFICHÉE    │
│  slideshow  │                         │  QR ticket +        │
│  vidéo loop │                         │  QR concours        │
│             │─────────────────────────►│                     │
└─────────────┘   timer écoulé (config) └─────────────────────┘
```

### État IDLE
- Carousel d'images configurables (format paysage 16:9)
- OU vidéo en boucle (`.mp4`, `.webm`)
- Message d'accueil personnalisable
- Horloge en temps réel

### État VENTE (affiché X secondes)
- **Bloc gauche** : QR code → `myrecei.pt` (reçu numérique Hiboutik)
  - Numéro de ticket visible : `#36457 | 2026-06-2-151`
  - Détail complet de la transaction
- **Bloc droite** : QR code → `lmdv-concours.vercel.app?ticket=XXXXX`
  - Ticket pré-rempli dans l'URL
  - Message d'invitation au concours
- **Footer** : Total TTC + mode de paiement

---

## Configuration

Fichier `config.json` à la racine :

```json
{
  "hiboutik": {
    "account": "moncompte",
    "email": "gerant@franchise.fr",
    "api_key": "XXXXXXXXXXXXX",
    "store_id": 12
  },
  "display": {
    "sale_duration_seconds": 45,
    "poll_interval_ms": 3000,
    "idle_message": "Bienvenue à La Maison du Vapoteur",
    "concours_url": "https://lmdv-concours.vercel.app",
    "show_concours_block": true
  },
  "media": {
    "type": "slideshow",
    "items": [
      "./media/slide1.jpg",
      "./media/slide2.jpg",
      "./media/concours-banner.jpg"
    ],
    "slide_duration_seconds": 6,
    "video_path": "./media/lmdv-promo.mp4"
  },
  "server": {
    "port": 3000
  }
}
```

---

## Structure du projet

```
lmdv-afficheur/
├── config.json              ← configuration locale (ne pas commiter les credentials)
├── server.js                ← serveur Node.js + polling + WebSocket
├── package.json
├── package-lock.json
│
├── public/
│   ├── index.html           ← redirect vers /display
│   ├── display.html         ← page afficheur principale
│   ├── css/
│   │   └── display.css      ← styles tablette
│   ├── js/
│   │   └── display.js       ← logique client WebSocket
│   └── media/               ← images + vidéos slideshow
│       ├── slide1.jpg
│       └── lmdv-promo.mp4
│
├── capacitor/               ← wrapper Android (optionnel)
│   ├── android/
│   └── capacitor.config.ts
│
└── docs/
    └── SETUP.md
```

---

## Démarrage rapide

### Prérequis
- Node.js 18+ installé sur le PC de caisse ou un PC du réseau local
- Accès API Hiboutik de la boutique (email + clé API)

### Installation

```bash
# 1. Cloner / télécharger le projet
git clone https://github.com/lmdv-france/lmdv-afficheur-local.git
cd lmdv-afficheur-local

# 2. Installer les dépendances
npm install

# 3. Configurer
cp config.example.json config.json
# → éditer config.json avec les credentials Hiboutik

# 4. Lancer
npm start

# → Serveur disponible sur http://localhost:3000
# → Ouvrir http://localhost:3000/display sur la tablette
```

### Accès depuis la tablette

La tablette et le PC doivent être sur le **même réseau WiFi**.

```
# Trouver l'IP locale du PC (terminal macOS)
ipconfig getifaddr en0

# Sur la tablette : ouvrir Chrome
http://192.168.1.XXX:3000/display
```

---

## Wrapper Capacitor (recommandé pour production)

Capacitor permet de créer une app Android/iOS native qui :
- **Empêche la mise en veille** de la tablette (`@capacitor/keep-awake`)
- Lance l'afficheur au **démarrage automatique**
- Masque la barre de navigation (**mode kiosque**)
- Gère la **rotation écran** et le **plein écran**

### Installation Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/keep-awake
npx cap init "LMDV Afficheur" "fr.lmdv.afficheur"
npx cap add android
npx cap sync
```

### Build APK

```bash
npx cap open android
# → Android Studio s'ouvre
# → Build → Generate Signed APK
# → Installer sur la tablette via ADB ou clé USB
```

---

## Alternative sans wrapper : Screen Wake Lock API

Pour éviter la mise en veille **sans** Capacitor (solution browser uniquement) :

```javascript
// Dans display.js — empêche la veille sur navigateurs modernes
async function requestWakeLock() {
  try {
    const wakeLock = await navigator.wakeLock.request('screen');
    console.log('Wake Lock actif');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await navigator.wakeLock.request('screen');
      }
    });
  } catch (err) {
    console.warn('Wake Lock non supporté:', err);
  }
}
```

Compatibilité : Chrome 84+, Edge 84+, Samsung Internet 12+. **Non supporté sur iOS Safari.**

---

## Alternative commerciale : Fully Kiosk Browser

Pour Android, [Fully Kiosk Browser](https://www.fully-kiosk.com/) (~15€/appareil) offre :
- Mode kiosque clé en main
- Anti-veille configurable
- Démarrage automatique
- Remote management
- Compatible avec notre page `/display` sans aucune modification

---

## Sécurité

- Les credentials Hiboutik sont stockés dans `config.json` **en local uniquement**
- Aucune donnée ne transite par les serveurs LMDV
- Le serveur écoute sur `localhost` par défaut (modifier pour écouter sur le réseau local)
- Pour restreindre l'accès : ajouter un middleware d'IP whitelist dans `server.js`

---

## Évolutions prévues

- [ ] Interface d'administration web pour modifier `config.json` sans éditer le fichier
- [ ] Support `sale_item` (affichage produit par produit) via Cloudflare Tunnel
- [ ] Thèmes visuels multiples (Standard LMDV, Concours, Noël, etc.)
- [ ] Statistiques journalières en mode idle (nb ventes, CA)
- [ ] Multi-écrans (plusieurs tablettes sur le même serveur)
- [ ] Mode `unique_sale_id` pour afficher le format `2026-06-2-151` plutôt que `36457`

---

## Endpoints serveur

| Route | Description |
|---|---|
| `GET /` | Redirect vers `/display` |
| `GET /display` | Page afficheur principale |
| `GET /admin` | Interface de configuration (future) |
| `WS /ws` | WebSocket pour les événements temps réel |
| `GET /api/status` | Statut serveur + dernière vente |
| `GET /api/config` | Configuration actuelle (sans credentials) |

---

## Dépendances npm

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "node-fetch": "^3.3.2",
    "chokidar": "^3.5.3"
  },
  "devDependencies": {
    "@capacitor/cli": "^5.0.0"
  }
}
```

---

## Changelog

| Version | Date | Description |
|---|---|---|
| 1.0.0 | 2026-06 | Version initiale — polling + WebSocket + display fin de vente |

---

*Projet LMDV France — Usage interne franchisés uniquement*
