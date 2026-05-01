
import os
import json
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
# Allows overriding the storage path via environment variable for deployment (e.g., Railway Volume)
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", BASE_DIR))
DATA_DIR = STORAGE_DIR / "data"
UPLOAD_DIR = STORAGE_DIR / "uploads"
DB_PATH = DATA_DIR / "futbol7.sqlite3"


def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = dict_factory
    return conn


def parse_json_list(value):
    try:
        data = json.loads(value or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def init_db():
    conn = connect()
    cur = conn.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        app_name TEXT NOT NULL DEFAULT 'Futbol7 Studio',
        home_team_name TEXT NOT NULL DEFAULT 'Equipo Local',
        away_team_name TEXT NOT NULL DEFAULT 'Equipo Rival',
        home_primary TEXT NOT NULL DEFAULT '#ff1558',
        home_secondary TEXT NOT NULL DEFAULT '#ffffff',
        away_primary TEXT NOT NULL DEFAULT '#2563eb',
        away_secondary TEXT NOT NULL DEFAULT '#ffffff',
        next_match_title TEXT DEFAULT 'Próximo Partido',
        venue TEXT DEFAULT 'Cancha principal',
        schedule TEXT DEFAULT 'Sábado 7:00 PM',
        live_enabled INTEGER NOT NULL DEFAULT 0,
        live_url TEXT DEFAULT '',
        captain_home_id INTEGER DEFAULT NULL,
        captain_away_id INTEGER DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_side TEXT NOT NULL DEFAULT 'home',
        name TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        number INTEGER DEFAULT 0,
        position TEXT DEFAULT '',
        photo_path TEXT DEFAULT '',
        poster_path TEXT DEFAULT '',
        goals INTEGER DEFAULT 0,
        assists INTEGER DEFAULT 0,
        matches_played INTEGER DEFAULT 0,
        rating REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        match_date TEXT DEFAULT '',
        venue TEXT DEFAULT '',
        score_home INTEGER DEFAULT 0,
        score_away INTEGER DEFAULT 0,
        status TEXT DEFAULT 'programado',
        lineup_home TEXT DEFAULT '[]',
        lineup_away TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        platform TEXT DEFAULT 'youtube',
        url TEXT NOT NULL,
        category TEXT DEFAULT 'resumen',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        minute TEXT DEFAULT '',
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS formations_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER,
        changed_by TEXT,
        side TEXT,
        lineup TEXT,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mvp_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        voter_username TEXT NOT NULL,
        player_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id, voter_username)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Migrations: add new columns to existing databases safely
    for col, ddl in [
        ("captain_home_id", "ALTER TABLE settings ADD COLUMN captain_home_id INTEGER DEFAULT NULL"),
        ("captain_away_id", "ALTER TABLE settings ADD COLUMN captain_away_id INTEGER DEFAULT NULL"),
    ]:
        try:
            cur.execute(ddl)
        except Exception:
            pass

    if cur.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"] == 0:
        cur.executemany(
            "INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)",
            [
                ("admin", "admin123", "admin", "Administrador"),
                ("capitan1", "cap123", "user", "Capitán Local"),
                ("capitan2", "cap456", "user", "Capitán Rival"),
                ("usuario", "user123", "user", "Espectador"),
            ],
        )
    if not cur.execute("SELECT id FROM settings WHERE id=1").fetchone():
        cur.execute("""INSERT INTO settings
        (id, app_name, home_team_name, away_team_name, home_primary, home_secondary,
         away_primary, away_secondary, next_match_title, venue, schedule, live_enabled, live_url)
        VALUES (1,'Futbol7 Studio','Equipo Local','Equipo Rival','#ff1558','#ffffff',
                '#2563eb','#ffffff','Próximo Partido','Cancha principal','Sábado 7:00 PM',0,'')""")
    if cur.execute("SELECT COUNT(*) AS total FROM matches").fetchone()["total"] == 0:
        cur.execute("""INSERT INTO matches
        (title, match_date, venue, score_home, score_away, status, lineup_home, lineup_away)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        ("Próximo Partido", "", "Cancha principal", 0, 0, "programado",
         json.dumps([None]*7), json.dumps([None]*7)))
    conn.commit()
    conn.close()
