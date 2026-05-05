
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
        role TEXT NOT NULL DEFAULT 'PLAYER',
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
        player_code TEXT UNIQUE,
        is_registered INTEGER DEFAULT 1,
        is_guest INTEGER DEFAULT 0,
        is_nn INTEGER DEFAULT 0,
        team_side TEXT NOT NULL DEFAULT 'home',
        name TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        number INTEGER DEFAULT 0,
        position TEXT DEFAULT '',
        photo_path TEXT DEFAULT '',
        poster_path TEXT DEFAULT '',
        goals INTEGER DEFAULT 0,
        assists INTEGER DEFAULT 0,
        matches_played INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS match_managers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        assigned_by_user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id, player_id)
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
        lineup_away TEXT DEFAULT '[]',
        captain_home_id INTEGER DEFAULT NULL,
        captain_away_id INTEGER DEFAULT NULL
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
        role TEXT DEFAULT 'PLAYER',
        message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Migrations: add new columns to existing databases safely
    for col, ddl in [
        ("captain_home_id", "ALTER TABLE settings ADD COLUMN captain_home_id INTEGER DEFAULT NULL"),
        ("captain_away_id", "ALTER TABLE settings ADD COLUMN captain_away_id INTEGER DEFAULT NULL"),
        ("available_players", "ALTER TABLE matches ADD COLUMN available_players TEXT DEFAULT '[]'"),
        ("captain_home_id", "ALTER TABLE matches ADD COLUMN captain_home_id INTEGER DEFAULT NULL"),
        ("captain_away_id", "ALTER TABLE matches ADD COLUMN captain_away_id INTEGER DEFAULT NULL"),
        ("has_stream", "ALTER TABLE matches ADD COLUMN has_stream INTEGER DEFAULT 0"),
        ("stream_url", "ALTER TABLE matches ADD COLUMN stream_url TEXT DEFAULT ''"),
        ("video_url", "ALTER TABLE matches ADD COLUMN video_url TEXT DEFAULT ''"),
        ("stream_desc", "ALTER TABLE matches ADD COLUMN stream_desc TEXT DEFAULT ''"),
        ("media_path", "ALTER TABLE highlights ADD COLUMN media_path TEXT DEFAULT ''"),
        ("media_type", "ALTER TABLE highlights ADD COLUMN media_type TEXT DEFAULT ''"),
        ("moment_type", "ALTER TABLE highlights ADD COLUMN moment_type TEXT DEFAULT 'otro'"),
        ("match_id", "ALTER TABLE highlights ADD COLUMN match_id INTEGER DEFAULT NULL"),
        ("google_id", "ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT NULL"),
        ("email", "ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL"),
        ("avatar", "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL"),
        ("phone", "ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''"),
        ("preferred_position", "ALTER TABLE users ADD COLUMN preferred_position TEXT DEFAULT ''"),
        ("shirt_number", "ALTER TABLE users ADD COLUMN shirt_number INTEGER DEFAULT NULL"),
        ("bio", "ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''"),
        ("player_id", "ALTER TABLE users ADD COLUMN player_id INTEGER DEFAULT NULL"),
        ("google_client_id", "ALTER TABLE settings ADD COLUMN google_client_id TEXT DEFAULT ''"),
        ("player_code", "ALTER TABLE players ADD COLUMN player_code TEXT UNIQUE"),
        ("is_registered", "ALTER TABLE players ADD COLUMN is_registered INTEGER DEFAULT 1"),
        ("is_guest", "ALTER TABLE players ADD COLUMN is_guest INTEGER DEFAULT 0"),
        ("is_nn", "ALTER TABLE players ADD COLUMN is_nn INTEGER DEFAULT 0"),
        ("email", "ALTER TABLE players ADD COLUMN email TEXT DEFAULT ''"),
        ("phone", "ALTER TABLE players ADD COLUMN phone TEXT DEFAULT ''"),
        ("created_at", "ALTER TABLE players ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "ALTER TABLE players ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"),
    ]:
        try:
            cur.execute(ddl)
        except Exception:
            pass

    if cur.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"] == 0:
        cur.executemany(
            "INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)",
            [
                ("admin", "admin123", "ADMIN", "Administrador"),
                ("capitan1", "cap123", "CAPTAIN", "Capitán Local"),
                ("capitan2", "cap456", "CAPTAIN", "Capitán Rival"),
                ("usuario", "user123", "PLAYER", "Jugador Espectador"),
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
    # Ensure all players have a code
    players_without_code = conn.execute("SELECT id FROM players WHERE player_code IS NULL OR player_code = ''").fetchall()
    for p in players_without_code:
        code = f"JUG-{p['id']:04d}"
        conn.execute("UPDATE players SET player_code=? WHERE id=?", (code, p['id']))
    
    # Ensure all users have a player profile
    users_without_player = conn.execute("SELECT id, display_name, username FROM users WHERE player_id IS NULL").fetchall()
    for u in users_without_player:
        # Create player profile
        cur.execute("INSERT INTO players (name, email, is_registered) VALUES (?, ?, 1)", 
                    (u['display_name'], u['username'] if "@" in u['username'] else ""))
        p_id = cur.lastrowid
        code = f"JUG-{p_id:04d}"
        conn.execute("UPDATE players SET player_code=? WHERE id=?", (code, p_id))
        conn.execute("UPDATE users SET player_id=? WHERE id=?", (p_id, u['id']))
    
    conn.commit()
    conn.close()
