const { body, param, query, validationResult } = require('express-validator');

/**
 * Middleware to check validation results and return errors
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Données invalides',
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ─── Register ────────────────────────────────────────────────────────────────
const registerRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Le pseudo doit faire entre 3 et 30 caractères')
    .matches(/^[\w\s\u00C0-\u024F''-]+$/)
    .withMessage('Pseudo invalide'),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Adresse email invalide')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 6, max: 128 })
    .withMessage('Le mot de passe doit faire au moins 6 caractères'),

  body('avatar')
    .optional()
    .trim()
    .isLength({ max: 10 })
    .withMessage('Avatar invalide'),

  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 60 })
    .withMessage('Prénom trop long'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 60 })
    .withMessage('Nom trop long'),

  body('emergencyName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Nom du contact d\'urgence trop long'),

  body('emergencyPhone')
    .optional()
    .trim()
    .isLength({ max: 30 })
    .withMessage('Numéro d\'urgence invalide'),
];

// ─── Login ────────────────────────────────────────────────────────────────────
const loginRules = [
  body('email').trim().isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').notEmpty().withMessage('Mot de passe requis'),
];

// ─── Messages ─────────────────────────────────────────────────────────────────
const sendMessageRules = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Le message doit faire entre 1 et 2000 caractères'),
];

const getMessagesRules = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('limit doit être entre 1 et 200')
    .toInt(),
];

// ─── Moods ────────────────────────────────────────────────────────────────────
const moodRules = [
  body('score')
    .isInt({ min: 1, max: 10 })
    .withMessage('Le score doit être un entier entre 1 et 10')
    .toInt(),

  body('note')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('La note ne peut pas dépasser 500 caractères'),
];

const userIdParam = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID utilisateur invalide')
    .toInt(),
];

module.exports = {
  validate,
  registerRules,
  loginRules,
  sendMessageRules,
  getMessagesRules,
  moodRules,
  userIdParam,
};
