# Trust Layer

Dépôt de l'équipe Student Compass Team pour le projet Trust Layer.

Trust Layer est une application web de soutien à la santé mentale destinée aux étudiant(e)s du Bénin. Elle offre un espace de discussion communautaire entièrement anonyme, accompagné d'outils de bien-être et d'accès rapide aux ressources d'urgence.

---

## Structure du projet

```
trust_layer/
├── index.html          Page d'accueil (landing page)
├── connexion.html      Inscription (3 étapes) et connexion
├── chat.html           Interface de chat principale
├── politique.html      Politiques de confidentialité et règles d'utilisation
├── css/
│   ├── landing.css
│   ├── connexion.css
│   ├── chat.css
│   └── politique.css
└── js/
    ├── security.js     Utilitaires de sécurité partagés (chargé en premier)
    ├── landing.js      Animations de la page d'accueil
    ├── connexion.js    Logique du formulaire d'inscription et de connexion
    └── chat.js         Logique du chat, bien-être et ressources
```

---

## État du frontend

Le frontend est complet et prêt à être connecté au backend. Toutes les simulations ont été retirées. Chaque appel réseau pointe vers une route API réelle — si le serveur est absent, les erreurs remontent proprement à l'interface.

**Ce qui est en place :**
- Formulaire d'inscription en 3 étapes avec validation temps réel
- Connexion email / mot de passe
- Interface de chat (chargement de messages, envoi, réactions, signalement)
- Suivi d'humeur quotidien (slider 1–10, historique)
- Panneau de ressources : respiration guidée, conseils bien-être, contacts d'urgence
- Détection de mots-clés de détresse avec affichage automatique de la bannière d'urgence
- Sécurité frontend : échappement XSS, rate limiting client, validation des entrées, token CSRF

---

## Routes API attendues

Le frontend s'attend aux routes suivantes. Le backend doit les implémenter.

| Méthode | Route                  | Description                                              |
|---------|------------------------|----------------------------------------------------------|
| POST    | `/api/register`        | Créer un compte                                          |
| POST    | `/api/login`           | Authentifier un utilisateur                              |
| GET     | `/api/profile/:id`     | Récupérer le profil d'un utilisateur                     |
| GET     | `/api/messages`        | Récupérer les messages (paramètre `?limit=50`)           |
| POST    | `/api/messages`        | Envoyer un message                                       |
| GET     | `/api/moods/:id`       | Récupérer l'historique d'humeur d'un utilisateur         |
| POST    | `/api/moods`           | Enregistrer une note d'humeur                            |

### Format des réponses attendues

**POST /api/register — POST /api/login**
```json
{
  "user": {
    "id": 1,
    "avatar": "🌟",
    "pseudo": "ÉtoileDuSoir42",
    "first_name": "Aïcha",
    "last_name": "Koffi",
    "email": "exemple@mail.com"
  }
}
```

**GET /api/messages**
```json
{
  "messages": [
    {
      "id": 1,
      "user_id": 1,
      "avatar": "🌟",
      "pseudo": "ÉtoileDuSoir42",
      "content": "Bonjour tout le monde",
      "created_at": "2026-02-19T14:32:00Z"
    }
  ]
}
```

**POST /api/messages**
```json
{
  "message": {
    "id": 2,
    "user_id": 1,
    "avatar": "🌟",
    "pseudo": "ÉtoileDuSoir42",
    "content": "Message envoyé",
    "created_at": "2026-02-19T14:35:00Z"
  }
}
```

**GET /api/moods/:id**
```json
{
  "moods": [
    { "score": 7, "date": "19 févr.", "created_at": "2026-02-19T10:00:00Z" }
  ]
}
```

En cas d'erreur, toutes les routes doivent retourner un objet `{ "error": "message lisible" }` avec le code HTTP approprié (400, 401, 404, 500…).

---

## Session utilisateur

Après connexion ou inscription réussie, le frontend stocke en `sessionStorage` :

| Clé             | Contenu                          |
|-----------------|----------------------------------|
| `tl_user_id`    | Identifiant numérique            |
| `tl_avatar`     | Emoji avatar                     |
| `tl_pseudo`     | Pseudo choisi                    |
| `tl_profile`    | Objet utilisateur complet (JSON) |

Si `tl_user_id` est absent au chargement de `chat.html`, l'utilisateur est redirigé vers `connexion.html`.

---

## Stack technique

- **Frontend :** HTML5 / CSS3 / JavaScript vanilla (ES2022+)
- **Typographie :** Fraunces (titres) + DM Sans (corps) via Google Fonts
- **Backend prévu :** Node.js + Express ou Python + FastAPI
- **Base de données prévue :** MySQL + Redis
- **Temps réel :** WebSocket (Socket.io ou natif)
- **Authentification :** JWT avec expiration

---

## Sécurité frontend en place

- Échappement HTML systématique de toutes les données affichées (protection XSS)
- Validation et sanitisation des entrées avant tout envoi à l'API
- Rate limiting côté client (10 messages / 30 secondes)
- En-têtes Content-Security-Policy déclarés sur chaque page HTML
- Aucune donnée sensible stockée en localStorage (uniquement l'historique d'humeur anonymisé)
- Token CSRF généré côté client — le backend doit le valider

**À implémenter côté backend :**
- Hachage des mots de passe (bcrypt)
- Validation serveur de toutes les entrées (ne pas se fier uniquement au frontend)
- Rate limiting serveur
- HTTPS obligatoire en production
- Logs de sécurité et détection d'abus

---

## Lancer le projet en développement

Le projet est du HTML/CSS/JS pur — aucun build requis.

```bash
# Depuis le dossier du projet
python3 -m http.server 8000
# Ouvrir : http://localhost:8000
```

Sans backend actif, les pages d'accueil et de politique sont accessibles. Les pages de connexion et de chat retourneront des erreurs réseau — c'est le comportement attendu.

---

## Équipe

Student Compass Team — Projet Trust Layer · Bénin, 2026