-- =============================================================================
-- TRUST LAYER — schema.sql
-- Script de création complet de la base de données MySQL 8.x
--
-- UTILISATION :
--   Option A (terminal) :
--     mysql -u root -p < schema.sql
--
--   Option B (phpMyAdmin / DBeaver) :
--     Copie-colle ce fichier et exécute-le.
--
--   Option C (Node.js au démarrage) :
--     Tu peux exécuter ce script via : mysql2.execute(fs.readFileSync('schema.sql'))
--     Mais c'est mieux de le faire une fois manuellement.
--
-- ORDRE IMPORTANT : les tables avec FK doivent être créées après leurs références.
--   users → salons → messages → moods → reports → reactions → revoked_tokens
-- =============================================================================

-- Crée la base si elle n'existe pas déjà
CREATE DATABASE IF NOT EXISTS trustlayer
  CHARACTER SET utf8mb4          -- support complet Unicode (emojis, accents, etc.)
  COLLATE utf8mb4_unicode_ci;    -- tri insensible à la casse, accents compris

USE trustlayer;

-- Désactive les vérifications FK pendant la création (évite les erreurs d'ordre)
SET FOREIGN_KEY_CHECKS = 0;


-- =============================================================================
-- TABLE 1 : users
-- Stocke les identités et profils de tous les utilisateurs.
--
-- CORRECTIONS vs schéma original :
--   — "pseudo" renommé en "username" (cohérence avec le code backend)
--   — BIGINT UNSIGNED au lieu de INT (anticipe la croissance)
--   — NOT NULL explicite sur les colonnes obligatoires
--   — is_banned ajouté (modération)
--   — updated_at ajouté (audit)
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username         VARCHAR(30)      NOT NULL                   COMMENT 'Pseudo public visible dans le chat',
  email            VARCHAR(255)     NOT NULL                   COMMENT 'Email pour la connexion — jamais affiché',
  password_hash    VARCHAR(255)     NOT NULL                   COMMENT 'Hash bcrypt — jamais le mot de passe en clair',
  avatar           VARCHAR(10)      NOT NULL DEFAULT '🌟'      COMMENT 'Emoji avatar choisi à l\'inscription',
  first_name       VARCHAR(60)      DEFAULT NULL               COMMENT 'Prénom réel — privé, usage urgence uniquement',
  last_name        VARCHAR(60)      DEFAULT NULL               COMMENT 'Nom réel — privé',
  emergency_name   VARCHAR(100)     DEFAULT NULL               COMMENT 'Nom du contact d\'urgence',
  emergency_phone  VARCHAR(30)      DEFAULT NULL               COMMENT 'Téléphone du contact d\'urgence',
  is_banned        TINYINT(1)       NOT NULL DEFAULT 0         COMMENT '0 = actif, 1 = banni par la modération',
  is_admin         TINYINT(1)       NOT NULL DEFAULT 0         COMMENT '0 = utilisateur, 1 = administrateur',
  created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP        DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username),
  UNIQUE KEY uq_email    (email)
  -- Les colonnes UNIQUE ont automatiquement un index en MySQL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Identités et profils utilisateurs';


-- =============================================================================
-- TABLE 2 : salons
-- Salons de discussion (ex : "Espace Général").
--
-- NOUVELLE TABLE : salon_id était présent dans messages mais la table n'existait pas.
-- =============================================================================
CREATE TABLE IF NOT EXISTS salons (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT  COMMENT 'Petit entier — peu de salons prévus',
  name        VARCHAR(50)      NOT NULL                  COMMENT 'Nom du salon',
  description VARCHAR(255)     DEFAULT NULL              COMMENT 'Description affichée dans l\'interface',
  is_active   TINYINT(1)       NOT NULL DEFAULT 1        COMMENT '1 = actif, 0 = archivé',
  created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_salon_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Salons de discussion';

-- Insère le salon par défaut (indispensable avant d'insérer des messages)
INSERT INTO salons (name, description)
VALUES ('Espace Général', 'Salon principal de la communauté Trust Layer')
ON DUPLICATE KEY UPDATE name = name; -- idempotent : pas d'erreur si déjà présent


-- =============================================================================
-- TABLE 3 : messages
-- Messages du chat avec soft delete intégré.
--
-- CORRECTIONS vs schéma original :
--   — FK salon_id référence maintenant une vraie table (salons)
--   — BIGINT UNSIGNED pour id et user_id
--   — Contraintes NOT NULL explicites
--   — INDEX composé (salon_id, created_at) pour les requêtes de chargement
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED  NOT NULL                  COMMENT 'Auteur du message',
  salon_id    TINYINT UNSIGNED NOT NULL DEFAULT 1        COMMENT 'Salon de destination',
  content     TEXT             NOT NULL                  COMMENT 'Contenu du message (max 500 chars côté app)',
  deleted_at  TIMESTAMP        DEFAULT NULL              COMMENT 'NULL = visible, non-NULL = soft delete',
  created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Index composé : optimise la requête "50 derniers messages du salon X"
  -- C'est la requête la plus fréquente → index prioritaire
  KEY idx_messages_salon_time (salon_id, created_at),

  -- Index simple : optimise la modération "tous les messages de l'user X"
  KEY idx_messages_user (user_id),

  CONSTRAINT fk_msg_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_msg_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE RESTRICT

  -- ON DELETE CASCADE sur user : si un compte est supprimé, ses messages partent aussi
  -- ON DELETE RESTRICT sur salon : on ne peut pas supprimer un salon qui a des messages
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Messages du chat avec soft delete';


-- =============================================================================
-- TABLE 4 : moods
-- Suivi d'humeur quotidien (score de 1 à 10).
--
-- CORRECTIONS vs schéma original :
--   — TINYINT UNSIGNED pour score (économique, CHECK constraint ajouté)
--   — Champ note ajouté (prévu dans l'API mais absent du schéma)
--   — INDEX composé pour les requêtes d'historique
-- =============================================================================
CREATE TABLE IF NOT EXISTS moods (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED  NOT NULL,
  score       TINYINT UNSIGNED NOT NULL                  COMMENT 'Score d\'humeur entre 1 et 10',
  note        VARCHAR(500)     DEFAULT NULL              COMMENT 'Note privée optionnelle',
  created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Index composé : optimise "les 30 dernières humeurs de l'user X triées par date"
  KEY idx_moods_user_time (user_id, created_at),

  CONSTRAINT fk_mood_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_mood_score CHECK (score BETWEEN 1 AND 10)

  -- MySQL 8.0+ supporte les CHECK constraints
  -- Sur versions antérieures, la validation est gérée par express-validator
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Suivi d\'humeur quotidien';


-- =============================================================================
-- TABLE 5 : reports
-- Signalements de messages par les utilisateurs.
--
-- CORRECTIONS vs schéma original :
--   — BIGINT UNSIGNED pour les IDs
--   — UNIQUE(reporter_id, message_id) : un seul signalement par utilisateur par message
--   — INDEX sur status pour filtrer les "pending" en modération
-- =============================================================================
CREATE TABLE IF NOT EXISTS reports (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  reporter_id  BIGINT UNSIGNED  NOT NULL  COMMENT 'Utilisateur qui signale',
  message_id   BIGINT UNSIGNED  NOT NULL  COMMENT 'Message signalé',
  reason       VARCHAR(500)     DEFAULT NULL,
  status       ENUM('pending', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Un utilisateur ne peut signaler le même message qu'une seule fois
  UNIQUE KEY uq_report (reporter_id, message_id),

  -- Index pour la modération : filtrer les signalements en attente
  KEY idx_reports_status (status),

  CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_report_message  FOREIGN KEY (message_id)  REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Signalements de messages';


-- =============================================================================
-- TABLE 6 : reactions
-- Réactions emoji aux messages (bouton 💜 dans le frontend).
-- NOUVELLE TABLE : le frontend avait déjà le bouton mais la persistance manquait.
--
-- Fonctionne en "toggle" : ajouter = réagir, ajouter à nouveau = retirer.
-- La contrainte UNIQUE garantit qu'un utilisateur ne peut réagir qu'une fois.
-- =============================================================================
CREATE TABLE IF NOT EXISTS reactions (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED  NOT NULL,
  message_id  BIGINT UNSIGNED  NOT NULL,
  emoji       VARCHAR(10)      NOT NULL DEFAULT '💜',
  created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Une seule réaction par utilisateur par message (toggle côté backend)
  UNIQUE KEY uq_reaction (user_id, message_id),

  -- Index pour compter les réactions d'un message rapidement
  KEY idx_reactions_message (message_id),

  CONSTRAINT fk_react_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_react_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Réactions emoji aux messages';


-- =============================================================================
-- TABLE 7 : revoked_tokens (optionnelle — sécurité avancée)
-- Permet de révoquer un JWT avant sa date d'expiration.
-- Utile pour : ban immédiat, déconnexion forcée, mot de passe compromis.
--
-- On stocke un hash SHA-256 du token — jamais le token complet.
-- Les tokens expirés sont nettoyés automatiquement par le backend.
-- =============================================================================
CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  token_hash  VARCHAR(64)      NOT NULL  COMMENT 'SHA-256 du JWT révoqué',
  user_id     BIGINT UNSIGNED  DEFAULT NULL,
  expires_at  TIMESTAMP        NOT NULL  COMMENT 'Expiration du token original — pour nettoyage',
  created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_token_hash (token_hash),

  -- Index pour le nettoyage automatique des tokens expirés
  KEY idx_token_expires (expires_at),

  CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  -- ON DELETE SET NULL : si l'user est supprimé, on garde la trace du token révoqué
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='JWT révoqués avant expiration';


-- Réactive les vérifications FK
SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================================
-- VÉRIFICATION FINALE
-- Ces requêtes confirment que tout a été créé correctement.
-- =============================================================================
SELECT
  TABLE_NAME    AS 'Table créée',
  TABLE_ROWS    AS 'Lignes (approx)',
  TABLE_COMMENT AS 'Description'
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'trustlayer'
ORDER BY TABLE_NAME;

-- Résultat attendu : 7 tables (messages, moods, reactions, reports, revoked_tokens, salons, users)