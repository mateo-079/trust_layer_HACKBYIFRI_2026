const rateLimit = require('express-rate-limit');
const logger    = require('../utils/logger');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives. Réessaie dans 15 minutes.' },
  handler(req, res, next, options) {
    logger.security('Rate limit auth dépassé', { ip: req.ip });
    res.status(429).json(options.message);
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes.' }
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Trop de messages. Attends une minute.' },
  handler(req, res, next, options) {
    logger.security('Rate limit messages dépassé', { ip: req.ip });
    res.status(429).json(options.message);
  }
});

module.exports = { authLimiter, apiLimiter, messageLimiter };