# MEMORY.md — LMDV Afficheur Local
*Créé : 07 juin 2026 — v1.0.0 livrée par Claude Code*

---

## 📦 Infos projet

- **Repo** : https://github.com/Salmeronster/lmdv-afficheur-local (privé)
- **Release** : v1.0.0 — https://github.com/Salmeronster/lmdv-afficheur-local/releases/tag/v1.0.0
- **Stack** : Node.js 18+ · Express · ws · multer · chokidar · Vanilla JS
- **Contexte** : outil interne LMDV pour franchisés, potentiel commercial externe

---

## 🏗️ Architecture

```
PC local boutique
  └─ server.js :3000
      ├─ Poll API Hiboutik toutes les 3s
      ├─ Détecte nouveau sale_id → WebSocket broadcast
      ├─ Sert /display (tablette) et /admin (PC gérant)
      └─ Hot reload config.json via chokidar
```

**Aucun webhook, aucun tunnel, aucune donnée sortante.**

---

## 📁 Structure livrée

```
lmdv-afficheur-local/
├── server.js                  ← serveur complet
├── config.example.json        ← template config
├── config.json                ← config locale (gitignored)
├── start.bat                  ← raccourci Windows
├── package.json
├── README.md
├── installer/
│   └── index.html             ← générateur .ps1 personnalisé
└── public/
    ├── display.html/css/js    ← tablette afficheur
    └── admin.html/css/js      ← interface admin PC
```

---

## ✅ Tests passés (Claude Code)

- `/display` → 200 ✅
- `/admin` → 200 ✅
- `/api/status` → JSON valide ✅
- `api_key` masquée dans `/api/config` ✅
- Création auto `config.json` si absent ✅
- Port déjà utilisé → message d'erreur clair ✅

---

## 🎁 Bonus installeur Windows

`installer/index.html` — page web locale qui :
1. Demande les credentials Hiboutik + paramètres
2. Génère un fichier `install-lmdv.ps1` personnalisé
3. Le franchisé exécute le .ps1 → télécharge le ZIP depuis la release GitHub, installe Node.js si absent, configure `config.json`, crée un raccourci démarrage

**Pour que le .ps1 fonctionne** → la release GitHub doit être publique OU le franchisé doit avoir accès au repo.

---

## 📋 Prochaines actions

- [ ] Passer le repo en **public** si commercialisation externe, ou garder privé pour LMDV uniquement
- [ ] Tester l'installeur .ps1 sur un vrai PC Windows franchisé
- [ ] Ajouter le module email automation (Simple tier)
- [ ] Wrapper Capacitor Android (v1.1)
- [ ] Décider quels franchisés reçoivent version Simple vs Premium

---

## 💡 Potentiel commercial

- ~20 000 comptes Hiboutik en France/Europe
- Tous ont accès à `ac.hiboutik.net` avec ses limitations connues
- Notre solution résout : items qui disparaissent, design non maîtrisé, zéro contenu entre ventes
- Modèle envisagé : SaaS ~15-30€/mois/boutique ou licence one-shot
