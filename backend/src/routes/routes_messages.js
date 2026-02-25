// =============================================================================
// TRUST LAYER — src/routes/routes_messages.js
//
// AJOUT WebSocket :
//   Après insertion d'un message en base, on le diffuse à tous les clients
//   connectés via Socket.io. Le client qui a envoyé le message reçoit aussi
//   la diffusion — le frontend doit éviter d'afficher le message en double.
// =============================================================================

const express              = require('express');
const db                   = require('../db/database');
const logger               = require('../utils/logger');
const { authenticate }     = require('../middleware/auth_middleware');
const { messageLimiter }   = require('../middleware/rateLimiter');
const { diffuseMessage }   = require('../socket/socketHandler');
const {
  sendMessageRules,
  getMessagesRules,
  validate,
} = require('../middleware/validators');

const router = express.Router();


// ── GET /api/messages ─────────────────────────────────────────────────────────
router.get('/', authenticate, getMessagesRules, validate, async (req, res) => {
  try {
    const limit    = req.query.limit || 50;
    const messages = await db.getMessages(limit);
    res.json({ messages });
  } catch (err) {
    logger.error('Erreur chargement messages', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// ── POST /api/messages ────────────────────────────────────────────────────────
router.post('/', authenticate, messageLimiter, sendMessageRules, validate, async (req, res) => {
  try {
    const message = await db.createMessage(req.user.id, req.body.content);

    if (!message) {
      return res.status(500).json({ error: 'Impossible de créer le message' });
    }

    // ── Diffusion WebSocket ────────────────────────────────────────────────────
    // Récupère l'instance Socket.io depuis Express et diffuse le message.
    // Tous les clients connectés reçoivent l'événement 'new_message'.
    // Le frontend identifie si c'est son propre message via message.user_id.
    const io = req.app.get('io');
    if (io) diffuseMessage(io, message);

    logger.info('Message envoyé et diffusé', { userId: req.user.id });
    res.status(201).json({ message });

  } catch (err) {
    logger.error('Erreur envoi message', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// ── POST /api/messages/:id/react ──────────────────────────────────────────────
router.post('/:id/react', authenticate, async (req, res) => {
  const messageId = parseInt(req.params.id);

  if (!messageId || messageId < 1) {
    return res.status(400).json({ error: 'ID message invalide' });
  }

  try {
    const result = await db.toggleReaction(req.user.id, messageId);
    const count  = await db.getReactionCount(messageId);

    // Diffuse la mise à jour des réactions à tous les connectés
    const io = req.app.get('io');
    if (io) io.emit('reaction_update', { messageId, count });

    res.json({ ...result, count });
  } catch (err) {
    logger.error('Erreur réaction', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// ── POST /api/messages/:id/report ────────────────────────────────────────────
// Signale un message à l'équipe de modération.
// Règles :
//   - On ne peut pas signaler son propre message
//   - La contrainte UNIQUE(reporter_id, message_id) en base empêche les doublons
//   - La raison est optionnelle mais validée côté frontend
router.post('/:id/report', authenticate, async (req, res) => {
  const messageId = parseInt(req.params.id);
  const { reason } = req.body;

  if (!messageId || messageId < 1) {
    return res.status(400).json({ error: 'ID message invalide' });
  }

  // Valider la raison contre une liste blanche
  const ALLOWED_REASONS = ['harcèlement', 'contenu offensant', 'crise', 'spam'];
  if (reason && !ALLOWED_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Raison invalide' });
  }

  try {
    // Vérifier que le message existe et n'est pas le sien
    const [rows] = await db.pool.execute(
      'SELECT user_id FROM messages WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [messageId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message introuvable' });
    }

    if (rows[0].user_id === req.user.id) {
      return res.status(403).json({ error: 'Tu ne peux pas signaler ton propre message' });
    }

    await db.createReport(req.user.id, messageId, reason || null);

    logger.warn('Message signalé', {
      messageId,
      reporterId: req.user.id,
      reason: reason || 'non précisée',
    });

    res.status(201).json({ success: true, message: 'Signalement enregistré' });

  } catch (err) {
    // Erreur duplicate key = déjà signalé par cet utilisateur
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Tu as déjà signalé ce message' });
    }
    logger.error('Erreur signalement', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// ── DELETE /api/messages/:id ──────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const messageId = parseInt(req.params.id);

  if (!messageId || messageId < 1) {
    return res.status(400).json({ error: 'ID message invalide' });
  }

  try {
    const [rows] = await db.pool.execute(
      'SELECT user_id FROM messages WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [messageId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Message introuvable' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Tu ne peux supprimer que tes propres messages' });

    await db.deleteMessage(messageId);

    // Diffuse la suppression à tous les connectés
    const io = req.app.get('io');
    if (io) io.emit('message_deleted', { messageId });

    logger.info('Message supprimé', { messageId, userId: req.user.id });
    res.json({ success: true });

  } catch (err) {
    logger.error('Erreur suppression message', { error: err.message });
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;