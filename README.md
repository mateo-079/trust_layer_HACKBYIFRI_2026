# Trust Layer

Application web de soutien à la santé mentale destinée aux étudiants du Bénin.
Espace de discussion communautaire anonyme avec suivi d'humeur, ressources de bien-être et système de modération.

Développé par la Student Compass Team — HACKBYIFRI 2026.

---

## Table des matières

1. [Présentation du projet](#présentation-du-projet)
2. [Prérequis](#prérequis)
3. [Structure du projet](#structure-du-projet)
4. [Installation et configuration](#installation-et-configuration)
5. [Installation et configuration de MySQL](#installation-et-configuration-de-mysql)
6. [Lancer l'application](#lancer-lapplication)
7. [Utilisation](#utilisation)
8. [Variables d'environnement](#variables-denvironnement)

---

## Présentation du projet

Trust Layer permet à un étudiant de rejoindre un espace d'échange en 30 secondes sous un pseudo et un avatar anonymes. L'identité réelle n'est jamais exposée dans le chat.

Fonctionnalités principales :

- Chat communautaire en temps réel (Socket.io)
- Inscription et authentification sécurisée (JWT + bcrypt)
- Suivi quotidien d'humeur avec visualisation sur 7 ou 30 jours
- Détection automatique de mots-clés de détresse avec affichage des contacts d'urgence
- Exercice de respiration guidée et ressources de bien-être
- Signalement de messages avec panneau de modération admin
- Réactions aux messages (soutien anonyme)

---

## Prérequis

Avant de commencer, tu dois avoir installé sur ta machine :

- **Node.js** version 18 ou supérieure — https://nodejs.org
  Pour vérifier : `node --version`

- **MySQL** version 8.0 — https://dev.mysql.com/downloads/mysql/
  Pour vérifier : `mysql --version`

- **Git** — https://git-scm.com
  Pour vérifier : `git --version`

- Un éditeur de code, par exemple **VS Code** — https://code.visualstudio.com

- Une extension pour servir les fichiers frontend statiques. Recommandé : **Live Server** (extension VS Code) ou **http-server** via npm.

---

## Structure du projet

```
trust-layer/
├── backend/
│   ├── src/
│   │   ├── server.js               Point d'entrée — Express + Socket.io
│   │   ├── db/
│   │   │   └── database.js         Pool de connexions MySQL
│   │   ├── middleware/
│   │   │   ├── auth_middleware.js  Vérification JWT
│   │   │   ├── admin_middleware.js Vérification is_admin
│   │   │   ├── rateLimiter.js      Limitation des requêtes
│   │   │   └── validators.js       Validation des entrées
│   │   ├── routes/
│   │   │   ├── routes_auth.js      Inscription et connexion
│   │   │   ├── routes_messages.js  Messages, réactions, signalements
│   │   │   ├── routes_moods.js     Suivi d'humeur
│   │   │   ├── routes_profile.js   Profil utilisateur
│   │   │   └── routes_admin.js     Modération (admin uniquement)
│   │   ├── socket/
│   │   │   └── socketHandler.js    Événements WebSocket
│   │   └── utils/
│   │       └── logger.js           Winston — logs applicatifs
│   ├── schema.sql                  Script de création de la base de données
│   ├── .env                        Variables d'environnement (à créer)
│   ├── .env.example                Modèle de configuration
│   └── package.json
└── frontend/
    ├── index.html                  Page d'accueil
    ├── connexion.html              Inscription et connexion
    ├── chat.html                   Interface principale
    ├── admin.html                  Panneau de modération
    ├── politique.html              Politique de confidentialité
    ├── css/
    │   ├── landing.css
    │   ├── connexion.css
    │   └── chat.css
    └── js/
        ├── landing.js
        ├── connexion.js
        ├── chat.js
        └── security.js
```

---

## Installation et configuration

### Étape 1 — Cloner le dépôt

Ouvre un terminal et exécute :

```bash
git clone https://github.com/mateo-079/trust_layer_HACKBYIFRI_2026
cd trust_layer_HACKBYIFRI_2026
```


### Étape 2 — Installer les dépendances Node.js

```bash
cd backend
npm install
```

Cette commande lit le fichier `package.json` et installe automatiquement toutes les bibliothèques nécessaires dans un dossier `node_modules/`.

### Étape 3 — Créer le fichier de configuration

Le fichier `.env` contient les informations sensibles (mots de passe, clés secrètes). Il n'est pas versionné sur Git pour des raisons de sécurité. Tu dois le créer manuellement.

Depuis le dossier `backend/`, copie le modèle :

```bash
# Sur Windows PowerShell
Copy-Item .env.example .env

# Sur Mac / Linux
cp .env.example .env
```

Ouvre le fichier `.env` dans ton éditeur et remplis les valeurs. Voir la section [Variables d'environnement](#variables-denvironnement) pour le détail de chaque champ.

---

## Installation et configuration de MySQL

Cette section explique comment installer MySQL, créer la base de données et la configurer pour Trust Layer. Suis les étapes dans l'ordre.

### Étape 1 — Installer MySQL 8.0

Télécharge MySQL Community Server depuis le site officiel :
https://dev.mysql.com/downloads/mysql/

Durant l'installation, note bien le mot de passe que tu définis pour l'utilisateur `root`. Tu en auras besoin ensuite.

Une fois l'installation terminée, vérifie que MySQL est accessible depuis ton terminal. Sur Windows, il faut parfois ajouter MySQL au PATH manuellement.

Pour trouver où MySQL est installé sur Windows, ouvre PowerShell et tape :

```powershell
Get-ChildItem -Path C:\ -Recurse -Filter "mysql.exe" -ErrorAction SilentlyContinue | Select-Object FullName
```

Tu verras un chemin comme `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`.

Pour l'ajouter au PATH (à exécuter dans PowerShell en tant qu'administrateur) :

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\MySQL\MySQL Server 8.0\bin", "Machine")
```

Ferme et rouvre PowerShell, puis vérifie :

```bash
mysql --version
```

Tu dois voir quelque chose comme : `mysql  Ver 8.0.xx for Win64`.

### Étape 2 — Démarrer le service MySQL

Sur Windows :

```powershell
# Depuis PowerShell en administrateur
net start MySQL80
```

Sur Mac :

```bash
brew services start mysql
```

Sur Linux (Ubuntu/Debian) :

```bash
sudo systemctl start mysql
```

### Étape 3 — Se connecter à MySQL

```bash
mysql -u root -p
```

MySQL te demandera ton mot de passe root. Tape-le et appuie sur Entrée. Tu arrives dans le terminal MySQL, reconnaissable au prompt `mysql>`.

### Étape 4 — Créer la base de données et les tables

Depuis le terminal MySQL, exécute le script de création fourni avec le projet. Il crée la base `trustlayer` et ses 7 tables avec toutes les contraintes.

```sql
SOURCE /chemin/vers/trust-layer/backend/schema.sql
```

Remplace `/chemin/vers/trust-layer/` par le chemin réel sur ta machine. Sur Windows, utilise des slashes `/` et non des antislashes `\`.

Exemple sur Windows :

```sql
SOURCE C:/Users/TonNom/Documents/trust-layer/backend/schema.sql
```

Tu dois voir plusieurs lignes `Query OK` défiler. À la fin, une requête de vérification s'exécute et affiche les 7 tables créées : `messages`, `moods`, `reactions`, `reports`, `revoked_tokens`, `salons`, `users`.

### Étape 5 — Créer un utilisateur MySQL dédié (recommandé)

Il est déconseillé d'utiliser le compte `root` pour ton application. Crée un utilisateur avec des permissions limitées :

```sql
CREATE USER 'trustlayer_user'@'localhost' IDENTIFIED BY 'ChoisisUnMotDePasseIci';
GRANT SELECT, INSERT, UPDATE, DELETE ON trustlayer.* TO 'trustlayer_user'@'localhost';
FLUSH PRIVILEGES;
```

Retiens le nom d'utilisateur et le mot de passe que tu viens de choisir.

### Étape 6 — Vérifier que tout fonctionne

Toujours dans le terminal MySQL, vérifie que les tables ont bien été créées :

```sql
USE trustlayer;
SHOW TABLES;
```

Tu dois voir :

```
+----------------------+
| Tables_in_trustlayer |
+----------------------+
| messages             |
| moods                |
| reactions            |
| reports              |
| revoked_tokens       |
| salons               |
| users                |
+----------------------+
```

Quitte MySQL :

```sql
EXIT;
```

### Étape 7 — Renseigner les informations MySQL dans le fichier .env

Ouvre ton fichier `backend/.env` et remplis les variables MySQL avec les valeurs que tu viens de définir :

```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=trustlayer
DB_USER=trustlayer_user
DB_PASSWORD=ChoisisUnMotDePasseIci
```

Si tu as choisi d'utiliser `root` directement (déconseillé en production) :

```
DB_USER=root
DB_PASSWORD=TonMotDePasseRoot
```

---

## Lancer l'application

### Démarrer le backend

Depuis le dossier `backend/` :

```bash
# Mode développement (redémarrage automatique à chaque modification)
npm run dev

# Mode production
npm start
```

Le backend démarre sur le port 3000. Tu dois voir dans le terminal :

```
info: Serveur démarré {"port":3000,"env":"development"}
info: Connexion MySQL établie {"host":"localhost","database":"trustlayer"}
```

Si tu vois une erreur de connexion MySQL, vérifie que le service MySQL est bien démarré et que les variables dans `.env` sont correctes.

### Démarrer le frontend

Le frontend est composé de fichiers HTML statiques. Tu dois les servir depuis un serveur local, pas en ouvrant directement les fichiers dans le navigateur (les requêtes vers `localhost:3000` seraient bloquées par CORS).

Avec l'extension Live Server de VS Code :

1. Ouvre le dossier `frontend/` dans VS Code
2. Clic droit sur `index.html`
3. Clique sur "Open with Live Server"

Le frontend s'ouvre sur `http://127.0.0.1:5500`.

Avec http-server (alternative) :

```bash
npm install -g http-server
cd frontend
http-server -p 5500
```

### Accéder à l'application

- Page d'accueil : http://127.0.0.1:5500/index.html
- Connexion / Inscription : http://127.0.0.1:5500/connexion.html
- Chat : http://127.0.0.1:5500/chat.html
- Panneau admin : http://127.0.0.1:5500/admin.html (compte admin requis)

### Créer un compte administrateur

Après avoir créé un compte via l'interface, connecte-toi à MySQL et exécute :

```bash
mysql -u root -p trustlayer
```

```sql
-- Trouve ton ID
SELECT id, username FROM users;

-- Promouvois ton compte (remplace 1 par ton ID)
UPDATE users SET is_admin = 1 WHERE id = 1;

EXIT;
```

Reconnecte-toi sur l'application. Le bouton "Moderation" apparaîtra dans la sidebar du chat.

---

## Variables d'environnement

Voici le contenu complet du fichier `.env` à créer dans le dossier `backend/` :

```
# Environnement
NODE_ENV=development

# Serveur
PORT=3000

# Base de données MySQL
DB_HOST=localhost
DB_PORT=3306
DB_NAME=trustlayer
DB_USER=trustlayer_user
DB_PASSWORD=ton_mot_de_passe
DB_CONNECTION_LIMIT=10

# JWT — clé secrète pour signer les tokens d'authentification
# Génère une valeur aléatoire avec : node -e "require('crypto').randomBytes(64).toString('hex')" | Write-Output
JWT_SECRET=remplace_par_une_longue_chaine_aleatoire
JWT_EXPIRES_IN=7d

# Frontend — URL autorisée par le CORS (adresse de ton Live Server)
FRONTEND_URL=http://127.0.0.1:5500
```

Le champ `JWT_SECRET` doit être une chaîne aléatoire longue et unique. Pour en générer une depuis ton terminal :

```bash
node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(64).toString('hex'));"
```

Copie la valeur affichée et colle-la dans ton `.env`.

---

## Equipe

Student Compass Team — IFRI, Université d'Abomey-Calavi, Bénin.

HACKBYIFRI 2026 — Thème : Integration efficace du numerique dans l'apprentissage.