// =============================================================================
// TRUST LAYER — landing.js
// Animations et comportements de la page d'accueil.
// Aucune interaction avec le backend — uniquement de l'animation UI.
// =============================================================================


// -----------------------------------------------------------------------------
// APPARITION DES CARTES AU SCROLL
// Chaque carte de la section features s'anime en fondu + glissement vers le haut
// quand elle entre dans le champ de vision. On utilise deux observers distincts
// pour permettre à l'IntersectionObserver d'assigner un délai progressif à chaque
// carte selon son ordre dans la grille.
// -----------------------------------------------------------------------------

// Premier observer : calcule le délai d'animation progressif (0.1s par carte).
const delayObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
            entry.target.style.animationDelay = `${i * 0.1}s`;
        }
    });
}, { threshold: 0.15 });

// Second observer : déclenche l'animation elle-même quand la carte est visible.
document.querySelectorAll('.feature-card').forEach(card => {
    // État initial invisible — la carte apparaîtra en douceur.
    card.style.opacity   = '0';
    card.style.transform = 'translateY(30px)';
    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';

    delayObserver.observe(card);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
            card.style.opacity   = '1';
            card.style.transform = 'translateY(0)';
        }
    }, { threshold: 0.2 });

    visibilityObserver.observe(card);
});


// -----------------------------------------------------------------------------
// OMBRE DE LA BARRE DE NAVIGATION AU SCROLL
// Ajoute une ombre sous la nav quand l'utilisateur descend, pour renforcer la
// lisibilité sur les sections colorées.
// -----------------------------------------------------------------------------
window.addEventListener('scroll', () => {
    const nav = document.querySelector('.nav');
    nav.style.boxShadow = window.scrollY > 20
        ? '0 4px 24px rgba(26,37,53,0.12)'
        : 'none';
});
