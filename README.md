# 🛡️ Trust Layer — Guide d'installation pour collaborateurs

> **À lire jusqu'au bout avant de commencer.** Ce guide suppose que tu as déjà installé MySQL et créé un utilisateur MySQL sur ton ordinateur. Si ce n'est pas fait, demande à l'équipe avant de continuer.

---

## Ce dont tu as besoin

Avant de commencer, vérifie que tu as bien installé :

- **Node.js** version 18 ou plus récente → [télécharger ici](https://nodejs.org)
- **MySQL 8** → déjà installé normalement
- **VS Code** → pour ouvrir et modifier les fichiers
- **Live Server** → extension VS Code (cherche "Live Server" dans les extensions)

Pour vérifier que Node.js est bien installé, ouvre un terminal et tape :
```bash
node -v
```
Tu dois voir quelque chose comme `v22.x.x`. Si tu vois une erreur, installe Node.js d'abord.

---

## Étape 1 — Récupérer les fichiers du projet

Récupère le dossier du projet auprès de l'équipe (par clé USB, Google Drive, ou Git). Tu dois avoir cette structure :

```
Back-Test/
├── backend/
│   ├── src/
│   ├── schema.sql
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── chat.html
    ├── connexion.html
    └── js/
```

---

## Étape 2 — Créer la base de données MySQL

Tu as déjà MySQL installé. Maintenant on va créer la base de données du projet.

**Ouvre MySQL Workbench** (l'application MySQL avec l'interface graphique).

Connecte-toi avec ton utilisateur root (ou celui que tu as créé lors de l'installation).

Une fois connecté, clique sur **File → Open SQL Script** et sélectionne le fichier `schema.sql` qui se trouve à la racine du dossier `backend/`.

Ensuite clique sur l'**éclair ⚡** (ou Ctrl+Shift+Enter) pour exécuter le script.

Tu dois voir apparaître 7 lignes vertes dans la zone "Action Output" en bas. Si c'est vert, la base de données est créée.

Maintenant crée l'utilisateur dédié au projet. Toujours dans Workbench, ouvre un nouvel onglet de requête et colle ces lignes :

```sql
CREATE DATABASE IF NOT EXISTS trustlayer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'trustlayer_user'@'localhost' IDENTIFIED BY 'TrustLayer2026!';
GRANT SELECT, INSERT, UPDATE, DELETE ON trustlayer.* TO 'trustlayer_user'@'localhost';
FLUSH PRIVILEGES;
```

Exécute avec l'éclair ⚡. Si tu vois une erreur disant que l'utilisateur existe déjà, c'est bon — passe à l'étape suivante.

---

## Étape 3 — Configurer le fichier `.env`

Le fichier `.env` contient les informations de connexion à ta base de données. Il n'est **pas partagé** par mesure de sécurité — tu dois le créer toi-même.

Dans le dossier `backend/`, tu trouveras un fichier appelé `.env.example`. Fais-en une copie et renomme-la `.env` (sans le `.example`).

Ouvre ce fichier `.env` dans VS Code et remplis-le comme ceci :

```dotenv
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://127.0.0.1:5500

JWT_SECRET=remplace_cette_valeur_par_une_longue_chaine_aleatoire
JWT_EXPIRES_IN=7d

BCRYPT_ROUNDS=12

DB_HOST=localhost
DB_PORT=3306
DB_NAME=trustlayer
DB_USER=trustlayer_user
DB_PASSWORD=TrustLayer2026!
DB_CONNECTION_LIMIT=10
```

> ⚠️ **Important :** Pour le `JWT_SECRET`, génère une vraie valeur aléatoire. Ouvre un terminal dans le dossier `backend/` et tape :
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```
> Copie le résultat et colle-le comme valeur de `JWT_SECRET`.

---

## Étape 4 — Installer les dépendances Node.js

Ouvre un terminal dans le dossier `backend/` (dans VS Code : Terminal → Nouveau terminal, assure-toi d'être dans le bon dossier).

Tape :
```bash
npm install
```

Tu verras plein de texte défiler — c'est normal. Attends que ça se termine (1 à 2 minutes). À la fin tu verras quelque chose comme `added 312 packages`.

---

## Étape 5 — Démarrer MySQL

> ⚠️ **À faire à chaque fois que tu redémarres ton ordinateur.**

MySQL s'arrête quand tu étiens ton PC. Pour le relancer, ouvre **PowerShell en administrateur** (clic droit sur PowerShell → "Exécuter en tant qu'administrateur") et tape :

```powershell
net start MySQL80
```

Tu dois voir : `Le service MySQL80 a démarré.`

Si tu vois `Le service a déjà été démarré`, c'est bon aussi.

---

## Étape 6 — Démarrer le serveur backend

Dans le terminal VS Code (toujours dans le dossier `backend/`), tape :

```bash
npm run dev
```

Si tout fonctionne, tu dois voir exactement ces deux lignes :

```
info: Serveur démarré {"port":3000,"env":"development"}
info: Connexion MySQL établie {"host":"localhost","database":"trustlayer"}
```

Si tu vois une erreur, relis les étapes 2, 3 et 5 — 99% du temps c'est MySQL qui n'est pas démarré ou le `.env` mal configuré.

> Le serveur tourne maintenant sur `http://localhost:3000`. **Laisse ce terminal ouvert** — si tu le fermes, le serveur s'arrête.

---

## Étape 7 — Ouvrir le frontend

Dans VS Code, ouvre le dossier `frontend/`. Fais un clic droit sur le fichier `connexion.html` et clique sur **"Open with Live Server"**.

Ton navigateur va s'ouvrir automatiquement sur `http://127.0.0.1:5500/frontend/connexion.html`.

Tu peux maintenant créer un compte et tester le chat !

---

## Étape 8 — Tester que tout fonctionne

Pour confirmer que tout est bien branché :

1. Crée un compte via le formulaire d'inscription
2. Connecte-toi — tu dois arriver sur la page de chat
3. Envoie un message — il doit apparaître dans le chat
4. Ouvre un **deuxième onglet**, connecte-toi avec un autre compte
5. Envoie un message depuis l'un des onglets — il doit apparaître **instantanément** dans les deux onglets

Si le message apparaît en temps réel dans les deux onglets, **tout fonctionne parfaitement**.

---

## En cas de problème

**Le serveur ne démarre pas**
→ Vérifie que MySQL est bien démarré (étape 5)
→ Vérifie que ton `.env` est bien rempli (étape 3)
→ Vérifie que tu es bien dans le dossier `backend/` dans le terminal

**"Cannot find module" au démarrage**
→ Tu n'as pas fait `npm install` ou tu n'es pas dans le bon dossier

**La page de chat s'ouvre mais les messages ne s'envoient pas**
→ Vérifie que le serveur backend tourne (terminal avec les logs)
→ Ouvre la console du navigateur (F12 → Console) et note l'erreur

**Les messages ne s'affichent pas en temps réel**
→ Vérifie que le script Socket.io est bien dans `chat.html`
→ Ouvre F12 → Console et cherche une erreur WebSocket

**Mot de passe MySQL oublié**
→ Contacte l'équipe, ne touche pas à MySQL tout seul

---

## À retenir pour chaque session de dev

Chaque fois que tu veux travailler sur le projet :

1. Ouvre PowerShell admin → `net start MySQL80`
2. Dans VS Code, terminal dans `backend/` → `npm run dev`
3. Clic droit sur `connexion.html` → Open with Live Server
4. Travaille, teste, code
5. Quand tu as fini, `Ctrl+C` dans le terminal pour arrêter le serveur

---

*Dernière mise à jour : 23 février 2026*
