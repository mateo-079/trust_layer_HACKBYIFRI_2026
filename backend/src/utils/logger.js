// =============================================================================
// TRUST LAYER — src/utils/logger.js
//
// CORRECTION : remplacement du logger maison (fs.appendFileSync bloquant)
// par winston — la lib déjà présente dans package.json mais jamais utilisée.
//
// POURQUOI c'est important :
//   — fs.appendFileSync() bloque le thread Node.js à chaque log
//   — winston écrit de façon asynchrone via des streams → pas de blocage
//   — winston gère automatiquement la rotation de fichiers (avec winston-daily-rotate-file)
//   — Format JSON en production, format coloré en développement
// =============================================================================

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');

const LOG_DIR = path.join(__dirname, '../../logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const isDev = process.env.NODE_ENV !== 'production';

// ── Format développement : lisible en console ─────────────────────────────────
const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// ── Format production : JSON structuré pour les outils d'analyse ──────────────
const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  format: isDev ? devFormat : prodFormat,
  transports: [
    // Console — toujours active
    new transports.Console(),

    // Fichier app.log — tous les logs INFO et plus
    new transports.File({
      filename: path.join(LOG_DIR, 'app.log'),
      level: 'info',
      maxsize:  5 * 1024 * 1024, // 5 MB max par fichier
      maxFiles: 5,               // garde les 5 derniers fichiers
    }),

    // Fichier error.log — uniquement les erreurs
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize:  5 * 1024 * 1024,
      maxFiles: 3,
    }),

    // Fichier security.log — logs de sécurité (niveau warn)
    new transports.File({
      filename: path.join(LOG_DIR, 'security.log'),
      level: 'warn',
      maxsize:  5 * 1024 * 1024,
      maxFiles: 10, // on garde plus longtemps les logs de sécurité
    }),
  ],
});

// ── Méthode security : raccourci pour les événements de sécurité ──────────────
// Utilise le niveau 'warn' pour aller dans security.log
// et préfixe le message pour faciliter le filtrage.
logger.security = function(message, meta = {}) {
  this.warn(`[SECURITY] ${message}`, meta);
};

module.exports = logger;