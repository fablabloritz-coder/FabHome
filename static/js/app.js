/* FabHome — Logique : grille configurable, DnD avec snap, CRUD, widgets, pages, services */

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

    function editUrl() {
        var pg = PAGE_DATA.currentPage;
        return pg && pg !== 1 ? '/?page=' + pg + '&edit=1' : '/?edit=1';
    }

    /* ══════════════════════════════════════
       ETAT DE LA GRILLE
       ══════════════════════════════════════ */

    var gridBoard = qs('#gridBoard');
    var highlight = qs('#gridHighlight');
    var gridCols = parseInt(PAGE_DATA.settings.grid_cols) || 4;
    var gridRows = parseInt(PAGE_DATA.settings.grid_rows) || 3;
    var occupiedMap = {};

    function buildOccupiedMap() {
        occupiedMap = {};
        PAGE_DATA.groups.forEach(function (g) {
            if (g.grid_row < 0) return;
            for (var r = g.grid_row; r < g.grid_row + (g.row_span || 1); r++) {
                for (var c = g.grid_col; c < g.grid_col + (g.col_span || 1); c++) {
                    occupiedMap[r + ',' + c] = g.id;
                }
            }
        });
    }

    function canPlace(row, col, colSpan, rowSpan, excludeId) {
        if (col < 0 || row < 0 || col + colSpan > gridCols || row + rowSpan > gridRows) return false;
        for (var r = row; r < row + rowSpan; r++) {
            for (var c = col; c < col + colSpan; c++) {
                var key = r + ',' + c;
                if (occupiedMap[key] && occupiedMap[key] !== excludeId) return false;
            }
        }
        return true;
    }

    function getCellFromPoint(x, y) {
        if (!gridBoard) return null;
        var rect = gridBoard.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
        var cellW = rect.width / gridCols;
        var cellH = rect.height / gridRows;
        var col = Math.floor((x - rect.left) / cellW);
        var row = Math.floor((y - rect.top) / cellH);
        return {
            row: Math.max(0, Math.min(gridRows - 1, row)),
            col: Math.max(0, Math.min(gridCols - 1, col))
        };
    }

    /* ══════════════════════════════════════
       CELLULES VIDES (mode edition)
       ══════════════════════════════════════ */

    var pendingPosition = null;

    function renderEmptyCells() {
        qsa('.grid-cell-empty', gridBoard).forEach(function (e) { e.remove(); });
        if (!editMode || !gridBoard) return;
        buildOccupiedMap();
        for (var r = 0; r < gridRows; r++) {
            for (var c = 0; c < gridCols; c++) {
                if (!occupiedMap[r + ',' + c]) {
                    var cell = document.createElement('div');
                    cell.className = 'grid-cell-empty';
                    cell.style.gridColumn = (c + 1) + ' / span 1';
                    cell.style.gridRow = (r + 1) + ' / span 1';
                    cell.dataset.row = r;
                    cell.dataset.col = c;
                    cell.innerHTML = '<i class="bi bi-plus"></i>';
                    cell.addEventListener('click', onEmptyCellClick);
                    gridBoard.appendChild(cell);
                }
            }
        }
    }

    function onEmptyCellClick() {
        pendingPosition = {
            row: parseInt(this.dataset.row),
            col: parseInt(this.dataset.col)
        };
        openGroupModal(null);
    }

    function updateUnplacedSection() {
        var section = qs('#unplacedSection');
        var list = qs('#unplacedList');
        if (!section || !list) return;
        var unplaced = PAGE_DATA.groups.filter(function (g) { return g.grid_row < 0; });
        section.style.display = unplaced.length > 0 ? '' : 'none';
    }

    /* ══════════════════════════════════════
       WIDGETS (horloge, accueil, meteo, recherche)
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
        var g = h >= 5 && h < 12 ? 'Bonjour' : h < 18 ? "Bon apr\u00e8s-midi" : 'Bonsoir';
        var name = PAGE_DATA.settings.greeting_name;
        el.textContent = g + (name ? ', ' + name : '') + ' \uD83D\uDC4B';
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
            var providers = {
                google: 'https://www.google.com/search?q=',
                duckduckgo: 'https://duckduckgo.com/?q=',
                bing: 'https://www.bing.com/search?q=',
                startpage: 'https://www.startpage.com/sp/search?query='
            };
            var sp = PAGE_DATA.settings.search_provider || 'google';
            window.open((providers[sp] || providers.google) + encodeURIComponent(q), '_blank');
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

    function loadHealth() {
        var w = qs('#health-widget');
        if (!w) return;
        fetch('/api/health').then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) return;
            var metrics = ['cpu', 'ram', 'disk'];
            metrics.forEach(function (m) {
                var fill = qs('#health-' + m);
                var pct = qs('#health-' + m + '-pct');
                if (fill) {
                    fill.style.width = d[m] + '%';
                    fill.className = 'health-fill' + (d[m] > 85 ? ' critical' : d[m] > 60 ? ' warning' : '');
                }
                if (pct) pct.textContent = Math.round(d[m]) + '%';
            });
        }).catch(function () {});
    }

    /* ══════════════════════════════════════
       MODE EDITION
       ══════════════════════════════════════ */

    var editMode = false;
    var editBtn = qs('#editToggle');
    var editIcon = qs('#editToggleIcon');

    function setEditMode(on) {
        editMode = on;
        document.body.classList.toggle('edit-mode', on);
        if (editBtn) editBtn.classList.toggle('active', on);
        if (editIcon) editIcon.className = on ? 'bi bi-check-lg' : 'bi bi-pencil';

        qsa('.group-card').forEach(function (c) { c.draggable = false; });
        qsa('.palette-block').forEach(function (b) { b.draggable = on; });
        qsa('.link-wrap').forEach(function (w) { w.draggable = on; });

        renderEmptyCells();
        updateUnplacedSection();

        try { sessionStorage.setItem('fh_edit', on ? '1' : '0'); } catch (e) {}
        var pageParam = PAGE_DATA.currentPage && PAGE_DATA.currentPage !== 1 ? 'page=' + PAGE_DATA.currentPage : '';
        if (on) {
            history.replaceState(null, '', pageParam ? '/?' + pageParam + '&edit=1' : '/?edit=1');
        } else {
            history.replaceState(null, '', pageParam ? '/?' + pageParam : '/');
        }
    }

    if (editBtn) {
        editBtn.addEventListener('click', function () { setEditMode(!editMode); });
    }

    document.addEventListener('mousedown', function (e) {
        if (!editMode) return;
        var handle = e.target.closest('.drag-handle');
        if (!handle) return;
        var card = handle.closest('.group-card');
        if (card) card.draggable = true;
    });
    document.addEventListener('mouseup', function () {
        qsa('.group-card').forEach(function (c) { c.draggable = false; });
    });

    /* ══════════════════════════════════════
       MODALES
       ══════════════════════════════════════ */

    var groupModal = null;
    var linkModal = null;
    var settingsModal = null;

    function initModals() {
        var gm = qs('#groupModal');
        var lm = qs('#linkModal');
        var sm = qs('#settingsModal');
        if (gm && typeof bootstrap !== 'undefined') groupModal = new bootstrap.Modal(gm);
        if (lm && typeof bootstrap !== 'undefined') linkModal = new bootstrap.Modal(lm);
        if (sm && typeof bootstrap !== 'undefined') settingsModal = new bootstrap.Modal(sm);
    }

    /* -- Groupe -- */
    function openGroupModal(groupId) {
        if (!groupModal) { initModals(); }
        if (!groupModal) return;
        var form = qs('#groupForm');
        var title = qs('#groupModalTitle');
        if (groupId) {
            var g = findGroup(groupId);
            title.textContent = 'Modifier le groupe';
            form.dataset.editId = groupId;
            form.elements.name.value = g ? g.name : '';
            form.elements.icon.value = g ? g.icon : 'bi-folder';
            form.elements.col_span.value = g ? g.col_span : 1;
            form.elements.row_span.value = g ? (g.row_span || 1) : 1;
        } else {
            title.textContent = 'Nouveau groupe';
            delete form.dataset.editId;
            form.reset();
            form.elements.icon.value = 'bi-folder';
            form.elements.col_span.value = '1';
            form.elements.row_span.value = '1';
        }
        groupModal.show();
    }

    var groupForm = qs('#groupForm');
    if (groupForm) {
        groupForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var body = {
                name: f.elements.name.value,
                icon: f.elements.icon.value,
                col_span: parseInt(f.elements.col_span.value) || 1,
                row_span: parseInt(f.elements.row_span.value) || 1,
                page_id: PAGE_DATA.currentPage || 1
            };
            var eid = f.dataset.editId;

            if (!eid && pendingPosition) {
                body.grid_row = pendingPosition.row;
                body.grid_col = pendingPosition.col;
                pendingPosition = null;
            }

            var p = eid ? api('PUT', '/api/groups/' + eid, body)
                        : api('POST', '/api/groups', body);
            p.then(function () { location.href = editUrl(); })
             .catch(function (err) { alert(err.message); });
        });
    }

    var groupModalEl = qs('#groupModal');
    if (groupModalEl) {
        groupModalEl.addEventListener('hidden.bs.modal', function () {
            pendingPosition = null;
        });
    }

    /* -- Lien -- */
    function openLinkModal(linkId, groupId) {
        if (!linkModal) { initModals(); }
        if (!linkModal) return;
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
            p.then(function () { location.href = editUrl(); })
             .catch(function (err) { alert(err.message); });
        });
    }

    /* -- Reglages -- */
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
                },
                health: { enabled: f.elements.health_enabled.checked, config: {} }
            };
            Promise.all([
                api('PUT', '/api/settings', settingsBody),
                api('PUT', '/api/widgets', widgetsBody)
            ]).then(function () { location.href = editUrl(); })
              .catch(function (err) { alert(err.message); });
        });
    }

    /* -- Icon picker -- */
    document.addEventListener('click', function (e) {
        var ig = e.target.closest('.ig');
        if (!ig) return;
        var modal = ig.closest('.modal');
        if (modal) {
            var input = modal.querySelector('input[name="icon"]');
            if (input) input.value = ig.dataset.v;
        }
    });

    /* -- Upload icone -- */
    document.addEventListener('change', function (e) {
        if (!e.target.classList.contains('icon-upload-input')) return;
        var file = e.target.files[0];
        if (!file) return;
        var formData = new FormData();
        formData.append('file', file);
        fetch('/api/upload/icon', { method: 'POST', body: formData })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.error) { alert(d.error); return; }
                var targetForm = e.target.dataset.target;
                var form = qs('#' + targetForm);
                if (form) form.elements.icon.value = d.url;
            })
            .catch(function (err) { alert('Erreur upload : ' + err.message); });
        e.target.value = '';
    });

    /* -- Fetch favicon -- */
    var fetchFavBtn = qs('#fetchFavicon');
    if (fetchFavBtn) {
        fetchFavBtn.addEventListener('click', function () {
            var urlInput = qs('#linkForm input[name="url"]');
            var iconInput = qs('#linkForm input[name="icon"]');
            if (!urlInput || !iconInput || !urlInput.value.trim()) {
                alert("Renseignez d'abord l'URL du lien");
                return;
            }
            fetch('/api/favicon?url=' + encodeURIComponent(urlInput.value.trim()))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.error) { alert(d.error); return; }
                    iconInput.value = d.icon;
                })
                .catch(function (err) { alert('Erreur : ' + err.message); });
        });
    }

    /* -- Upload fond d'ecran -- */
    var bgUpload = qs('#bgUploadInput');
    if (bgUpload) {
        bgUpload.addEventListener('change', function () {
            var file = bgUpload.files[0];
            if (!file) return;
            var formData = new FormData();
            formData.append('file', file);
            fetch('/api/upload/background', { method: 'POST', body: formData })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.error) { alert(d.error); return; }
                    var urlInput = qs('#settingsForm input[name="background_url"]');
                    if (urlInput) urlInput.value = d.url;
                })
                .catch(function (err) { alert('Erreur upload : ' + err.message); });
            bgUpload.value = '';
        });
    }

    /* -- Export / Import config -- */
    var exportBtn = qs('#exportConfigBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function (e) {
            e.preventDefault();
            fetch('/api/config/export')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'fabhome-config.json';
                    a.click();
                    URL.revokeObjectURL(a.href);
                })
                .catch(function (err) { alert('Erreur export : ' + err.message); });
        });
    }

    var importInput = qs('#importConfigInput');
    if (importInput) {
        importInput.addEventListener('change', function () {
            var file = importInput.files[0];
            if (!file) return;
            if (!confirm('Importer ce fichier va REMPLACER toutes les donnees actuelles. Continuer ?')) {
                importInput.value = '';
                return;
            }
            var reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    var data = JSON.parse(ev.target.result);
                    api('POST', '/api/config/import', data)
                        .then(function () { location.href = '/'; })
                        .catch(function (err) { alert('Erreur import : ' + err.message); });
                } catch (ex) {
                    alert('Fichier JSON invalide');
                }
            };
            reader.readAsText(file);
            importInput.value = '';
        });
    }

    /* -- Pages (CRUD) -- */
    var pageModal = null;
    var serviceModal = null;

    function initExtraModals() {
        var pm = qs('#pageModal');
        var sm = qs('#serviceModal');
        if (pm && typeof bootstrap !== 'undefined' && !pageModal) pageModal = new bootstrap.Modal(pm);
        if (sm && typeof bootstrap !== 'undefined' && !serviceModal) serviceModal = new bootstrap.Modal(sm);
    }

    function openPageModal(pageId) {
        initExtraModals();
        if (!pageModal) return;
        var form = qs('#pageForm');
        var title = qs('#pageModalTitle');
        if (pageId) {
            var pg = PAGE_DATA.pages.find(function (p) { return p.id === pageId; });
            title.textContent = 'Modifier la page';
            form.dataset.editId = pageId;
            form.elements.name.value = pg ? pg.name : '';
            form.elements.icon.value = pg ? pg.icon : 'bi-file-earmark';
        } else {
            title.textContent = 'Nouvelle page';
            delete form.dataset.editId;
            form.reset();
            form.elements.icon.value = 'bi-file-earmark';
        }
        pageModal.show();
    }

    var pageForm = qs('#pageForm');
    if (pageForm) {
        pageForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var body = { name: f.elements.name.value, icon: f.elements.icon.value };
            var eid = f.dataset.editId;
            var p = eid ? api('PUT', '/api/pages/' + eid, body)
                        : api('POST', '/api/pages', body);
            p.then(function () { location.href = editUrl(); })
             .catch(function (err) { alert(err.message); });
        });
    }

    /* -- Services (CRUD) -- */
    function openServiceModal(svcId) {
        initExtraModals();
        if (!serviceModal) return;
        var form = qs('#serviceForm');
        var title = qs('#serviceModalTitle');
        if (svcId) {
            var svc = PAGE_DATA.services.find(function (s) { return s.id === svcId; });
            title.textContent = 'Modifier le service';
            form.dataset.editId = svcId;
            form.elements.name.value = svc ? svc.name : '';
            form.elements.type.value = svc ? svc.type : 'generic';
            form.elements.url.value = svc ? svc.url : '';
            form.elements.api_key.value = svc ? svc.api_key : '';
        } else {
            title.textContent = 'Ajouter un service';
            delete form.dataset.editId;
            form.reset();
        }
        serviceModal.show();
    }

    var serviceForm = qs('#serviceForm');
    if (serviceForm) {
        serviceForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var body = {
                name: f.elements.name.value,
                type: f.elements.type.value,
                url: f.elements.url.value,
                api_key: f.elements.api_key.value
            };
            var eid = f.dataset.editId;
            var p = eid ? api('PUT', '/api/services/' + eid, body)
                        : api('POST', '/api/services', body);
            p.then(function () { location.href = editUrl(); })
             .catch(function (err) { alert(err.message); });
        });
    }

    /* -- Chargement des donnees service -- */
    function loadServices() {
        var widgets = qsa('.service-widget');
        widgets.forEach(function (w) {
            var sid = parseInt(w.dataset.serviceId);
            var stype = w.dataset.serviceType;
            var statusEl = qs('#svc-status-' + sid);
            var dataEl = qs('#svc-data-' + sid);

            fetch('/api/services/' + sid + '/proxy')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.error) {
                        if (statusEl) statusEl.textContent = '\u26A0\uFE0F';
                        if (dataEl) dataEl.textContent = data.error;
                        return;
                    }
                    if (statusEl) statusEl.textContent = '\u2705';
                    if (dataEl) renderServiceData(dataEl, stype, data);
                })
                .catch(function () {
                    if (statusEl) statusEl.textContent = '\u274C';
                });
        });
    }

    function renderServiceData(el, stype, data) {
        var html = '';
        if (stype === 'pihole') {
            html = '<span>Requetes : ' + (data.dns_queries_today || '\u2014') + '</span>'
                 + ' <span>Bloquees : ' + (data.ads_blocked_today || '\u2014') + '</span>';
        } else if (stype === 'adguard') {
            var stats = data.stats || data;
            html = '<span>Requetes : ' + (stats.num_dns_queries || '\u2014') + '</span>'
                 + ' <span>Bloquees : ' + (stats.num_blocked_filtering || '\u2014') + '</span>';
        } else if (stype === 'uptimekuma') {
            if (data.heartbeatList) {
                var count = Object.keys(data.heartbeatList).length;
                html = '<span>' + count + ' moniteurs</span>';
            } else {
                html = '<span>Connecte</span>';
            }
        } else {
            var keys = Object.keys(data).slice(0, 3);
            keys.forEach(function (k) {
                html += '<span class="svc-kv"><strong>' + k + '</strong>: ' + String(data[k]).substring(0, 50) + '</span> ';
            });
        }
        el.innerHTML = html;
    }

    /* ══════════════════════════════════════
       TAILLE DE LA GRILLE (palette)
       ══════════════════════════════════════ */

    var applyBtn = qs('#applyGridSize');
    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            var newCols = parseInt(qs('#gridColsInput').value) || 4;
            var newRows = parseInt(qs('#gridRowsInput').value) || 3;
            newCols = Math.max(2, Math.min(16, newCols));
            newRows = Math.max(1, Math.min(12, newRows));
            api('PUT', '/api/settings', { grid_cols: String(newCols), grid_rows: String(newRows) })
                .then(function () { location.href = editUrl(); })
                .catch(function (err) { alert(err.message); });
        });
    }

    /* ══════════════════════════════════════
       DRAG & DROP — GROUPES (grille + palette)
       ══════════════════════════════════════ */

    var draggingGroupId = null;
    var draggingColSpan = 1;
    var draggingRowSpan = 1;
    var dragSource = null;
    var draggedLink = null;

    if (gridBoard) {
        gridBoard.addEventListener('dragstart', function (e) {
            var card = e.target.closest('.group-card');
            if (!card || !editMode) return;
            if (e.target.closest('.link-wrap')) return;
            draggingGroupId = parseInt(card.dataset.groupId);
            var g = findGroup(draggingGroupId);
            draggingColSpan = g ? (g.col_span || 1) : 1;
            draggingRowSpan = g ? (g.row_span || 1) : 1;
            dragSource = 'grid';
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'group');
        });

        gridBoard.addEventListener('dragover', function (e) {
            if (!draggingGroupId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            var cell = getCellFromPoint(e.clientX, e.clientY);
            if (!cell || !highlight) return;

            var ok = canPlace(cell.row, cell.col, draggingColSpan, draggingRowSpan, draggingGroupId);
            highlight.style.gridColumn = (cell.col + 1) + ' / span ' + draggingColSpan;
            highlight.style.gridRow = (cell.row + 1) + ' / span ' + draggingRowSpan;
            highlight.classList.add('visible');
            highlight.classList.toggle('invalid', !ok);
        });

        gridBoard.addEventListener('dragleave', function (e) {
            if (!e.relatedTarget || !gridBoard.contains(e.relatedTarget)) {
                if (highlight) highlight.classList.remove('visible');
            }
        });

        gridBoard.addEventListener('drop', function (e) {
            e.preventDefault();
            if (!draggingGroupId) return;
            var cell = getCellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            var ok = canPlace(cell.row, cell.col, draggingColSpan, draggingRowSpan, draggingGroupId);
            if (!ok) return;

            api('POST', '/api/groups/' + draggingGroupId + '/move', {
                grid_row: cell.row,
                grid_col: cell.col
            }).then(function () {
                location.href = editUrl();
            }).catch(function (err) { alert(err.message); });
        });
    }

    document.addEventListener('dragstart', function (e) {
        var wrap = e.target.closest('.link-wrap');
        if (wrap && editMode) {
            draggedLink = wrap;
            wrap.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'link');
            return;
        }
        var block = e.target.closest('.palette-block');
        if (block && editMode) {
            draggingGroupId = parseInt(block.dataset.groupId);
            var g = findGroup(draggingGroupId);
            draggingColSpan = g ? (g.col_span || 1) : 1;
            draggingRowSpan = g ? (g.row_span || 1) : 1;
            dragSource = 'palette';
            block.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'group');
        }
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
        if (draggingGroupId) {
            qsa('.group-card.dragging, .palette-block.dragging').forEach(function (el) {
                el.classList.remove('dragging');
            });
            if (highlight) highlight.classList.remove('visible');
            draggingGroupId = null;
            dragSource = null;
        }
        if (draggedLink) {
            draggedLink.classList.remove('dragging');
            qsa('.link-wrap.drag-over-link').forEach(function (w) { w.classList.remove('drag-over-link'); });

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
        }
    });

    /* ══════════════════════════════════════
       DELEGATION D'EVENEMENTS (data-action)
       ══════════════════════════════════════ */

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var id = btn.dataset.id ? parseInt(btn.dataset.id) : null;

        switch (action) {
            case 'new-group':
                pendingPosition = null;
                openGroupModal(null);
                break;
            case 'edit-group':
                openGroupModal(id);
                break;
            case 'delete-group':
                if (confirm('Supprimer le groupe \u00AB ' + (btn.dataset.name || '') + ' \u00BB et tous ses liens ?')) {
                    api('DELETE', '/api/groups/' + id)
                        .then(function () { location.href = editUrl(); })
                        .catch(function (err) { alert(err.message); });
                }
                break;
            case 'unplace-group':
                api('POST', '/api/groups/' + id + '/move', { grid_row: -1, grid_col: 0 })
                    .then(function () { location.href = editUrl(); })
                    .catch(function (err) { alert(err.message); });
                break;
            case 'new-link':
                openLinkModal(null, parseInt(btn.dataset.groupId));
                break;
            case 'edit-link':
                openLinkModal(id, null);
                break;
            case 'delete-link':
                if (confirm('Supprimer le lien \u00AB ' + (btn.dataset.name || '') + ' \u00BB ?')) {
                    api('DELETE', '/api/links/' + id)
                        .then(function () { location.href = editUrl(); })
                        .catch(function (err) { alert(err.message); });
                }
                break;
            case 'open-settings':
                if (!settingsModal) initModals();
                if (settingsModal) settingsModal.show();
                break;
            case 'new-page':
                openPageModal(null);
                break;
            case 'edit-current-page':
                openPageModal(PAGE_DATA.currentPage);
                break;
            case 'delete-page':
                if (confirm('Supprimer cette page et tous ses groupes ?')) {
                    api('DELETE', '/api/pages/' + id)
                        .then(function () { location.href = editUrl(); })
                        .catch(function (err) { alert(err.message); });
                }
                break;
            case 'new-service':
                openServiceModal(null);
                break;
            case 'edit-service':
                openServiceModal(id);
                break;
            case 'delete-service':
                if (confirm('Supprimer ce service ?')) {
                    api('DELETE', '/api/services/' + id)
                        .then(function () { location.href = editUrl(); })
                        .catch(function (err) { alert(err.message); });
                }
                break;
        }
    });

    /* ══════════════════════════════════════
       INITIALISATION
       ══════════════════════════════════════ */

    buildOccupiedMap();
    initModals();
    initExtraModals();
    updateClock();
    updateGreeting();
    setInterval(updateClock, 1000);
    checkStatuses();
    setInterval(checkStatuses, 60000);
    loadWeather();
    setInterval(loadWeather, 1800000);
    loadHealth();
    setInterval(loadHealth, 30000);
    loadServices();

    if (PAGE_DATA.editOnLoad) {
        setEditMode(true);
    } else {
        try {
            if (sessionStorage.getItem('fh_edit') === '1') setEditMode(true);
        } catch (e) {}
    }

})();
