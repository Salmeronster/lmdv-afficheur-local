# LMDV Afficheur Local

Afficheur client de caisse pour les boutiques La Maison du Vapoteur.  
Remplace l'afficheur natif Hiboutik par une solution 100% locale et personnalisable.

---

## Installation recommandée (page web)

1. Ouvrez la page d'installation : **[installer/index.html](./installer/index.html)** (ou hébergée sur Vercel)
2. Renseignez vos identifiants Hiboutik
3. Testez la connexion
4. Téléchargez le script `.ps1` généré
5. Sur le PC Windows de caisse : **clic droit → Exécuter avec PowerShell**

L'installation est entièrement automatique (Node.js, dépendances, config, pare-feu, raccourci bureau).

---

## Installation manuelle

### Prérequis
- Windows 10/11 avec Node.js 18+ ([nodejs.org](https://nodejs.org))
- Connexion au réseau local de la boutique

### Étapes

```
1. Copiez ce dossier sur le PC Windows (ex: C:\LMDV\afficheur\)
2. Copiez config.example.json en config.json et remplissez vos identifiants Hiboutik
3. Ouvrez une invite de commande dans le dossier et lancez : npm install
4. Autorisez le port dans le pare-feu Windows :
   netsh advfirewall firewall add rule name="LMDV Afficheur" dir=in action=allow protocol=TCP localport=3000
5. Démarrez le serveur : node server.js  (ou double-cliquez start.bat)
```

### Trouver votre IP locale (pour la tablette)
```
ipconfig
```
Cherchez "Adresse IPv4" — ex : `192.168.1.42`

---

## Accès

| Interface | URL |
|---|---|
| Afficheur tablette | `http://[IP-DU-PC]:3000/display` |
| Administration | `http://localhost:3000/admin` |
| Statut | `http://localhost:3000/api/status` |

L'admin n'est accessible **que depuis le PC local** (sécurité).

---

## Structure

```
├── server.js           Serveur Node.js (Express + WebSocket + polling)
├── config.json         Configuration (créée au 1er démarrage)
├── start.bat           Raccourci démarrage Windows
├── public/
│   ├── display.html    Afficheur tablette
│   ├── admin.html      Interface administration
│   ├── css/            Styles
│   ├── js/             Scripts client
│   └── media/          Médias uploadés (images/vidéos)
└── installer/
    └── index.html      Assistant d'installation web
```

---

## Démarrage automatique Windows (optionnel)

Avec [pm2](https://pm2.keymetrics.io/) :
```
npm install -g pm2
pm2 start server.js --name lmdv-afficheur
pm2 startup
pm2 save
```

---

## Support

Interface admin → onglet **Boutique** → bouton **Tester la connexion** pour diagnostiquer les problèmes Hiboutik.
