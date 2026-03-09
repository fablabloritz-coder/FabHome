/* FabHome — Logique : grille configurable, DnD avec snap, CRUD, widgets, pages, services */
(function () {
    'use strict';
    /* ══════════════════════════════════════
       HELPERS
       ══════════════════════════════════════ */
    function escHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
    function api(method, url, body) {
        var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        return fetch(url, opts).then(function (r) {
            if (!r.ok) return r.json().catch(function () { return {}; })
                .then(function (e) { throw new Error(e.error || 'Erreur'); });
            return r.json();
        });
    }
    function showToast(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) { window.alert(message); return; }
        var icon = type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill';
        var bg = type === 'success' ? 'text-bg-success' : 'text-bg-danger';
        var el = document.createElement('div');
        el.className = 'toast align-items-center ' + bg + ' border-0';
        el.setAttribute('role', 'alert');
        el.innerHTML = '<div class="d-flex"><div class="toast-body"><i class="bi ' + icon + ' me-2"></i>' + escHtml(message) + '</div>'
            + '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
        container.appendChild(el);
        var toast = new bootstrap.Toast(el, { delay: 5000 });
        el.addEventListener('hidden.bs.toast', function () { el.remove(); });
        toast.show();
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
                    occupiedMap[r + ',' + c] = 'g_' + g.id;
                }
            }
        });
        (PAGE_DATA.grid_widgets || []).forEach(function (w) {
            if (w.grid_row < 0) return;
            for (var r = w.grid_row; r < w.grid_row + (w.row_span || 1); r++) {
                for (var c = w.grid_col; c < w.grid_col + (w.col_span || 1); c++) {
                    occupiedMap[r + ',' + c] = 'w_' + w.id;
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
    function onEmptyCellClick(e) {
        pendingPosition = {
            row: parseInt(this.dataset.row),
            col: parseInt(this.dataset.col)
        };
        // Remove any existing context menu
        var old = qs('#cellContextMenu');
        if (old) old.remove();
        // Build dropdown at click position
        var menu = document.createElement('div');
        menu.id = 'cellContextMenu';
        menu.className = 'dropdown-menu show shadow';
        menu.style.cssText = 'position:fixed;z-index:9999;';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.innerHTML =
            '<button class="dropdown-item" data-choice="group"><i class="bi bi-collection me-2"></i>Nouveau groupe</button>' +
            '<button class="dropdown-item" data-choice="widget"><i class="bi bi-grid-1x2 me-2"></i>Nouveau widget</button>';
        document.body.appendChild(menu);
        menu.addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-choice]');
            if (!btn) return;
            menu.remove();
            if (btn.dataset.choice === 'group') openGroupModal(null);
            else openGridWidgetModal(null);
        });
        // Close on click outside
        setTimeout(function () {
            document.addEventListener('click', function handler(ev) {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    pendingPosition = null;
                    document.removeEventListener('click', handler);
                }
            });
        }, 0);
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
        var t = qs('#header-time'), d = qs('#header-date');
        if (!t) return;
        var now = new Date();
        t.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (d) d.textContent = now.toLocaleDateString('fr-FR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
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
        var w = qs('#health-widget-header');
        if (!w) return;
        fetch('/api/health').then(function (r) { return r.json(); }).then(function (d) {
            if (d.error) return;
            var metrics = ['cpu', 'ram', 'disk'];
            metrics.forEach(function (m) {
                var pct = qs('#health-' + m + '-pct-header');
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
        var card = handle.closest('.group-card') || handle.closest('.grid-widget-card');
        if (card) card.draggable = true;
    });
    document.addEventListener('mouseup', function () {
        qsa('.group-card, .grid-widget-card').forEach(function (c) { c.draggable = false; });
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
            form.elements.icon_size.value = g ? (g.icon_size || 'medium') : 'medium';
            form.elements.text_size.value = g ? (g.text_size || 'medium') : 'medium';
        } else {
            title.textContent = 'Nouveau groupe';
            delete form.dataset.editId;
            form.reset();
            form.elements.icon.value = 'bi-folder';
            form.elements.col_span.value = '1';
            form.elements.row_span.value = '1';
            form.elements.icon_size.value = 'medium';
            form.elements.text_size.value = 'medium';
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
                icon_size: f.elements.icon_size.value,
                text_size: f.elements.text_size.value,
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
             .catch(function (err) { showToast(err.message, 'error'); });
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
             .catch(function (err) { showToast(err.message, 'error'); });
        });
    }
    /* -- Grid Widget (standalone on board) -- */
    var gridWidgetModal = null;
    
    function openGridWidgetModal(widgetId) {
        if (!gridWidgetModal) {
            var gwm = qs('#gridWidgetModal');
            if (gwm && typeof bootstrap !== 'undefined') gridWidgetModal = new bootstrap.Modal(gwm);
        }
        if (!gridWidgetModal) return;
        
        var form = qs('#gridWidgetForm');
        var title = qs('#gridWidgetModalTitle');
        var typeSelect = qs('#gridWidgetType');
        
        if (widgetId) {
            title.textContent = 'Modifier le widget';
            form.dataset.editId = widgetId;
            // Load existing data
            var existing = (PAGE_DATA.grid_widgets || []).find(function(w) { return w.id === widgetId; });
            if (existing) {
                typeSelect.value = existing.type;
                typeSelect.dispatchEvent(new Event('change'));
                if (existing.type === 'note' && form.elements.note_text) form.elements.note_text.value = (existing.config || {}).text || '';
                if (existing.type === 'weather') {
                    if (form.elements.weather_city) form.elements.weather_city.value = (existing.config || {}).city || '';
                    if (form.elements.weather_lat) form.elements.weather_lat.value = (existing.config || {}).latitude || '';
                    if (form.elements.weather_lon) form.elements.weather_lon.value = (existing.config || {}).longitude || '';
                }
                if (existing.type === 'service' && form.elements.service_id) {
                    form.elements.service_id.value = (existing.config || {}).service_id || '';
                }
                if (existing.type === 'camera' && form.elements.camera_url) {
                    form.elements.camera_url.value = (existing.config || {}).camera_url || '';
                }
                form.elements.icon_size.value = existing.icon_size || 'medium';
                form.elements.text_size.value = existing.text_size || 'medium';
                qs('#gridWidgetColSpan').value = existing.col_span || 1;
                qs('#gridWidgetRowSpan').value = existing.row_span || 1;
            }
        } else {
            title.textContent = 'Ajouter un widget';
            delete form.dataset.editId;
            form.reset();
            if (pendingPosition) {
                qs('#gridWidgetCol').value = pendingPosition.col;
                qs('#gridWidgetRow').value = pendingPosition.row;
            }
        }
        gridWidgetModal.show();
    }
    
    // Gérer l'affichage des configs selon le type
    var typeSelect = qs('#gridWidgetType');
    if (typeSelect) {
        typeSelect.addEventListener('change', function() {
            var type = this.value;
            qs('#widgetConfigNote').style.display = type === 'note' ? '' : 'none';
            qs('#widgetConfigWeather').style.display = type === 'weather' ? '' : 'none';
            var camCfg = qs('#widgetConfigCamera');
            if (camCfg) camCfg.style.display = type === 'camera' ? '' : 'none';
            var svcCfg = qs('#widgetConfigService');
            if (svcCfg) svcCfg.style.display = type === 'service' ? '' : 'none';
        });
    }
    
    var gridWidgetForm = qs('#gridWidgetForm');
    if (gridWidgetForm) {
        gridWidgetForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var config = {};
            var type = f.elements.type.value;
            
            if (type === 'note') {
                config.text = f.elements.note_text.value;
            } else if (type === 'weather') {
                config.city = f.elements.weather_city.value;
                config.latitude = parseFloat(f.elements.weather_lat.value) || 48.69;
                config.longitude = parseFloat(f.elements.weather_lon.value) || 6.18;
            } else if (type === 'service') {
                config.service_id = parseInt(f.elements.service_id.value) || 0;
            } else if (type === 'camera') {
                config.camera_url = f.elements.camera_url ? f.elements.camera_url.value.trim() : '';
            }
            
            var body = {
                page_id: PAGE_DATA.currentPage || 1,
                type: type,
                config: config,
                icon_size: f.elements.icon_size.value,
                text_size: f.elements.text_size.value,
                col_span: parseInt(qs('#gridWidgetColSpan').value) || 1,
                row_span: parseInt(qs('#gridWidgetRowSpan').value) || 1,
                grid_col: parseInt(qs('#gridWidgetCol').value) || 0,
                grid_row: parseInt(qs('#gridWidgetRow').value) || 0
            };
            
            var eid = f.dataset.editId;
            var p = eid ? api('PUT', '/api/grid-widgets/' + eid, body)
                        : api('POST', '/api/grid-widgets', body);
            p.then(function () { location.href = editUrl(); })
             .catch(function (err) { showToast(err.message, 'error'); });
        });
    }
    var gridWidgetModalEl = qs('#gridWidgetModal');
    if (gridWidgetModalEl) {
        gridWidgetModalEl.addEventListener('hidden.bs.modal', function () {
            pendingPosition = null;
        });
    }
    /* -- Reglages -- */
    var settingsForm = qs('#settingsForm');
    if (settingsForm) {
        // Toggle custom theme options visibility
        var themeSelect = settingsForm.elements.theme;
        if (themeSelect) {
            themeSelect.addEventListener('change', function () {
                var box = qs('#customThemeOptions');
                if (box) box.style.display = themeSelect.value === 'custom' ? 'block' : 'none';
            });
        }
        settingsForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var f = e.target;
            var settingsBody = {
                title: f.elements.title.value,
                theme: f.elements.theme.value,
                background_url: f.elements.background_url.value,
                search_provider: f.elements.search_provider.value,
                refresh_interval: f.elements.refresh_interval ? f.elements.refresh_interval.value : '30',
                caldav_url: f.elements.caldav_url ? f.elements.caldav_url.value : '',
                caldav_username: f.elements.caldav_username ? f.elements.caldav_username.value : '',
                caldav_password: f.elements.caldav_password ? f.elements.caldav_password.value : '',
                camera_urls: f.elements.camera_urls ? f.elements.camera_urls.value : ''
            };
            if (f.elements.theme.value === 'custom') {
                settingsBody.custom_accent = f.elements.custom_accent ? f.elements.custom_accent.value : '#ff6b35';
                settingsBody.custom_bg = f.elements.custom_bg ? f.elements.custom_bg.value : '#0f0f1a';
                settingsBody.custom_card_bg = f.elements.custom_card_bg ? f.elements.custom_card_bg.value : '#1a1a2e';
                settingsBody.custom_text = f.elements.custom_text ? f.elements.custom_text.value : '#e0e0e0';
            }
            var widgetsBody = {
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
                health: { enabled: f.elements.health_enabled.checked, config: {} },
                calendar: { enabled: true, config: {} },
                camera: { enabled: f.elements.camera_enabled ? f.elements.camera_enabled.checked : false, config: {} }
            };
            Promise.all([
                api('PUT', '/api/settings', settingsBody),
                api('PUT', '/api/widgets', widgetsBody)
            ]).then(function () { location.href = editUrl(); })
              .catch(function (err) { showToast(err.message, 'error'); });
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
                if (d.error) { showToast(d.error, 'error'); return; }
                var targetForm = e.target.dataset.target;
                var form = qs('#' + targetForm);
                if (form) form.elements.icon.value = d.url;
            })
            .catch(function (err) { showToast('Erreur upload : ' + err.message, 'error'); });
        e.target.value = '';
    });
    /* -- Fetch favicon -- */
    var fetchFavBtn = qs('#fetchFavicon');
    if (fetchFavBtn) {
        fetchFavBtn.addEventListener('click', function () {
            var urlInput = qs('#linkForm input[name="url"]');
            var iconInput = qs('#linkForm input[name="icon"]');
            if (!urlInput || !iconInput || !urlInput.value.trim()) {
                showToast("Renseignez d'abord l'URL du lien", 'error');
                return;
            }
            fetch('/api/favicon?url=' + encodeURIComponent(urlInput.value.trim()))
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.error) { showToast(d.error, 'error'); return; }
                    iconInput.value = d.icon;
                })
                .catch(function (err) { showToast('Erreur : ' + err.message, 'error'); });
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
                    if (d.error) { showToast(d.error, 'error'); return; }
                    var urlInput = qs('#settingsForm input[name="background_url"]');
                    if (urlInput) urlInput.value = d.url;
                })
                .catch(function (err) { showToast('Erreur upload : ' + err.message, 'error'); });
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
                .catch(function (err) { showToast('Erreur export : ' + err.message, 'error'); });
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
                        .catch(function (err) { showToast('Erreur import : ' + err.message, 'error'); });
                } catch (ex) {
                    showToast('Fichier JSON invalide', 'error');
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
             .catch(function (err) { showToast(err.message, 'error'); });
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
             .catch(function (err) { showToast(err.message, 'error'); });
        });
    }
    /* -- Chargement des donnees service -- */
    function renderServiceData(el, stype, data) {
        var html = '';
        if (data.error) {
            html = '<span class="text-warning" style="font-size:0.78rem"><i class="bi bi-exclamation-triangle"></i> ' + escHtml(data.error) + '</span>';
            el.innerHTML = html;
            return;
        }
        if (stype === 'pretgo') {
            var mat = data.total_materiel;
            var pers = data.total_personnes;
            html += '<div class="svc-app-block">';
            if (mat !== null && mat !== undefined) {
                html += '<div class="svc-stat"><i class="bi bi-box-seam"></i> <strong>' + mat + '</strong> matériels</div>';
                if (data.etats) {
                    var etats = data.etats;
                    var eKeys = Object.keys(etats);
                    html += '<div class="svc-etats">';
                    eKeys.forEach(function(k) { html += '<span class="svc-badge">' + escHtml(k) + ' : ' + etats[k] + '</span> '; });
                    html += '</div>';
                }
            }
            if (pers !== null && pers !== undefined) {
                html += '<div class="svc-stat"><i class="bi bi-people"></i> <strong>' + pers + '</strong> personnes</div>';
            }
            if (mat === null && pers === null) {
                html += '<div class="svc-stat text-muted"><i class="bi bi-info-circle"></i> Aucune donnée disponible</div>';
            }
            html += '</div>';
        } else if (stype === 'fabtrack') {
            html += '<div class="svc-app-block">';
            if (data.interventions_total !== null && data.interventions_total !== undefined) {
                html += '<div class="svc-stat"><i class="bi bi-clipboard-data"></i> <strong>' + data.interventions_total + '</strong> interventions</div>';
                if (data.impression_3d_grammes) html += '<div class="svc-stat"><i class="bi bi-printer"></i> 3D : ' + data.impression_3d_grammes + ' g</div>';
                if (data.decoupe_m2) html += '<div class="svc-stat"><i class="bi bi-scissors"></i> Découpe : ' + data.decoupe_m2 + ' m²</div>';
            }
            if (data.machines && data.machines.length) {
                html += '<div class="svc-machines">';
                data.machines.forEach(function(m) {
                    var cls = m.statut === 'disponible' ? 'svc-ok' : (m.statut === 'hors_service' ? 'svc-err' : 'svc-warn');
                    html += '<span class="svc-machine ' + cls + '" title="' + escHtml(m.statut) + '">' + escHtml(m.nom) + '</span> ';
                });
                html += '</div>';
            }
            if (data.interventions_total === null && (!data.machines || !data.machines.length)) {
                html += '<div class="svc-stat text-muted"><i class="bi bi-info-circle"></i> Aucune donnée disponible</div>';
            }
            html += '</div>';
        } else if (stype === 'pihole') {
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
        } else if (stype === 'docker') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-box"></i> <strong>' + (data.total || 0) + '</strong> containers';
            html += ' (<span class="text-success">' + (data.running || 0) + ' up</span>';
            if (data.stopped) html += ', <span class="text-warning">' + data.stopped + ' off</span>';
            html += ')</div>';
            if (data.containers && data.containers.length) {
                html += '<div class="svc-machines">';
                data.containers.forEach(function(c) {
                    var cls = c.state === 'running' ? 'svc-ok' : 'svc-err';
                    html += '<span class="svc-machine ' + cls + '" title="' + escHtml(c.status) + '">' + escHtml(c.name) + '</span> ';
                });
                html += '</div>';
            }
            html += '</div>';
        } else if (stype === 'portainer') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-hdd-stack"></i> <strong>' + (data.endpoints || 0) + '</strong> endpoints</div>';
            html += '<div class="svc-stat"><i class="bi bi-box"></i> <strong>' + (data.containers_running || 0) + '</strong> running / ' + (data.containers_total || 0) + ' total</div>';
            html += '</div>';
        } else if (stype === 'proxmox') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-server"></i> <strong>' + (data.nodes || 0) + '</strong> nœuds</div>';
            if (data.node_list && data.node_list.length) {
                html += '<div class="svc-machines">';
                data.node_list.forEach(function(n) {
                    var cls = n.status === 'online' ? 'svc-ok' : 'svc-err';
                    html += '<span class="svc-machine ' + cls + '" title="CPU: ' + n.cpu + '%">' + escHtml(n.name) + '</span> ';
                });
                html += '</div>';
            }
            html += '</div>';
        } else if (stype === 'plex') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-film"></i> <strong>' + (data.libraries || 0) + '</strong> bibliothèques</div>';
            html += '<div class="svc-stat"><i class="bi bi-play-circle"></i> <strong>' + (data.active_streams || 0) + '</strong> flux actifs</div>';
            if (data.library_list && data.library_list.length) {
                html += '<div class="svc-etats">';
                data.library_list.forEach(function(l) { html += '<span class="svc-badge">' + escHtml(l.title) + '</span> '; });
                html += '</div>';
            }
            html += '</div>';
        } else if (stype === 'radarr') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-camera-reels"></i> <strong>' + (data.total || 0) + '</strong> films</div>';
            html += '<div class="svc-stat"><i class="bi bi-eye"></i> ' + (data.monitored || 0) + ' surveillés, <strong>' + (data.has_file || 0) + '</strong> dispo</div>';
            if (data.missing) html += '<div class="svc-stat text-warning"><i class="bi bi-exclamation-circle"></i> ' + data.missing + ' manquants</div>';
            html += '</div>';
        } else if (stype === 'sonarr') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-tv"></i> <strong>' + (data.total || 0) + '</strong> séries</div>';
            html += '<div class="svc-stat"><i class="bi bi-collection-play"></i> ' + (data.episodes_have || 0) + ' / ' + (data.episodes_total || 0) + ' épisodes</div>';
            html += '</div>';
        } else if (stype === 'truenas') {
            html = '<div class="svc-app-block">';
            html += '<div class="svc-stat"><i class="bi bi-device-hdd"></i> <strong>' + (data.pools || 0) + '</strong> pools</div>';
            if (data.pool_list && data.pool_list.length) {
                html += '<div class="svc-machines">';
                data.pool_list.forEach(function(p) {
                    var cls = p.healthy ? 'svc-ok' : 'svc-err';
                    html += '<span class="svc-machine ' + cls + '" title="' + escHtml(p.status) + '">' + escHtml(p.name) + '</span> ';
                });
                html += '</div>';
            }
            if (data.alerts) html += '<div class="svc-stat text-warning"><i class="bi bi-bell"></i> ' + data.alerts + ' alertes</div>';
            html += '</div>';
        } else {
            var keys = Object.keys(data).slice(0, 3);
            keys.forEach(function (k) {
                html += '<span class="svc-kv"><strong>' + escHtml(k) + '</strong>: ' + escHtml(String(data[k]).substring(0, 50)) + '</span> ';
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
                .catch(function (err) { showToast(err.message, 'error'); });
        });
    }
    /* ══════════════════════════════════════
       DRAG & DROP — GROUPES (grille + palette)
       ══════════════════════════════════════ */
    var draggingGroupId = null;
    var draggingGridWidgetId = null;
    var draggingColSpan = 1;
    var draggingRowSpan = 1;
    var dragSource = null;
    var draggedLink = null;
    if (gridBoard) {
        gridBoard.addEventListener('dragstart', function (e) {
            if (e.target.closest('.link-wrap')) return;
            var card = e.target.closest('.group-card');
            var wcard = e.target.closest('.grid-widget-card');
            if (card && editMode) {
                draggingGroupId = parseInt(card.dataset.groupId);
                var g = findGroup(draggingGroupId);
                draggingColSpan = g ? (g.col_span || 1) : 1;
                draggingRowSpan = g ? (g.row_span || 1) : 1;
                dragSource = 'grid';
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'group');
            } else if (wcard && editMode) {
                draggingGridWidgetId = parseInt(wcard.dataset.gridWidgetId);
                var gw = (PAGE_DATA.grid_widgets || []).find(function(w) { return w.id === draggingGridWidgetId; });
                draggingColSpan = gw ? (gw.col_span || 1) : 1;
                draggingRowSpan = gw ? (gw.row_span || 1) : 1;
                dragSource = 'grid';
                wcard.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'gridwidget');
            }
        });
        gridBoard.addEventListener('dragover', function (e) {
            if (!draggingGroupId && !draggingGridWidgetId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var cell = getCellFromPoint(e.clientX, e.clientY);
            if (!cell || !highlight) return;
            var excludeId = draggingGroupId ? ('g_' + draggingGroupId) : ('w_' + draggingGridWidgetId);
            var ok = canPlace(cell.row, cell.col, draggingColSpan, draggingRowSpan, excludeId);
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
            var cell = getCellFromPoint(e.clientX, e.clientY);
            if (!cell) return;
            if (draggingGroupId) {
                var excludeId = 'g_' + draggingGroupId;
                if (!canPlace(cell.row, cell.col, draggingColSpan, draggingRowSpan, excludeId)) return;
                api('POST', '/api/groups/' + draggingGroupId + '/move', {
                    grid_row: cell.row,
                    grid_col: cell.col
                }).then(function () {
                    location.href = editUrl();
                }).catch(function (err) { showToast(err.message, 'error'); });
            } else if (draggingGridWidgetId) {
                var excludeId2 = 'w_' + draggingGridWidgetId;
                if (!canPlace(cell.row, cell.col, draggingColSpan, draggingRowSpan, excludeId2)) return;
                api('POST', '/api/grid-widgets/' + draggingGridWidgetId + '/move', {
                    grid_row: cell.row,
                    grid_col: cell.col
                }).then(function () {
                    location.href = editUrl();
                }).catch(function (err) { showToast(err.message, 'error'); });
            }
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
        if (draggingGroupId || draggingGridWidgetId) {
            qsa('.group-card.dragging, .palette-block.dragging, .grid-widget-card.dragging').forEach(function (el) {
                el.classList.remove('dragging');
            });
            if (highlight) highlight.classList.remove('visible');
            draggingGroupId = null;
            draggingGridWidgetId = null;
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
                        .catch(function (err) { showToast(err.message, 'error'); });
                }
                break;
            case 'unplace-group':
                api('POST', '/api/groups/' + id + '/move', { grid_row: -1, grid_col: 0 })
                    .then(function () { location.href = editUrl(); })
                    .catch(function (err) { showToast(err.message, 'error'); });
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
                        .catch(function (err) { showToast(err.message, 'error'); });
                }
                break;
            case 'new-grid-widget':
                openGridWidgetModal(null);
                break;
            case 'edit-grid-widget':
                openGridWidgetModal(id);
                break;
            case 'delete-grid-widget':
                if (confirm('Supprimer ce widget ?')) {
                    api('DELETE', '/api/grid-widgets/' + id)
                        .then(function () { location.href = editUrl(); })
                        .catch(function (err) { showToast(err.message, 'error'); });
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
                        .catch(function (err) { showToast(err.message, 'error'); });
                }
                break;
            case 'new-service':
                if (settingsModal) settingsModal.hide();
                setTimeout(function() { openServiceModal(null); }, 350);
                break;
            case 'edit-service':
                if (settingsModal) settingsModal.hide();
                setTimeout(function() { openServiceModal(id); }, 350);
                break;
            case 'delete-service':
                if (confirm('Supprimer ce service ?')) {
                    api('DELETE', '/api/services/' + id)
                        .then(function () { location.href = editUrl(); })
                        .catch(function (err) { showToast(err.message, 'error'); });
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
    setInterval(updateClock, 1000);
    checkStatuses();
    setInterval(checkStatuses, 60000);
    loadWeather();
    setInterval(loadWeather, 1800000);
    loadHealth();
    setInterval(loadHealth, 30000);
    // ── Grid Widget live updates ──
    function loadGridWidgetCalendars() {
        qsa('.grid-widget-card[data-widget-type="calendar"]').forEach(function(card) {
            var eventsDiv = card.querySelector('.gw-calendar-events');
            if (!eventsDiv) return;
            api('GET', '/api/calendar/events')
                .then(function (data) {
                    if (!data.events || data.events.length === 0) {
                        eventsDiv.innerHTML = '<div class="calendar-empty">Aucun événement à venir</div>';
                        return;
                    }
                    eventsDiv.innerHTML = data.events.slice(0, 8).map(function (ev) {
                        var html = '<div class="calendar-event">';
                        html += '<div class="calendar-event-title">' + escHtml(ev.title || 'Sans titre') + '</div>';
                        if (ev.start) html += '<div class="calendar-event-time"><i class="bi bi-clock"></i> ' + escHtml(ev.start) + '</div>';
                        if (ev.location) html += '<div class="calendar-event-location"><i class="bi bi-geo-alt"></i> ' + escHtml(ev.location) + '</div>';
                        html += '</div>';
                        return html;
                    }).join('');
                })
                .catch(function () {
                    eventsDiv.innerHTML = '<div class="calendar-empty">Erreur de chargement</div>';
                });
        });
    }
    loadGridWidgetCalendars();
    setInterval(loadGridWidgetCalendars, 300000);
    // ── Grid Widget service live updates ──
    function loadGridWidgetServices() {
        qsa('.gw-service').forEach(function(el) {
            var sid = parseInt(el.dataset.serviceId);
            if (!sid) return;
            var statusEl = el.querySelector('.gw-service-status');
            var dataEl = el.querySelector('.gw-service-data');
            fetch('/api/services/' + sid + '/proxy')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        if (statusEl) statusEl.textContent = '\u26A0\uFE0F';
                        if (dataEl) dataEl.textContent = escHtml(data.error);
                        return;
                    }
                    if (statusEl) statusEl.textContent = '\u2705';
                    if (dataEl) {
                        var card = el.closest('.grid-widget-card');
                        var stype = '';
                        if (card) {
                            var gw = (PAGE_DATA.grid_widgets || []).find(function(w) { return w.id === parseInt(card.dataset.gridWidgetId); });
                            if (gw) {
                                var svc = (PAGE_DATA.services || []).find(function(s) { return s.id === sid; });
                                stype = svc ? svc.type : '';
                            }
                        }
                        renderServiceData(dataEl, stype, data);
                    }
                })
                .catch(function() {
                    if (statusEl) statusEl.textContent = '\u274C';
                });
        });
    }
    loadGridWidgetServices();
    // ── Grid Widget camera refresh ──
    function refreshGridWidgetCameras() {
        qsa('.gw-camera-img').forEach(function(img) {
            var base = img.dataset.baseSrc || img.getAttribute('src');
            if (!img.dataset.baseSrc) img.dataset.baseSrc = base.split('?')[0];
            img.src = img.dataset.baseSrc + '?t=' + Date.now();
        });
    }
    // ── Dynamic refresh interval ──
    var refreshMs = parseInt(PAGE_DATA.settings.refresh_interval || '30') * 1000;
    if (refreshMs > 0) {
        setInterval(loadGridWidgetServices, refreshMs);
        setInterval(refreshGridWidgetCameras, refreshMs);
    }
    /* ══════════════════════════════════════
       GESTION DES PROFILS
       ══════════════════════════════════════ */
    function initProfiles() {
        var profileSelector = qs('.header-profile');
        if (!profileSelector) return;
        var profileBtn = qs('.header-profile-btn', profileSelector);
        var profileDropdown = qs('.profile-dropdown', profileSelector);
        // Toggle dropdown
        profileBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            profileDropdown.classList.toggle('hidden');
        });
        // Close dropdown when clicking outside
        document.addEventListener('click', function () {
            profileDropdown.classList.add('hidden');
        });
        // Profile switching
        qsa('.profile-item[data-profile-id]', profileDropdown).forEach(function (item) {
            item.addEventListener('click', function () {
                var profileId = this.getAttribute('data-profile-id');
                api('POST', '/api/profiles/switch', { profile_id: parseInt(profileId) })
                    .then(function () {
                        window.location.reload();
                    })
                    .catch(function (e) {
                        showToast('Erreur changement profil: ' + e.message, 'error');
                    });
            });
        });
        // Add profile button
        var addBtn = qs('.profile-add', profileDropdown);
        if (addBtn) {
            addBtn.addEventListener('click', function () {
                var name = prompt('Nom du profil:');
                if (!name) return;
                var icon = prompt('Icône (emoji):', '👤');
                if (!icon) return;
                api('POST', '/api/profiles', { name: name, icon: icon })
                    .then(function () {
                        window.location.reload();
                    })
                    .catch(function (e) {
                        showToast('Erreur création profil: ' + e.message, 'error');
                    });
            });
        }
        // Manage profiles button
        var manageBtn = qs('.profile-manage', profileDropdown);
        if (manageBtn) {
            manageBtn.addEventListener('click', function () {
                profileDropdown.classList.add('hidden');
                openProfileManager();
            });
        }
    }
    function openProfileManager() {
        var profiles = PAGE_DATA.profiles || [];
        var html = '<div style="max-height:60vh;overflow:auto">';
        profiles.forEach(function (p) {
            var isDefault = p.id === 1;
            html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1)">';
            html += '<span style="font-size:1.3rem">' + escHtml(p.icon) + '</span>';
            html += '<span style="flex:1;font-weight:600">' + escHtml(p.name) + '</span>';
            if (!isDefault) {
                html += '<button class="btn btn-sm btn-outline-light pm-rename" data-id="' + p.id + '" data-name="' + escHtml(p.name) + '" data-icon="' + escHtml(p.icon) + '"><i class="bi bi-pencil"></i></button>';
                html += '<button class="btn btn-sm btn-outline-danger pm-delete" data-id="' + p.id + '" data-name="' + escHtml(p.name) + '"><i class="bi bi-trash"></i></button>';
            } else {
                html += '<span class="badge bg-secondary">Principal</span>';
            }
            html += '</div>';
        });
        html += '</div>';
        var modalId = 'profileManagerModal';
        var existing = qs('#' + modalId);
        if (existing) existing.remove();
        var wrapper = document.createElement('div');
        wrapper.innerHTML = '<div class="modal fade" id="' + modalId + '" tabindex="-1">' +
            '<div class="modal-dialog"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title">Gérer les profils</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
            '<div class="modal-body">' + html + '</div>' +
            '</div></div></div>';
        document.body.appendChild(wrapper.firstChild);
        var modalEl = qs('#' + modalId);
        var bsModal = new bootstrap.Modal(modalEl);
        qsa('.pm-rename', modalEl).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pid = parseInt(this.dataset.id);
                var newName = prompt('Nouveau nom:', this.dataset.name);
                if (!newName) return;
                var newIcon = prompt('Nouvelle icône (emoji):', this.dataset.icon);
                if (!newIcon) return;
                api('PUT', '/api/profiles/' + pid, { name: newName, icon: newIcon })
                    .then(function () { window.location.reload(); })
                    .catch(function (e) { showToast('Erreur: ' + e.message, 'error'); });
            });
        });
        qsa('.pm-delete', modalEl).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pid = parseInt(this.dataset.id);
                var pname = this.dataset.name;
                if (!confirm('Supprimer le profil "' + pname + '" et toutes ses données ?')) return;
                api('DELETE', '/api/profiles/' + pid)
                    .then(function () { window.location.reload(); })
                    .catch(function (e) { showToast('Erreur: ' + e.message, 'error'); });
            });
        });
        bsModal.show();
    }
    /* ══════════════════════════════════════
       INITIALISATION
       ══════════════════════════════════════ */
    initProfiles();
    if (PAGE_DATA.editOnLoad) {
        setEditMode(true);
    } else {
        try {
            if (sessionStorage.getItem('fh_edit') === '1') setEditMode(true);
        } catch (e) {}
    }
})();
