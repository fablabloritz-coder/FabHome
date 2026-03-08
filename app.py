"""FabHome — Page d'accueil personnalisée avec grille configurable."""

import os
import logging
import time
import json
import ssl
import uuid
import glob
from datetime import datetime, timedelta
from urllib.parse import urlparse
from urllib.request import urlopen, Request

from flask import Flask, render_template, request, jsonify, redirect, url_for, send_from_directory, session

import models

try:
    import caldav
    CALDAV_AVAILABLE = True
except ImportError:
    CALDAV_AVAILABLE = False
    logging.warning("caldav non installé - widget calendrier indisponible")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024
app.config['SECRET_KEY'] = os.environ.get('FABHOME_SECRET', os.urandom(24).hex())

UPLOAD_DIR = os.path.join(os.environ.get('FABHOME_DATA', 'data'), 'uploads')
ICON_DIR = os.path.join(UPLOAD_DIR, 'icons')
BG_DIR = os.path.join(UPLOAD_DIR, 'bg')
ALLOWED_IMG = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'}

os.makedirs(ICON_DIR, exist_ok=True)
os.makedirs(BG_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

models.init_db()

_cache = {}


def get_current_profile_id():
    """Récupère l'ID du profil actif depuis la session."""
    return session.get('profile_id', 1)


def set_current_profile_id(profile_id):
    """Définit l'ID du profil actif dans la session."""
    session['profile_id'] = profile_id


# ── Pages ─────────────────────────────────────────────────

@app.route('/')
def index():
    profile_id = get_current_profile_id()
    settings = models.get_settings(profile_id)
    pages = models.get_pages(profile_id)
    page_id = request.args.get('page', 1, type=int)
    groups = models.get_groups(page_id=page_id)
    widgets = {w['type']: w for w in models.get_widgets(profile_id)}

    # Parse camera URLs from settings
    camera_urls = settings.get('camera_urls', '')
    camera_streams = []
    if camera_urls:
        for line in camera_urls.strip().split('\n'):
            line = line.strip()
            if '|' in line:
                name, url = line.split('|', 1)
                camera_streams.append({'name': name.strip(), 'url': url.strip()})

    # Add camera streams to camera widget
    if 'camera' not in widgets:
        widgets['camera'] = {'type': 'camera', 'enabled': True, 'config': {}}
    if not widgets['camera'].get('config'):
        widgets['camera']['config'] = {}
    widgets['camera']['config']['streams'] = camera_streams
    
    services = models.get_services()
    profiles = models.get_profiles()
    current_profile = models.get_profile(profile_id)
    grid_widgets = models.get_grid_widgets(page_id)
    
    return render_template('index.html',
                           settings=settings, groups=groups, widgets=widgets,
                           pages=pages, current_page=page_id,
                           services=services,
                           profiles=profiles,
                           current_profile=current_profile,
                           grid_widgets=grid_widgets,
                           groups_json=json.dumps(groups),
                           widgets_json=json.dumps(widgets),
                           pages_json=json.dumps(pages),
                           services_json=json.dumps(services),
                           profiles_json=json.dumps(profiles),
                           grid_widgets_json=json.dumps(grid_widgets))


@app.route('/admin')
def admin():
    return redirect(url_for('index', edit=1))


# ── API : Profils ─────────────────────────────────────────

@app.route('/api/profiles', methods=['GET'])
def api_get_profiles():
    return jsonify(profiles=models.get_profiles(),
                   current=get_current_profile_id())


@app.route('/api/profiles', methods=['POST'])
def api_create_profile():
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify(error='Nom requis'), 400
        profile_id = models.create_profile(
            name[:50],
            (data.get('icon') or '👤')[:10],
            (data.get('color') or '#6c757d')[:20])
        return jsonify(id=profile_id), 201
    except Exception as e:
        logger.error(f"Erreur création profil: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


@app.route('/api/profiles/<int:profile_id>', methods=['PUT'])
def api_update_profile(profile_id):
    data = request.get_json() or {}
    models.update_profile(
        profile_id,
        name=data.get('name'),
        icon=data.get('icon'),
        color=data.get('color'))
    return jsonify(ok=True)


@app.route('/api/profiles/<int:profile_id>', methods=['DELETE'])
def api_delete_profile(profile_id):
    if profile_id == 1:
        return jsonify(error='Cannot delete default profile'), 400
    models.delete_profile(profile_id)
    if get_current_profile_id() == profile_id:
        set_current_profile_id(1)
    return jsonify(ok=True)


@app.route('/api/profiles/switch', methods=['POST'])
def api_switch_profile():
    data = request.get_json() or {}
    profile_id = data.get('profile_id')
    if not profile_id:
        return jsonify(error='profile_id requis'), 400
    profile = models.get_profile(profile_id)
    if not profile:
        return jsonify(error='Profil introuvable'), 404
    set_current_profile_id(profile_id)
    return jsonify(ok=True, profile_id=profile_id)


# ── API : Réglages ────────────────────────────────────────

@app.route('/api/settings', methods=['PUT'])
def api_update_settings():
    try:
        data = request.get_json()
        if not data:
            return jsonify(error='Données manquantes'), 400
        profile_id = get_current_profile_id()
        allowed = {'title', 'theme', 'background_url', 'greeting_name',
                   'search_provider', 'grid_cols', 'grid_rows',
                   'caldav_url', 'caldav_username', 'caldav_password', 'camera_urls'}
        for k, v in data.items():
            if k in allowed:
                models.update_setting(k, str(v)[:500], profile_id)
        return jsonify(ok=True)
    except Exception as e:
        logger.error(f"Erreur mise à jour réglages: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


# ── API : Groupes ─────────────────────────────────────────

@app.route('/api/groups', methods=['POST'])
def api_create_group():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    gid = models.create_group(
        name[:100],
        (data.get('icon') or 'bi-folder')[:500],
        int(data.get('col_span', 1)),
        int(data.get('row_span', 1)),
        int(data.get('grid_row', -1)),
        int(data.get('grid_col', 0)),
        page_id=int(data.get('page_id', 1)),
        icon_size=(data.get('icon_size') or 'medium')[:10],
        text_size=(data.get('text_size') or 'medium')[:10])
    return jsonify(id=gid), 201


@app.route('/api/groups/<int:gid>', methods=['PUT'])
def api_update_group(gid):
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    models.update_group(
        gid, name[:100],
        (data.get('icon') or 'bi-folder')[:500],
        col_span=int(data['col_span']) if 'col_span' in data else None,
        row_span=int(data['row_span']) if 'row_span' in data else None,
        grid_row=int(data['grid_row']) if 'grid_row' in data else None,
        grid_col=int(data['grid_col']) if 'grid_col' in data else None,
        icon_size=(data['icon_size'])[:10] if 'icon_size' in data else None,
        text_size=(data['text_size'])[:10] if 'text_size' in data else None)
    return jsonify(ok=True)


@app.route('/api/groups/<int:gid>', methods=['DELETE'])
def api_delete_group(gid):
    models.delete_group(gid)
    return jsonify(ok=True)


@app.route('/api/groups/<int:gid>/move', methods=['POST'])
def api_move_group(gid):
    data = request.get_json() or {}
    if 'grid_row' not in data or 'grid_col' not in data:
        return jsonify(error='grid_row et grid_col requis'), 400
    models.move_group(gid, int(data['grid_row']), int(data['grid_col']))
    return jsonify(ok=True)


# ── API : Liens ───────────────────────────────────────────

def _validate_url(raw):
    url = raw.strip()[:2000]
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https', ''):
        return None
    if not parsed.scheme:
        url = 'https://' + url
    return url


@app.route('/api/links', methods=['POST'])
def api_create_link():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    raw_url = (data.get('url') or '').strip()
    group_id = data.get('group_id')
    if not name or not raw_url or not group_id:
        return jsonify(error='Nom, URL et groupe requis'), 400
    url = _validate_url(raw_url)
    if not url:
        return jsonify(error='URL invalide (HTTP/HTTPS uniquement)'), 400
    lid = models.create_link(
        group_id=int(group_id), name=name[:100], url=url,
        icon=(data.get('icon') or 'bi-link-45deg')[:500],
        description=(data.get('description') or '')[:200],
        check_status=1 if data.get('check_status') else 0)
    return jsonify(id=lid), 201


@app.route('/api/links/<int:lid>', methods=['PUT'])
def api_update_link(lid):
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    raw_url = (data.get('url') or '').strip()
    if not name or not raw_url:
        return jsonify(error='Nom et URL requis'), 400
    url = _validate_url(raw_url)
    if not url:
        return jsonify(error='URL invalide'), 400
    models.update_link(lid, name[:100], url,
                       (data.get('icon') or 'bi-link-45deg')[:500],
                       (data.get('description') or '')[:200],
                       1 if data.get('check_status') else 0,
                       group_id=data.get('group_id'))
    return jsonify(ok=True)


@app.route('/api/links/<int:lid>', methods=['DELETE'])
def api_delete_link(lid):
    models.delete_link(lid)
    return jsonify(ok=True)


@app.route('/api/links/reorder', methods=['POST'])
def api_reorder_links():
    data = request.get_json() or {}
    group_id = data.get('group_id')
    ids = data.get('order', [])
    if not group_id or not isinstance(ids, list):
        return jsonify(error='group_id et order requis'), 400
    models.reorder_links(int(group_id), [int(i) for i in ids])
    return jsonify(ok=True)


# ── API : Grid Widgets (widgets autonomes sur la grille) ──

@app.route('/api/grid-widgets', methods=['POST'])
def api_create_grid_widget():
    """Créer un widget autonome sur la grille"""
    try:
        data = request.get_json() or {}
        wtype = (data.get('type') or '').strip()
        if not wtype:
            return jsonify(error='type requis'), 400
        
        allowed_types = {'clock', 'weather', 'calendar', 'camera', 'service', 'health', 'note'}
        if wtype not in allowed_types:
            return jsonify(error=f'Type invalide. Types autorisés: {", ".join(allowed_types)}'), 400
        
        page_id = data.get('page_id', 1)
        wid = models.create_grid_widget(
            page_id=int(page_id),
            wtype=wtype,
            config=data.get('config', {}),
            icon_size=data.get('icon_size', 'medium'),
            text_size=data.get('text_size', 'medium'),
            col_span=int(data.get('col_span', 1)),
            row_span=int(data.get('row_span', 1)),
            grid_col=int(data.get('grid_col', 0)),
            grid_row=int(data.get('grid_row', -1)))
        return jsonify(id=wid), 201
    except Exception as e:
        logger.error(f"Erreur création widget grille: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


@app.route('/api/grid-widgets/<int:wid>', methods=['PUT'])
def api_update_grid_widget(wid):
    """Mettre à jour un widget de grille"""
    try:
        data = request.get_json() or {}
        models.update_grid_widget(
            wid,
            wtype=data.get('type'),
            config=data.get('config'),
            icon_size=data.get('icon_size'),
            text_size=data.get('text_size'),
            col_span=int(data['col_span']) if 'col_span' in data else None,
            row_span=int(data['row_span']) if 'row_span' in data else None)
        return jsonify(ok=True)
    except Exception as e:
        logger.error(f"Erreur mise à jour widget grille: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


@app.route('/api/grid-widgets/<int:wid>/move', methods=['POST'])
def api_move_grid_widget(wid):
    """Déplacer un widget sur la grille"""
    try:
        data = request.get_json() or {}
        if 'grid_row' not in data or 'grid_col' not in data:
            return jsonify(error='grid_row et grid_col requis'), 400
        models.move_grid_widget(wid, int(data['grid_row']), int(data['grid_col']))
        return jsonify(ok=True)
    except Exception as e:
        logger.error(f"Erreur déplacement widget: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


@app.route('/api/grid-widgets/<int:wid>', methods=['DELETE'])
def api_delete_grid_widget(wid):
    """Supprimer un widget de grille"""
    try:
        models.delete_grid_widget(wid)
        return jsonify(ok=True)
    except Exception as e:
        logger.error(f"Erreur suppression widget grille: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


# ── API : Widgets ─────────────────────────────────────────

@app.route('/api/widgets', methods=['PUT'])
def api_update_widgets():
    data = request.get_json()
    if not data:
        return jsonify(error='Données manquantes'), 400
    profile_id = get_current_profile_id()
    allowed = {'greeting', 'search', 'clock', 'weather', 'health', 'calendar', 'camera'}
    for wtype, wdata in data.items():
        if wtype in allowed and isinstance(wdata, dict):
            models.update_widget(wtype,
                                 1 if wdata.get('enabled') else 0,
                                 wdata.get('config', {}),
                                 profile_id)
    return jsonify(ok=True)


# ── API : Pages ───────────────────────────────────────────

@app.route('/api/pages', methods=['POST'])
def api_create_page():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    profile_id = get_current_profile_id()
    pid = models.create_page(name[:100], (data.get('icon') or 'bi-file-earmark')[:500], profile_id)
    return jsonify(id=pid), 201


@app.route('/api/pages/<int:pid>', methods=['PUT'])
def api_update_page(pid):
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    models.update_page(pid, name[:100], (data.get('icon') or 'bi-file-earmark')[:500])
    return jsonify(ok=True)


@app.route('/api/pages/<int:pid>', methods=['DELETE'])
def api_delete_page(pid):
    if pid == 1:
        return jsonify(error='Impossible de supprimer la page par défaut'), 400
    models.delete_page(pid)
    return jsonify(ok=True)


@app.route('/api/pages/reorder', methods=['POST'])
def api_reorder_pages():
    data = request.get_json() or {}
    ids = data.get('order', [])
    if not isinstance(ids, list):
        return jsonify(error='order requis'), 400
    models.reorder_pages([int(i) for i in ids])
    return jsonify(ok=True)


# ── API : Services ────────────────────────────────────────

@app.route('/api/services', methods=['POST'])
def api_create_service():
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify(error='Nom requis'), 400
        stype = (data.get('type') or 'generic').strip()[:50]
        url = (data.get('url') or '').strip()[:2000]
        api_key = (data.get('api_key') or '')[:500]
        config = data.get('config', {})
        sid = models.create_service(name[:100], stype, url, api_key, config)
        return jsonify(id=sid), 201
    except Exception as e:
        logger.error(f"Erreur création service: {e}")
        return jsonify(error=f'Erreur: {str(e)}'), 500


@app.route('/api/services/<int:sid>', methods=['PUT'])
def api_update_service(sid):
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    models.update_service(
        sid, name[:100],
        (data.get('type') or 'generic')[:50],
        (data.get('url') or '')[:2000],
        (data.get('api_key') or '')[:500],
        data.get('config', {}),
        1 if data.get('enabled', True) else 0)
    return jsonify(ok=True)


@app.route('/api/services/<int:sid>', methods=['DELETE'])
def api_delete_service(sid):
    models.delete_service(sid)
    return jsonify(ok=True)


@app.route('/api/services/<int:sid>/proxy')
def api_service_proxy(sid):
    """Proxy pour interroger un service externe (évite CORS)."""
    services = models.get_services()
    svc = next((s for s in services if s['id'] == sid), None)
    if not svc or not svc['enabled']:
        return jsonify(error='Service non trouvé'), 404
    try:
        svc_url = svc['url'].rstrip('/')
        svc_type = svc.get('type', 'generic')
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        headers = {'User-Agent': 'FabHome/1.0'}
        if svc.get('api_key'):
            headers['X-Api-Key'] = svc['api_key']

        def _fetch_json(url):
            req = Request(url)
            for k, v in headers.items():
                req.add_header(k, v)
            resp = urlopen(req, timeout=10, context=ctx)
            return json.loads(resp.read().decode())

        # ── PrêtGo : agrège inventaire + personnes
        if svc_type == 'pretgo':
            result = {'type': 'pretgo'}
            try:
                inv = _fetch_json(svc_url + '/api/inventaire')
                items = inv if isinstance(inv, list) else inv.get('data', inv.get('items', []))
                result['total_materiel'] = len(items)
                etats = {}
                for it in items:
                    e = it.get('etat', it.get('état', 'inconnu'))
                    etats[e] = etats.get(e, 0) + 1
                result['etats'] = etats
            except Exception:
                result['total_materiel'] = None
            try:
                pers = _fetch_json(svc_url + '/api/personnes')
                plist = pers if isinstance(pers, list) else pers.get('data', pers.get('items', []))
                result['total_personnes'] = len(plist)
            except Exception:
                result['total_personnes'] = None
            return jsonify(result)

        # ── Fabtrack : résumé stats + machines
        if svc_type == 'fabtrack':
            result = {'type': 'fabtrack'}
            try:
                summary = _fetch_json(svc_url + '/api/stats/summary')
                result['interventions_total'] = summary.get('interventions_total', 0)
                result['impression_3d_grammes'] = summary.get('impression_3d_grammes', 0)
                result['decoupe_m2'] = summary.get('decoupe_m2', 0)
                result['papier_feuilles'] = summary.get('papier_feuilles', 0)
                by_type = summary.get('by_type', [])
                result['by_type'] = by_type[:5] if isinstance(by_type, list) else []
            except Exception:
                result['interventions_total'] = None
            try:
                ref = _fetch_json(svc_url + '/api/reference')
                machines = ref.get('machines', [])
                result['machines_total'] = len(machines)
                result['machines_actives'] = len([m for m in machines if m.get('actif')])
                result['machines'] = [{'nom': m.get('nom', ''), 'statut': m.get('statut', '')} for m in machines[:8]]
            except Exception:
                result['machines_total'] = None
            return jsonify(result)

        # ── Générique / autres types
        endpoint = svc.get('config', {}).get('endpoint', '')
        target = svc_url + endpoint
        data = _fetch_json(target)
        return jsonify(data)
    except Exception as e:
        return jsonify(error=str(e)), 502


# ── API : Import / Export ─────────────────────────────────

@app.route('/api/config/export')
def api_export_config():
    data = models.export_all()
    return jsonify(data)


@app.route('/api/config/import', methods=['POST'])
def api_import_config():
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify(error='JSON invalide'), 400
    if 'settings' not in data and 'groups' not in data:
        return jsonify(error='Données de configuration requises'), 400
    models.import_all(data)
    return jsonify(ok=True)


# ── API : Statuts ─────────────────────────────────────────

# Servir les fichiers uploadés
@app.route('/uploads/<path:filepath>')
def serve_upload(filepath):
    return send_from_directory(UPLOAD_DIR, filepath)


# Upload d'icône
@app.route('/api/upload/icon', methods=['POST'])
def api_upload_icon():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify(error='Fichier manquant'), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_IMG:
        return jsonify(error='Format non supporté'), 400
    name = uuid.uuid4().hex[:12] + ext
    f.save(os.path.join(ICON_DIR, name))
    return jsonify(url='/uploads/icons/' + name), 201


# Upload de fond d'écran (remplace l'ancien)
@app.route('/api/upload/background', methods=['POST'])
def api_upload_background():
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify(error='Fichier manquant'), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_IMG:
        return jsonify(error='Format non supporté'), 400
    # Supprimer l'ancien fond
    for old in glob.glob(os.path.join(BG_DIR, '*')):
        try:
            os.remove(old)
        except OSError:
            pass
    name = 'background' + ext
    f.save(os.path.join(BG_DIR, name))
    bg_url = '/uploads/bg/' + name
    models.update_setting('background_url', bg_url, get_current_profile_id())
    return jsonify(url=bg_url), 201


# Calendar events (Nextcloud CalDAV)
@app.route('/api/calendar/events')
def api_calendar_events():
    """Récupère les événements du calendrier via CalDAV (public ou authentifié)."""
    if not CALDAV_AVAILABLE:
        return jsonify(error="caldav non installé"), 503

    profile_id = get_current_profile_id()

    # Récupérer les paramètres du calendrier depuis les settings
    settings = models.get_settings(profile_id)
    caldav_url = (settings.get('caldav_url', '') or '').strip()
    caldav_username = (settings.get('caldav_username', '') or '').strip()
    caldav_password = (settings.get('caldav_password', '') or '').strip()

    if not caldav_url:
        return jsonify(events=[], message="URL CalDAV non configurée")
    
    try:
        start = datetime.now()
        end = start + timedelta(days=7)
        all_events = []
        
        # Détecter si c'est un calendrier public (URL contenant public-calendars ou ?export)
        is_public = 'public-calendars' in caldav_url or caldav_url.endswith('?export')
        
        if is_public:
            # Calendrier public : récupérer directement l'ICS
            import requests as req
            resp = req.get(caldav_url, timeout=10)
            resp.raise_for_status()
            
            from icalendar import Calendar as iCalendar
            cal = iCalendar.from_ical(resp.text)
            
            for component in cal.walk():
                if component.name != 'VEVENT':
                    continue
                try:
                    summary = str(component.get('summary', 'Sans titre'))
                    dtstart = component.get('dtstart')
                    location = component.get('location', '')
                    
                    if dtstart:
                        start_dt = dtstart.dt
                        # Filtrer les événements dans la plage de 7 jours
                        if hasattr(start_dt, 'date'):
                            check_date = start_dt.date()
                        else:
                            check_date = start_dt
                        if check_date < start.date() or check_date > end.date():
                            continue
                        if isinstance(start_dt, datetime):
                            start_str = start_dt.strftime('%d/%m %H:%M')
                        else:
                            start_str = start_dt.strftime('%d/%m')
                    else:
                        start_str = ''
                    
                    all_events.append({
                        'title': summary,
                        'start': start_str,
                        'location': str(location) if location else ''
                    })
                except Exception as e:
                    logging.warning(f"Erreur parsing événement public: {e}")
                    continue
        else:
            # Calendrier authentifié via CalDAV
            if not caldav_username or not caldav_password:
                return jsonify(events=[], message="Identifiants CalDAV manquants pour ce type d'URL")
            
            client = caldav.DAVClient(
                url=caldav_url,
                username=caldav_username,
                password=caldav_password
            )
            principal = client.principal()
            calendars = principal.calendars()
            
            if not calendars:
                return jsonify(events=[], message="Aucun calendrier trouvé")
            
            for calendar in calendars:
                try:
                    events = calendar.date_search(start=start, end=end)
                    for event in events:
                        try:
                            vevent = event.icalendar_component
                            summary = str(vevent.get('summary', 'Sans titre'))
                            dtstart = vevent.get('dtstart')
                            location = vevent.get('location', '')
                            
                            if dtstart:
                                start_dt = dtstart.dt
                                if isinstance(start_dt, datetime):
                                    start_str = start_dt.strftime('%d/%m %H:%M')
                                else:
                                    start_str = start_dt.strftime('%d/%m')
                            else:
                                start_str = ''
                            
                            all_events.append({
                                'title': summary,
                                'start': start_str,
                                'location': str(location) if location else ''
                            })
                        except Exception as e:
                            logging.warning(f"Erreur parsing événement: {e}")
                            continue
                except Exception as e:
                    logging.warning(f"Erreur récupération calendrier: {e}")
                    continue
        
        # Trier par date
        all_events.sort(key=lambda x: x['start'])
        
        return jsonify(events=all_events[:10])  # Limiter à 10 événements
        
    except Exception as e:
        logging.error(f"Erreur CalDAV: {e}")
        return jsonify(error=str(e)), 500


# Proxy favicon
@app.route('/api/favicon')
def api_favicon():
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify(error='URL manquante'), 400
    try:
        parsed = urlparse(url if '://' in url else 'https://' + url)
        domain = parsed.hostname
        if not domain:
            return jsonify(error='Domaine invalide'), 400

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        base = f"{parsed.scheme}://{domain}"

        # 1. Parser la page HTML pour trouver la meilleure icône
        try:
            page_url = url if '://' in url else 'https://' + url
            req = Request(page_url)
            for k, v in headers.items():
                req.add_header(k, v)
            response = urlopen(req, timeout=5, context=ctx)
            html = response.read(100000).decode('utf-8', errors='ignore')

            import re
            best_icon = None
            best_size = 0

            # Chercher toutes les balises <link> avec rel icon/shortcut/apple-touch
            link_tags = re.findall(r'<link\s+[^>]*?>', html, re.IGNORECASE | re.DOTALL)
            for tag in link_tags:
                rel_match = re.search(r'rel=["\']([^"\']*)["\']', tag, re.IGNORECASE)
                if not rel_match:
                    continue
                rel = rel_match.group(1).lower()
                if 'icon' not in rel and 'apple-touch' not in rel:
                    continue
                href_match = re.search(r'href=["\']([^"\']*)["\']', tag, re.IGNORECASE)
                if not href_match:
                    continue
                href = href_match.group(1).strip()
                if not href or href.startswith('data:'):
                    continue

                # Déterminer la taille
                size = 0
                sizes_match = re.search(r'sizes=["\'](\d+)x\d+["\']', tag, re.IGNORECASE)
                if sizes_match:
                    size = int(sizes_match.group(1))
                elif 'apple-touch' in rel:
                    size = 180
                elif href.endswith('.svg'):
                    size = 512

                # Construire l'URL complète
                if href.startswith('http'):
                    full_url = href
                elif href.startswith('//'):
                    full_url = f"{parsed.scheme}:{href}"
                elif href.startswith('/'):
                    full_url = f"{base}{href}"
                else:
                    full_url = f"{base}/{href}"

                if size > best_size or best_icon is None:
                    best_icon = full_url
                    best_size = size

            # Chercher og:image comme fallback enrichi
            if not best_icon or best_size < 64:
                og_match = re.search(r'<meta\s+[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', html, re.IGNORECASE)
                if not og_match:
                    og_match = re.search(r'<meta\s+[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']', html, re.IGNORECASE)

            if best_icon:
                return jsonify(icon=best_icon)

        except Exception:
            pass

        # 2. Essayer /favicon.ico direct
        try:
            favicon_url = f"{base}/favicon.ico"
            req = Request(favicon_url)
            for k, v in headers.items():
                req.add_header(k, v)
            response = urlopen(req, timeout=3, context=ctx)
            if response.getcode() == 200:
                ct = response.headers.get('Content-Type', '')
                if 'image' in ct or 'octet' in ct or ct == '':
                    return jsonify(icon=favicon_url)
        except Exception:
            pass

        # 3. Essayer /apple-touch-icon.png
        try:
            apple_url = f"{base}/apple-touch-icon.png"
            req = Request(apple_url)
            for k, v in headers.items():
                req.add_header(k, v)
            response = urlopen(req, timeout=3, context=ctx)
            if response.getcode() == 200:
                return jsonify(icon=apple_url)
        except Exception:
            pass

        # 4. Fallback: Google favicon service
        return jsonify(icon=f'https://www.google.com/s2/favicons?domain={domain}&sz=64')

    except Exception as e:
        logger.debug(f"Erreur récupération favicon: {e}")
        return jsonify(error='Erreur'), 400


# Santé serveur
@app.route('/api/health')
def api_health():
    try:
        import psutil
        return jsonify(
            cpu=psutil.cpu_percent(interval=0.5),
            ram=psutil.virtual_memory().percent,
            disk=psutil.disk_usage('/').percent
        )
    except ImportError:
        return jsonify(error='psutil non installé'), 501

@app.route('/api/status')
def api_status():
    groups = models.get_groups()
    results = {}
    now = time.time()
    for g in groups:
        for lnk in g['links']:
            if lnk['check_status']:
                ck = f"status:{lnk['id']}"
                cached = _cache.get(ck)
                if cached and now - cached['ts'] < 120:
                    results[lnk['id']] = cached['val']
                else:
                    val = _ping(lnk['url'])
                    _cache[ck] = {'val': val, 'ts': now}
                    results[lnk['id']] = val
    return jsonify(results)


def _ping(url):
    """Vérifie si une URL est accessible. Retourne 'up', 'down' ou 'unknown'."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return 'unknown'
        
        # Essayer HEAD en premier
        try:
            req = Request(url, method='HEAD')
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FabHome/1.0')
            req.add_header('Accept', '*/*')
            response = urlopen(req, timeout=8, context=ctx)
            # Codes 2xx et 3xx sont considérés comme "up"
            if 200 <= response.getcode() < 400:
                return 'up'
        except Exception:
            pass
        
        # Si HEAD échoue, essayer GET avec lecture limitée
        try:
            req = Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FabHome/1.0')
            req.add_header('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
            response = urlopen(req, timeout=8, context=ctx)
            # Lire seulement les premiers octets pour vérifier
            response.read(512)
            if 200 <= response.getcode() < 400:
                return 'up'
        except Exception as e:
            # Si c'est une erreur de timeout ou connexion, c'est vraiment down
            if 'timed out' in str(e).lower() or 'Connection refused' in str(e):
                return 'down'
            # Pour d'autres erreurs (SSL, format, etc.), on ne sait pas vraiment
            return 'unknown'
        
        return 'down'
    except Exception as e:
        logger.debug(f"Erreur ping {url}: {e}")
        return 'unknown'


# ── API : Météo ───────────────────────────────────────────

@app.route('/api/weather')
def api_weather():
    profile_id = get_current_profile_id()
    widgets = {w['type']: w for w in models.get_widgets(profile_id)}
    ww = widgets.get('weather')
    if not ww or not ww['enabled']:
        return jsonify(error='Widget météo désactivé'), 404
    cfg = ww['config']
    lat = float(cfg.get('latitude', 48.69))
    lon = float(cfg.get('longitude', 6.18))
    cache_key = f"weather:{lat}:{lon}"
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached['ts'] < 1800:
        return jsonify(cached['val'])
    try:
        api_url = (f"https://api.open-meteo.com/v1/forecast?"
                   f"latitude={lat}&longitude={lon}"
                   f"&current=temperature_2m,weather_code&timezone=auto")
        req = Request(api_url)
        req.add_header('User-Agent', 'FabHome/1.0')
        resp = urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        result = {
            'temperature': data['current']['temperature_2m'],
            'weather_code': data['current']['weather_code'],
            'city': cfg.get('city', ''),
        }
        _cache[cache_key] = {'val': result, 'ts': now}
        return jsonify(result)
    except Exception as e:
        logger.warning("Erreur météo : %s", e)
        return jsonify(error='Erreur API météo'), 502


# ── Gestion d'erreurs ─────────────────────────────────────

@app.errorhandler(404)
def err_404(e):
    if request.path.startswith('/api/'):
        return jsonify(error='Ressource non trouvée'), 404
    return redirect(url_for('index'))


@app.errorhandler(500)
def err_500(e):
    logger.exception("Erreur interne")
    return jsonify(error='Erreur interne du serveur'), 500


@app.errorhandler(413)
def err_413(e):
    return jsonify(error='Fichier trop volumineux (max 2 Mo)'), 413


# ── Démarrage ─────────────────────────────────────────────

if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    # Allow launching on a custom port outside Docker (default stays 3000).
    port = int(os.environ.get('FABHOME_APP_PORT', os.environ.get('PORT', '3000')))
    app.run(host='0.0.0.0', port=port, debug=debug)
