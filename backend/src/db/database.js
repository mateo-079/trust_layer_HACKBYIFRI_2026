// =============================================================================
// TRUST LAYER — src/db/database.js
// Pool de connexions MySQL via mysql2/promise.
//
// POURQUOI mysql2/promise ?
//   — API async/await native, pas de callbacks
//   — Pool de connexions : plusieurs requêtes simultanées sans bloquer
//   — Préparation des requêtes (paramètres bindés) : protection SQL injection
//   — Pas de race condition contrairement à l'ancien système fs JSON
//
// UTILISATION dans les routes :
//   const db = require('../db/database');
//   const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
// =============================================================================

const mysql  = require('mysql2/promise');
const logger = require('../utils/logger');

// ── Pool de connexions ────────────────────────────────────────────────────────
// Un "pool" maintient plusieurs connexions MySQL ouvertes en permanence.
// Quand une requête arrive, elle prend une connexion disponible et la remet
// dans le pool après usage. Bien plus efficace qu'ouvrir/fermer à chaque fois.
const pool = mysql.createPool({
  host:             process.env.DB_HOST             || 'localhost',
  port:             parseInt(process.env.DB_PORT)   || 3306,
  database:         process.env.DB_NAME             || 'trustlayer',
  user:             process.env.DB_USER             || 'root',
  password:         process.env.DB_PASSWORD         || '',
  connectionLimit:  parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  charset:          'utf8mb4',
  // Reconnexion automatique si la connexion est perdue
  enableKeepAlive:  true,
  keepAliveInitialDelay: 0,
  // Convertit automatiquement les BIGINT MySQL en Number JS
  // (si tes IDs dépassent Number.MAX_SAFE_INTEGER, passe à 'false' et gère en BigInt)
  supportBigNumbers: true,
  bigNumberStrings:  false,
  // Retourne les colonnes DATETIME/TIMESTAMP comme des strings ISO
  // pour éviter les surprises de timezone
  dateStrings: true,
});

// ── Test de connexion au démarrage ────────────────────────────────────────────
// On vérifie immédiatement que MySQL est joignable.
// Si le serveur démarre sans BDD, on le sait tout de suite au lieu de découvrir
// l'erreur à la première requête d'un utilisateur.
pool.getConnection()
  .then(conn => {
    logger.info('Connexion MySQL établie', {
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'trustlayer',
    });
    conn.release(); // IMPORTANT : toujours relâcher la connexion après usage
  })
  .catch(err => {
    logger.error('Impossible de se connecter à MySQL', { error: err.message });
    // On arrête le serveur — inutile de démarrer sans base de données
    process.exit(1);
  });


// =============================================================================
// COUCHE D'ABSTRACTION — Méthodes métier
//
// Ces fonctions encapsulent les requêtes SQL pour que les routes n'aient pas
// à écrire du SQL directement. Avantages :
//   — SQL centralisé et facile à maintenir
//   — Les routes restent courtes et lisibles
//   — Paramètres toujours bindés → protection SQL injection garantie
// =============================================================================

const db = {

  // ─── Accès direct au pool (pour les cas complexes dans les routes) ──────────
  // Utilise pool.execute() pour les requêtes simples.
  // Utilise pool.getConnection() pour les transactions multi-requêtes.
  pool,


  // ===========================================================================
  // USERS
  // ===========================================================================

  /**
   * Cherche un utilisateur par son email.
   * Utilisé dans le login pour vérifier les credentials.
   * Retourne NULL si non trouvé — NE PAS révéler l'absence à l'appelant côté client.
   */
  async findUserByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    return rows[0] || null;
  },

  /**
   * Vérifie si un email OU un username est déjà pris.
   * Utilisé à l'inscription pour éviter les doublons avant d'insérer.
   */
  async findUserByEmailOrUsername(email, username) {
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
      [email.toLowerCase().trim(), username.toLowerCase().trim()]
    );
    return rows[0] || null;
  },

  /**
   * Cherche un utilisateur par son ID.
   * Utilisé par le middleware auth.js pour hydrater req.user après vérification JWT.
   */
  async findUserById(id) {
    const [rows] = await pool.execute(
      'SELECT id, username, email, avatar, first_name, last_name, is_banned, is_admin, created_at FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Crée un nouvel utilisateur.
   * Le mot de passe doit déjà être haché (bcrypt) avant d'appeler cette fonction.
   * Retourne l'utilisateur créé (sans password_hash).
   */
  async createUser({ username, email, password_hash, avatar, firstName, lastName, emergencyName, emergencyPhone }) {
    const [result] = await pool.execute(
      `INSERT INTO users
        (username, email, password_hash, avatar, first_name, last_name, emergency_name, emergency_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        email.toLowerCase().trim(),
        password_hash,
        avatar || '🌟',
        firstName  || null,
        lastName   || null,
        emergencyName  || null,
        emergencyPhone || null,
      ]
    );

    // MySQL retourne insertId après un INSERT
    return this.findUserById(result.insertId);
  },


  // ===========================================================================
  // MESSAGES
  // ===========================================================================

  /**
   * Récupère les N derniers messages d'un salon avec les infos de l'auteur.
   * JOIN sur users pour éviter N requêtes supplémentaires (N+1 problem).
   * deleted_at IS NULL → exclut les messages supprimés (soft delete).
   */
  async getMessages(limit = 50, salonId = 1) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 50), 200);
    const safeSalonId = Math.max(1, parseInt(salonId) || 1);
    // pool.query() au lieu de pool.execute() car mysql2 ne supporte pas
    // les placeholders ? pour LIMIT. Les valeurs sont validées par parseInt
    // + Math.min/max avant injection — pas de risque SQL injection.
    const [rows] = await pool.query(
      `SELECT
         m.id,
         m.content,
         m.created_at,
         m.user_id,
         u.username,
         u.avatar
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.salon_id = ${safeSalonId} AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT ${safeLimit}`
    );
    // On inverse pour avoir l'ordre chronologique (plus ancien → plus récent)
    return rows.reverse();
  },

  /**
   * Insère un message en base et retourne le message complet (avec username/avatar).
   * Le contenu est déjà sanitisé par la route avant d'arriver ici.
   */
  async createMessage(userId, content, salonId = 1) {
    const [result] = await pool.execute(
      'INSERT INTO messages (user_id, salon_id, content) VALUES (?, ?, ?)',
      [userId, salonId, content]
    );

    // On récupère le message inséré avec les infos de l'auteur
    const [rows] = await pool.execute(
      `SELECT m.id, m.content, m.created_at, m.user_id, u.username, u.avatar
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.id = ?`,
      [result.insertId]
    );
    return rows[0] || null;
  },

  /**
   * Soft delete : marque deleted_at au lieu de supprimer physiquement.
   * Seul l'auteur ou un admin peut supprimer (à vérifier dans la route).
   */
  async deleteMessage(messageId) {
    await pool.execute(
      'UPDATE messages SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [messageId]
    );
  },


  // ===========================================================================
  // MOODS
  // ===========================================================================

  /**
   * Récupère les 30 dernières entrées d'humeur d'un utilisateur.
   * Triées de la plus récente à la plus ancienne.
   */
  async getMoods(userId) {
    const [rows] = await pool.execute(
      `SELECT id, score, note, created_at
       FROM moods
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
    );
    return rows;
  },

  /**
   * Enregistre une entrée d'humeur.
   * Le score est validé (1-10) par le validator avant d'arriver ici.
   */
  async createMood(userId, score, note = null) {
    const [result] = await pool.execute(
      'INSERT INTO moods (user_id, score, note) VALUES (?, ?, ?)',
      [userId, score, note || null]
    );
    const [rows] = await pool.execute(
      'SELECT * FROM moods WHERE id = ?',
      [result.insertId]
    );
    return rows[0] || null;
  },


  // ===========================================================================
  // REPORTS (signalements)
  // ===========================================================================

  /**
   * Crée un signalement. La contrainte UNIQUE(reporter_id, message_id) en base
   * empêche les doublons — MySQL lèvera une erreur qu'on capture dans la route.
   */
  async createReport(reporterId, messageId, reason = null) {
    const [result] = await pool.execute(
      'INSERT INTO reports (reporter_id, message_id, reason) VALUES (?, ?, ?)',
      [reporterId, messageId, reason || null]
    );
    return { id: result.insertId, reporter_id: reporterId, message_id: messageId, status: 'pending' };
  },


  // ===========================================================================
  // REACTIONS
  // ===========================================================================

  /**
   * Toggle une réaction (ajoute si absente, supprime si déjà présente).
   * La contrainte UNIQUE(user_id, message_id) gère l'unicité en base.
   * Retourne { added: true } ou { added: false } selon l'action effectuée.
   */
  async toggleReaction(userId, messageId, emoji = '💜') {
    // Vérifie si la réaction existe déjà
    const [existing] = await pool.execute(
      'SELECT id FROM reactions WHERE user_id = ? AND message_id = ?',
      [userId, messageId]
    );

    if (existing.length > 0) {
      // Supprime la réaction existante
      await pool.execute(
        'DELETE FROM reactions WHERE user_id = ? AND message_id = ?',
        [userId, messageId]
      );
      return { added: false };
    } else {
      // Ajoute la réaction
      await pool.execute(
        'INSERT INTO reactions (user_id, message_id, emoji) VALUES (?, ?, ?)',
        [userId, messageId, emoji]
      );
      return { added: true };
    }
  },

  /**
   * Compte les réactions pour un message donné.
   */
  async getReactionCount(messageId) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) AS count FROM reactions WHERE message_id = ?',
      [messageId]
    );
    return rows[0]?.count || 0;
  },


  // ===========================================================================
  // SÉCURITÉ
  // ===========================================================================

  /**
   * Vérifie si un token JWT est révoqué.
   * Utilise le hash SHA-256 du token, pas le token lui-même.
   */
  async isTokenRevoked(tokenHash) {
    const [rows] = await pool.execute(
      'SELECT id FROM revoked_tokens WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
      [tokenHash]
    );
    return rows.length > 0;
  },

  /**
   * Révoque un token JWT (déconnexion forcée, compte banni, etc.).
   * Nettoie automatiquement les tokens expirés à chaque appel.
   */
  async revokeToken(tokenHash, userId, expiresAt) {
    // Nettoyage des tokens expirés (maintenance légère, pas besoin de cron séparé)
    await pool.execute('DELETE FROM revoked_tokens WHERE expires_at < NOW()');

    await pool.execute(
      'INSERT IGNORE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [tokenHash, userId || null, expiresAt]
    );
  },

};

module.exports = db;