// =============================================================================
// TRUST LAYER — src/middleware/auth.js
// Middleware d'authentification JWT.
//
// Vérifie le token JWT dans le header Authorization.
// Si valide, hydrate req.user avec les données de l'utilisateur depuis MySQL.
// Si invalide ou expiré, répond 401.
//
// CORRECTIONS apportées :
//   — Vérification si le compte est banni (is_banned)
//   — Log de sécurité sans email en clair (masqué)
//   — Support optionnel de la révocation de tokens
// =============================================================================

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db/database');
const logger = require('../utils/logger');

/**
 * Masque un email pour les logs : "jean.dupont@gmail.com" → "j***@g***.com"
 * On ne log jamais d'email en clair — problème de confidentialité.
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '[inconnu]';
  const [local, domain] = email.split('@');
  if (!domain) return `${email[0]}***`;
  const [domainName, ...tld] = domain.split('.');
  return `${local[0]}***@${domainName[0]}***.${tld.join('.')}`;
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.slice(7);

  try {
    // Vérifie la signature et l'expiration du token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Vérification optionnelle : token révoqué (déconnexion forcée, ban)
    // Utilise un hash SHA-256 du token — on ne stocke jamais le token lui-même
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const revoked   = await db.isTokenRevoked(tokenHash);
    if (revoked) {
      return res.status(401).json({ error: 'Session expirée. Reconnecte-toi.' });
    }

    // Charge l'utilisateur depuis MySQL (données fraîches, pas seulement le payload JWT)
    const user = await db.findUserById(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    // Vérifie si le compte est banni
    if (user.is_banned) {
      logger.security('Tentative de connexion avec compte banni', {
        userId: user.id,
        ip: req.ip,
      });
      return res.status(403).json({ error: 'Compte suspendu.' });
    }

    req.user = user;
    next();

  } catch (err) {
    // Ne log pas l'email en clair — uniquement l'IP et le type d'erreur
    logger.security('Token invalide', {
      ip:    req.ip,
      error: err.name, // 'JsonWebTokenError', 'TokenExpiredError', etc.
    });
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { authenticate, maskEmail };