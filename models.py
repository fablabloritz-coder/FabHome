"""FabHome — Couche base de données SQLite."""

import sqlite3
import os
import json
import logging

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get('FABHOME_DB', 'data/fabhome.db')


def get_db():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS pages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL DEFAULT 'Accueil',
            icon       TEXT    NOT NULL DEFAULT 'bi-house',
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS groups_ (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id    INTEGER NOT NULL DEFAULT 1,
            name       TEXT    NOT NULL,
            icon       TEXT    NOT NULL DEFAULT 'bi-folder',
            col_span   INTEGER NOT NULL DEFAULT 1,
            row_span   INTEGER NOT NULL DEFAULT 1,
            grid_col   INTEGER NOT NULL DEFAULT 0,
            grid_row   INTEGER NOT NULL DEFAULT -1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS links (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id     INTEGER NOT NULL,
            name         TEXT    NOT NULL,
            url          TEXT    NOT NULL,
            icon         TEXT    NOT NULL DEFAULT 'bi-link-45deg',
            description  TEXT    NOT NULL DEFAULT '',
            sort_order   INTEGER NOT NULL DEFAULT 0,
            check_status INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (group_id) REFERENCES groups_(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS widgets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            type       TEXT    NOT NULL UNIQUE,
            config     TEXT    NOT NULL DEFAULT '{}',
            enabled    INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS services (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            type       TEXT    NOT NULL DEFAULT 'generic',
            url        TEXT    NOT NULL DEFAULT '',
            api_key    TEXT    NOT NULL DEFAULT '',
            config     TEXT    NOT NULL DEFAULT '{}',
            enabled    INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_links_group ON links(group_id);
    ''')

    # ── Migrations ────────────────────────────────────────
    cols = [r[1] for r in conn.execute("PRAGMA table_info(groups_)").fetchall()]
    if 'col_span' not in cols:
        conn.execute('ALTER TABLE groups_ ADD COLUMN col_span INTEGER NOT NULL DEFAULT 1')
    if 'row_span' not in cols:
        conn.execute('ALTER TABLE groups_ ADD COLUMN row_span INTEGER NOT NULL DEFAULT 1')
    if 'grid_col' not in cols:
        conn.execute('ALTER TABLE groups_ ADD COLUMN grid_col INTEGER NOT NULL DEFAULT 0')
    if 'page_id' not in cols:
        conn.execute('ALTER TABLE groups_ ADD COLUMN page_id INTEGER NOT NULL DEFAULT 1')

    # Create this index only after legacy migrations added page_id.
    conn.execute('CREATE INDEX IF NOT EXISTS idx_groups_page ON groups_(page_id)')

    needs_placement = 'grid_row' not in cols
    if needs_placement:
        conn.execute('ALTER TABLE groups_ ADD COLUMN grid_row INTEGER NOT NULL DEFAULT -1')
        existing = conn.execute('SELECT id FROM groups_ ORDER BY sort_order, id').fetchall()
        gcols = 4
        for i, row in enumerate(existing):
            r = i // gcols
            c = i % gcols
            conn.execute('UPDATE groups_ SET grid_row=?, grid_col=? WHERE id=?',
                         (r, c, row[0]))

    # Tables ajoutées en migration
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if 'pages' not in tables:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT 'Accueil',
                icon TEXT NOT NULL DEFAULT 'bi-house',
                sort_order INTEGER NOT NULL DEFAULT 0
            );
        ''')
    if 'services' not in tables:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'generic',
                url TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
                config TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
            );
        ''')

    # Page par défaut
    if not conn.execute('SELECT 1 FROM pages LIMIT 1').fetchone():
        conn.execute("INSERT INTO pages (id, name, icon, sort_order) VALUES (1, 'Accueil', 'bi-house', 0)")

    # ── Réglages par défaut ───────────────────────────────
    for k, v in {
        'title': "Ma Page d'Accueil",
        'theme': 'dark',
        'background_url': '',
        'greeting_name': '',
        'search_provider': 'google',
        'grid_cols': '4',
        'grid_rows': '3',
    }.items():
        conn.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (k, v))

    for wtype, cfg, en, order in [
        ('greeting', '{}', 1, 0),
        ('search',   '{"provider":"google"}', 1, 1),
        ('clock',    '{}', 1, 2),
        ('weather',  '{"latitude":48.69,"longitude":6.18,"city":"Nancy"}', 0, 3),
        ('health',   '{}', 0, 4),
    ]:
        conn.execute(
            'INSERT OR IGNORE INTO widgets (type, config, enabled, sort_order) VALUES (?,?,?,?)',
            (wtype, cfg, en, order))

    conn.commit()
    conn.close()
    logger.info("Base de données initialisée : %s", DB_PATH)


# ── Réglages ──────────────────────────────────────────────

def get_settings():
    conn = get_db()
    rows = conn.execute('SELECT key, value FROM settings').fetchall()
    conn.close()
    return {r['key']: r['value'] for r in rows}


def update_setting(key, value):
    conn = get_db()
    conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))
    conn.commit()
    conn.close()


# ── Pages ─────────────────────────────────────────────────

def get_pages():
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        'SELECT * FROM pages ORDER BY sort_order, id').fetchall()]
    conn.close()
    return rows


def create_page(name, icon='bi-file-earmark'):
    conn = get_db()
    mx = conn.execute('SELECT COALESCE(MAX(sort_order),0) FROM pages').fetchone()[0]
    cur = conn.execute('INSERT INTO pages (name, icon, sort_order) VALUES (?,?,?)',
                       (name, icon, mx + 1))
    pid = cur.lastrowid
    conn.commit()
    conn.close()
    return pid


def update_page(pid, name, icon):
    conn = get_db()
    conn.execute('UPDATE pages SET name=?, icon=? WHERE id=?', (name, icon, pid))
    conn.commit()
    conn.close()


def delete_page(pid):
    if pid == 1:
        return  # Ne pas supprimer la page par défaut
    conn = get_db()
    conn.execute('DELETE FROM pages WHERE id=?', (pid,))
    conn.commit()
    conn.close()


def reorder_pages(ordered_ids):
    conn = get_db()
    for i, pid in enumerate(ordered_ids):
        conn.execute('UPDATE pages SET sort_order=? WHERE id=?', (i, pid))
    conn.commit()
    conn.close()


# ── Groupes ───────────────────────────────────────────────

def get_groups(page_id=None):
    conn = get_db()
    if page_id is not None:
        groups = [dict(r) for r in conn.execute(
            'SELECT * FROM groups_ WHERE page_id=? ORDER BY grid_row, grid_col, id',
            (page_id,)).fetchall()]
    else:
        groups = [dict(r) for r in conn.execute(
            'SELECT * FROM groups_ ORDER BY grid_row, grid_col, id').fetchall()]
    links = [dict(r) for r in conn.execute(
        'SELECT * FROM links ORDER BY sort_order, id').fetchall()]
    conn.close()
    by_group = {}
    for lnk in links:
        by_group.setdefault(lnk['group_id'], []).append(lnk)
    for g in groups:
        g['links'] = by_group.get(g['id'], [])
    return groups


def create_group(name, icon='bi-folder', col_span=1, row_span=1,
                 grid_row=-1, grid_col=0, page_id=1):
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO groups_ (name, icon, col_span, row_span, grid_row, grid_col, sort_order, page_id) '
        'VALUES (?,?,?,?,?,?,0,?)',
        (name, icon, max(1, min(4, col_span)), max(1, min(4, row_span)),
         grid_row, grid_col, page_id))
    gid = cur.lastrowid
    conn.commit()
    conn.close()
    return gid


def update_group(gid, name, icon, col_span=None, row_span=None,
                 grid_row=None, grid_col=None, page_id=None):
    conn = get_db()
    fields = ['name=?', 'icon=?']
    params = [name, icon]
    if col_span is not None:
        fields.append('col_span=?')
        params.append(max(1, min(4, col_span)))
    if row_span is not None:
        fields.append('row_span=?')
        params.append(max(1, min(4, row_span)))
    if grid_row is not None:
        fields.append('grid_row=?')
        params.append(grid_row)
    if grid_col is not None:
        fields.append('grid_col=?')
        params.append(grid_col)
    if page_id is not None:
        fields.append('page_id=?')
        params.append(page_id)
    params.append(gid)
    conn.execute('UPDATE groups_ SET ' + ','.join(fields) + ' WHERE id=?', params)
    conn.commit()
    conn.close()


def move_group(gid, grid_row, grid_col):
    conn = get_db()
    conn.execute('UPDATE groups_ SET grid_row=?, grid_col=? WHERE id=?',
                 (grid_row, grid_col, gid))
    conn.commit()
    conn.close()


def delete_group(gid):
    conn = get_db()
    conn.execute('DELETE FROM groups_ WHERE id=?', (gid,))
    conn.commit()
    conn.close()


# ── Liens ─────────────────────────────────────────────────

def create_link(group_id, name, url, icon='bi-link-45deg', description='', check_status=0):
    conn = get_db()
    mx = conn.execute('SELECT COALESCE(MAX(sort_order),0) FROM links WHERE group_id=?',
                      (group_id,)).fetchone()[0]
    cur = conn.execute(
        'INSERT INTO links (group_id,name,url,icon,description,sort_order,check_status) '
        'VALUES (?,?,?,?,?,?,?)',
        (group_id, name, url, icon, description, mx + 1, check_status))
    lid = cur.lastrowid
    conn.commit()
    conn.close()
    return lid


def update_link(lid, name, url, icon, description, check_status, group_id=None):
    conn = get_db()
    if group_id is not None:
        conn.execute(
            'UPDATE links SET name=?,url=?,icon=?,description=?,check_status=?,group_id=? WHERE id=?',
            (name, url, icon, description, check_status, group_id, lid))
    else:
        conn.execute(
            'UPDATE links SET name=?,url=?,icon=?,description=?,check_status=? WHERE id=?',
            (name, url, icon, description, check_status, lid))
    conn.commit()
    conn.close()


def delete_link(lid):
    conn = get_db()
    conn.execute('DELETE FROM links WHERE id=?', (lid,))
    conn.commit()
    conn.close()


def reorder_links(group_id, ordered_ids):
    conn = get_db()
    for i, lid in enumerate(ordered_ids):
        conn.execute('UPDATE links SET sort_order=?, group_id=? WHERE id=?',
                     (i, group_id, lid))
    conn.commit()
    conn.close()


# ── Widgets ───────────────────────────────────────────────

def get_widgets():
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        'SELECT * FROM widgets ORDER BY sort_order, id').fetchall()]
    conn.close()
    for r in rows:
        r['config'] = json.loads(r['config'])
    return rows


def update_widget(wtype, enabled, config):
    conn = get_db()
    conn.execute('UPDATE widgets SET enabled=?, config=? WHERE type=?',
                 (enabled, json.dumps(config), wtype))
    conn.commit()
    conn.close()


# ── Services (intégrations API) ───────────────────────────

def get_services():
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        'SELECT * FROM services ORDER BY sort_order, id').fetchall()]
    conn.close()
    for r in rows:
        r['config'] = json.loads(r['config'])
    return rows


def create_service(name, stype, url, api_key='', config=None):
    conn = get_db()
    mx = conn.execute('SELECT COALESCE(MAX(sort_order),0) FROM services').fetchone()[0]
    cur = conn.execute(
        'INSERT INTO services (name, type, url, api_key, config, enabled, sort_order) '
        'VALUES (?,?,?,?,?,1,?)',
        (name, stype, url, api_key, json.dumps(config or {}), mx + 1))
    sid = cur.lastrowid
    conn.commit()
    conn.close()
    return sid


def update_service(sid, name, stype, url, api_key='', config=None, enabled=1):
    conn = get_db()
    conn.execute(
        'UPDATE services SET name=?, type=?, url=?, api_key=?, config=?, enabled=? WHERE id=?',
        (name, stype, url, api_key, json.dumps(config or {}), enabled, sid))
    conn.commit()
    conn.close()


def delete_service(sid):
    conn = get_db()
    conn.execute('DELETE FROM services WHERE id=?', (sid,))
    conn.commit()
    conn.close()


# ── Export / Import ───────────────────────────────────────

def export_all():
    conn = get_db()
    data = {
        'settings': {r['key']: r['value'] for r in
                     conn.execute('SELECT key, value FROM settings').fetchall()},
        'pages': [dict(r) for r in conn.execute('SELECT * FROM pages ORDER BY sort_order').fetchall()],
        'groups': [dict(r) for r in conn.execute('SELECT * FROM groups_ ORDER BY id').fetchall()],
        'links': [dict(r) for r in conn.execute('SELECT * FROM links ORDER BY id').fetchall()],
        'widgets': [],
        'services': [],
    }
    for r in conn.execute('SELECT * FROM widgets ORDER BY sort_order').fetchall():
        w = dict(r)
        w['config'] = json.loads(w['config'])
        data['widgets'].append(w)
    for r in conn.execute('SELECT * FROM services ORDER BY sort_order').fetchall():
        s = dict(r)
        s['config'] = json.loads(s['config'])
        data['services'].append(s)
    conn.close()
    return data


def import_all(data):
    conn = get_db()
    conn.execute('DELETE FROM links')
    conn.execute('DELETE FROM groups_')
    conn.execute('DELETE FROM pages')
    conn.execute('DELETE FROM services')
    conn.execute('DELETE FROM settings')
    conn.execute('DELETE FROM widgets')

    for k, v in data.get('settings', {}).items():
        conn.execute('INSERT INTO settings (key, value) VALUES (?,?)', (k, v))

    for p in data.get('pages', []):
        conn.execute('INSERT INTO pages (id, name, icon, sort_order) VALUES (?,?,?,?)',
                     (p['id'], p['name'], p.get('icon', 'bi-house'), p.get('sort_order', 0)))

    for g in data.get('groups', []):
        conn.execute(
            'INSERT INTO groups_ (id, page_id, name, icon, col_span, row_span, grid_col, grid_row, sort_order) '
            'VALUES (?,?,?,?,?,?,?,?,?)',
            (g['id'], g.get('page_id', 1), g['name'], g['icon'],
             g.get('col_span', 1), g.get('row_span', 1),
             g.get('grid_col', 0), g.get('grid_row', -1), g.get('sort_order', 0)))

    for lnk in data.get('links', []):
        conn.execute(
            'INSERT INTO links (id, group_id, name, url, icon, description, sort_order, check_status) '
            'VALUES (?,?,?,?,?,?,?,?)',
            (lnk['id'], lnk['group_id'], lnk['name'], lnk['url'],
             lnk.get('icon', 'bi-link-45deg'), lnk.get('description', ''),
             lnk.get('sort_order', 0), lnk.get('check_status', 0)))

    for w in data.get('widgets', []):
        conn.execute(
            'INSERT OR REPLACE INTO widgets (type, config, enabled, sort_order) VALUES (?,?,?,?)',
            (w['type'], json.dumps(w.get('config', {})),
             w.get('enabled', 1), w.get('sort_order', 0)))

    for s in data.get('services', []):
        conn.execute(
            'INSERT INTO services (name, type, url, api_key, config, enabled, sort_order) '
            'VALUES (?,?,?,?,?,?,?)',
            (s['name'], s['type'], s.get('url', ''),
             s.get('api_key', ''), json.dumps(s.get('config', {})),
             s.get('enabled', 1), s.get('sort_order', 0)))

    conn.commit()
    conn.close()
