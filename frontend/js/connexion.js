// =============================================================================
// TRUST LAYER — connexion.js
// Gestion du formulaire d'inscription (3 étapes) et du formulaire de connexion.
// Ce fichier communique directement avec le backend via l'API définie dans
// API_BASE. Aucune simulation — si le serveur est absent, les erreurs remontent.
// =============================================================================


// -----------------------------------------------------------------------------
// DONNÉES STATIQUES
// La liste des avatars et des bases de pseudos est gérée côté client car ce sont
// des données purement visuelles qui ne nécessitent pas de requête serveur.
// -----------------------------------------------------------------------------

const AVATARS = [
    '🌟','🌸','🦋','🌙','☀️','🌺',
    '🍀','🌈','🎨','🎭','🌊','🏔️',
    '🌳','🌵','🌻','🌹','🍁','🌾',
    '🦁','🐬','🦚','🌠','💫','🎵'
];

const PSEUDOS = [
    'ÉtoileDuSoir','PapillonLibre','LuneDouce','SoleilCourageux',
    'RêveurCalme','EspritPaisible','CœurSerein','ÂmeLégère',
    'VentDoux','OcéanProfond','MontagneSage','ForêtMystique',
    'FlammeEspoir','AubeNouvelle','NuitBienveillante','JourRadieux',
    'PlumePoète','PierrePatiente','ArcEnCiel','ÉclatLumière',
    'RacineForte','RivièreCalme','ColibriVif','ÉtoileFilante'
];

const API_BASE = 'http://localhost:3000/api';


// -----------------------------------------------------------------------------
// ÉTAT DU FORMULAIRE
// Ces variables suivent l'avancement de l'utilisateur dans le formulaire en 3
// étapes. selectedAvatar, pseudoOk et profileOk servent à activer ou désactiver
// les boutons de navigation entre les étapes.
// -----------------------------------------------------------------------------
let selectedAvatar = null;
let currentStep    = 1;
let pseudoOk       = false;
let profileOk      = false;


// -----------------------------------------------------------------------------
// INITIALISATION
// Point d'entrée lancé au DOMContentLoaded. Construit la grille d'avatars et
// branche tous les écouteurs d'événements.
// -----------------------------------------------------------------------------
function init() {
    buildAvatarGrid();
    bindPseudo();
    bindProfileFields();
    document.getElementById('random-btn').addEventListener('click', generatePseudo);
    document.getElementById('btn-enter').addEventListener('click', submitProfile);
    document.getElementById('btn-login').addEventListener('click', submitLogin);
}

// Génère dynamiquement la grille d'avatars depuis la liste AVATARS.
// Chaque bouton déclenche selectAvatar() au clic.
function buildAvatarGrid() {
    const grid = document.getElementById('avatar-grid');
    AVATARS.forEach(av => {
        const btn = document.createElement('button');
        btn.className = 'av-option';
        btn.textContent = av;
        btn.title = `Choisir ${av}`;
        btn.addEventListener('click', () => selectAvatar(av, btn));
        grid.appendChild(btn);
    });
}

// Met à jour l'interface quand un avatar est sélectionné :
// — déselectionne le précédent, met en surbrillance le nouveau
// — met à jour la prévisualisation du profil et active le bouton "Continuer"
function selectAvatar(av, el) {
    document.querySelectorAll('.av-option').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
    selectedAvatar = av;

    document.getElementById('next-to-2').disabled         = false;
    document.getElementById('preview-av').textContent      = av;
    document.getElementById('confirm-avatar').textContent  = av;
    document.getElementById('conf-av-display').textContent = av;
}


// -----------------------------------------------------------------------------
// VALIDATION DU PSEUDO
// Écoute la saisie en temps réel et affiche un retour visuel immédiat.
// La validation n'est pas bloquante — l'utilisateur voit le feedback
// au fur et à mesure qu'il tape.
// -----------------------------------------------------------------------------
function bindPseudo() {
    const input = document.getElementById('pseudo-input');

    input.addEventListener('input', () => {
        const val     = input.value.trim();
        const hint    = document.getElementById('input-hint');
        const preview = document.getElementById('pseudo-preview');

        document.getElementById('preview-name').textContent = val || 'Ton pseudo...';

        if (isPseudoValid(val)) {
            hint.textContent = 'Parfait !';
            hint.className   = 'input-hint ok';
            preview.classList.add('ready');
            pseudoOk = true;
        } else if (val.length > 20) {
            hint.textContent = 'Maximum 20 caractères';
            hint.className   = 'input-hint err';
            preview.classList.remove('ready');
            pseudoOk = false;
        } else {
            hint.textContent = val.length > 0 ? `Encore ${3 - val.length} caractère(s)` : 'Entre 3 et 20 caractères';
            hint.className   = 'input-hint';
            preview.classList.remove('ready');
            pseudoOk = false;
        }

        updateStep2Buttons();
    });
}

// Retourne true si le pseudo respecte le format : 3-20 caractères
// alphanumériques, accents autorisés, tirets et underscores acceptés.
function isPseudoValid(val) {
    return /^[\w\u00C0-\u017E\-]{3,20}$/.test(val);
}


// -----------------------------------------------------------------------------
// VALIDATION DES CHAMPS DU PROFIL
// Tous les champs obligatoires sont écoutés en temps réel. La validation globale
// se déclenche à chaque modification pour activer ou non le bouton "Continuer".
// -----------------------------------------------------------------------------
function bindProfileFields() {
    const inputs = [
        document.getElementById('last-name'),
        document.getElementById('first-name'),
        document.getElementById('email-input'),
        document.getElementById('emergency-name'),
        document.getElementById('emergency-phone'),
        document.getElementById('password-input')
    ];
    const terms = document.getElementById('terms-check');

    const onChange = () => {
        const result = validateProfileFields();
        profileOk = result.ok;
        updateProfileHint(result);
        updateStep2Buttons();
    };

    inputs.forEach(input => input.addEventListener('input', onChange));
    if (terms) terms.addEventListener('change', onChange);
    onChange(); // Lance une première validation pour initialiser l'état du bouton.
}

// Rassemble les valeurs actuelles de tous les champs du profil dans un objet.
// Utilisé aussi bien pour la validation que pour la construction du payload API.
function getProfileData() {
    return {
        lastName:       document.getElementById('last-name').value.trim(),
        firstName:      document.getElementById('first-name').value.trim(),
        email:          document.getElementById('email-input').value.trim(),
        emergencyName:  document.getElementById('emergency-name').value.trim(),
        emergencyPhone: document.getElementById('emergency-phone').value.trim(),
        password:       document.getElementById('password-input').value,
        termsAccepted:  document.getElementById('terms-check').checked
    };
}

// Valide l'ensemble des champs du profil et retourne un objet résultat.
// Les règles : noms 2-40 chars, email format standard, téléphone 6-20 chiffres,
// mot de passe minimum 6 caractères, conditions acceptées.
function validateProfileFields() {
    const data    = getProfileData();
    const nameRe  = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF' -]{2,40}$/;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRe = /^[0-9+()\s-]{6,20}$/;

    if (!data.lastName || !data.firstName || !data.email ||
        !data.emergencyName || !data.emergencyPhone || !data.password) {
        return { ok: false, type: 'idle', msg: 'Tous les champs sont obligatoires.' };
    }
    if (!nameRe.test(data.lastName))        return { ok: false, type: 'err', msg: 'Nom invalide (2-40 caractères).' };
    if (!nameRe.test(data.firstName))       return { ok: false, type: 'err', msg: 'Prénom invalide (2-40 caractères).' };
    if (!nameRe.test(data.emergencyName))   return { ok: false, type: 'err', msg: 'Nom du contact invalide.' };
    if (!emailRe.test(data.email))          return { ok: false, type: 'err', msg: 'Email invalide.' };
    if (!phoneRe.test(data.emergencyPhone)) return { ok: false, type: 'err', msg: 'Numéro du contact invalide.' };
    if (data.password.length < 6)           return { ok: false, type: 'err', msg: 'Mot de passe trop court (min 6).' };
    if (!data.termsAccepted)                return { ok: false, type: 'err', msg: 'Tu dois accepter les règles et la confidentialité.' };

    return { ok: true, type: 'ok', msg: 'Profil complet.' };
}

// Met à jour le message d'aide sous les champs du profil.
function updateProfileHint(result) {
    const hint = document.getElementById('profile-hint');
    if (!hint) return;
    hint.textContent = result.msg;
    if (result.type === 'ok')  hint.className = 'input-hint ok';
    else if (result.type === 'err') hint.className = 'input-hint err';
    else hint.className = 'input-hint';
}

// Active le bouton "Continuer" de l'étape 2 uniquement si pseudo et profil sont valides.
function updateStep2Buttons() {
    document.getElementById('next-to-3').disabled = !(pseudoOk && profileOk);
}


// -----------------------------------------------------------------------------
// GÉNÉRATION DE PSEUDO ALÉATOIRE
// Combine une base de la liste PSEUDOS avec un nombre aléatoire entre 1 et 99.
// Déclenche l'événement "input" pour relancer la validation immédiatement.
// -----------------------------------------------------------------------------
function generatePseudo() {
    const base   = PSEUDOS[Math.floor(Math.random() * PSEUDOS.length)];
    const num    = Math.floor(Math.random() * 99) + 1;
    const pseudo = `${base}${num}`;
    const input  = document.getElementById('pseudo-input');

    input.value = pseudo;
    input.dispatchEvent(new Event('input'));

    // Petite animation de rotation sur l'icône du bouton pour indiquer l'action.
    const svg = document.getElementById('random-btn').querySelector('svg');
    svg.style.transform = 'rotate(360deg)';
    setTimeout(() => { svg.style.transform = ''; }, 300);
}


// -----------------------------------------------------------------------------
// REQUÊTE API — Wrapper générique
// Même logique que dans chat.js — centralisé ici pour la page de connexion.
// Les erreurs HTTP remontent via une exception avec le message du serveur.
// -----------------------------------------------------------------------------
async function apiRequest(path, options = {}) {
    const opts = {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const res  = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data && data.error ? data.error : 'Une erreur est survenue.';
        throw new Error(msg);
    }
    return data;
}


// -----------------------------------------------------------------------------
// RETOURS VISUELS — Messages d'état
// showServerHint : zone d'erreur du formulaire d'inscription (étape 3)
// showLoginHint  : zone d'erreur du formulaire de connexion
// -----------------------------------------------------------------------------
function showServerHint(msg, type = 'err') {
    const hint = document.getElementById('server-hint');
    if (!hint) return;
    hint.textContent = msg || '';
    if (type === 'ok')  hint.className = 'input-hint ok';
    else if (type === 'err') hint.className = 'input-hint err';
    else hint.className = 'input-hint';
}

function showLoginHint(msg, type = 'err') {
    const hint = document.getElementById('login-hint');
    if (!hint) return;
    hint.textContent = msg || '';
    if (type === 'ok')  hint.className = 'input-hint ok';
    else if (type === 'err') hint.className = 'input-hint err';
    else hint.className = 'input-hint';
}


// -----------------------------------------------------------------------------
// BASCULEMENT INSCRIPTION / CONNEXION
// Gère les onglets en haut du formulaire. Réinitialise les messages d'erreur
// à chaque changement de panneau.
// -----------------------------------------------------------------------------
function switchAuth(panel) {
    document.querySelectorAll('.switch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.panel === panel);
    });
    document.querySelectorAll('.auth-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${panel}`);
    });
    showServerHint('');
    showLoginHint('');
}


// -----------------------------------------------------------------------------
// CONNEXION — Formulaire de connexion existant
// Envoie email + mot de passe au backend. En cas de succès, stocke les données
// de session et redirige vers le chat. En cas d'échec, affiche le message
// d'erreur retourné par le serveur.
// -----------------------------------------------------------------------------
async function submitLogin() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showLoginHint('Email et mot de passe requis.');
        return;
    }

    const btn      = document.getElementById('btn-login');
    const original = btn.innerHTML;
    btn.disabled   = true;
    btn.innerHTML  = 'Connexion...';

    try {
        const data = await apiRequest('/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (!data || !data.user) throw new Error('Connexion impossible.');

        // Stockage du token JWT et des données de session
        if (data.token) sessionStorage.setItem('tl_token', data.token);
        sessionStorage.setItem('tl_user_id', data.user.id);
        sessionStorage.setItem('tl_profile',  JSON.stringify(data.user));
        sessionStorage.setItem('tl_avatar',   data.user.avatar  || '');
        sessionStorage.setItem('tl_pseudo',   data.user.username || data.user.pseudo || '');

        showLoginHint('Connexion réussie. Redirection...', 'ok');
        window.location.href = 'chat.html';

    } catch (err) {
        showLoginHint(err.message || 'Erreur de connexion.');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = original;
    }
}


// -----------------------------------------------------------------------------
// INSCRIPTION — Soumission du formulaire complet
// Appelée au clic sur le bouton final de l'étape 3. Revalide tout avant d'envoyer
// pour éviter qu'une manipulation DOM contourne les vérifications temps réel.
// En cas de succès, le backend retourne l'utilisateur créé — on stocke la session
// et on redirige vers le chat.
// -----------------------------------------------------------------------------
async function submitProfile() {
    const pseudo       = document.getElementById('pseudo-input').value.trim();
    const profileCheck = validateProfileFields();

    // Revalidation défensive avant envoi.
    if (!selectedAvatar) {
        showServerHint('Choisis un avatar pour continuer.');
        goToStep(1);
        return;
    }
    if (!isPseudoValid(pseudo)) {
        showServerHint('Pseudo invalide. Vérifie la longueur.');
        goToStep(2);
        return;
    }
    if (!profileCheck.ok) {
        updateProfileHint(profileCheck);
        showServerHint("Complète tes informations avant d'entrer.");
        goToStep(2);
        return;
    }

    const btn      = document.getElementById('btn-enter');
    const original = btn.innerHTML;
    btn.disabled   = true;
    btn.innerHTML  = 'Création...';
    showServerHint('');

    try {
        const profile = getProfileData();
        const payload = {
            avatar:         selectedAvatar,
            username:       pseudo,
            firstName:      profile.firstName,
            lastName:       profile.lastName,
            email:          profile.email,
            emergencyName:  profile.emergencyName,
            emergencyPhone: profile.emergencyPhone,
            password:       profile.password
        };

        const data = await apiRequest('/register', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!data || !data.user) throw new Error('Création impossible.');

        // Stockage du token JWT et des données de session
        if (data.token) sessionStorage.setItem('tl_token', data.token);
        sessionStorage.setItem('tl_user_id', data.user.id);
        sessionStorage.setItem('tl_profile',  JSON.stringify(data.user));
        sessionStorage.setItem('tl_avatar',   data.user.avatar  || '');
        sessionStorage.setItem('tl_pseudo',   data.user.username || data.user.pseudo || '');

        showServerHint('Compte créé. Redirection...', 'ok');
        window.location.href = 'chat.html';

    } catch (err) {
        showServerHint(err.message || 'Erreur lors de la création.');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = original;
    }
}


// -----------------------------------------------------------------------------
// NAVIGATION ENTRE LES ÉTAPES DU FORMULAIRE
// Gère l'affichage des étapes, la mise à jour des indicateurs visuels (steps),
// et le pré-remplissage du récapitulatif à l'étape 3.
// -----------------------------------------------------------------------------
function goToStep(n) {
    const prev = currentStep;

    document.getElementById(`step-${prev}`).classList.remove('active');

    // Mise à jour de l'indicateur d'étape précédent.
    const prevIndicator = document.querySelector(`[data-step="${prev}"]`);
    prevIndicator.classList.remove('active');
    if (n > prev) prevIndicator.classList.add('done');
    else prevIndicator.classList.remove('done');

    // Affichage de la nouvelle étape.
    document.getElementById(`step-${n}`).classList.add('active');
    const nextIndicator = document.querySelector(`[data-step="${n}"]`);
    nextIndicator.classList.add('active');
    nextIndicator.classList.remove('done');

    // Mise à jour des lignes de progression entre les étapes.
    document.querySelectorAll('.step-line').forEach((line, i) => {
        line.classList.toggle('active', n > i + 1);
    });

    // À l'étape 3 (récapitulatif), on pré-remplit les champs de confirmation
    // avec les données saisies dans les étapes précédentes.
    if (n === 3) {
        const pseudo  = document.getElementById('pseudo-input').value.trim();
        const profile = getProfileData();

        document.getElementById('confirm-pseudo').textContent    = pseudo;
        document.getElementById('conf-pseudo-display').textContent = pseudo;
        document.getElementById('conf-fullname').textContent     = `${profile.firstName} ${profile.lastName}`.trim();
        document.getElementById('conf-email').textContent        = profile.email || '—';

        const emergencyParts = [profile.emergencyName, profile.emergencyPhone].filter(Boolean);
        document.getElementById('conf-emergency').textContent    = emergencyParts.length ? emergencyParts.join(' - ') : '—';

        // Scroll doux vers la card pour centrer le récap dans la vue
        requestAnimationFrame(() => {
            const card = document.querySelector('#step-3')?.closest('.form-card');
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    currentStep = n;
}


// -----------------------------------------------------------------------------
// DÉMARRAGE
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);