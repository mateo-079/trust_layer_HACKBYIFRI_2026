// =============================================================================
// TRUST LAYER — src/middleware/admin_middleware.js
//
// Vérifie qu'un utilisateur est admin APRÈS le middleware authenticate.
// À utiliser en chaîne : router.get('/...', authenticate, requireAdmin, handler)
//
// req.user est déjà hydraté par authenticate — on lit juste is_admin.
// =============================================================================

const logger = require('../utils/logger');

function requireAdmin(req, res, next) {
  if (!req.user) {
    // Ne devrait pas arriver si authenticate est appelé avant
    return res.status(401).json({ error: 'Non authentifié' });
  }

  if (!req.user.is_admin) {
    logger.security('Tentative d\'accès admin non autorisé', {
      userId: req.user.id,
      username: req.user.username,
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }

  next();
}

module.exports = { requireAdmin };