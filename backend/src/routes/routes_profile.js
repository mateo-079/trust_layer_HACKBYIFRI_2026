// =============================================================================
// TRUST LAYER — src/routes/profile.js
//
// CORRECTIONS apportées :
//   — db.findUserById() est maintenant async (MySQL) — await ajouté
//   — Montage cohérent : la route est /profile/:id (préfixe /api dans server.js)
// =============================================================================

const express          = require('express');
const db               = require('../db/database');
const { authenticate } = require('../middleware/auth_middleware');
const { userIdParam, validate } = require('../middleware/validators');

const router = express.Router();


// ── GET /api/profile/:id ──────────────────────────────────────────────────────
// Retourne le profil public d'un utilisateur.
// Si c'est le propre profil de l'utilisateur connecté → ajoute l'email.
router.get('/profile/:id', authenticate, userIdParam, validate, async (req, res) => {
  const id   = req.params.id; // déjà converti en Int par userIdParam
  const user = await db.findUserById(id);

  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }

  // Profil public : pas d'infos sensibles
  const profile = {
    id:         user.id,
    username:   user.username,
    avatar:     user.avatar,
    created_at: user.created_at,
  };

  // Si c'est son propre profil : on ajoute l'email
  if (req.user.id === id) {
    profile.email      = user.email;
    profile.first_name = user.first_name;
    profile.last_name  = user.last_name;
  }

  res.json({ user: profile });
});

module.exports = router;