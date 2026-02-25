// =============================================================================
// TRUST LAYER — src/server.js
// Point d'entrée du serveur Express + Socket.io.
//
// ARCHITECTURE WebSocket :
//   — On crée d'abord un serveur HTTP Node.js natif (http.createServer)
//   — Socket.io s'attache à ce serveur HTTP (pas à Express directement)
//   — Express et Socket.io partagent le même port (3000)
//   — Les routes API restent sur /api/*, Socket.io sur /socket.io/*
// =============================================================================

require('dotenv').config();

const express              = require('express');
const { createServer }     = require('http');
const { Server }           = require('socket.io');
const helmet               = require('helmet');
const cors                 = require('cors');
const morgan               = require('morgan');
const logger               = require('./utils/logger');
const { apiLimiter }       = require('./middleware/rateLimiter');
const { initSocket }       = require('./socket/socketHandler');

const app    = express();
const server = createServer(app); // Serveur HTTP qui encapsule Express

// ── Socket.io ─────────────────────────────────────────────────────────────────
// On crée l'instance Socket.io et on la passe à initSocket() qui configure
// tous les événements WebSocket.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://127.0.0.1:5500')
  .split(',')
  .map(o => o.trim());

const io = new Server(server, {
  cors: {
    origin:      allowedOrigins,
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  // Délai avant de considérer un client déconnecté (en ms)
  pingTimeout:  60000,
  pingInterval: 25000,
});

// Initialise les événements WebSocket
initSocket(io);

// Exporte io pour que les routes puissent diffuser des messages
app.set('io', io);


// ── Middlewares Express ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS bloqué pour l'origine : ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', apiLimiter);


// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api',          require('./routes/routes_auth'));
app.use('/api',          require('./routes/routes_profile'));
app.use('/api/messages', require('./routes/routes_messages'));
app.use('/api/moods',    require('./routes/routes_moods'));
app.use('/api/admin',    require('./routes/routes_admin'));


// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status:  'ok',
  env:     process.env.NODE_ENV || 'development',
  uptime:  Math.floor(process.uptime()) + 's',
  sockets: io.engine.clientsCount,
}));


// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));


// ── Erreurs globales ──────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  logger.error('Erreur non gérée', { error: err.message, path: req.path });
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Erreur interne du serveur',
  });
});


// ── Démarrage ─────────────────────────────────────────────────────────────────
// IMPORTANT : on écoute sur `server` (HTTP) et non sur `app` (Express)
// car Socket.io a besoin du serveur HTTP pour fonctionner.
const PORT = parseInt(process.env.PORT) || 3000;

server.listen(PORT, () => {
  logger.info('Serveur démarré', {
    port: PORT,
    env:  process.env.NODE_ENV || 'development',
    cors: allowedOrigins.join(', '),
  });
});

module.exports = { app, server, io };