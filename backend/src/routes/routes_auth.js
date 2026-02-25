// =============================================================================
// TRUST LAYER — src/routes/auth.js
// Routes d'inscription et de connexion.
//
// CORRECTIONS apportées :
//   — validators.js maintenant branché (registerRules, loginRules, validate)
//   — Email masqué dans les logs de sécurité (plus d'email en clair dans security.log)
//   — db.* sont maintenant async (MySQL) — await partout
//   — Le payload JWT retourne uniquement l'userId (pas l'email, pas d'autres données)
// =============================================================================

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db/database');
const logger   = require('../utils/logger');
const { maskEmail } = require('../middleware/auth_middleware');
const { authLimiter }                              = require('../middleware/rateLimiter');
const { registerRules, loginRules, validate }      = require('../middleware/validators');

const router = express.Router();


// ── POST /api/register ────────────────────────────────────────────────────────
// Crée un nouveau compte utilisateur.
//
// Pipeline :
//   authLimiter      → max 10 tentatives / 15 min par IP
//   registerRules    → validation express-validator (username, email, password, etc.)
//   validate         → si erreur → 422 avec détail des champs invalides
//   handler          → logique métier
router.post('/register', authLimiter, registerRules, validate, async (req, res) => {
  const { username, email, password, avatar, firstName, lastName, emergencyName, emergencyPhone } = req.body;

  try {
    // Vérifie si l'email ou le pseudo est déjà utilisé
    const existing = await db.findUserByEmailOrUsername(email, username);
    if (existing) {
      return res.status(409).json({ error: 'Email ou pseudo déjà utilisé' });
    }

    // Hachage du mot de passe — bcryptjs, coût = 12 (configurable via .env)
    const rounds        = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const password_hash = await bcrypt.hash(password, rounds);

    // Création de l'utilisateur en base
    const user = await db.createUser({
      username, email, password_hash,
      avatar:         avatar         || '🌟',
      firstName:      firstName      || null,
      lastName:       lastName       || null,
      emergencyName:  emergencyName  || null,
      emergencyPhone: emergencyPhone || null,
    });

    // Génération du JWT — payload minimal (userId seulement)
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info('Nouvel utilisateur créé', { userId: user.id });

    return res.status(201).json({
      token,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
        avatar:   user.avatar,
        is_admin: user.is_admin || 0,
      },
    });

  } catch (err) {
    logger.error('Erreur lors de l\'inscription', { error: err.message });
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// ── POST /api/login ───────────────────────────────────────────────────────────
// Authentifie un utilisateur existant.
//
// SÉCURITÉ — Protection contre le timing attack :
//   Si l'email n'existe pas, on fait quand même bcrypt.compare() avec un hash
//   fictif. Ça prend le même temps qu'une vraie comparaison → l'attaquant ne
//   peut pas savoir si l'email existe en mesurant le temps de réponse.
router.post('/login', authLimiter, loginRules, validate, async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await db.findUserByEmail(email);

    // Hash fictif utilisé si l'utilisateur n'existe pas — anti timing attack
    const DUMMY_HASH = '$2b$12$invalidhashfortimingattackprevention000000000000000000';
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !match) {
      // CORRECTION : email masqué dans le log (plus d'email en clair dans security.log)
      logger.security('Échec de connexion', {
        email: maskEmail(email), // "j***@g***.com" au lieu de "jean@gmail.com"
        ip:    req.ip,
      });
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Vérifie si le compte est banni
    if (user.is_banned) {
      logger.security('Connexion refusée — compte banni', { userId: user.id, ip: req.ip });
      return res.status(403).json({ error: 'Compte suspendu.' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info('Connexion réussie', { userId: user.id });

    return res.json({
      token,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
        avatar:   user.avatar,
        is_admin: user.is_admin || 0,
      },
    });

  } catch (err) {
    logger.error('Erreur lors de la connexion', { error: err.message });
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;