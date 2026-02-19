// =============================================================================
// TRUST LAYER — security.js
// Module de sécurité frontend partagé entre toutes les pages.
// Regroupe les utilitaires de sanitisation, validation, rate limiting,
// stockage sécurisé, et protection CSRF. Ce module est chargé sur chaque page
// avant les scripts spécifiques.
// =============================================================================

const Security = {

    // -------------------------------------------------------------------------
    // SANITISATION DES ENTRÉES
    // Toutes les données saisies par l'utilisateur ou reçues de sources externes
    // doivent passer par ces fonctions avant d'être utilisées ou affichées.
    // -------------------------------------------------------------------------

    // Neutralise les caractères HTML spéciaux pour prévenir les injections XSS.
    // À utiliser chaque fois qu'on insère du texte utilisateur dans le DOM.
    escapeHTML(str) {
        if (typeof str !== 'string') return '';
        const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#x27;", '/':'&#x2F;' };
        return str.replace(/[&<>"'/]/g, char => map[char]);
    },

    // Retire les balises HTML (balises script incluses) et retourne le texte brut.
    // Différent de escapeHTML — ici on supprime plutôt qu'on échappe.
    sanitizeText(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim();
    },

    // Nettoie et valide un email. Retourne l'email en minuscules si valide, sinon null.
    sanitizeEmail(email) {
        if (typeof email !== 'string') return null;
        const cleaned    = email.trim().toLowerCase();
        const emailRegex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return emailRegex.test(cleaned) ? cleaned : null;
    },

    // Nettoie un numéro de téléphone en gardant uniquement les caractères autorisés.
    // Retourne null si la longueur en chiffres est inférieure à 6 ou supérieure à 20.
    sanitizePhone(phone) {
        if (typeof phone !== 'string') return null;
        const cleaned    = phone.replace(/[^0-9+\s\-()]/g, '').trim();
        const digitsOnly = cleaned.replace(/\D/g, '');
        return digitsOnly.length >= 6 && digitsOnly.length <= 20 ? cleaned : null;
    },

    // Valide un nom ou prénom : 2 à 40 caractères, lettres, espaces, tirets et apostrophes.
    sanitizeName(name) {
        if (typeof name !== 'string') return null;
        const cleaned   = name.trim();
        const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,40}$/;
        return nameRegex.test(cleaned) ? cleaned : null;
    },

    // Valide un pseudo : 3 à 20 caractères alphanumériques, accents, tirets et underscores.
    sanitizePseudo(pseudo) {
        if (typeof pseudo !== 'string') return null;
        const cleaned      = pseudo.trim();
        const pseudoRegex  = /^[\wÀ-ÿ\-]{3,20}$/;
        return pseudoRegex.test(cleaned) ? cleaned : null;
    },


    // -------------------------------------------------------------------------
    // VALIDATION DU MOT DE PASSE
    // Évalue la robustesse du mot de passe et retourne un rapport détaillé.
    // Le minimum strict est 6 caractères — en dessous, le mot de passe est rejeté.
    // -------------------------------------------------------------------------
    validatePassword(password) {
        const issues = [];
        let strength = 'weak';

        if (!password || password.length < 6) {
            issues.push('Minimum 6 caractères requis');
            return { valid: false, strength: 'weak', issues };
        }

        if (password.length < 8) {
            issues.push('8 caractères ou plus sont recommandés');
        }

        const hasLower   = /[a-z]/.test(password);
        const hasUpper   = /[A-Z]/.test(password);
        const hasNumber  = /[0-9]/.test(password);
        const hasSpecial = /[^a-zA-Z0-9]/.test(password);

        const criteriaCount = [hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;

        if (criteriaCount >= 3 && password.length >= 8) strength = 'strong';
        else if (criteriaCount >= 2 && password.length >= 6) strength = 'medium';

        if (!hasLower && !hasUpper) issues.push('Ajoute des lettres');
        if (!hasNumber) issues.push('Ajoute des chiffres');
        if (!hasSpecial && strength !== 'strong') issues.push('Des caractères spéciaux (!@#$%) renforcent le mot de passe');

        // Rejette les mots de passe triviaux les plus courants.
        const commonPasswords = ['123456', 'password', 'azerty', 'qwerty', '000000', '111111'];
        if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
            issues.push('Mot de passe trop commun');
            strength = 'weak';
        }

        return { valid: password.length >= 6, strength, issues };
    },


    // -------------------------------------------------------------------------
    // RATE LIMITING CÔTÉ CLIENT
    // Limite le nombre de tentatives pour une action donnée (ex : connexion).
    // S'appuie sur localStorage pour persister les timestamps entre les requêtes.
    // Cette protection est complémentaire au rate limiting serveur.
    // -------------------------------------------------------------------------

    // Vérifie si l'action est autorisée. Retourne false si le quota est dépassé.
    // maxAttempts : nombre max de tentatives dans la fenêtre de temps.
    // windowMs    : durée de la fenêtre en millisecondes.
    checkRateLimit(action, maxAttempts = 5, windowMs = 60000) {
        const key = `rl_${action}`;
        const now = Date.now();

        let attempts = [];
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                attempts = JSON.parse(stored).filter(timestamp => now - timestamp < windowMs);
            }
        } catch {
            // Si localStorage est inaccessible, on laisse passer par sécurité.
            return true;
        }

        if (attempts.length >= maxAttempts) return false;

        attempts.push(now);
        try {
            localStorage.setItem(key, JSON.stringify(attempts));
        } catch {
            localStorage.removeItem(key);
        }

        return true;
    },

    // Réinitialise le compteur de tentatives pour une action.
    // Utile après une authentification réussie pour libérer la limite.
    resetRateLimit(action) {
        try { localStorage.removeItem(`rl_${action}`); } catch {}
    },


    // -------------------------------------------------------------------------
    // STOCKAGE SÉCURISÉ
    // Wrapper autour de sessionStorage pour centraliser la gestion des erreurs.
    // Le sessionStorage est preferé au localStorage pour les données sensibles
    // car il est automatiquement effacé à la fermeture de l'onglet.
    // ATTENTION : ne jamais stocker de mots de passe ou de tokens en clair.
    // -------------------------------------------------------------------------

    secureSet(key, value) {
        try {
            const safeValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            sessionStorage.setItem(key, safeValue);
        } catch (e) {
            console.error('Échec du stockage :', e.message);
        }
    },

    secureGet(key) {
        try {
            const value = sessionStorage.getItem(key);
            if (!value) return null;
            try { return JSON.parse(value); } catch { return value; }
        } catch { return null; }
    },

    secureRemove(key) {
        try {
            sessionStorage.removeItem(key);
            localStorage.removeItem(key);
        } catch {}
    },

    // Supprime toutes les clés de session sensibles connues.
    // À appeler lors de la déconnexion de l'utilisateur.
    clearAllSensitiveData() {
        try {
            const sensitiveKeys = [
                'tl_password', 'tl_token', 'tl_session',
                'tl_profile_draft', 'tl_emergency'
            ];
            sensitiveKeys.forEach(key => {
                sessionStorage.removeItem(key);
                localStorage.removeItem(key);
            });
        } catch {}
    },


    // -------------------------------------------------------------------------
    // LOGGING SÉCURISÉ
    // Filtre automatiquement les champs sensibles avant tout affichage en console.
    // Empêche qu'un mot de passe ou token apparaisse accidentellement dans les logs.
    // -------------------------------------------------------------------------
    secureLog(message, data = null) {
        if (typeof data === 'object' && data !== null) {
            const sensitiveKeys = ['password', 'token', 'secret', 'key', 'pwd', 'pass'];
            const filtered = {};
            for (const [key, value] of Object.entries(data)) {
                filtered[key] = sensitiveKeys.some(sk => key.toLowerCase().includes(sk))
                    ? '[FILTRÉ]'
                    : value;
            }
            console.log(`[Security] ${message}`, filtered);
        } else {
            console.log(`[Security] ${message}`);
        }
    },


    // -------------------------------------------------------------------------
    // VALIDATION COMPLÈTE DES FORMULAIRES
    // Ces méthodes combinent toutes les validations individuelles pour valider
    // un formulaire complet en une seule passe.
    // -------------------------------------------------------------------------

    // Valide le formulaire d'inscription complet.
    // Retourne un objet { valid, errors } — errors est un dictionnaire champ -> message.
    validateRegistrationForm(formData) {
        const errors = {};

        if (!this.sanitizePseudo(formData.pseudo))        errors.pseudo         = 'Pseudo invalide (3-20 caractères alphanumériques)';
        if (!formData.avatar || formData.avatar.length > 10) errors.avatar       = 'Avatar invalide';
        if (!this.sanitizeName(formData.lastName))        errors.lastName        = 'Nom invalide (2-40 caractères)';
        if (!this.sanitizeName(formData.firstName))       errors.firstName       = 'Prénom invalide (2-40 caractères)';
        if (!this.sanitizeEmail(formData.email))          errors.email           = 'Email invalide';
        if (!this.sanitizeName(formData.emergencyName))   errors.emergencyName   = 'Nom du contact invalide';
        if (!this.sanitizePhone(formData.emergencyPhone)) errors.emergencyPhone  = 'Numéro de téléphone invalide';
        if (!this.validatePassword(formData.password).valid) errors.password     = this.validatePassword(formData.password).issues.join(', ');
        if (!formData.termsAccepted)                      errors.terms           = "Tu dois accepter les conditions d'utilisation";

        return { valid: Object.keys(errors).length === 0, errors };
    },

    // Valide le formulaire de connexion.
    // Moins strict que l'inscription — on vérifie juste que les champs sont présents et formatés.
    validateLoginForm(formData) {
        const errors = {};

        if (!this.sanitizeEmail(formData.email)) errors.email = 'Email invalide';
        if (!formData.password || formData.password.length < 1) errors.password = 'Mot de passe requis';

        return {
            valid: Object.keys(errors).length === 0,
            errors,
            cleanData: Object.keys(errors).length === 0 ? {
                email:    this.sanitizeEmail(formData.email),
                password: formData.password
            } : null
        };
    },


    // -------------------------------------------------------------------------
    // PROTECTION CSRF
    // Génère un token aléatoire côté client à inclure dans les requêtes API.
    // Le backend doit valider ce token pour rejeter les requêtes forgées.
    // La génération utilise l'API Web Crypto — sûre et non prédictible.
    // -------------------------------------------------------------------------
    generateCSRFToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    },

    setCSRFToken(token) { this.secureSet('csrf_token', token); },
    getCSRFToken()      { return this.secureGet('csrf_token'); },


    // -------------------------------------------------------------------------
    // VÉRIFICATION HTTPS
    // En production, toutes les communications doivent transiter en HTTPS.
    // Un avertissement console est levé si ce n'est pas le cas — cela n'est jamais
    // affiché à l'utilisateur, mais alerte l'équipe de développement.
    // -------------------------------------------------------------------------
    isHTTPS() {
        return window.location.protocol === 'https:';
    },

    checkHTTPS() {
        const host = window.location.hostname;
        if (!this.isHTTPS() && host !== 'localhost' && host !== '127.0.0.1') {
            console.warn('ATTENTION : le site tourne sans HTTPS. Les données peuvent être interceptées en transit.');
        }
    }
};


// -----------------------------------------------------------------------------
// AUTO-EXÉCUTION AU CHARGEMENT
// Ces vérifications se lancent dès que le script est chargé, sur toutes les pages.
// Nettoyage des anciennes entrées de rate limiting stockées il y a plus d'une heure.
// -----------------------------------------------------------------------------
(function () {
    Security.checkHTTPS();

    try {
        Object.keys(localStorage)
            .filter(key => key.startsWith('rl_'))
            .forEach(key => {
                try {
                    const attempts = JSON.parse(localStorage.getItem(key));
                    if (Array.isArray(attempts) && attempts.every(t => Date.now() - t > 3600000)) {
                        localStorage.removeItem(key);
                    }
                } catch {
                    localStorage.removeItem(key);
                }
            });
    } catch {}
})();

// Compatibilité Node.js pour les tests unitaires éventuels.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Security;
}
