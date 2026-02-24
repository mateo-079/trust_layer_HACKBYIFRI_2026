// =============================================================================
// TRUST LAYER — src/routes/moods.js
//
// CORRECTIONS apportées :
//   — validators.js maintenant branché (moodRules, userIdParam, validate)
//   — db.* sont async (MySQL) — await partout
//   — Vérification d'autorisation conservée (un user ne voit que ses humeurs)
// =============================================================================

const express          = require('express');
const db               = require('../db/database');
const logger           = require('../utils/logger');
const { authenticate } = require('../middleware/auth_middleware');
const { moodRules, userIdParam, validate } = require('../middleware/validators');

const router = express.Router();


// ── GET /api/moods/:id ────────────────────────────────────────────────────────
// Récupère les 30 dernières humeurs d'un utilisateur.
// Un utilisateur ne peut voir QUE ses propres humeurs (vérification req.user.id === id).
router.get('/:id', authenticate, userIdParam, validate, async (req, res) => {
  // userIdParam valide et convertit req.params.id en Int via .toInt()
  const id = req.params.id;

  // Autorisation : impossible de lire les humeurs d'un autre utilisateur
  if (req.user.id !== id) {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  try {
    const moods = await db.getMoods(id);
    res.json({ moods });
  } catch (err) {
    logger.error('Erreur chargement humeurs', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// ── POST /api/moods ───────────────────────────────────────────────────────────
// Enregistre une note d'humeur pour l'utilisateur connecté.
//
// Pipeline :
//   authenticate  → vérifie le JWT
//   moodRules     → valide que score est un Int entre 1 et 10, note <= 500 chars
//   validate      → retourne 422 si invalide
//   handler       → insère en base
//
// IMPORTANT : on utilise req.user.id (du JWT vérifié), PAS user_id du body.
// Ça empêche un utilisateur d'enregistrer une humeur au nom d'un autre.
router.post('/', authenticate, moodRules, validate, async (req, res) => {
  // req.body.score est déjà converti en Int par le validator (.toInt())
  const { score, note } = req.body;

  try {
    const mood = await db.createMood(req.user.id, score, note || null);
    logger.info('Humeur enregistrée', { userId: req.user.id, score });
    res.status(201).json({ mood });
  } catch (err) {
    logger.error('Erreur enregistrement humeur', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;