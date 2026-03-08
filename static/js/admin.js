/* FabHome — Logique panneau d'administration */

// ── Helpers ──────────────────────────────────────────────
function api(method, url, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (resp) {
        if (!resp.ok) {
            return resp.json().catch(function () { return { error: 'Erreur' }; })
                .then(function (err) { throw new Error(err.error || 'Erreur'); });
        }
        return resp.json();
    });
}

function reload() { location.reload(); }

// ── Modales Bootstrap ────────────────────────────────────
var groupModalEl = document.getElementById('groupModal');
var linkModalEl  = document.getElementById('linkModal');
var groupModal   = groupModalEl ? new bootstrap.Modal(groupModalEl) : null;
var linkModal    = linkModalEl  ? new bootstrap.Modal(linkModalEl)  : null;

// ── Groupes ──────────────────────────────────────────────
function showGroupModal(data) {
    var form  = document.getElementById('groupForm');
    var title = document.getElementById('groupModalLabel');
    if (data && data.id) {
        title.textContent = 'Modifier le groupe';
        form.dataset.editId = data.id;
        form.elements.name.value = data.name || '';
        form.elements.icon.value = data.icon || 'bi-folder';
    } else {
        title.textContent = 'Nouveau groupe';
        delete form.dataset.editId;
        form.reset();
        form.elements.icon.value = 'bi-folder';
    }
    groupModal.show();
}

var groupForm = document.getElementById('groupForm');
if (groupForm) {
    groupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        var body = { name: f.elements.name.value, icon: f.elements.icon.value };
        var editId = f.dataset.editId;
        var p = editId
            ? api('PUT', '/api/groups/' + editId, body)
            : api('POST', '/api/groups', body);
        p.then(reload).catch(function (err) { alert(err.message); });
    });
}

function deleteGroup(id, name) {
    if (!confirm('Supprimer le groupe « ' + name + ' » et tous ses liens ?')) return;
    api('DELETE', '/api/groups/' + id).then(reload).catch(function (err) { alert(err.message); });
}

function moveGroup(id, dir) {
    api('POST', '/api/groups/' + id + '/move', { direction: parseInt(dir) }).then(reload)
        .catch(function (err) { alert(err.message); });
}

// ── Liens ────────────────────────────────────────────────
function showLinkModal(data) {
    var form  = document.getElementById('linkForm');
    var title = document.getElementById('linkModalLabel');
    if (data && data.id) {
        title.textContent = 'Modifier le lien';
        form.dataset.editId = data.id;
        form.elements.group_id.value   = data.groupId || '';
        form.elements.name.value       = data.name || '';
        form.elements.url.value        = data.url || '';
        form.elements.icon.value       = data.icon || 'bi-link-45deg';
        form.elements.description.value = data.description || '';
        form.elements.check_status.checked = (data.checkStatus === '1');
    } else {
        title.textContent = 'Ajouter un lien';
        delete form.dataset.editId;
        form.reset();
        form.elements.group_id.value = data.groupId || '';
        form.elements.icon.value = 'bi-link-45deg';
    }
    linkModal.show();
}

var linkForm = document.getElementById('linkForm');
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
        var editId = f.dataset.editId;
        var p = editId
            ? api('PUT', '/api/links/' + editId, body)
            : api('POST', '/api/links', body);
        p.then(reload).catch(function (err) { alert(err.message); });
    });
}

function deleteLink(id, name) {
    if (!confirm('Supprimer le lien « ' + name + ' » ?')) return;
    api('DELETE', '/api/links/' + id).then(reload).catch(function (err) { alert(err.message); });
}

function moveLink(id, dir) {
    api('POST', '/api/links/' + id + '/move', { direction: parseInt(dir) }).then(reload)
        .catch(function (err) { alert(err.message); });
}

// ── Widgets ──────────────────────────────────────────────
var widgetsForm = document.getElementById('widgetsForm');
if (widgetsForm) {
    widgetsForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;

        var widgetsBody = {
            greeting: { enabled: f.elements.greeting_enabled.checked, config: {} },
            clock:    { enabled: f.elements.clock_enabled.checked, config: {} },
            search:   { enabled: f.elements.search_enabled.checked, config: {} },
            weather: {
                enabled: f.elements.weather_enabled.checked,
                config: {
                    city: f.elements.weather_city.value,
                    latitude: parseFloat(f.elements.weather_lat.value) || 48.69,
                    longitude: parseFloat(f.elements.weather_lon.value) || 6.18
                }
            }
        };

        var settingsBody = {
            greeting_name: f.elements.greeting_name.value,
            search_provider: f.elements.search_provider.value
        };

        Promise.all([
            api('PUT', '/api/widgets', widgetsBody),
            api('PUT', '/api/settings', settingsBody)
        ]).then(reload).catch(function (err) { alert(err.message); });
    });
}

// ── Apparence ────────────────────────────────────────────
var settingsForm = document.getElementById('settingsForm');
if (settingsForm) {
    settingsForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        var body = {
            title: f.elements.title.value,
            theme: f.elements.theme.value,
            background_url: f.elements.background_url.value
        };
        api('PUT', '/api/settings', body).then(reload)
            .catch(function (err) { alert(err.message); });
    });
}

// ── Sélecteur d'icônes (clic pour remplir le champ) ─────
document.addEventListener('click', function (e) {
    var pick = e.target.closest('.icon-pick');
    if (!pick) return;
    var icon = pick.dataset.icon;
    var modal = pick.closest('.modal');
    if (modal) {
        var input = modal.querySelector('input[name="icon"]');
        if (input) input.value = icon;
    }
});

// ── Délégation d'événements (boutons data-action) ────────
document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var d = btn.dataset;

    switch (d.action) {
        case 'new-group':
            showGroupModal(null);
            break;
        case 'edit-group':
            showGroupModal(d);
            break;
        case 'delete-group':
            deleteGroup(d.id, d.name);
            break;
        case 'move-group':
            moveGroup(d.id, d.dir);
            break;
        case 'new-link':
            showLinkModal({ groupId: d.groupId });
            break;
        case 'edit-link':
            showLinkModal(d);
            break;
        case 'delete-link':
            deleteLink(d.id, d.name);
            break;
        case 'move-link':
            moveLink(d.id, d.dir);
            break;
    }
});
