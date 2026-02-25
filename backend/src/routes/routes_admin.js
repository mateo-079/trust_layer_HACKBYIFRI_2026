// =============================================================================
// TRUST LAYER — src/routes/routes_admin.js
//
// Routes de modération — accessibles uniquement aux admins.
// Toutes les routes passent par authenticate + requireAdmin.
//
// GET  /api/admin/reports          — liste des signalements (avec pagination)
// GET  /api/admin/stats            — statistiques globales
// PATCH /api/admin/reports/:id     — changer le statut (resolved / rejected)
// DELETE /api/admin/messages/:id   — supprimer un message signalé
// POST /api/admin/users/:id/ban    — bannir un utilisateur
// DELETE /api/admin/users/:id/ban  — débannir un utilisateur
// =============================================================================

const express        = require('express');
const router         = express.Router();
const db             = require('../db/database');
const { authenticate }  = require('../middleware/auth_middleware');
const { requireAdmin }  = require('../middleware/admin_middleware');
const logger            = require('../utils/logger');

// Toutes les routes de ce fichier nécessitent authenticate + requireAdmin
router.use(authenticate, requireAdmin);


// ---------------------------------------------------------------------------
// GET /api/admin/reports
// Liste des signalements avec infos du message et du signaleur.
// Paramètres : ?status=pending|resolved|rejected&page=1&limit=20
// ---------------------------------------------------------------------------
router.get('/reports', async (req, res, next) => {
  try {
    const status = ['pending', 'resolved', 'rejected'].includes(req.query.status)
      ? req.query.status : null;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (Math.max(parseInt(req.query.page) || 1, 1) - 1) * limit;

    const whereClause = status ? `WHERE r.status = '${status}'` : '';

    const [reports] = await db.pool.query(`
      SELECT
        r.id,
        r.reason,
        r.status,
        r.created_at,
        -- Message signalé
        m.id         AS message_id,
        m.content    AS message_content,
        m.deleted_at AS message_deleted_at,
        -- Auteur du message
        u_msg.id       AS author_id,
        u_msg.username AS author_username,
        u_msg.avatar   AS author_avatar,
        u_msg.is_banned AS author_is_banned,
        -- Signaleur
        u_rep.id       AS reporter_id,
        u_rep.username AS reporter_username
      FROM reports r
      JOIN messages m       ON m.id = r.message_id
      JOIN users u_msg      ON u_msg.id = m.user_id
      JOIN users u_rep      ON u_rep.id = r.reporter_id
      ${whereClause}
      ORDER BY
        CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
        r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Compter le total pour la pagination
    const [[{ total }]] = await db.pool.query(`
      SELECT COUNT(*) AS total FROM reports r ${whereClause}
    `);

    res.json({
      reports,
      pagination: { total, limit, offset, page: Math.floor(offset / limit) + 1 },
    });
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Chiffres clés pour le dashboard.
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const [[users]]    = await db.pool.query('SELECT COUNT(*) AS total FROM users');
    const [[banned]]   = await db.pool.query('SELECT COUNT(*) AS total FROM users WHERE is_banned = 1');
    const [[messages]] = await db.pool.query('SELECT COUNT(*) AS total FROM messages WHERE deleted_at IS NULL');
    const [[pending]]  = await db.pool.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'pending'");
    const [[resolved]] = await db.pool.query("SELECT COUNT(*) AS total FROM reports WHERE status = 'resolved'");

    res.json({
      users:    users.total,
      banned:   banned.total,
      messages: messages.total,
      reports:  { pending: pending.total, resolved: resolved.total },
    });
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// PATCH /api/admin/reports/:id
// Mettre à jour le statut d'un signalement.
// Body : { status: 'resolved' | 'rejected' }
// ---------------------------------------------------------------------------
router.patch('/reports/:id', async (req, res, next) => {
  try {
    const reportId = parseInt(req.params.id);
    const { status } = req.body;

    if (!['resolved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide. Valeurs acceptées : resolved, rejected' });
    }

    const [result] = await db.pool.execute(
      'UPDATE reports SET status = ? WHERE id = ?',
      [status, reportId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Signalement introuvable' });
    }

    logger.info('Signalement mis à jour', {
      adminId: req.user.id,
      reportId,
      status,
    });

    res.json({ success: true, reportId, status });
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// DELETE /api/admin/messages/:id
// Suppression définitive d'un message (soft delete + diffusion WebSocket).
// ---------------------------------------------------------------------------
router.delete('/messages/:id', async (req, res, next) => {
  try {
    const messageId = parseInt(req.params.id);

    await db.deleteMessage(messageId);

    // Diffuse la suppression en temps réel à tous les clients connectés
    const io = req.app.get('io');
    if (io) io.emit('message_deleted', { messageId });

    logger.info('Message supprimé par admin', {
      adminId: req.user.id,
      messageId,
    });

    res.json({ success: true, messageId });
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/ban
// Bannir un utilisateur + révoquer son token JWT actif.
// ---------------------------------------------------------------------------
router.post('/users/:id/ban', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Impossible de se bannir soi-même' });
    }

    await db.pool.execute(
      'UPDATE users SET is_banned = 1 WHERE id = ?',
      [userId]
    );

    // Déconnecte l'utilisateur en temps réel si connecté via WebSocket
    const io = req.app.get('io');
    if (io) io.emit('user_banned', { userId });

    logger.info('Utilisateur banni', {
      adminId: req.user.id,
      targetUserId: userId,
    });

    res.json({ success: true, userId, banned: true });
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id/ban
// Débannir un utilisateur.
// ---------------------------------------------------------------------------
router.delete('/users/:id/ban', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    await db.pool.execute(
      'UPDATE users SET is_banned = 0 WHERE id = ?',
      [userId]
    );

    logger.info('Utilisateur débanni', {
      adminId: req.user.id,
      targetUserId: userId,
    });

    res.json({ success: true, userId, banned: false });
  } catch (err) { next(err); }
});


module.exports = router;