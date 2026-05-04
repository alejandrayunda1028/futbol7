import json
import mimetypes
import os
import secrets
import sys
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from app.db import UPLOAD_DIR, connect, init_db, parse_json_list

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
TOKENS = {}
ALLOWED_IMAGES = {".jpg", ".jpeg", ".png", ".webp"}

app = Flask(__name__, static_folder=str(FRONTEND))
app.config['SECRET_KEY'] = secrets.token_hex(24)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

def safe_int(v, default=0):
    try:
        return int(v if v not in (None, "") else default)
    except Exception:
        return default

def safe_float(v, default=0):
    try:
        return float(v if v not in (None, "") else default)
    except Exception:
        return default

def color_to_rgb(hex_value, default=(255, 21, 88)):

    try:

        value = (hex_value or "").replace("#", "").strip()

        if len(value) != 6:

            return default

        return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

    except Exception:

        return default



def font(size, bold=True):

    candidates = [

        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",

        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/dejavu/DejaVuSans.ttf",

        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",

    ]

    for c in candidates:

        try:

            return ImageFont.truetype(c, size)

        except Exception:

            pass

    return ImageFont.load_default()



def fit_cover(img, size, y_bias=0.18):

    target_w, target_h = size

    src_w, src_h = img.size

    target_ratio = target_w / target_h

    src_ratio = src_w / src_h

    if src_ratio > target_ratio:

        crop_h = src_h

        crop_w = int(src_h * target_ratio)

        left = max(0, (src_w - crop_w) // 2)

        top = 0

    else:

        crop_w = src_w

        crop_h = int(src_w / target_ratio)

        left = 0

        extra = max(0, src_h - crop_h)

        top = int(extra * y_bias)

    return img.crop((left, top, left + crop_w, top + crop_h)).resize((target_w, target_h), Image.Resampling.LANCZOS)



def draw_text_fit(draw, xy, text, max_width, start_size, fill, bold=True):

    size = start_size

    text = str(text or "")

    while size > 16:

        f = font(size, bold=bold)

        box = draw.textbbox((0, 0), text, font=f)

        if box[2] - box[0] <= max_width:

            draw.text(xy, text, font=f, fill=fill)

            return

        size -= 4

    draw.text(xy, text, font=font(size, bold=bold), fill=fill)



def gradient_overlay(size, top_rgba, bottom_rgba):

    w, h = size

    img = Image.new("RGBA", size, (0, 0, 0, 0))

    pix = img.load()

    for y in range(h):

        t = y / max(1, h - 1)

        r = int(top_rgba[0] * (1 - t) + bottom_rgba[0] * t)

        g = int(top_rgba[1] * (1 - t) + bottom_rgba[1] * t)

        b = int(top_rgba[2] * (1 - t) + bottom_rgba[2] * t)

        a = int(top_rgba[3] * (1 - t) + bottom_rgba[3] * t)

        for x in range(w):

            pix[x, y] = (r, g, b, a)

    return img



def parse_multipart(content_type, raw):

    fields, files = {}, {}

    if "boundary=" not in content_type:

        return fields, files

    boundary = content_type.split("boundary=", 1)[1].strip().strip('"')

    sep = b"\r\n\r\n"

    for part in raw.split(("--" + boundary).encode("utf-8")):

        part = part.strip()

        if not part or part == b"--" or sep not in part:

            continue

        head, body = part.split(sep, 1)

        body = body.rstrip(b"\r\n-")

        header = head.decode("utf-8", "ignore")

        if 'name="' not in header:

            continue

        name = header.split('name="', 1)[1].split('"', 1)[0]

        if 'filename="' in header:

            filename = header.split('filename="', 1)[1].split('"', 1)[0]

            files[name] = {"filename": filename, "content": body}

        else:

            fields[name] = body.decode("utf-8", "ignore")

    return fields, files



def make_player_poster(source_path, output_path, meta, colors):

    primary = color_to_rgb(colors.get("primary"))

    secondary = color_to_rgb(colors.get("secondary"), (255, 255, 255))

    team_name = colors.get("team_name") or "Equipo"



    name = (meta.get("name") or "Jugador").strip()

    nickname = (meta.get("nickname") or name.split(" ")[0] or "Jugador").strip()

    last_name = (name.split(" ")[-1] or "Jugador").upper()

    number = str(meta.get("number") or 0)

    position = (meta.get("position") or "Jugador").strip()

    pj = str(meta.get("matches_played") or 0)

    goals = str(meta.get("goals") or 0)

    assists = str(meta.get("assists") or 0)



    W, H = 1080, 1350

    original = Image.open(source_path).convert("RGB")

    photo = fit_cover(original, (W, H), y_bias=0.08)

    photo = ImageEnhance.Contrast(photo).enhance(1.04)

    photo = ImageEnhance.Color(photo).enhance(1.05)

    canvas = photo.convert("RGBA")



    # Team color wash and dark footer. No ugly fake shirt overlay.

    canvas.alpha_composite(gradient_overlay((W, H), primary + (40,), (8, 8, 14, 210)))

    canvas.alpha_composite(gradient_overlay((W, H), (0, 0, 0, 0), (0, 0, 0, 195)))



    # subtle grid and side panel

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    od = ImageDraw.Draw(overlay)

    for x in range(0, W, 42):

        od.line((x, 0, x, H), fill=(255, 255, 255, 15), width=1)

    for y in range(0, H, 42):

        od.line((0, y, W, y), fill=(255, 255, 255, 12), width=1)

    od.rectangle((0, 0, 150, H), fill=primary + (135,))

    od.rectangle((0, 950, W, H), fill=(20, 0, 12, 175))

    od.rectangle((0, 1040, W, H), fill=(8, 10, 18, 205))

    canvas.alpha_composite(overlay)



    draw = ImageDraw.Draw(canvas)

    # Top labels

    draw.rounded_rectangle((790, 42, 1035, 98), radius=28, fill=(0, 0, 0, 135), outline=(255, 255, 255, 40), width=2)

    draw.text((825, 56), "F7 STUDIO", font=font(25, True), fill=(255, 255, 255, 245))

    draw.text((185, 54), team_name.upper(), font=font(28, True), fill=(255, 255, 255, 235))

    draw.text((185, 88), "PRESENTACIÃ“N DE JUGADOR", font=font(20, True), fill=(255, 255, 255, 165))



    # Vertical word

    vertical = Image.new("RGBA", (720, 120), (0, 0, 0, 0))

    vd = ImageDraw.Draw(vertical)

    vd.text((0, 0), last_name, font=font(92, True), fill=(255, 255, 255, 235))

    vertical = vertical.rotate(90, expand=True)

    canvas.alpha_composite(vertical, (12, 130))



    # Accent stripe

    stripe = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    sd = ImageDraw.Draw(stripe)

    sd.polygon([(0, 1000), (W, 890), (W, 1015), (0, 1120)], fill=primary + (170,))

    sd.polygon([(690, 970), (W, 910), (W, 980), (720, 1040)], fill=secondary + (105,))

    canvas.alpha_composite(stripe)



    # Footer text

    draw = ImageDraw.Draw(canvas)

    draw_text_fit(draw, (70, 1068), nickname.upper(), 760, 82, (255, 255, 255, 255), True)

    draw.text((72, 1150), f"#{number} Â· {team_name} Â· {position}", font=font(36, True), fill=(255, 255, 255, 235))



    # Badges

    badges = [(f"{pj} PJ", 72), (f"{goals} Goles", 265), (f"{assists} Asist.", 520)]

    for label, x in badges:

        tw = draw.textbbox((0, 0), label, font=font(29, True))[2] + 44

        draw.rounded_rectangle((x, 1228, x + tw, 1292), radius=32, fill=(255, 255, 255, 38), outline=(255, 255, 255, 95), width=2)

        draw.text((x + 22, 1244), label, font=font(29, True), fill=(255, 255, 255, 255))



    canvas.convert("RGB").save(output_path, "PNG", optimize=True)




def get_user():
    auth = request.headers.get("Authorization", "")
    token = auth.replace("Bearer ", "").strip()
    return TOKENS.get(token)

def require_user():
    user = get_user()
    if not user:
        return None, jsonify({"error": "No autorizado"}), 401
    return user, None, None

def require_roles(roles):
    user, err_resp, err_code = require_user()
    if not user:
        return None, err_resp, err_code
    if user["role"] not in roles:
        return None, jsonify({"error": "Sin permisos"}), 403
    return user, None, None

@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_static(path):
    if path.startswith("uploads/"):
        filename = path.replace("uploads/", "")
        return send_from_directory(str(UPLOAD_DIR), filename)
    if (FRONTEND / path).exists():
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/login", methods=["POST"])
def login():
    body = request.get_json() or {}
    conn = connect()
    user = conn.execute(
        "SELECT * FROM users WHERE username=? AND password=?",
        ((body.get("username") or "").strip(), (body.get("password") or "").strip()),
    ).fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "Credenciales inválidas"}), 401
    
    # Do not leak password in tokens
    if "password" in user: del user["password"]
    
    token = secrets.token_hex(18)
    TOKENS[token] = user
    return jsonify({"token": token, "user": user})

@app.route("/api/login/google", methods=["POST"])
def login_google():
    body = request.get_json() or {}
    token_id = body.get("credential")
    if not token_id: return jsonify({"error": "No credential provided"}), 400
    
    # We allow the google JWT to be verified without hardcoding client ID if we want,
    # but it's best practice to verify it. In Railway, they will set GOOGLE_CLIENT_ID.
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    try:
        idinfo = id_token.verify_oauth2_token(token_id, google_requests.Request(), client_id)
        # idinfo contains: sub (google_id), email, name, picture
    except Exception as e:
        return jsonify({"error": "Token inválido: " + str(e)}), 400
    
    google_id = idinfo.get("sub")
    email = idinfo.get("email")
    name = idinfo.get("name")
    picture = idinfo.get("picture")
    
    conn = connect()
    user = conn.execute("SELECT * FROM users WHERE google_id=?", (google_id,)).fetchone()
    if not user:
        user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    
    if not user:
        # Create new user
        base_username = email.split("@")[0]
        # ensure unique username
        username = base_username
        i = 1
        while conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
            username = f"{base_username}{i}"
            i += 1
            
        conn.execute("""INSERT INTO users (username, password, role, display_name, google_id, email, avatar) 
                        VALUES (?, ?, 'user', ?, ?, ?, ?)""", 
                     (username, "", name, google_id, email, picture))
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE google_id=?", (google_id,)).fetchone()
    else:
        # Update existing user info if empty
        conn.execute("UPDATE users SET google_id=?, email=COALESCE(email, ?), avatar=COALESCE(avatar, ?) WHERE id=?", 
                     (google_id, email, picture, user["id"]))
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        
    conn.close()
    if "password" in user: del user["password"]
    
    token = secrets.token_hex(18)
    TOKENS[token] = user
    return jsonify({"token": token, "user": user})

@app.route("/api/users/profile", methods=["PUT"])
def update_profile():
    user, err, code = require_user()
    if not user: return err, code
    
    body = request.get_json() or {}
    conn = connect()
    conn.execute('''UPDATE users SET display_name=?, phone=?, preferred_position=?, shirt_number=?, bio=?, player_id=? 
                    WHERE id=?''',
                 (body.get("display_name", user.get("display_name")), 
                  body.get("phone", ""), 
                  body.get("preferred_position", ""), 
                  safe_int(body.get("shirt_number"), 0) or None, 
                  body.get("bio", ""), 
                  safe_int(body.get("player_id"), 0) or None,
                  user["id"]))
    conn.commit()
    updated_user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    conn.close()
    if "password" in updated_user: del updated_user["password"]
    
    # Update token session data
    auth = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if auth in TOKENS: TOKENS[auth] = updated_user
    
    socketio.emit("user_updated", updated_user)
    return jsonify(updated_user)

@app.route("/api/users/profile/photo", methods=["POST"])
def update_profile_photo():
    user, err, code = require_user()
    if not user: return err, code
    
    if "photo" not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files["photo"]
    if file.filename == "": return jsonify({"error": "Empty file"}), 400
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif"]: return jsonify({"error": "Invalid format"}), 400
    
    filename = f"avatar_{user['id']}_{int(datetime.now().timestamp())}{ext}"
    path = UPLOAD_DIR / filename
    file.save(path)
    
    url = f"/uploads/{filename}"
    conn = connect()
    conn.execute("UPDATE users SET avatar=? WHERE id=?", (url, user["id"]))
    conn.commit()
    updated_user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    conn.close()
    
    if "password" in updated_user: del updated_user["password"]
    auth = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if auth in TOKENS: TOKENS[auth] = updated_user
    
    socketio.emit("user_updated", updated_user)
    return jsonify({"avatar": url})
    if not user:
        return jsonify({"error": "Credenciales inválidas"}), 401
    token = secrets.token_hex(18)
    TOKENS[token] = user
    return jsonify({"token": token, "user": user})

@app.route("/api/logout", methods=["GET"])
def logout():
    auth = request.headers.get("Authorization", "")
    token = auth.replace("Bearer ", "").strip()
    TOKENS.pop(token, None)
    return jsonify({"ok": True})

@app.route("/api/bootstrap", methods=["GET"])
def bootstrap():
    user, err, code = require_user()
    if not user: return err, code
    conn = connect()
    settings = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
    players = conn.execute("SELECT * FROM players ORDER BY team_side, number, name").fetchall()
    matches = conn.execute("SELECT * FROM matches ORDER BY id DESC").fetchall()
    videos = conn.execute("SELECT * FROM videos ORDER BY id DESC").fetchall()
    highlights = conn.execute("SELECT * FROM highlights ORDER BY id DESC").fetchall()
    conn.close()
    for m in matches:
        m["lineup_home"] = parse_json_list(m.get("lineup_home"))
        m["lineup_away"] = parse_json_list(m.get("lineup_away"))
        m["available_players"] = parse_json_list(m.get("available_players"))
    return jsonify({
        "user": user,
        "settings": settings,
        "players": players,
        "matches": matches,
        "videos": videos,
        "highlights": highlights,
        "dashboard": {"players": len(players), "matches": len(matches), "videos": len(videos), "highlights": len(highlights)}
    })

@app.route("/api/upload-photo", methods=["POST"])
def upload_photo():
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    if "photo" not in request.files:
        return jsonify({"error": "Sube una imagen válida"}), 400
    upload = request.files["photo"]
    if upload.filename == "":
        return jsonify({"error": "No llegó la foto"}), 400
    
    ext = Path(upload.filename).suffix.lower() or ".jpg"
    if ext not in ALLOWED_IMAGES:
        return jsonify({"error": "Usa JPG, PNG o WEBP"}), 400

    original_name = f"original_{secrets.token_hex(10)}{ext}"
    poster_name = f"poster_{secrets.token_hex(10)}.png"
    original_path = UPLOAD_DIR / original_name
    poster_path = UPLOAD_DIR / poster_name
    upload.save(original_path)

    conn = connect()
    s = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
    conn.close()
    side = request.form.get("team_side", "home")
    colors = {
        "primary": s["away_primary"] if side == "away" else s["home_primary"],
        "secondary": s["away_secondary"] if side == "away" else s["home_secondary"],
        "team_name": s["away_team_name"] if side == "away" else s["home_team_name"],
    }
    meta = {
        "name": request.form.get("name", "Jugador"),
        "nickname": request.form.get("nickname", ""),
        "number": safe_int(request.form.get("number"), 0),
        "position": request.form.get("position", "Jugador"),
        "matches_played": safe_int(request.form.get("matches_played"), 0),
        "goals": safe_int(request.form.get("goals"), 0),
        "assists": safe_int(request.form.get("assists"), 0),
    }
    make_player_poster(original_path, poster_path, meta, colors)
    return jsonify({"photo_path": f"/uploads/{original_name}", "poster_path": f"/uploads/{poster_name}"}), 201

def player_payload():
    body = request.get_json() or {}
    return {
        "team_side": body.get("team_side", "home"),
        "name": (body.get("name") or "Jugador").strip(),
        "nickname": (body.get("nickname") or "").strip(),
        "number": safe_int(body.get("number"), 0),
        "position": (body.get("position") or "").strip(),
        "photo_path": (body.get("photo_path") or "").strip(),
        "poster_path": (body.get("poster_path") or "").strip(),
        "goals": safe_int(body.get("goals"), 0),
        "assists": safe_int(body.get("assists"), 0),
        "matches_played": safe_int(body.get("matches_played"), 0),
        "rating": safe_float(body.get("rating"), 0),
    }

@app.route("/api/players", methods=["GET"])
def get_players():
    user, err, code = require_user()
    if not user: return err, code
    conn = connect()
    rows = conn.execute("SELECT * FROM players ORDER BY team_side, number, name").fetchall()
    conn.close()
    return jsonify(rows)

@app.route("/api/players", methods=["POST"])
def create_player():
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    p = player_payload()
    conn = connect()
    cur = conn.cursor()
    cur.execute('''INSERT INTO players
    (team_side, name, nickname, number, position, photo_path, poster_path, goals, assists, matches_played, rating)
    VALUES (:team_side, :name, :nickname, :number, :position, :photo_path, :poster_path, :goals, :assists, :matches_played, :rating)''', p)
    conn.commit()
    row = conn.execute("SELECT * FROM players WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    socketio.emit("data_changed", {"type": "players"})
    return jsonify(row), 201

@app.route("/api/players/<int:player_id>", methods=["PUT"])
def update_player(player_id):
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    p = player_payload()
    p["id"] = player_id
    conn = connect()
    old = conn.execute("SELECT * FROM players WHERE id=?", (player_id,)).fetchone()
    if old and not p["poster_path"]: p["poster_path"] = old.get("poster_path", "")
    if old and not p["photo_path"]: p["photo_path"] = old.get("photo_path", "")
    conn.execute('''UPDATE players SET team_side=:team_side, name=:name, nickname=:nickname, number=:number,
    position=:position, photo_path=:photo_path, poster_path=:poster_path, goals=:goals, assists=:assists,
    matches_played=:matches_played, rating=:rating WHERE id=:id''', p)
    conn.commit()
    row = conn.execute("SELECT * FROM players WHERE id=?", (player_id,)).fetchone()
    conn.close()
    socketio.emit("data_changed", {"type": "players"})
    return jsonify(row)

@app.route("/api/players/<int:player_id>", methods=["DELETE"])
def delete_player(player_id):
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    conn = connect(); conn.execute("DELETE FROM players WHERE id=?", (player_id,)); conn.commit(); conn.close()
    socketio.emit("data_changed", {"type": "players"})
    return jsonify({"ok": True})

def match_payload():
    body = request.get_json() or {}
    return {
        "title": (body.get("title") or "Partido").strip(),
        "match_date": (body.get("match_date") or "").strip(),
        "venue": (body.get("venue") or "").strip(),
        "score_home": safe_int(body.get("score_home"), 0),
        "score_away": safe_int(body.get("score_away"), 0),
        "status": (body.get("status") or "programado").strip(),
        "lineup_home": json.dumps(body.get("lineup_home") or [None]*7),
        "lineup_away": json.dumps(body.get("lineup_away") or [None]*7),
        "available_players": json.dumps(body.get("available_players") or []),
        "has_stream": safe_int(body.get("has_stream"), 0),
        "stream_url": (body.get("stream_url") or "").strip(),
        "video_url": (body.get("video_url") or "").strip(),
        "stream_desc": (body.get("stream_desc") or "").strip(),
    }

@app.route("/api/matches", methods=["GET"])
def get_matches():
    user, err, code = require_user()
    if not user: return err, code
    conn = connect()
    rows = conn.execute("SELECT * FROM matches ORDER BY id DESC").fetchall()
    conn.close()
    for r in rows:
        r["lineup_home"] = parse_json_list(r.get("lineup_home"))
        r["lineup_away"] = parse_json_list(r.get("lineup_away"))
        r["available_players"] = parse_json_list(r.get("available_players"))
    return jsonify(rows)

@app.route("/api/matches", methods=["POST"])
def create_match():
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    p = match_payload()
    conn = connect()
    cur = conn.cursor()
    cur.execute('''INSERT INTO matches (title, match_date, venue, score_home, score_away, status, lineup_home, lineup_away, available_players, has_stream, stream_url, video_url, stream_desc)
    VALUES (:title, :match_date, :venue, :score_home, :score_away, :status, :lineup_home, :lineup_away, :available_players, :has_stream, :stream_url, :video_url, :stream_desc)''', p)
    conn.commit()
    row = conn.execute("SELECT * FROM matches WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    row["lineup_home"] = parse_json_list(row["lineup_home"]); row["lineup_away"] = parse_json_list(row["lineup_away"])
    row["available_players"] = parse_json_list(row.get("available_players"))
    socketio.emit("match_updated", row)
    return jsonify(row), 201

@app.route("/api/matches/<int:match_id>", methods=["PUT"])
def update_match(match_id):
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    p = match_payload(); p["id"] = match_id
    
    # Optional logic: verify if capitanes are saving
    # If the user is captain1 (home), they can only edit lineup_home. Same for away.
    # To keep things simple and reliable, any "user" role can edit, but we broadcast the change.
    
    conn = connect()
    conn.execute('''UPDATE matches SET title=:title, match_date=:match_date, venue=:venue, score_home=:score_home,
    score_away=:score_away, status=:status, lineup_home=:lineup_home, lineup_away=:lineup_away, available_players=:available_players,
    has_stream=:has_stream, stream_url=:stream_url, video_url=:video_url, stream_desc=:stream_desc WHERE id=:id''', p)
    conn.commit()
    row = conn.execute("SELECT * FROM matches WHERE id=?", (match_id,)).fetchone()
    conn.close()
    row["lineup_home"] = parse_json_list(row["lineup_home"]); row["lineup_away"] = parse_json_list(row["lineup_away"])
    row["available_players"] = parse_json_list(row.get("available_players"))
    socketio.emit("match_updated", row)
    return jsonify(row)

@app.route("/api/matches/<int:match_id>", methods=["DELETE"])
def delete_match(match_id):
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    conn = connect(); conn.execute("DELETE FROM matches WHERE id=?", (match_id,)); conn.commit(); conn.close()
    socketio.emit("data_changed", {"type": "matches"})
    return jsonify({"ok": True})

@app.route("/api/videos", methods=["GET"])
def get_videos():
    user, err, code = require_user()
    if not user: return err, code
    conn = connect(); rows = conn.execute("SELECT * FROM videos ORDER BY id DESC").fetchall(); conn.close()
    return jsonify(rows)

@app.route("/api/videos", methods=["POST"])
def create_video():
    user, err, code = require_roles({"admin"})
    if not user: return err, code
    b = request.get_json() or {}
    conn = connect(); cur = conn.cursor()
    cur.execute("INSERT INTO videos (title, platform, url, category) VALUES (?, ?, ?, ?)",
                ((b.get("title") or "Video").strip(), (b.get("platform") or "youtube").strip(), (b.get("url") or "").strip(), (b.get("category") or "resumen").strip()))
    conn.commit(); row = conn.execute("SELECT * FROM videos WHERE id=?", (cur.lastrowid,)).fetchone(); conn.close()
    socketio.emit("data_changed", {"type": "videos"})
    return jsonify(row), 201

@app.route("/api/videos/<int:video_id>", methods=["DELETE"])
def delete_video(video_id):
    user, err, code = require_roles({"admin"})
    if not user: return err, code
    conn = connect(); conn.execute("DELETE FROM videos WHERE id=?", (video_id,)); conn.commit(); conn.close()
    socketio.emit("data_changed", {"type": "videos"})
    return jsonify({"ok": True})


@app.route("/api/highlights", methods=["GET"])
def get_highlights():
    user, err, code = require_user()
    if not user: return err, code
    conn = connect(); rows = conn.execute("SELECT * FROM highlights ORDER BY id DESC").fetchall(); conn.close()
    return jsonify(rows)

@app.route("/api/highlights", methods=["POST"])
def create_highlight():
    user, err, code = require_roles({"admin"})
    if not user: return err, code
    b = request.get_json() or {}
    conn = connect(); cur = conn.cursor()
    cur.execute("INSERT INTO highlights (title, minute, description, media_path, media_type, moment_type, match_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ((b.get("title") or "Momento").strip(), (b.get("minute") or "").strip(), (b.get("description") or "").strip(),
                 (b.get("media_path") or "").strip(), (b.get("media_type") or "").strip(), (b.get("moment_type") or "otro").strip(), safe_int(b.get("match_id"), 0) or None))
    conn.commit(); row = conn.execute("SELECT * FROM highlights WHERE id=?", (cur.lastrowid,)).fetchone(); conn.close()
    socketio.emit("data_changed", {"type": "highlights"})
    return jsonify(row), 201

@app.route("/api/highlights/<int:highlight_id>", methods=["DELETE"])
def delete_highlight(highlight_id):
    user, err, code = require_roles({"admin"})
    if not user: return err, code
    conn = connect(); conn.execute("DELETE FROM highlights WHERE id=?", (highlight_id,)); conn.commit(); conn.close()
    socketio.emit("data_changed", {"type": "highlights"})
    return jsonify({"ok": True})

@app.route("/api/upload-media", methods=["POST"])
def upload_media():
    user, err, code = require_roles({"admin"})
    if not user: return err, code
    if "media" not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files["media"]
    if file.filename == "": return jsonify({"error": "Empty file"}), 400
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"]: 
        return jsonify({"error": "Formato inválido"}), 400
    
    media_type = "video" if ext in [".mp4", ".webm"] else "image"
    filename = f"media_{int(datetime.now().timestamp())}{ext}"
    path = UPLOAD_DIR / filename
    file.save(path)
    
    return jsonify({"url": f"/uploads/{filename}", "type": media_type})


@app.route("/api/settings", methods=["POST"])
def update_settings():
    user, err, code = require_roles({"admin", "user"})
    if not user: return err, code
    body = request.get_json() or {}
    conn = connect()
    s = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
    if user["role"] != "admin":
        allowed = {"app_name", "home_team_name","away_team_name","home_primary","home_secondary","away_primary","away_secondary","next_match_title","venue","schedule","captain_home_id","captain_away_id","app_theme","app_bg_color"}
        body = {k:v for k,v in body.items() if k in allowed}
    s.update(body)
    
    # Simple migration if app_theme doesn't exist
    try:
        conn.execute("ALTER TABLE settings ADD COLUMN app_theme TEXT DEFAULT 'dark'")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE settings ADD COLUMN app_bg_color TEXT DEFAULT ''")
    except Exception:
        pass

    conn.execute('''UPDATE settings SET app_name=?, home_team_name=?, away_team_name=?, home_primary=?, home_secondary=?,
    away_primary=?, away_secondary=?, next_match_title=?, venue=?, schedule=?, live_enabled=?, live_url=?, captain_home_id=?, captain_away_id=?, app_theme=?, app_bg_color=? WHERE id=1''',
    (s.get("app_name",""), s["home_team_name"], s["away_team_name"], s["home_primary"], s["home_secondary"], s["away_primary"], s["away_secondary"], s["next_match_title"], s["venue"], s["schedule"], safe_int(s.get("live_enabled"),0), s.get("live_url",""), safe_int(s.get("captain_home_id"),0) or None, safe_int(s.get("captain_away_id"),0) or None, s.get("app_theme", "dark"), s.get("app_bg_color", "")))
    conn.commit(); row = conn.execute("SELECT * FROM settings WHERE id=1").fetchone(); conn.close()
    socketio.emit("settings_updated", row)
    return jsonify(row)

# Socket.io events
@socketio.on("connect")
def handle_connect():
    print("User connected")

@socketio.on("disconnect")
def handle_disconnect():
    print("User disconnected")

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "3000"))
    print(f"Futbol7 Clean Studio Flask+SocketIO en http://localhost:{port}")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
