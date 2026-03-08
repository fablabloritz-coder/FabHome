"""FabHome — Page d'accueil personnalisée avec grille configurable."""

import os
import logging
import time
import json
from urllib.parse import urlparse
from urllib.request import urlopen, Request

from flask import Flask, render_template, request, jsonify, redirect, url_for

import models

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

models.init_db()

_cache = {}


# ── Pages ─────────────────────────────────────────────────

@app.route('/')
def index():
    settings = models.get_settings()
    groups = models.get_groups()
    widgets = {w['type']: w for w in models.get_widgets()}
    return render_template('index.html',
                           settings=settings, groups=groups, widgets=widgets,
                           groups_json=json.dumps(groups),
                           widgets_json=json.dumps(widgets))


@app.route('/admin')
def admin():
    return redirect(url_for('index', edit=1))


# ── API : Réglages ────────────────────────────────────────

@app.route('/api/settings', methods=['PUT'])
def api_update_settings():
    data = request.get_json()
    if not data:
        return jsonify(error='Données manquantes'), 400
    allowed = {'title', 'theme', 'background_url', 'greeting_name',
               'search_provider', 'grid_cols', 'grid_rows'}
    for k, v in data.items():
        if k in allowed:
            models.update_setting(k, str(v)[:500])
    return jsonify(ok=True)


# ── API : Groupes ─────────────────────────────────────────

@app.route('/api/groups', methods=['POST'])
def api_create_group():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    gid = models.create_group(
        name[:100],
        (data.get('icon') or 'bi-folder')[:50],
        int(data.get('col_span', 1)),
        int(data.get('row_span', 1)),
        int(data.get('grid_row', -1)),
        int(data.get('grid_col', 0)))
    return jsonify(id=gid), 201


@app.route('/api/groups/<int:gid>', methods=['PUT'])
def api_update_group(gid):
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify(error='Nom requis'), 400
    models.update_group(
        gid, name[:100],
        (data.get('icon') or 'bi-folder')[:50],
        col_span=int(data['col_span']) if 'col_span' in data else None,
        row_span=int(data['row_span']) if 'row_span' in data else None,
        grid_row=int(data['grid_row']) if 'grid_row' in data else None,
        grid_col=int(data['grid_col']) if 'grid_col' in data else None)
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
        icon=(data.get('icon') or 'bi-link-45deg')[:50],
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
                       (data.get('icon') or 'bi-link-45deg')[:50],
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


# ── API : Widgets ─────────────────────────────────────────

@app.route('/api/widgets', methods=['PUT'])
def api_update_widgets():
    data = request.get_json()
    if not data:
        return jsonify(error='Données manquantes'), 400
    allowed = {'greeting', 'search', 'clock', 'weather'}
    for wtype, wdata in data.items():
        if wtype in allowed and isinstance(wdata, dict):
            models.update_widget(wtype,
                                 1 if wdata.get('enabled') else 0,
                                 wdata.get('config', {}))
    return jsonify(ok=True)


# ── API : Statuts ─────────────────────────────────────────

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
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return 'down'
        req = Request(url, method='HEAD')
        req.add_header('User-Agent', 'FabHome/1.0')
        urlopen(req, timeout=5)
        return 'up'
    except Exception:
        try:
            req = Request(url)
            req.add_header('User-Agent', 'FabHome/1.0')
            urlopen(req, timeout=5)
            return 'up'
        except Exception:
            return 'down'


# ── API : Météo ───────────────────────────────────────────

@app.route('/api/weather')
def api_weather():
    widgets = {w['type']: w for w in models.get_widgets()}
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
    app.run(host='0.0.0.0', port=3000, debug=debug)
