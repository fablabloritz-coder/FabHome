/* FabHome — Logique page d'accueil */

// ── Horloge ──────────────────────────────────────────────
function updateClock() {
    const timeEl = document.getElementById('clock-time');
    const dateEl = document.getElementById('clock-date');
    if (!timeEl) return;
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }
}

// ── Message d'accueil ────────────────────────────────────
function updateGreeting() {
    const el = document.getElementById('greeting-text');
    if (!el) return;
    const h = new Date().getHours();
    let greet = 'Bonsoir';
    if (h >= 5 && h < 12)       greet = 'Bonjour';
    else if (h >= 12 && h < 18) greet = 'Bon après-midi';
    const name = (typeof GREETING_NAME !== 'undefined' && GREETING_NAME)
        ? `, ${GREETING_NAME}` : '';
    el.textContent = `${greet}${name} 👋`;
}

// ── Recherche ────────────────────────────────────────────
const searchForm = document.getElementById('search-form');
if (searchForm) {
    searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const q = document.getElementById('search-input').value.trim();
        if (!q) return;
        const providers = {
            google:     'https://www.google.com/search?q=' + encodeURIComponent(q),
            duckduckgo: 'https://duckduckgo.com/?q='      + encodeURIComponent(q),
            bing:       'https://www.bing.com/search?q='   + encodeURIComponent(q),
            startpage:  'https://www.startpage.com/sp/search?query=' + encodeURIComponent(q),
        };
        const provider = (typeof SEARCH_PROVIDER !== 'undefined') ? SEARCH_PROVIDER : 'google';
        window.open(providers[provider] || providers.google, '_blank');
    });
}

// ── Vérification des statuts ─────────────────────────────
function checkStatuses() {
    const dots = document.querySelectorAll('[data-status-id]');
    if (!dots.length) return;
    fetch('/api/status')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            for (var id in data) {
                var els = document.querySelectorAll('[data-status-id="' + id + '"]');
                els.forEach(function (dot) {
                    dot.className = 'status-dot ' + data[id];
                });
            }
        })
        .catch(function () { /* silencieux */ });
}

// ── Météo ────────────────────────────────────────────────
function loadWeather() {
    var el = document.getElementById('weather-widget');
    if (!el) return;
    fetch('/api/weather')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.error) return;
            var tempEl = document.getElementById('weather-temp');
            if (tempEl) tempEl.textContent = Math.round(data.temperature);
            var icon = weatherIcon(data.weather_code);
            var i = el.querySelector('i');
            if (i) i.className = 'bi ' + icon;
        })
        .catch(function () { /* silencieux */ });
}

function weatherIcon(code) {
    if (code === 0)   return 'bi-sun';
    if (code <= 3)    return 'bi-cloud-sun';
    if (code <= 49)   return 'bi-cloud';
    if (code <= 59)   return 'bi-cloud-drizzle';
    if (code <= 69)   return 'bi-cloud-rain';
    if (code <= 79)   return 'bi-snow';
    if (code <= 82)   return 'bi-cloud-rain-heavy';
    if (code <= 99)   return 'bi-cloud-lightning-rain';
    return 'bi-cloud';
}

// ── Initialisation ───────────────────────────────────────
updateClock();
updateGreeting();
setInterval(updateClock, 1000);
checkStatuses();
setInterval(checkStatuses, 60000);
loadWeather();
setInterval(loadWeather, 1800000);
