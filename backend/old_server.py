
import json
import mimetypes
import os
import secrets
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from app.db import UPLOAD_DIR, connect, init_db, parse_json_list

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
TOKENS = {}
ALLOWED_IMAGES = {".jpg", ".jpeg", ".png", ".webp"}

def respond(handler, payload, status=200):
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(raw)

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

class Handler(BaseHTTPRequestHandler):
    server_version = "Futbol7Clean/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def read_json(self):
        length = safe_int(self.headers.get("Content-Length"), 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def user(self):
        token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
        return TOKENS.get(token)

    def require_user(self):
        user = self.user()
        if not user:
            respond(self, {"error": "No autorizado"}, 401)
            return None
        return user

    def require_roles(self, roles):
        user = self.require_user()
        if not user:
            return None
        if user["role"] not in roles:
            respond(self, {"error": "Sin permisos"}, 403)
            return None
        return user

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            if path == "/api/bootstrap": return self.bootstrap()
            if path == "/api/logout": return self.logout()
            if path == "/api/players": return self.players()
            if path == "/api/matches": return self.matches()
            if path == "/api/videos": return self.videos()
            if path == "/api/highlights": return self.highlights()
            respond(self, {"error": "No encontrado"}, 404)
            return
        return self.static(path)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        routes = {
            "/api/login": self.login,
            "/api/upload-photo": self.upload_photo,
            "/api/players": self.create_player,
            "/api/matches": self.create_match,
            "/api/videos": self.create_video,
            "/api/highlights": self.create_highlight,
            "/api/settings": self.update_settings,
        }
        if path in routes:
            return routes[path]()
        respond(self, {"error": "No encontrado"}, 404)

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/players/"): return self.update_player(path.rsplit("/", 1)[-1])
        if path.startswith("/api/matches/"): return self.update_match(path.rsplit("/", 1)[-1])
        respond(self, {"error": "No encontrado"}, 404)

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/players/"): return self.delete("players", path.rsplit("/", 1)[-1], {"admin", "user"})
        if path.startswith("/api/matches/"): return self.delete("matches", path.rsplit("/", 1)[-1], {"admin", "user"})
        if path.startswith("/api/videos/"): return self.delete("videos", path.rsplit("/", 1)[-1], {"admin"})
        if path.startswith("/api/highlights/"): return self.delete("highlights", path.rsplit("/", 1)[-1], {"admin"})
        respond(self, {"error": "No encontrado"}, 404)

    def static(self, path):
        if path == "/":
            path = "/index.html"
        target = UPLOAD_DIR / path.replace("/uploads/", "") if path.startswith("/uploads/") else FRONTEND / path.lstrip("/")
        if not target.exists() or not target.is_file():
            self.send_error(404, "Archivo no encontrado")
            return
        data = target.read_bytes()
        mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix == ".js": mime = "application/javascript"
        if target.suffix == ".css": mime = "text/css"
        if target.suffix == ".html": mime = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def login(self):
        body = self.read_json()
        conn = connect()
        user = conn.execute(
            "SELECT id, username, role, display_name FROM users WHERE username=? AND password=?",
            ((body.get("username") or "").strip(), (body.get("password") or "").strip()),
        ).fetchone()
        conn.close()
        if not user:
            respond(self, {"error": "Credenciales invÃ¡lidas"}, 401)
            return
        token = secrets.token_hex(18)
        TOKENS[token] = user
        respond(self, {"token": token, "user": user})

    def logout(self):
        token = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
        TOKENS.pop(token, None)
        respond(self, {"ok": True})

    def bootstrap(self):
        user = self.require_user()
        if not user: return
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
        respond(self, {
            "user": user,
            "settings": settings,
            "players": players,
            "matches": matches,
            "videos": videos,
            "highlights": highlights,
            "dashboard": {"players": len(players), "matches": len(matches), "videos": len(videos), "highlights": len(highlights)}
        })

    def upload_photo(self):
        if not self.require_roles({"admin", "user"}): return
        content_type = self.headers.get("Content-Type", "")
        length = safe_int(self.headers.get("Content-Length"), 0)
        if "multipart/form-data" not in content_type or length <= 0:
            respond(self, {"error": "Sube una imagen vÃ¡lida"}, 400)
            return
        fields, files = parse_multipart(content_type, self.rfile.read(length))
        upload = files.get("photo")
        if not upload:
            respond(self, {"error": "No llegÃ³ la foto"}, 400)
            return
        ext = Path(upload.get("filename") or "foto.jpg").suffix.lower() or ".jpg"
        if ext not in ALLOWED_IMAGES:
            respond(self, {"error": "Usa JPG, PNG o WEBP"}, 400)
            return

        original_name = f"original_{secrets.token_hex(10)}{ext}"
        poster_name = f"poster_{secrets.token_hex(10)}.png"
        original_path = UPLOAD_DIR / original_name
        poster_path = UPLOAD_DIR / poster_name
        original_path.write_bytes(upload["content"])

        conn = connect()
        s = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
        conn.close()
        side = fields.get("team_side", "home")
        colors = {
            "primary": s["away_primary"] if side == "away" else s["home_primary"],
            "secondary": s["away_secondary"] if side == "away" else s["home_secondary"],
            "team_name": s["away_team_name"] if side == "away" else s["home_team_name"],
        }
        meta = {
            "name": fields.get("name", "Jugador"),
            "nickname": fields.get("nickname", ""),
            "number": safe_int(fields.get("number"), 0),
            "position": fields.get("position", "Jugador"),
            "matches_played": safe_int(fields.get("matches_played"), 0),
            "goals": safe_int(fields.get("goals"), 0),
            "assists": safe_int(fields.get("assists"), 0),
        }
        make_player_poster(original_path, poster_path, meta, colors)
        respond(self, {"photo_path": f"/uploads/{original_name}", "poster_path": f"/uploads/{poster_name}"}, 201)

    def player_payload(self):
        body = self.read_json()
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

    def create_player(self):
        if not self.require_roles({"admin", "user"}): return
        p = self.player_payload()
        conn = connect()
        cur = conn.cursor()
        cur.execute("""INSERT INTO players
        (team_side, name, nickname, number, position, photo_path, poster_path, goals, assists, matches_played, rating)
        VALUES (:team_side, :name, :nickname, :number, :position, :photo_path, :poster_path, :goals, :assists, :matches_played, :rating)""", p)
        conn.commit()
        row = conn.execute("SELECT * FROM players WHERE id=?", (cur.lastrowid,)).fetchone()
        conn.close()
        respond(self, row, 201)

    def update_player(self, player_id):
        if not self.require_roles({"admin", "user"}): return
        p = self.player_payload()
        p["id"] = player_id
        conn = connect()
        old = conn.execute("SELECT * FROM players WHERE id=?", (player_id,)).fetchone()
        if old and not p["poster_path"]: p["poster_path"] = old.get("poster_path", "")
        if old and not p["photo_path"]: p["photo_path"] = old.get("photo_path", "")
        conn.execute("""UPDATE players SET team_side=:team_side, name=:name, nickname=:nickname, number=:number,
        position=:position, photo_path=:photo_path, poster_path=:poster_path, goals=:goals, assists=:assists,
        matches_played=:matches_played, rating=:rating WHERE id=:id""", p)
        conn.commit()
        row = conn.execute("SELECT * FROM players WHERE id=?", (player_id,)).fetchone()
        conn.close()
        respond(self, row)

    def players(self):
        if not self.require_user(): return
        conn = connect()
        rows = conn.execute("SELECT * FROM players ORDER BY team_side, number, name").fetchall()
        conn.close()
        respond(self, rows)

    def match_payload(self):
        body = self.read_json()
        return {
            "title": (body.get("title") or "Partido").strip(),
            "match_date": (body.get("match_date") or "").strip(),
            "venue": (body.get("venue") or "").strip(),
            "score_home": safe_int(body.get("score_home"), 0),
            "score_away": safe_int(body.get("score_away"), 0),
            "status": (body.get("status") or "programado").strip(),
            "lineup_home": json.dumps(body.get("lineup_home") or [None]*7),
            "lineup_away": json.dumps(body.get("lineup_away") or [None]*7),
        }

    def create_match(self):
        if not self.require_roles({"admin", "user"}): return
        p = self.match_payload()
        conn = connect()
        cur = conn.cursor()
        cur.execute("""INSERT INTO matches (title, match_date, venue, score_home, score_away, status, lineup_home, lineup_away)
        VALUES (:title, :match_date, :venue, :score_home, :score_away, :status, :lineup_home, :lineup_away)""", p)
        conn.commit()
        row = conn.execute("SELECT * FROM matches WHERE id=?", (cur.lastrowid,)).fetchone()
        conn.close()
        row["lineup_home"] = parse_json_list(row["lineup_home"]); row["lineup_away"] = parse_json_list(row["lineup_away"])
        respond(self, row, 201)

    def update_match(self, match_id):
        if not self.require_roles({"admin", "user"}): return
        p = self.match_payload(); p["id"] = match_id
        conn = connect()
        conn.execute("""UPDATE matches SET title=:title, match_date=:match_date, venue=:venue, score_home=:score_home,
        score_away=:score_away, status=:status, lineup_home=:lineup_home, lineup_away=:lineup_away WHERE id=:id""", p)
        conn.commit()
        row = conn.execute("SELECT * FROM matches WHERE id=?", (match_id,)).fetchone()
        conn.close()
        row["lineup_home"] = parse_json_list(row["lineup_home"]); row["lineup_away"] = parse_json_list(row["lineup_away"])
        respond(self, row)

    def matches(self):
        if not self.require_user(): return
        conn = connect()
        rows = conn.execute("SELECT * FROM matches ORDER BY id DESC").fetchall()
        conn.close()
        for r in rows:
            r["lineup_home"] = parse_json_list(r.get("lineup_home"))
            r["lineup_away"] = parse_json_list(r.get("lineup_away"))
        respond(self, rows)

    def videos(self):
        if not self.require_user(): return
        conn = connect(); rows = conn.execute("SELECT * FROM videos ORDER BY id DESC").fetchall(); conn.close()
        respond(self, rows)

    def create_video(self):
        if not self.require_roles({"admin"}): return
        b = self.read_json()
        conn = connect(); cur = conn.cursor()
        cur.execute("INSERT INTO videos (title, platform, url, category) VALUES (?, ?, ?, ?)",
                    ((b.get("title") or "Video").strip(), (b.get("platform") or "youtube").strip(), (b.get("url") or "").strip(), (b.get("category") or "resumen").strip()))
        conn.commit(); row = conn.execute("SELECT * FROM videos WHERE id=?", (cur.lastrowid,)).fetchone(); conn.close()
        respond(self, row, 201)

    def highlights(self):
        if not self.require_user(): return
        conn = connect(); rows = conn.execute("SELECT * FROM highlights ORDER BY id DESC").fetchall(); conn.close()
        respond(self, rows)

    def create_highlight(self):
        if not self.require_roles({"admin"}): return
        b = self.read_json()
        conn = connect(); cur = conn.cursor()
        cur.execute("INSERT INTO highlights (title, minute, description) VALUES (?, ?, ?)",
                    ((b.get("title") or "Momento").strip(), (b.get("minute") or "").strip(), (b.get("description") or "").strip()))
        conn.commit(); row = conn.execute("SELECT * FROM highlights WHERE id=?", (cur.lastrowid,)).fetchone(); conn.close()
        respond(self, row, 201)

    def update_settings(self):
        user = self.require_roles({"admin", "user"})
        if not user: return
        body = self.read_json()
        conn = connect()
        s = conn.execute("SELECT * FROM settings WHERE id=1").fetchone()
        if user["role"] != "admin":
            allowed = {"home_team_name","away_team_name","home_primary","home_secondary","away_primary","away_secondary","next_match_title","venue","schedule"}
            body = {k:v for k,v in body.items() if k in allowed}
        s.update(body)
        conn.execute("""UPDATE settings SET app_name=?, home_team_name=?, away_team_name=?, home_primary=?, home_secondary=?,
        away_primary=?, away_secondary=?, next_match_title=?, venue=?, schedule=?, live_enabled=?, live_url=? WHERE id=1""",
        (s["app_name"], s["home_team_name"], s["away_team_name"], s["home_primary"], s["home_secondary"], s["away_primary"], s["away_secondary"], s["next_match_title"], s["venue"], s["schedule"], safe_int(s.get("live_enabled"),0), s.get("live_url","")))
        conn.commit(); row = conn.execute("SELECT * FROM settings WHERE id=1").fetchone(); conn.close()
        respond(self, row)

    def delete(self, table, row_id, roles):
        if not self.require_roles(roles): return
        conn = connect(); conn.execute(f"DELETE FROM {table} WHERE id=?", (row_id,)); conn.commit(); conn.close()
        respond(self, {"ok": True})

def main():
    init_db()
    port = int(os.environ.get("PORT", "3000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Futbol7 Clean Studio en http://localhost:{port}")
    server.serve_forever()

if __name__ == "__main__":
    main()
