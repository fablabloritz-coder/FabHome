/* FabHome — Logique unifiée : affichage + mode édition + CRUD + DnD */

(function () {
    'use strict';

    /* ══════════════════════════════════════
       HELPERS
       ══════════════════════════════════════ */
    function api(method, url, body) {
        var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        return fetch(url, opts).then(function (r) {
            if (!r.ok) return r.json().catch(function () { return {}; })
                .then(function (e) { throw new Error(e.error || 'Erreur'); });
            return r.json();
        });
    }

    function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
    function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

    // Trouver les données d'un groupe/lien dans PAGE_DATA
    function findGroup(id) {
        return PAGE_DATA.groups.find(function (g) { return g.id === id; });
    }
    function findLink(id) {
        for (var i = 0; i < PAGE_DATA.groups.length; i++) {
            var links = PAGE_DATA.groups[i].links;
            for (var j = 0; j < links.length; j++) {
                if (links[j].id === id) return links[j];
            }
        }
        return null;
    }

    /* ══════════════════════════════════════
       WIDGETS (horloge, accueil, météo, recherche)
       ══════════════════════════════════════ */

    function updateClock() {
        var t = qs('#clock-time'), d = qs('#clock-date');
        if (!t) return;
        var now = new Date();
        t.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (d) d.textContent = now.toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    function updateGreeting() {
        var el = qs('#greeting-text');
        if (!el) return;
        var h = new Date().getHours();
        var g = h >= 5 && h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
        var name = PAGE_DATA.settings.greeting_name;
        el.textContent = g + (name ? ', ' + name : '') + ' 👋';
    }

    function loadWeather() {
        var el = qs('#weather-widget');
        if (!el) return;
        fetch('/api/weather').then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) return;
            var t = qs('#weather-temp');
            if (t) t.textContent = Math.round(d.temperature);
            var ic = el.querySelector('i');
            if (ic) ic.className = 'bi ' + weatherIcon(d.weather_code);
        }).catch(function () {});
    }

    function weatherIcon(c) {
        if (c === 0) return 'bi-sun';
        if (c <= 3)  return 'bi-cloud-sun';
        if (c <= 49) return 'bi-cloud';
        if (c <= 59) return 'bi-cloud-drizzle';
        if (c <= 69) return 'bi-cloud-rain';
        if (c <= 79) return 'bi-snow';
        if (c <= 82) return 'bi-cloud-rain-heavy';
        if (c <= 99) return 'bi-cloud-lightning-rain';
        return 'bi-cloud';
    }

    var searchForm = qs('#search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var q = qs('#search-input').value.trim();
            if (!q) return;
            var p = {
                google: 'https://www.google.com/search?q=',
                duckduckgo: 'https://duckduckgo.com/?q=',
                bing: 'https://www.bing.com/search?q=',
                startpage: 'https://www.startpage.com/sp/search?query='
            };
            var sp = PAGE_DATA.settings.search_provider || 'google';
            window.open((p[sp] || p.google) + encodeURIComponent(q), '_blank');
        });
    }

    function checkStatuses() {
        var dots = qsa('[data-status-id]');
        if (!dots.length) return;
        fetch('/api/status').then(function (r) { return r.json(); }).then(function (data) {
            for (var id in data) {
                qsa('[data-status-id="' + id + '"]').forEach(function (d) {
                    d.className = 'status-dot ' + data[id];
                });
            }
        }).catch(function () {});
    }

    /* ══════════════════════════════════════
       MODE ÉDITION
       ══════════════════════════════════════ */

    var editMode = false;
    var editBtn = qs('#editToggle');
    var editIcon = qs('#editToggleIcon');

    function setEditMode(on) {
        editMode = on;
        document.body.classList.toggle('edit-mode', on);
        if (editBtn) editBtn.classList.toggle('active', on);
        if (editIcon) editIcon.className = on ? 'bi bi-check-lg' : 'bi bi-pencil';

        // Rendre les groupes glissables
        qsa('.group-card:not(.add-group-ghost)').forEach(function (c) {
            c.draggable = on;
        });
        // Rendre les liens glissables
        qsa('.link-wrap').forEach(function (w) {
            w.draggable = on;
        });
        try { sessionStorage.setItem('fh_edit', on ? '1' : '0'); } catch (e) {}
    }

    if (editBtn) {
        editBtn.addEventListener('click', function () { setEditMode(!editMode); });
    }

    /* ══════════════════════════════════════
       MODALES
       ══════════════════════════════════════ */

    var groupModal = qs('#groupModal') ? new bootstrap.Modal(qs('#groupModal')) : null;
    var linkModal  = qs('#linkModal')  ? new bootstrap.Modal(qs('#linkModal'))  : null;
    var settingsModal = qs('#settingsModal') ? new bootstrap.Modal(qs('#settingsModal')) : null;

    /* ── Groupe ───────────────────────── */
    function openGroupModal(groupId) {
        var form = qs('#groupForm');
        var title = qs('#groupModalTitle');
        if (groupId) {
            var g = findGroup(groupId);
            title.textContent = 'Modifier le groupe';
            form.dataset.editId = groupId;
            form.elements.name.value = g ? g.name : '';
            form.elements.icon.value = g ? g.icon : 'bi-folder';
            form.elements.col_span.value = g ? g.col_span : 1;
        } else {
            title.textContent = 'Nouveau groupe';
            delete form.dataset.editId;
            form.reset();
            form.elements.icon.value = 'bi-folder';
            form.elements.col_span.value = '1';
        }
        groupModal.show();
    }

    var groupForm = qs('#groupForm');
    if (groupForm) {
        groupForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var body = { name: f.elements.name.value, icon: f.elements.icon.value,
                         col_span: parseInt(f.elements.col_span.value) || 1 };
            var eid = f.dataset.editId;
            var p = eid ? api('PUT', '/api/groups/' + eid, body)
                        : api('POST', '/api/groups', body);
            p.then(function () { location.href = '/?edit=1'; })
             .catch(function (err) { alert(err.message); });
        });
    }

    /* ── Lien ─────────────────────────── */
    function openLinkModal(linkId, groupId) {
        var form = qs('#linkForm');
        var title = qs('#linkModalTitle');
        if (linkId) {
            var lnk = findLink(linkId);
            title.textContent = 'Modifier le lien';
            form.dataset.editId = linkId;
            form.elements.group_id.value = lnk ? lnk.group_id : groupId;
            form.elements.name.value = lnk ? lnk.name : '';
            form.elements.url.value = lnk ? lnk.url : '';
            form.elements.icon.value = lnk ? lnk.icon : 'bi-link-45deg';
            form.elements.description.value = lnk ? lnk.description : '';
            form.elements.check_status.checked = lnk ? !!lnk.check_status : false;
        } else {
            title.textContent = 'Ajouter un lien';
            delete form.dataset.editId;
            form.reset();
            form.elements.group_id.value = groupId || '';
            form.elements.icon.value = 'bi-link-45deg';
        }
        linkModal.show();
    }

    var linkForm = qs('#linkForm');
    if (linkForm) {
        linkForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var body = {
                group_id: parseInt(f.elements.group_id.value),
                name: f.elements.name.value,
                url: f.elements.url.value,
                icon: f.elements.icon.value,
                description: f.elements.description.value,
                check_status: f.elements.check_status.checked
            };
            var eid = f.dataset.editId;
            var p = eid ? api('PUT', '/api/links/' + eid, body)
                        : api('POST', '/api/links', body);
            p.then(function () { location.href = '/?edit=1'; })
             .catch(function (err) { alert(err.message); });
        });
    }

    /* ── Réglages ─────────────────────── */
    var settingsForm = qs('#settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var settingsBody = {
                title: f.elements.title.value,
                theme: f.elements.theme.value,
                background_url: f.elements.background_url.value,
                greeting_name: f.elements.greeting_name.value,
                search_provider: f.elements.search_provider.value
            };
            var widgetsBody = {
                greeting: { enabled: f.elements.greeting_enabled.checked, config: {} },
                clock: { enabled: f.elements.clock_enabled.checked, config: {} },
                search: { enabled: f.elements.search_enabled.checked, config: {} },
                weather: {
                    enabled: f.elements.weather_enabled.checked,
                    config: {
                        city: f.elements.weather_city.value,
                        latitude: parseFloat(f.elements.weather_lat.value) || 48.69,
                        longitude: parseFloat(f.elements.weather_lon.value) || 6.18
                    }
                }
            };
            Promise.all([
                api('PUT', '/api/settings', settingsBody),
                api('PUT', '/api/widgets', widgetsBody)
            ]).then(function () { location.href = '/?edit=1'; })
              .catch(function (err) { alert(err.message); });
        });
    }

    /* ── Icon picker (clic sur grille) ── */
    document.addEventListener('click', function (e) {
        var ig = e.target.closest('.ig');
        if (!ig) return;
        var modal = ig.closest('.modal');
        if (modal) {
            var input = modal.querySelector('input[name="icon"]');
            if (input) input.value = ig.dataset.v;
        }
    });

    /* ══════════════════════════════════════
       DRAG & DROP — GROUPES
       ══════════════════════════════════════ */

    var grid = qs('#groupsGrid');
    var draggedCard = null;

    if (grid) {
        grid.addEventListener('dragstart', function (e) {
            var card = e.target.closest('.group-card:not(.add-group-ghost)');
            if (!card || !editMode) return;
            // Vérifier que c'est un drag de groupe (pas de lien)
            if (e.target.closest('.link-wrap')) return;
            draggedCard = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'group');
        });

        grid.addEventListener('dragover', function (e) {
            if (!draggedCard) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            // Trouver l'élément le plus proche pour insérer avant
            var cards = qsa('.group-card:not(.dragging):not(.add-group-ghost)', grid);
            var closest = null;
            var closestDist = Infinity;

            cards.forEach(function (c) {
                var rect = c.getBoundingClientRect();
                var cx = rect.left + rect.width / 2;
                var cy = rect.top + rect.height / 2;
                var dist = Math.hypot(e.clientX - cx, e.clientY - cy);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = c;
                }
            });

            // Retirer les indicateurs
            cards.forEach(function (c) { c.classList.remove('drag-over'); });

            if (closest) {
                var rect = closest.getBoundingClientRect();
                var midX = rect.left + rect.width / 2;
                var midY = rect.top + rect.height / 2;
                // Déterminer si on insère avant ou après
                var after = (e.clientY > midY) || (Math.abs(e.clientY - midY) < rect.height * 0.3 && e.clientX > midX);
                if (after) {
                    var next = closest.nextElementSibling;
                    if (next && next !== draggedCard) {
                        grid.insertBefore(draggedCard, next);
                    } else if (!next) {
                        var ghost = qs('.add-group-ghost', grid);
                        if (ghost) grid.insertBefore(draggedCard, ghost);
                    }
                } else {
                    if (closest !== draggedCard.nextElementSibling) {
                        grid.insertBefore(draggedCard, closest);
                    }
                }
            }
        });

        grid.addEventListener('dragend', function () {
            if (!draggedCard) return;
            draggedCard.classList.remove('dragging');
            qsa('.group-card', grid).forEach(function (c) { c.classList.remove('drag-over'); });

            // Sauvegarder le nouvel ordre
            var order = qsa('.group-card:not(.add-group-ghost)', grid).map(function (c) {
                return parseInt(c.dataset.groupId);
            }).filter(function (id) { return !isNaN(id); });

            api('POST', '/api/groups/reorder', { order: order }).catch(function (err) {
                console.error('Erreur reorder:', err);
            });

            draggedCard = null;
        });
    }

    /* ══════════════════════════════════════
       DRAG & DROP — LIENS (dans un groupe)
       ══════════════════════════════════════ */

    var draggedLink = null;

    document.addEventListener('dragstart', function (e) {
        var wrap = e.target.closest('.link-wrap');
        if (!wrap || !editMode) return;
        // Empêcher le drag groupe
        e.stopPropagation();
        draggedLink = wrap;
        wrap.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'link');
    });

    document.addEventListener('dragover', function (e) {
        if (!draggedLink) return;
        var linksList = e.target.closest('.group-links');
        if (!linksList) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        var wraps = qsa('.link-wrap:not(.dragging)', linksList);
        wraps.forEach(function (w) { w.classList.remove('drag-over-link'); });

        var closest = null;
        wraps.forEach(function (w) {
            var rect = w.getBoundingClientRect();
            var mid = rect.top + rect.height / 2;
            if (e.clientY < mid && !closest) closest = w;
        });

        if (closest) {
            closest.classList.add('drag-over-link');
            linksList.insertBefore(draggedLink, closest);
        } else {
            linksList.appendChild(draggedLink);
        }
    });

    document.addEventListener('dragend', function () {
        if (!draggedLink) return;
        draggedLink.classList.remove('dragging');
        qsa('.link-wrap').forEach(function (w) { w.classList.remove('drag-over-link'); });

        // Trouver le groupe parent et sauver l'ordre
        var linksList = draggedLink.closest('.group-links');
        if (linksList) {
            var groupId = parseInt(linksList.dataset.groupId);
            var order = qsa('.link-wrap', linksList).map(function (w) {
                return parseInt(w.dataset.linkId);
            }).filter(function (id) { return !isNaN(id); });

            api('POST', '/api/links/reorder', { group_id: groupId, order: order })
                .catch(function (err) { console.error('Erreur reorder liens:', err); });
        }

        draggedLink = null;
    });

    /* ══════════════════════════════════════
       DÉLÉGATION D'ÉVÉNEMENTS (data-action)
       ══════════════════════════════════════ */

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var id = btn.dataset.id ? parseInt(btn.dataset.id) : null;

        switch (action) {
            case 'new-group':
                openGroupModal(null);
                break;
            case 'edit-group':
                openGroupModal(id);
                break;
            case 'delete-group':
                if (confirm('Supprimer le groupe « ' + (btn.dataset.name || '') + ' » et tous ses liens ?')) {
                    api('DELETE', '/api/groups/' + id)
                        .then(function () { location.href = '/?edit=1'; })
                        .catch(function (err) { alert(err.message); });
                }
                break;
            case 'new-link':
                openLinkModal(null, parseInt(btn.dataset.groupId));
                break;
            case 'edit-link':
                openLinkModal(id, null);
                break;
            case 'delete-link':
                if (confirm('Supprimer le lien « ' + (btn.dataset.name || '') + ' » ?')) {
                    api('DELETE', '/api/links/' + id)
                        .then(function () { location.href = '/?edit=1'; })
                        .catch(function (err) { alert(err.message); });
                }
                break;
            case 'open-settings':
                if (settingsModal) settingsModal.show();
                break;
        }
    });

    /* ══════════════════════════════════════
       INITIALISATION
       ══════════════════════════════════════ */

    updateClock();
    updateGreeting();
    setInterval(updateClock, 1000);
    checkStatuses();
    setInterval(checkStatuses, 60000);
    loadWeather();
    setInterval(loadWeather, 1800000);

    // Entrer en mode édition si demandé par URL ou session
    if (PAGE_DATA.editOnLoad) {
        setEditMode(true);
    } else {
        try {
            if (sessionStorage.getItem('fh_edit') === '1') setEditMode(true);
        } catch (e) {}
    }

})();
