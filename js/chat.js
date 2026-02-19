// =============================================================================
// TRUST LAYER — chat.js
// Gestion du chat en temps réel, du bien-être, des ressources et de la sécurité
// frontend. Ce fichier s'attend à ce que le backend soit disponible via l'API
// définie dans API_BASE. Toutes les données affichées viennent du serveur.
// =============================================================================


// -----------------------------------------------------------------------------
// SECURITE — Échappement HTML
// Toute donnée utilisateur affichée dans le DOM passe par escHtml() pour
// neutraliser les tentatives d'injection XSS.
// -----------------------------------------------------------------------------

function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Supprime les balises HTML et tronque à 500 caractères.
// Retourne null si le message est vide ou trop long — le message ne sera pas envoyé.
function sanitizeMessage(text) {
    if (typeof text !== 'string') return null;
    const stripped = text.replace(/<[^>]*>/g, '');
    const trimmed  = stripped.trim().replace(/\s{3,}/g, '  ');
    if (trimmed.length === 0 || trimmed.length > 500) return null;
    return trimmed;
}

// Valide le format d'un pseudo : 3 à 20 caractères alphanumériques, accents et tirets acceptés.
function validatePseudo(pseudo) {
    if (typeof pseudo !== 'string') return false;
    return /^[\w\u00C0-\u017E\-]{3,20}$/.test(pseudo.trim());
}


// -----------------------------------------------------------------------------
// SECURITE — Rate limiting côté client
// Maximum 10 messages toutes les 30 secondes. Ce contrôle est complémentaire
// au rate limiting côté serveur — il ne s'y substitue pas.
// -----------------------------------------------------------------------------
const rateLimiter = {
    timestamps: [],
    MAX:    10,
    WINDOW: 30_000,

    check() {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < this.WINDOW);
        if (this.timestamps.length >= this.MAX) {
            const wait = Math.ceil((this.WINDOW - (now - this.timestamps[0])) / 1000);
            return { allowed: false, wait };
        }
        this.timestamps.push(now);
        return { allowed: true };
    }
};


// -----------------------------------------------------------------------------
// CONFIGURATION API
// L'URL de base de l'API backend. À adapter selon l'environnement de déploiement.
// Toutes les requêtes sont relatives à cette base.
// -----------------------------------------------------------------------------
const API_BASE = '/api';


// -----------------------------------------------------------------------------
// STOCKAGE DE SESSION
// Les données d'identité (userId, avatar, pseudo) sont stockées en sessionStorage
// pour la durée de la session. L'historique des humeurs utilise localStorage
// comme cache local en cas d'échec API — seuls le score et la date sont stockés,
// aucune information identifiante.
// -----------------------------------------------------------------------------
const secureStorage = {
    get(key) {
        try { return sessionStorage.getItem(key); } catch { return null; }
    },
    set(key, val) {
        try { sessionStorage.setItem(key, String(val)); } catch {}
    },
    getJson(key) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    },
    setJson(key, val) {
        try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {}
    },

    // Lit l'historique d'humeur depuis localStorage (cache anonyme local).
    getMoodHistory() {
        try { return JSON.parse(localStorage.getItem('tl_moods') || '[]'); }
        catch { return []; }
    },
    // Sauvegarde uniquement score + date — aucune donnée identifiante.
    saveMoodHistory(arr) {
        try {
            const safe = arr.map(e => ({ score: e.score, date: e.date }));
            localStorage.setItem('tl_moods', JSON.stringify(safe));
        } catch {}
    }
};


// -----------------------------------------------------------------------------
// ÉTAT GLOBAL DE LA SESSION
// Contient les informations de l'utilisateur connecté pour la durée de la page.
// onlineCount est initialisé à 0 — le vrai nombre viendra du backend via WebSocket
// ou polling.
// -----------------------------------------------------------------------------
const state = {
    userId:      parseInt(secureStorage.get('tl_user_id') || '0', 10) || null,
    avatar:      secureStorage.get('tl_avatar') || '',
    pseudo:      secureStorage.get('tl_pseudo') || '',
    firstName:   '',
    lastName:    '',
    mood:        5,
    moodHistory: secureStorage.getMoodHistory(),
    onlineCount: 0,
};

// Si aucun userId en session, l'utilisateur n'est pas authentifié — on le renvoie
// vers la page de connexion. Aucune donnée ne sera chargée.
if (!state.userId) {
    window.location.href = 'connexion.html';
}


// -----------------------------------------------------------------------------
// MOTS-CLÉS DE DÉTRESSE
// Si un message contient l'un de ces termes, le bandeau d'alerte de crise
// s'affiche automatiquement avec les contacts d'urgence. Le message est quand
// même envoyé — on ne bloque pas l'utilisateur.
// -----------------------------------------------------------------------------
const CRISIS_WORDS = [
    'suicide', 'suicider', 'mourir', 'me tuer', 'en finir',
    'plus envie de vivre', 'plus la force', 'tout arrêter',
    'automutilation', 'me faire mal', 'me blesser',
    'idées noires', 'souffrance insupportable',
    'je vais craquer', "je n'en peux plus"
];


// -----------------------------------------------------------------------------
// INITIALISATION AU CHARGEMENT DE LA PAGE
// L'ordre est important : d'abord le profil (pour avoir avatar/pseudo),
// puis l'interface, puis les données dynamiques (messages, humeurs).
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    if (!state.userId) return;

    await hydrateProfile();
    applyUserProfile();
    initMoodSlider();
    await loadMoodHistory();
    initInput();
    await loadMessages();
});


// -----------------------------------------------------------------------------
// REQUÊTE API — Wrapper générique
// Toutes les requêtes vers le backend passent par cette fonction.
// Elle centralise la gestion des erreurs HTTP et le parsing JSON.
// En cas d'erreur serveur, le message d'erreur vient du champ "error" retourné
// par l'API, ou d'un message générique si absent.
// -----------------------------------------------------------------------------
async function apiRequest(path, options = {}) {
    const opts = {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    };
    const res  = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data && data.error ? data.error : 'Erreur serveur.';
        throw new Error(msg);
    }
    return data;
}


// -----------------------------------------------------------------------------
// FORMATAGE DES DATES ET HEURES
// Utilisé pour afficher les timestamps des messages et de l'historique d'humeur.
// -----------------------------------------------------------------------------
function formatTime(ts) {
    if (!ts) return now();
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function now() {
    return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}


// -----------------------------------------------------------------------------
// PROFIL UTILISATEUR
// Au chargement, on tente d'abord de lire le profil depuis le cache sessionStorage
// pour éviter un écran blanc. En parallèle, on fait la requête API pour avoir
// les données à jour. Si l'API échoue et qu'il n'y a pas de cache, on redirige
// vers la connexion — la session est invalide.
// -----------------------------------------------------------------------------
function applyProfileData(user) {
    if (!user) return;
    state.avatar    = user.avatar    || state.avatar;
    state.pseudo    = user.pseudo    || state.pseudo;
    state.firstName = user.first_name || '';
    state.lastName  = user.last_name  || '';
}

async function hydrateProfile() {
    const cached = secureStorage.getJson('tl_profile');
    if (cached) applyProfileData(cached);

    try {
        const data = await apiRequest(`/profile/${state.userId}`);
        if (data && data.user) {
            applyProfileData(data.user);
            secureStorage.setJson('tl_profile', data.user);
        }
    } catch {
        // Si le cache local existe, on continue avec les données en mémoire.
        // Sinon la session est invalide — retour à la connexion.
        if (!cached) {
            window.location.href = 'connexion.html';
        }
    }
}

// Applique avatar et pseudo de l'utilisateur dans les éléments d'interface concernés.
function applyUserProfile() {
    document.getElementById('user-av').textContent   = state.avatar;
    document.getElementById('user-name').textContent = escHtml(state.pseudo);
    document.getElementById('input-av').textContent  = state.avatar;
}


// -----------------------------------------------------------------------------
// CHARGEMENT DES MESSAGES
// Récupère les 50 derniers messages depuis l'API et les insère dans le DOM.
// Les messages démo éventuellement présents dans le HTML sont supprimés avant
// l'insertion pour éviter les doublons.
// -----------------------------------------------------------------------------
async function loadMessages() {
    const wrap = document.getElementById('messages-wrap');

    // Supprime les éventuels messages statiques présents dans le HTML.
    wrap.querySelectorAll('.msg-row').forEach(row => row.remove());

    try {
        const data = await apiRequest('/messages?limit=50');
        if (data && Array.isArray(data.messages)) {
            data.messages.forEach(m => {
                appendMessage({
                    av:    m.avatar,
                    name:  m.pseudo,
                    text:  m.content,
                    isOwn: m.user_id === state.userId,
                    time:  formatTime(m.created_at)
                });
            });
        }
    } catch (err) {
        console.warn('Chargement des messages impossible :', err.message);
    }
}


// -----------------------------------------------------------------------------
// BIEN-ÊTRE — Slider d'humeur
// L'utilisateur note son humeur de 1 à 10. Le dégradé du slider se met à jour
// visuellement en temps réel pour refléter la valeur choisie.
// -----------------------------------------------------------------------------
function initMoodSlider() {
    const slider = document.getElementById('mood-slider');
    const val    = document.getElementById('mood-value');

    slider.addEventListener('input', () => {
        const safe = Math.min(10, Math.max(1, parseInt(slider.value) || 5));
        slider.value    = safe;
        val.textContent = safe;
        state.mood      = safe;

        const pct = ((safe - 1) / 9) * 100;
        slider.style.background = `linear-gradient(to right,
            #8B6FD4 0%, #8B6FD4 ${pct}%,
            rgba(255,255,255,0.15) ${pct}%, rgba(255,255,255,0.15) 100%)`;
    });
}

// Envoie le score d'humeur au backend, puis recharge l'historique.
// En cas d'échec API, un message d'erreur s'affiche dans la barre de saisie.
async function saveMood() {
    const score = Math.min(10, Math.max(1,
        parseInt(document.getElementById('mood-slider').value) || 5));

    try {
        await apiRequest('/moods', {
            method: 'POST',
            body: JSON.stringify({ user_id: state.userId, score })
        });
        await loadMoodHistory();
        flashSaved();
    } catch {
        showInputError("Impossible d'enregistrer l'humeur.");
    }
}

// Récupère l'historique des humeurs depuis l'API.
// Si l'API est indisponible, utilise le cache local localStorage comme fallback.
async function loadMoodHistory() {
    try {
        const data = await apiRequest(`/moods/${state.userId}`);
        if (data && Array.isArray(data.moods)) {
            state.moodHistory = data.moods;
            renderMoodHistory();
            return;
        }
    } catch {}

    // Fallback sur le cache local si l'API ne répond pas.
    state.moodHistory = secureStorage.getMoodHistory();
    renderMoodHistory();
}

// Affiche les 5 dernières entrées d'humeur sous le slider.
function renderMoodHistory() {
    const container = document.getElementById('mood-history');
    container.innerHTML = '';

    state.moodHistory.slice(0, 5).forEach(entry => {
        const emoji = entry.score >= 7 ? '😊' : entry.score >= 4 ? '😐' : '😢';
        const tag   = document.createElement('div');
        tag.className   = 'mood-tag';
        const dateLabel = entry.date || formatDate(entry.created_at);
        tag.textContent = `${emoji} ${entry.score}/10 · ${escHtml(dateLabel)}`;
        container.appendChild(tag);
    });
}

// Retour visuel sur le bouton "Enregistrer" après sauvegarde réussie.
function flashSaved() {
    const btn  = document.getElementById('save-mood');
    const orig = btn.textContent;
    btn.textContent      = 'Enregistre !';
    btn.style.background = '#4CAF50';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
}

function toggleWellbeingInfo() {
    document.getElementById('wellbeing-info').classList.toggle('show');
}


// -----------------------------------------------------------------------------
// SAISIE ET ENVOI DE MESSAGES
// La zone de texte s'auto-dimensionne et est limitée à 500 caractères.
// Entrée seule = envoi, Shift+Entrée = saut de ligne.
// -----------------------------------------------------------------------------
function initInput() {
    const input = document.getElementById('msg-input');

    input.addEventListener('input', () => {
        if (input.value.length > 500) input.value = input.value.substring(0, 500);
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// Pipeline complet d'envoi d'un message :
// 1. Contrôle du rate limiting
// 2. Sanitisation et validation du contenu
// 3. Détection de mots-clés de crise
// 4. Envoi à l'API
// 5. Insertion du message retourné dans le DOM
async function sendMessage() {
    const input = document.getElementById('msg-input');

    // Étape 1 — Vérification du rate limit.
    const limit = rateLimiter.check();
    if (!limit.allowed) {
        showRateLimitWarning(limit.wait);
        return;
    }

    // Étape 2 — Nettoyage et validation du texte.
    const text = sanitizeMessage(input.value);
    if (!text) {
        showInputError('Message vide ou trop long (500 caractères max).');
        return;
    }

    // Étape 3 — Détection de détresse. Le bandeau s'affiche mais le message
    // est quand même transmis — l'utilisateur n'est pas bloqué.
    if (CRISIS_WORDS.some(kw => text.toLowerCase().includes(kw.toLowerCase()))) {
        showCrisisAlert();
    }

    input.value        = '';
    input.style.height = 'auto';

    // Étape 4 — Envoi à l'API et insertion de la réponse dans le DOM.
    try {
        const data = await apiRequest('/messages', {
            method: 'POST',
            body: JSON.stringify({ user_id: state.userId, content: text })
        });

        if (data && data.message) {
            appendMessage({
                av:    data.message.avatar,
                name:  data.message.pseudo,
                text:  data.message.content,
                isOwn: true,
                time:  formatTime(data.message.created_at)
            });
        }
    } catch {
        showInputError("Impossible d'envoyer le message.");
    }
}

// Crée et insère un bloc message dans la zone de chat.
// Tout contenu venant du serveur est échappé avant insertion — protection XSS.
function appendMessage({ av, name, text, isOwn, time }) {
    const wrap = document.getElementById('messages-wrap');
    const row  = document.createElement('div');
    row.className = `msg-row${isOwn ? ' own' : ''}`;

    row.innerHTML = `
        <div class="msg-av-wrap">${escHtml(av)}</div>
        <div class="msg-body">
            <div class="msg-meta">
                <span class="msg-author">${escHtml(name)}</span>
                <span class="msg-time">${escHtml(time)}</span>
            </div>
            <div class="msg-bubble">${escHtml(text)}</div>
            <div class="msg-actions">
                <button class="react-btn" onclick="reactMsg(this)">🤍</button>
                <button class="report-btn" title="Signaler">⋯</button>
            </div>
        </div>`;

    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
}


// -----------------------------------------------------------------------------
// RETOURS VISUELS — Messages d'erreur et avertissements
// -----------------------------------------------------------------------------

// Affiche un avertissement de rate limit dans la barre d'info.
// Le message disparaît automatiquement au bout du délai d'attente.
function showRateLimitWarning(secondsLeft) {
    const hint = document.querySelector('.input-hint-bar');
    const orig = hint.innerHTML;
    hint.innerHTML   = `Trop de messages — attends ${secondsLeft}s`;
    hint.style.color = '#E07040';
    setTimeout(() => { hint.innerHTML = orig; hint.style.color = ''; }, secondsLeft * 1000);
}

// Affiche un message d'erreur temporaire dans la barre d'info (3 secondes).
function showInputError(msg) {
    const hint = document.querySelector('.input-hint-bar');
    const orig = hint.innerHTML;
    hint.innerHTML   = escHtml(msg);
    hint.style.color = '#E07040';
    setTimeout(() => { hint.innerHTML = orig; hint.style.color = ''; }, 3000);
}

// Bascule l'état "aimé" d'un message.
// Note : la persistance des réactions sera gérée par l'API (à implémenter).
function reactMsg(btn) {
    btn.classList.toggle('liked');
    btn.textContent = btn.classList.contains('liked') ? '💜' : '🤍';
}


// -----------------------------------------------------------------------------
// ALERTE DE CRISE
// S'affiche quand un mot-clé de détresse est détecté dans un message.
// L'utilisateur peut la fermer manuellement.
// -----------------------------------------------------------------------------
function showCrisisAlert() {
    document.getElementById('crisis-alert').classList.add('show');
    document.getElementById('messages-wrap').scrollTop = 0;
}

function closeCrisisAlert() {
    document.getElementById('crisis-alert').classList.remove('show');
}


// -----------------------------------------------------------------------------
// PANNEAU DE RESSOURCES
// Contenu statique organisé en trois panneaux : respiration, conseils, urgences.
// La clé passée à openPanel() est validée contre une liste blanche pour éviter
// toute injection de contenu arbitraire.
// -----------------------------------------------------------------------------
const PANELS = {
    breathing: {
        title: 'Exercice de respiration',
        html: `
            <p class="rp-intro">La cohérence cardiaque est l'une des techniques les plus efficaces contre le stress. Pratique-la 3 minutes quand tu te sens débordé(e).</p>
            <div class="breathing-timer">
                <div class="breathing-circle" id="breath-circle">Clique pour commencer</div>
                <button class="start-breathing" onclick="startBreathing()">Commencer</button>
            </div>
            <div class="rp-step"><div class="rp-step-num">1</div><p><strong>Inspire</strong> lentement par le nez pendant 4 secondes.</p></div>
            <div class="rp-step"><div class="rp-step-num">2</div><p><strong>Retiens</strong> ta respiration pendant 2 secondes.</p></div>
            <div class="rp-step"><div class="rp-step-num">3</div><p><strong>Expire</strong> lentement par la bouche pendant 6 secondes.</p></div>
            <div class="rp-step"><div class="rp-step-num">4</div><p><strong>Répète</strong> 6 à 10 fois.</p></div>`
    },
    conseils: {
        title: 'Conseils bien-être',
        html: `
            <p class="rp-intro">Des conseils courts et pratiques pour prendre soin de toi au quotidien.</p>
            <div class="conseil-card"><h4>Face au stress des examens</h4><p>Sessions de 25 min + 5 min de pause (Pomodoro). Plus efficace, moins épuisant.</p></div>
            <div class="conseil-card"><h4>Le sommeil, c'est sacré</h4><p>7 à 8 heures de sommeil améliorent les performances académiques.</p></div>
            <div class="conseil-card"><h4>Bouger, même un peu</h4><p>20 min de marche libèrent des endorphines et réduisent le stress.</p></div>
            <div class="conseil-card"><h4>Déconnecte avant de dormir</h4><p>30 min sans téléphone avant de dormir améliore la qualité du sommeil.</p></div>
            <div class="conseil-card"><h4>Écris ce que tu ressens</h4><p>5 lignes par jour dans un journal aide à libérer les émotions.</p></div>
            <div class="conseil-card"><h4>Demander de l'aide, c'est courageux</h4><p>Parler à quelqu'un de confiance est une force, pas une faiblesse.</p></div>`
    },
    urgence: {
        title: "Contacts d'urgence",
        html: `
            <p class="rp-intro">Si tu traverses une période très difficile, des personnes formées sont disponibles pour t'aider.</p>
            <div class="urgence-card red"><h4>Urgences sanitaires et sécuritaires — Bénin</h4><span class="urgence-num">166</span><p>Numéro national d'urgence béninois. Disponible 24h/24, 7j/7.</p></div>
            <div class="urgence-card blue"><h4>SAMU — Cotonou</h4><span class="urgence-num">51 04 00 00</span><p>Service d'aide médicale urgente. Pour toute urgence médicale grave.</p></div>
            <div class="urgence-card blue"><h4>Centre Psychiatrique de Jacquot — Cotonou</h4><span class="urgence-num">21 30 10 44</span><p>Centre spécialisé en santé mentale. Pour une orientation ou un soutien psychologique.</p></div>
            <div class="urgence-card blue"><h4>Pompiers</h4><span class="urgence-num">118</span><p>Pour toute situation de péril ou accident nécessitant une intervention rapide.</p></div>
            <div class="urgence-card blue"><h4>Police Secours</h4><span class="urgence-num">117</span><p>En cas de danger, d'agression ou de menace pour ta sécurité.</p></div>
            <div class="conseil-card" style="margin-top:1rem"><h4>N'oublie pas</h4><p>Tu peux aussi continuer à parler ici — la communauté est là pour toi.</p></div>`
    }
};

// Ouvre le panneau correspondant à la clé fournie.
// La clé est validée contre la liste blanche ALLOWED pour éviter tout abus.
function openPanel(key) {
    const ALLOWED = ['breathing', 'conseils', 'urgence'];
    if (!ALLOWED.includes(key)) return;

    const panel = PANELS[key];
    document.getElementById('rp-title').textContent   = panel.title;
    document.getElementById('rp-content').innerHTML   = panel.html; // HTML statique — sûr
    document.getElementById('resource-panel').classList.add('open');
    document.getElementById('resource-overlay').classList.add('show');
}

function closePanel() {
    document.getElementById('resource-panel').classList.remove('open');
    document.getElementById('resource-overlay').classList.remove('show');
    stopBreathing();
}


// -----------------------------------------------------------------------------
// EXERCICE DE RESPIRATION INTERACTIF
// Cycle en 3 phases : inspire (4s) — retiens (2s) — expire (6s).
// Le timer est stocké pour pouvoir être annulé proprement à la fermeture du panneau.
// -----------------------------------------------------------------------------
let breathingTimer = null;

const BREATH_PHASES = [
    { label: 'Inspire...', duration: 4000, cls: 'inhale' },
    { label: 'Retiens...', duration: 2000, cls: 'hold'   },
    { label: 'Expire...',  duration: 6000, cls: 'exhale' },
];

function startBreathing() {
    stopBreathing();
    runBreathPhase(0);
}

function runBreathPhase(i) {
    const phase  = BREATH_PHASES[i % 3];
    const circle = document.getElementById('breath-circle');
    if (!circle) return;

    circle.textContent = phase.label;
    circle.className   = `breathing-circle ${phase.cls}`;
    breathingTimer = setTimeout(() => runBreathPhase(i + 1), phase.duration);
}

function stopBreathing() {
    if (breathingTimer) {
        clearTimeout(breathingTimer);
        breathingTimer = null;
    }
}


// -----------------------------------------------------------------------------
// SIDEBAR MOBILE
// Sur petits écrans, la sidebar est masquée par défaut et s'ouvre via le bouton
// menu. Un overlay sombre ferme la sidebar si on clique en dehors.
// -----------------------------------------------------------------------------
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
}
