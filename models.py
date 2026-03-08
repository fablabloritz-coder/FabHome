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
        CREATE TABLE IF NOT EXISTS groups_ (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            icon       TEXT    NOT NULL DEFAULT 'bi-folder',
            col_span   INTEGER NOT NULL DEFAULT 1,
            row_span   INTEGER NOT NULL DEFAULT 1,
            grid_col   INTEGER NOT NULL DEFAULT 0,
            grid_row   INTEGER NOT NULL DEFAULT -1,
            sort_order INTEGER NOT NULL DEFAULT 0
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


# ── Groupes ───────────────────────────────────────────────

def get_groups():
    conn = get_db()
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
                 grid_row=-1, grid_col=0):
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO groups_ (name, icon, col_span, row_span, grid_row, grid_col, sort_order) '
        'VALUES (?,?,?,?,?,?,0)',
        (name, icon, max(1, min(3, col_span)), max(1, min(3, row_span)),
         grid_row, grid_col))
    gid = cur.lastrowid
    conn.commit()
    conn.close()
    return gid


def update_group(gid, name, icon, col_span=None, row_span=None,
                 grid_row=None, grid_col=None):
    conn = get_db()
    fields = ['name=?', 'icon=?']
    params = [name, icon]
    if col_span is not None:
        fields.append('col_span=?')
        params.append(max(1, min(3, col_span)))
    if row_span is not None:
        fields.append('row_span=?')
        params.append(max(1, min(3, row_span)))
    if grid_row is not None:
        fields.append('grid_row=?')
        params.append(grid_row)
    if grid_col is not None:
        fields.append('grid_col=?')
        params.append(grid_col)
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
