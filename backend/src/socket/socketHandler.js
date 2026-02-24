// =============================================================================
// TRUST LAYER — src/socket/socketHandler.js
// Gestionnaire WebSocket avec Socket.io.
//
// COMMENT ÇA MARCHE :
//   — Chaque utilisateur qui ouvre chat.html crée une connexion WebSocket
//   — Le serveur maintient la liste des connectés en mémoire (Map)
//   — Quand un message est envoyé via l'API REST, il est diffusé à tous
//     les connectés via io.emit('new_message', message)
//   — Quand un utilisateur se déconnecte, on met à jour le compteur
//
// SÉCURITÉ :
//   — Le token JWT est vérifié à la connexion (middleware Socket.io)
//   — Un utilisateur banni ne peut pas se connecter
//   — Les événements venant du client sont validés avant traitement
// =============================================================================

const jwt    = require('jsonwebtoken');
const db     = require('../db/database');
const logger = require('../utils/logger');

// Map des utilisateurs connectés : socketId → { userId, username, avatar }
// Utilisé pour compter les connectés et éviter les doublons
const connectedUsers = new Map();

function initSocket(io) {

  // ── Middleware d'authentification Socket.io ──────────────────────────────────
  // Vérifie le JWT avant d'accepter la connexion WebSocket.
  // Le token est envoyé par le frontend dans les options de connexion Socket.io.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('Token manquant — connexion refusée'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user    = await db.findUserById(decoded.userId);

      if (!user) return next(new Error('Utilisateur introuvable'));
      if (user.is_banned) return next(new Error('Compte suspendu'));

      // Attache l'utilisateur au socket pour y accéder dans les événements
      socket.user = user;
      next();

    } catch (err) {
      next(new Error('Token invalide'));
    }
  });


  // ── Connexion d'un nouvel utilisateur ────────────────────────────────────────
  io.on('connection', (socket) => {
    const user = socket.user;

    // Enregistre l'utilisateur dans la Map
    connectedUsers.set(socket.id, {
      userId:   user.id,
      username: user.username,
      avatar:   user.avatar,
    });

    logger.info('Utilisateur connecté via WebSocket', {
      userId:   user.id,
      username: user.username,
      online:   connectedUsers.size,
    });

    // Diffuse le nouveau compteur d'utilisateurs en ligne à tous
    io.emit('online_count', connectedUsers.size);

    // Envoie au nouvel arrivant le nombre actuel de connectés
    socket.emit('online_count', connectedUsers.size);


    // ── Déconnexion ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      connectedUsers.delete(socket.id);

      logger.info('Utilisateur déconnecté', {
        userId: user.id,
        reason,
        online: connectedUsers.size,
      });

      // Met à jour le compteur pour tout le monde
      io.emit('online_count', connectedUsers.size);
    });


    // ── Événement : utilisateur en train de taper ──────────────────────────────
    // Diffuse à tous SAUF l'expéditeur (broadcast)
    socket.on('typing', () => {
      socket.broadcast.emit('user_typing', {
        username: user.username,
        avatar:   user.avatar,
      });
    });

    socket.on('stop_typing', () => {
      socket.broadcast.emit('user_stop_typing');
    });

  });

}


// =============================================================================
// FONCTION EXPORTÉE — diffuseMessage()
// Appelée depuis routes/messages.js après insertion en base.
// Diffuse le message à tous les clients connectés.
//
// On ne laisse PAS le client émettre new_message directement via socket.emit —
// ça permettrait d'envoyer des messages sans passer par l'API (bypass validation).
// Le flux est toujours : Client → API REST → Base de données → Socket.io → Clients
// =============================================================================
function diffuseMessage(io, message) {
  io.emit('new_message', message);
}

module.exports = { initSocket, diffuseMessage };