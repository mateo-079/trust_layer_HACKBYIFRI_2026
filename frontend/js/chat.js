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
const API_BASE = 'http://localhost:3000/api';

// -----------------------------------------------------------------------------
// WEBSOCKET — Socket.io
// Connexion persistante au serveur pour recevoir les messages en temps réel.
// Le token JWT est envoyé à la connexion pour s'authentifier.
// -----------------------------------------------------------------------------
const SOCKET_URL = 'http://localhost:3000';
let socket = null;

function initSocket() {
    // Guard : ne pas créer une deuxième connexion si déjà connecté
    if (socket && socket.connected) return;

    const token = sessionStorage.getItem('tl_token');
    if (!token) return;

    // Connexion avec le token JWT pour authentification WebSocket
    // forceNew: false  → empêche de créer plusieurs connexions si initSocket() est appelé plusieurs fois
    // transports websocket uniquement → évite les reconnexions multiples polling+websocket
    socket = io(SOCKET_URL, {
        auth:      { token },
        transports: ['websocket'],
        forceNew:  false,
        reconnection:         true,
        reconnectionDelay:    2000,
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log('WebSocket connecté :', socket.id);
        // Initialiser le badge immédiatement — on est au moins 1 connecté
        const badge = document.getElementById('online-count');
        if (badge && badge.textContent === '—') badge.textContent = '1';
    });

    socket.on('disconnect', (reason) => {
        console.warn('WebSocket déconnecté :', reason);
    });

    socket.on('connect_error', (err) => {
        console.warn('Erreur WebSocket :', err.message);
    });

    // ── Nouveau message reçu en temps réel ─────────────────────────────────────
    // Tous les clients reçoivent cet événement quand quelqu'un envoie un message.
    // Reçoit tous les messages (y compris les siens) et les affiche.
    socket.on('new_message', (message) => {
        appendMessage({
            id:    message.id,
            av:    message.avatar,
            name:  message.username,
            text:  message.content,
            isOwn: message.user_id === state.userId,
            time:  formatTime(message.created_at),
        });
    });

    // ── Compteur d'utilisateurs en ligne ───────────────────────────────────────
    socket.on('online_count', (count) => {
        // Badge dans la nav (sidebar)
        const badge = document.getElementById('online-count');
        if (badge) badge.textContent = count;

        // Texte sous le titre du salon
        const header = document.getElementById('header-count');
        if (header) header.textContent = `${count} étudiant(e)s en ligne`;
    });

    // ── Mise à jour des réactions ──────────────────────────────────────────────
    socket.on('reaction_update', ({ messageId, count }) => {
        const row = document.querySelector(`.msg-row[data-message-id="${messageId}"]`);
        if (!row) return;
        const counter = row.querySelector('.react-count');
        if (counter) counter.textContent = count > 0 ? count : '';
    });

    // ── Indicateur "est en train d'écrire" ─────────────────────────────────────
    let typingTimeout = null;
    socket.on('user_typing', ({ username }) => {
        const bar = document.querySelector('.input-hint-bar');
        if (bar) bar.textContent = `${username} est en train d'écrire...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (bar) bar.textContent = `Anonyme · Respecte les autres · En cas d'urgence : 166 · SAMU : 13`;
        }, 2000);
    });

    socket.on('user_stop_typing', () => {
        clearTimeout(typingTimeout);
        const bar = document.querySelector('.input-hint-bar');
        if (bar) bar.textContent = `Anonyme · Respecte les autres · En cas d'urgence : 166 · SAMU : 13`;
    });

    // ── Message supprimé ───────────────────────────────────────────────────────
    socket.on('message_deleted', ({ messageId }) => {
        const row = document.querySelector(`.msg-row[data-message-id="${messageId}"]`);
        if (row) row.remove();
    });
}



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
    initSocket(); // Connexion WebSocket après chargement initial
});


// -----------------------------------------------------------------------------
// REQUÊTE API — Wrapper générique
// Toutes les requêtes vers le backend passent par cette fonction.
// Elle centralise la gestion des erreurs HTTP et le parsing JSON.
// En cas d'erreur serveur, le message d'erreur vient du champ "error" retourné
// par l'API, ou d'un message générique si absent.
// -----------------------------------------------------------------------------
async function apiRequest(path, options = {}) {
    // Recupere le token JWT stocke lors de la connexion
    const token = sessionStorage.getItem('tl_token');

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const opts = { ...options, headers };
    const res  = await fetch(`${API_BASE}${path}`, opts);

    // Token expire ou invalide -> retour connexion
    if (res.status === 401) {
        sessionStorage.clear();
        window.location.href = 'connexion.html';
        return {};
    }

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
    state.pseudo    = user.username  || state.pseudo;
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
                    name:  m.username,
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

        // Couleur active qui évolue selon l'humeur :
        // 1-3 → orange (difficulté)  4-6 → bleu (neutre)  7-10 → vert (bien)
        const activeColor = safe <= 3 ? '#F4A261'
                          : safe <= 6 ? '#4A7FC1'
                          :             '#4CAF50';

        const pct = ((safe - 1) / 9) * 100;
        slider.style.background = `linear-gradient(to right,
            ${activeColor} 0%, ${activeColor} ${pct}%,
            rgba(255,255,255,0.15) ${pct}%, rgba(255,255,255,0.15) 100%)`;
    });

    // Initialiser le dégradé au chargement avec la valeur par défaut (5)
    slider.dispatchEvent(new Event('input'));
}

// Envoie le score d'humeur au backend, puis recharge l'historique.
// En cas d'échec API, un message d'erreur s'affiche dans la barre de saisie.
async function saveMood() {
    const score = Math.min(10, Math.max(1,
        parseInt(document.getElementById('mood-slider').value) || 5));

    try {
        await apiRequest('/moods', {
            method: 'POST',
            body: JSON.stringify({ score })
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

    // On n'affiche que la dernière entrée — juste un flash de confirmation
    const last = state.moodHistory[0];
    if (!last) return;

    const emoji = last.score >= 7 ? '😊' : last.score >= 4 ? '😐' : '😢';
    const tag   = document.createElement('div');
    tag.className   = 'mood-tag mood-tag-flash';
    tag.textContent = `${emoji} ${last.score}/10 enregistré`;
    container.appendChild(tag);

    // Disparaît après 3 secondes avec un fade-out
    setTimeout(() => {
        tag.classList.add('mood-tag-fade');
        setTimeout(() => { container.innerHTML = ''; }, 600);
    }, 3000);
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

    // Délai pour éviter d'émettre typing à chaque frappe
    let typingEmitTimeout = null;

    input.addEventListener('input', () => {
        if (input.value.length > 500) input.value = input.value.substring(0, 500);
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';

        // Émet 'typing' via WebSocket (avec debounce 300ms)
        if (socket?.connected) {
            clearTimeout(typingEmitTimeout);
            socket.emit('typing');
            typingEmitTimeout = setTimeout(() => socket.emit('stop_typing'), 1500);
        }
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
            body: JSON.stringify({ content: text })
        });

        // Le message sera affiché par le WebSocket (new_message)
        // qui le diffuse à tous les connectés, y compris l'expéditeur.
        // On n'affiche rien ici pour éviter les doublons.
    } catch {
        showInputError("Impossible d'envoyer le message.");
    }
}

// Crée et insère un bloc message dans la zone de chat.
// Tout contenu venant du serveur est échappé avant insertion — protection XSS.
function appendMessage({ id, av, name, text, isOwn, time }) {
    const wrap = document.getElementById('messages-wrap');
    const row  = document.createElement('div');
    row.className = `msg-row${isOwn ? ' own' : ''}`;
    if (id) row.dataset.messageId = id;

    // Menu contextuel — différent selon si c'est son propre message
    const menuItems = isOwn
        ? `<button class="msg-menu-item danger" onclick="deleteMsg(this)">🗑️ Supprimer</button>`
        : `<button class="msg-menu-item danger" onclick="openReportModal(this)">🚩 Signaler ce message</button>`;

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
                <span class="react-count"></span>
                <button class="report-btn" onclick="toggleMsgMenu(this)" title="Options">⋯</button>
                <div class="msg-menu">
                    ${menuItems}
                </div>
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
async function reactMsg(btn) {
    // Récupère le messageId stocké dans le data-attribute du bouton
    const messageId = btn.closest('.msg-row')?.dataset.messageId;
    if (!messageId) return;

    // Optimistic UI : on change l'icône immédiatement sans attendre l'API
    const wasLiked = btn.classList.contains('liked');
    btn.classList.toggle('liked');
    btn.textContent = btn.classList.contains('liked') ? '💜' : '🤍';

    try {
        const data = await apiRequest(`/messages/${messageId}/react`, { method: 'POST' });
        // Met à jour le compteur si présent
        const counter = btn.closest('.msg-actions')?.querySelector('.react-count');
        if (counter && data.count !== undefined) counter.textContent = data.count > 0 ? data.count : '';
    } catch {
        // Rollback si l'API échoue
        btn.classList.toggle('liked');
        btn.textContent = wasLiked ? '💜' : '🤍';
    }
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
    humeur: {
        title: 'Mon évolution d\'humeur',
        html: `
            <p class="rp-intro">Visualise comment ton humeur évolue dans le temps. Chaque point représente une entrée que tu as enregistrée.</p>

            <div class="mood-chart-controls">
                <button class="mood-period-btn active" data-days="7" onclick="switchMoodPeriod(7, this)">7 jours</button>
                <button class="mood-period-btn" data-days="30" onclick="switchMoodPeriod(30, this)">30 jours</button>
            </div>

            <div class="mood-chart-wrap">
                <svg id="mood-svg" width="100%" height="200" viewBox="0 0 320 200" preserveAspectRatio="none"></svg>
                <div class="mood-chart-empty" id="mood-chart-empty" style="display:none">
                    <span>📊</span>
                    <p>Pas encore assez de données.<br>Continue à noter ton humeur !</p>
                </div>
            </div>

            <div class="mood-chart-legend">
                <span class="legend-item bad">😢 1–3</span>
                <span class="legend-item mid">😐 4–6</span>
                <span class="legend-item good">😊 7–10</span>
            </div>

            <div class="mood-stats" id="mood-stats"></div>

            <div class="mood-entries-list" id="mood-entries-list"></div>`
    },
    urgence: {
        title: "Contacts d'urgence",
        html: `
            <p class="rp-intro">Si tu traverses une période très difficile, des personnes formées sont disponibles pour t'aider. Ces numéros sont gratuits et disponibles 24h/24.</p>

            <div class="urgence-section-title red">🔴 Urgences vitales</div>

            <div class="urgence-card red">
                <div class="urgence-header">
                    <span class="urgence-icon">🚨</span>
                    <h4>Numéro d'Urgence National</h4>
                </div>
                <a class="urgence-num" href="tel:166">166</a>
                <p>Numéro unique au Bénin — gratuit, disponible 24h/24, 7j/7.</p>
            </div>

            <div class="urgence-card red">
                <div class="urgence-header">
                    <span class="urgence-icon">🏥</span>
                    <h4>SAMU</h4>
                </div>
                <a class="urgence-num" href="tel:+22901683000 00">+229 01 68 30 00 00</a>
                <p>Urgences médicales et psychiatriques.</p>
            </div>

            <div class="urgence-section-title blue">🔵 Sécurité</div>

            <div class="urgence-card blue">
                <div class="urgence-header">
                    <span class="urgence-icon">🚔</span>
                    <h4>Police Secours</h4>
                </div>
                <a class="urgence-num" href="tel:117">117</a>
                <p>En cas de danger, d'agression ou de menace pour ta sécurité.</p>
            </div>

            <div class="urgence-card blue">
                <div class="urgence-header">
                    <span class="urgence-icon">🚒</span>
                    <h4>Sapeurs-Pompiers</h4>
                </div>
                <a class="urgence-num" href="tel:118">118</a>
                <p>Incendie, accident, situation de péril.</p>
            </div>

            <div class="urgence-section-title green">🟢 Ressources locales</div>

            <div class="urgence-card green">
                <div class="urgence-header">
                    <span class="urgence-icon">🏨</span>
                    <h4>CNHU Cotonou</h4>
                </div>
                <a class="urgence-num" href="tel:+22901213006 56">+229 01 21 30 06 56</a>
                <p>Centre National Hospitalier et Universitaire — urgences 24h/24.</p>
            </div>

            <div class="urgence-card green">
                <div class="urgence-header">
                    <span class="urgence-icon">🎓</span>
                    <h4>Cellule d'écoute UAC</h4>
                </div>
                <a class="urgence-num" href="tel:+22902213600 74">+229 02 21 36 00 74</a>
                <p>Soutien psychologique à l'Université d'Abomey-Calavi — spécifique aux étudiant(e)s.</p>
            </div>`
    }
};

// Ouvre le panneau correspondant à la clé fournie.
// La clé est validée contre la liste blanche ALLOWED pour éviter tout abus.
function openPanel(key) {
    const ALLOWED = ['breathing', 'conseils', 'urgence', 'humeur'];
    if (!ALLOWED.includes(key)) return;

    stopBreathing();

    const panel   = PANELS[key];
    const content = document.getElementById('rp-content');
    content.innerHTML = '';

    document.getElementById('rp-title').textContent = panel.title;
    content.innerHTML = panel.html;

    document.getElementById('resource-panel').classList.add('open');
    document.getElementById('resource-overlay').classList.add('show');

    // Initialiser le graphique après injection du HTML
    if (key === 'humeur') initMoodChart();
}

function closePanel() {
    document.getElementById('resource-panel').classList.remove('open');
    document.getElementById('resource-overlay').classList.remove('show');
    stopBreathing();
}


// -----------------------------------------------------------------------------
// GRAPHIQUE D'HUMEUR
// Courbe SVG dessinée en JS pur — pas de librairie externe.
// Points colorés selon le score (rouge/bleu/vert) + courbe lissée + stats.
// -----------------------------------------------------------------------------
let moodChartDays = 7; // période active

function initMoodChart() {
    moodChartDays = 7;
    renderMoodChart();
}

function switchMoodPeriod(days, btn) {
    moodChartDays = days;
    document.querySelectorAll('.mood-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderMoodChart();
}

function renderMoodChart() {
    const svg       = document.getElementById('mood-svg');
    const emptyMsg  = document.getElementById('mood-chart-empty');
    const statsCont = document.getElementById('mood-stats');
    const listCont  = document.getElementById('mood-entries-list');
    if (!svg) return;

    // Filtrer les entrées selon la période choisie
    const cutoff = Date.now() - moodChartDays * 24 * 60 * 60 * 1000;
    const entries = (state.moodHistory || [])
        .filter(e => new Date(e.created_at || e.date).getTime() >= cutoff)
        .sort((a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date));

    svg.innerHTML = '';

    if (entries.length < 2) {
        svg.style.display  = 'none';
        emptyMsg.style.display = 'flex';
        statsCont.innerHTML = '';
        listCont.innerHTML  = '';
        return;
    }

    svg.style.display  = 'block';
    emptyMsg.style.display = 'none';

    // Dimensions SVG (viewBox 320×200)
    const W = 320, H = 200;
    const padL = 28, padR = 12, padT = 16, padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Couleur selon le score
    const scoreColor = s => s <= 3 ? '#F4A261' : s <= 6 ? '#4A7FC1' : '#4CAF50';

    // Coordonnées de chaque point
    const pts = entries.map((e, i) => ({
        x: padL + (i / (entries.length - 1)) * chartW,
        y: padT + chartH - ((e.score - 1) / 9) * chartH,
        score: e.score,
        date: e.created_at || e.date,
    }));

    // ── Zones colorées de fond (1-3 / 4-6 / 7-10) ──────────────────────────
    const zones = [
        { yTop: padT,                                  yBot: padT + chartH * (3/9), fill: 'rgba(76,175,80,0.06)'  }, // 7-10
        { yTop: padT + chartH * (3/9),                yBot: padT + chartH * (6/9), fill: 'rgba(74,127,193,0.06)' }, // 4-6
        { yTop: padT + chartH * (6/9),                yBot: padT + chartH,         fill: 'rgba(244,162,97,0.06)'  }, // 1-3
    ];
    zones.forEach(z => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', padL);
        rect.setAttribute('y', z.yTop);
        rect.setAttribute('width', chartW);
        rect.setAttribute('height', z.yBot - z.yTop);
        rect.setAttribute('fill', z.fill);
        svg.appendChild(rect);
    });

    // ── Lignes de grille horizontales (niveaux 2, 5, 8) ─────────────────────
    [2, 5, 8].forEach(lvl => {
        const y = padT + chartH - ((lvl - 1) / 9) * chartH;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
        line.setAttribute('y1', y);    line.setAttribute('y2', y);
        line.setAttribute('stroke', 'rgba(15,29,46,0.07)');
        line.setAttribute('stroke-dasharray', '3,3');
        svg.appendChild(line);

        // Label gauche
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', padL - 4); txt.setAttribute('y', y + 4);
        txt.setAttribute('text-anchor', 'end');
        txt.setAttribute('font-size', '9');
        txt.setAttribute('fill', '#6A8CAA');
        txt.textContent = lvl;
        svg.appendChild(txt);
    });

    // ── Courbe lissée (cubic bezier) ─────────────────────────────────────────
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
        const cp1x = (pts[i-1].x + pts[i].x) / 2;
        d += ` C ${cp1x} ${pts[i-1].y}, ${cp1x} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
    }

    // Zone remplie sous la courbe
    const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fillPath.setAttribute('d', d + ` L ${pts[pts.length-1].x} ${padT+chartH} L ${pts[0].x} ${padT+chartH} Z`);
    fillPath.setAttribute('fill', 'rgba(74,127,193,0.08)');
    svg.appendChild(fillPath);

    // Ligne de la courbe
    const curvePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    curvePath.setAttribute('d', d);
    curvePath.setAttribute('fill', 'none');
    curvePath.setAttribute('stroke', '#4A7FC1');
    curvePath.setAttribute('stroke-width', '2');
    curvePath.setAttribute('stroke-linecap', 'round');
    svg.appendChild(curvePath);

    // ── Points colorés ───────────────────────────────────────────────────────
    pts.forEach(pt => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pt.x);
        circle.setAttribute('cy', pt.y);
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', scoreColor(pt.score));
        circle.setAttribute('stroke', 'white');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
    });

    // ── Étiquettes de dates (première et dernière) ───────────────────────────
    [[pts[0], 'start'], [pts[pts.length-1], 'end']].forEach(([pt, anchor]) => {
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('x', pt.x);
        lbl.setAttribute('y', H - 4);
        lbl.setAttribute('text-anchor', anchor === 'start' ? 'start' : 'end');
        lbl.setAttribute('font-size', '9');
        lbl.setAttribute('fill', '#6A8CAA');
        lbl.textContent = new Date(pt.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
        svg.appendChild(lbl);
    });

    // ── Statistiques ─────────────────────────────────────────────────────────
    const scores  = entries.map(e => e.score);
    const avg     = (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1);
    const min     = Math.min(...scores);
    const max     = Math.max(...scores);
    const trend   = scores[scores.length-1] - scores[0];
    const trendTxt = trend > 0 ? `↑ +${trend}` : trend < 0 ? `↓ ${trend}` : '→ stable';
    const trendCls = trend > 0 ? 'good' : trend < 0 ? 'bad' : 'mid';

    statsCont.innerHTML = `
        <div class="mood-stat"><span class="stat-label">Moyenne</span><span class="stat-val">${avg}/10</span></div>
        <div class="mood-stat"><span class="stat-label">Min</span><span class="stat-val bad-text">${min}/10</span></div>
        <div class="mood-stat"><span class="stat-label">Max</span><span class="stat-val good-text">${max}/10</span></div>
        <div class="mood-stat"><span class="stat-label">Tendance</span><span class="stat-val ${trendCls}-text">${trendTxt}</span></div>`;

    // ── Liste des 5 dernières entrées ─────────────────────────────────────────
    const recent = [...entries].reverse().slice(0, 5);
    listCont.innerHTML = `<div class="mood-entries-title">Dernières entrées</div>` +
        recent.map(e => {
            const emoji = e.score >= 7 ? '😊' : e.score >= 4 ? '😐' : '😢';
            const d     = new Date(e.created_at || e.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
            return `<div class="mood-entry-row">
                <span class="entry-emoji">${emoji}</span>
                <span class="entry-score" style="color:${scoreColor(e.score)}">${e.score}/10</span>
                <span class="entry-date">${d}</span>
            </div>`;
        }).join('');
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

// -----------------------------------------------------------------------------
// DÉCONNEXION
// Efface la session et redirige vers la page de connexion.
// -----------------------------------------------------------------------------
function logout() {
    sessionStorage.clear();
    localStorage.removeItem('tl_token');
    localStorage.removeItem('tl_user_id');
    window.location.href = 'connexion.html';
}


// -----------------------------------------------------------------------------
// MENU CONTEXTUEL DES MESSAGES
// Ouverture/fermeture du menu ⋯ sous chaque message.
// Un seul menu peut être ouvert à la fois.
// -----------------------------------------------------------------------------
function toggleMsgMenu(btn) {
    const menu = btn.nextElementSibling;
    const isOpen = menu.classList.contains('open');

    // Fermer tous les menus ouverts
    document.querySelectorAll('.msg-menu.open').forEach(m => m.classList.remove('open'));

    if (!isOpen) {
        menu.classList.add('open');

        // Fermer au clic ailleurs dans la page
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target) && e.target !== btn) {
                    menu.classList.remove('open');
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 10);
    }
}


// -----------------------------------------------------------------------------
// SUPPRESSION D'UN MESSAGE (propre)
// Soft delete — le message est masqué côté client, supprimé en base via l'API.
// -----------------------------------------------------------------------------
async function deleteMsg(btn) {
    const row = btn.closest('.msg-row');
    const messageId = row?.dataset.messageId;
    if (!messageId) return;

    // Fermer le menu
    btn.closest('.msg-menu').classList.remove('open');

    if (!confirm('Supprimer ce message ?')) return;

    try {
        await apiRequest(`/messages/${messageId}`, { method: 'DELETE' });
        row.style.opacity = '0';
        row.style.transition = 'opacity 0.3s';
        setTimeout(() => row.remove(), 300);
    } catch {
        showInputError('Impossible de supprimer le message.');
    }
}


// -----------------------------------------------------------------------------
// SIGNALEMENT D'UN MESSAGE
// Ouvre une modale de confirmation avec choix de la raison.
// Le backend insère un enregistrement dans la table `reports`.
// Les modérateurs pourront consulter les signalements dans un panneau dédié.
// -----------------------------------------------------------------------------
let reportTargetRow = null;

function openReportModal(btn) {
    const menu = btn.closest('.msg-menu');
    menu.classList.remove('open');
    reportTargetRow = btn.closest('.msg-row');

    // Créer ou réutiliser la modale
    let modal = document.getElementById('report-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'report-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="report-title">
                <h3 id="report-title">🚩 Signaler un message</h3>
                <p>Pourquoi signales-tu ce message ? Ton signalement est anonyme et sera examiné par l'équipe.</p>
                <div class="report-reasons">
                    <button class="report-reason" data-reason="harcèlement">😔 Harcèlement ou intimidation</button>
                    <button class="report-reason" data-reason="contenu offensant">🤬 Contenu offensant ou haineux</button>
                    <button class="report-reason" data-reason="crise">🆘 Je pense que cette personne est en danger</button>
                    <button class="report-reason" data-reason="spam">🤖 Spam ou contenu inapproprié</button>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeReportModal()">Annuler</button>
                    <button class="btn-report-submit" id="submit-report" disabled onclick="submitReport()">Signaler</button>
                </div>
            </div>`;

        // Sélection de la raison
        modal.querySelectorAll('.report-reason').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.report-reason').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                document.getElementById('submit-report').disabled = false;
            });
        });

        // Fermer en cliquant l'overlay
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeReportModal();
        });

        document.body.appendChild(modal);
    }

    // Réinitialiser
    modal.querySelectorAll('.report-reason').forEach(b => b.classList.remove('selected'));
    document.getElementById('submit-report').disabled = true;
    modal.classList.add('open');
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) modal.classList.remove('open');
    reportTargetRow = null;
}

async function submitReport() {
    const modal = document.getElementById('report-modal');
    const selected = modal.querySelector('.report-reason.selected');
    if (!selected || !reportTargetRow) return;

    const messageId = reportTargetRow.dataset.messageId;
    const reason = selected.dataset.reason;

    const submitBtn = document.getElementById('submit-report');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi...';

    try {
        await apiRequest(`/messages/${messageId}/report`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });

        closeReportModal();
        showInputError('✅ Signalement envoyé. Merci de veiller à la communauté.');
    } catch {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Signaler';
        showInputError("Impossible d'envoyer le signalement.");
    }
}