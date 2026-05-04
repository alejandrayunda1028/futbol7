const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const nav = [
  ["inicio", "Inicio", "fa-house"],
  ["perfil", "Mi Perfil", "fa-user"],
  ["jugadores", "Plantilla General", "fa-users"],
  ["partido", "Partido 7v7", "fa-map"],
  ["contenido", "Videos", "fa-video"],
  ["ajustes", "Ajustes", "fa-gear"]
];

const slots = ["ARQ", "DEF I", "DEF C", "DEF D", "MED I", "MED D", "DEL"];
const homePos = [[50,90],[20,70],[50,70],[80,70],[35,45],[65,45],[50,20]];
const awayPos = [[50,10],[80,30],[50,30],[20,30],[65,55],[35,55],[50,80]];

let socket;
let state = {
  token: localStorage.f7_clean_token || "",
  user: null,
  settings: null,
  players: [],
  matches: [],
  videos: [],
  highlights: [],
  dashboard: {},
  section: "inicio",
  editPlayer: null,
  editMatch: null
};

function esc(v=""){
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function toast(msg){
  const t = $("#toast");
  t.innerHTML = `<i class="fa-solid fa-bell"></i> ${msg}`;
  t.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(()=>t.classList.remove("show"),2600);
}
async function api(path, opt={}){
  const headers = opt.headers || {};
  if(state.token) headers.Authorization = "Bearer " + state.token;
  if(opt.body && !(opt.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(path,{...opt,headers});
  const data = (res.headers.get("content-type")||"").includes("json") ? await res.json() : await res.text();
  if(!res.ok) throw new Error(data.error || "Error");
  return data;
}
function team(side){
  if(!state.settings) return {name:"Equipo", p:"#fff", s:"#000"};
  return side === "away"
    ? {name:state.settings.away_team_name, p:state.settings.away_primary, s:state.settings.away_secondary}
    : {name:state.settings.home_team_name, p:state.settings.home_primary, s:state.settings.home_secondary};
}
function contrast(hex){
  hex = (hex || "#000").replace("#","");
  if(hex.length!==6) return "#fff";
  const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
  return ((r*299+g*587+b*114)/1000)>150 ? "#111827" : "#fff";
}
function player(id){ return state.players.find(p => Number(p.id) === Number(id)); }

function initSocket() {
  if (socket) socket.disconnect();
  socket = io();
  
  socket.on("connect", () => {
    $("#connectionStatus").classList.remove("hidden");
    $("#connectionStatus").classList.add("connected");
    $("#connectionStatus").innerHTML = `<i class="fa-solid fa-wifi"></i> <span>En línea</span>`;
  });
  
  socket.on("disconnect", () => {
    $("#connectionStatus").classList.remove("hidden", "connected");
    $("#connectionStatus").innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Desconectado</span>`;
  });
  
  socket.on("match_updated", (m) => {
    const idx = state.matches.findIndex(x => x.id === m.id);
    if(idx > -1) state.matches[idx] = m;
    else state.matches.unshift(m);
    if(state.section === "partido" || state.section === "inicio") render();
    toast("⚽ Formación actualizada en tiempo real");
  });

  socket.on("settings_updated", (s) => {
    state.settings = s;
    applyTheme();
    if(state.section === "ajustes") render();
    shell();
  });

  socket.on("data_changed", async (data) => {
    await load(false);
    render();
  });
}

function applyTheme() {
  const t = state.settings?.app_theme || 'dark';
  document.body.className = `theme-${t}`;
  
  if (state.settings?.app_bg_color) {
    document.body.style.backgroundColor = state.settings.app_bg_color;
    document.body.style.backgroundImage = 'none'; // Overrides theme gradient
  } else {
    document.body.style.backgroundColor = '';
    document.body.style.backgroundImage = '';
  }
}

$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#loginMsg").textContent = "";
  const btn = e.target.querySelector("button");
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
  try{
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    const data = await api("/api/login", {method:"POST", body:JSON.stringify(f)});
    state.token = data.token;
    localStorage.f7_clean_token = state.token;
    await load();
  }catch(err){ 
    $("#loginMsg").textContent = err.message; 
    btn.innerHTML = `Ingresar al Studio`;
  }
});

$("#logoutBtn").onclick = async () => {
  try{ await api("/api/logout"); }catch{}
  localStorage.removeItem("f7_clean_token");
  state.token = "";
  state.user = null;
  if(socket) socket.disconnect();
  shell();
};
$("#refreshBtn").onclick = ()=>load();

async function load(fullRender = true){
  if(!state.token){ shell(); return; }
  try{
    const data = await api("/api/bootstrap");
    Object.assign(state, data);
    applyTheme();
    if (state.settings?.google_client_id) {
      window.google?.accounts.id.initialize({
        client_id: state.settings.google_client_id,
        callback: window.handleGoogleLogin
      });
    }
    if(!socket || !socket.connected) initSocket();
    if(fullRender) { shell(); render(); }
  }catch(err){
    localStorage.removeItem("f7_clean_token");
    state.token = "";
    state.user = null;
    shell();
    throw err;
  }
}
function shell(){
  const on = !!state.user;
  $("#login").classList.toggle("hidden", on);
  $("#app").classList.toggle("hidden", !on);
  if(!on) return;
  
  const s = state.settings || {};
  
  $("#brandName").textContent = s.app_name || "Futbol7 Pro";
  
  let roleDisplay = "Jugador";
  if(state.user.role === "ADMIN") roleDisplay = "Administrador";
  else if(state.user.role === "CAPTAIN") roleDisplay = "Capitán";
  $("#roleText").textContent = roleDisplay;

  const isAdmin = state.user.role === "ADMIN";
  const isCap = state.user.role === "CAPTAIN";

  const filteredNav = nav.filter(n => {
    if (n[0] === "ajustes") return isAdmin;
    return true;
  });

  $("#nav").innerHTML = filteredNav.map(n => `<button class="${state.section===n[0]?'active':''}" data-sec="${n[0]}"><i class="fa-solid ${n[2]}"></i> <span>${n[1]}</span></button>`).join("");
  $$("[data-sec]").forEach(b => b.onclick = () => { state.section = b.dataset.sec; render(); });
  
  const live = Number(state.settings.live_enabled) && state.settings.live_url;
  $("#liveBtn").classList.toggle("hidden", !live);
  $("#liveBtn").href = state.settings.live_url || "#";

  const avatarEl = $(".user-avatar");
  if(state.user.avatar) {
    avatarEl.innerHTML = `<img src="${esc(state.user.avatar)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    avatarEl.style.cursor = "pointer";
    avatarEl.onclick = () => { state.section = "perfil"; render(); };
  } else {
    avatarEl.innerHTML = `<i class="fa-solid fa-user"></i>`;
  }
}
function render(){
  shell();
  const views = {inicio, perfil, jugadores, partido, contenido, ajustes};
  $("#content").innerHTML = views[state.section]();
  $("#pageTitle").textContent = nav.find(n=>n[0]===state.section)?.[1] || "";
  
  bind();
}
function bind(){
  $("#profileForm")?.addEventListener("submit", saveProfile);
  $("#profilePhoto")?.addEventListener("change", uploadProfilePhoto);

  $("#playerForm")?.addEventListener("submit", savePlayer);
  $("#playerPhoto")?.addEventListener("change", uploadPhoto);
  $("#clearPlayer")?.addEventListener("click", ()=>{state.editPlayer=null;render();});
  $$("[data-edit-player]").forEach(b=>b.onclick=()=>{state.editPlayer=Number(b.dataset.editPlayer);state.section="jugadores";render();});
  $$("[data-del-player]").forEach(b=>b.onclick=async ()=>{if(confirm("¿Eliminar jugador?")) {await api("/api/players/"+b.dataset.delPlayer,{method:"DELETE"}); load();}});

  $("#searchPlayers")?.addEventListener("input", (e) => {
    state.searchPlayers = e.target.value;
    // Debounced or simple re-render
    const grid = $(".grid-4", $("#content"));
    const q = state.searchPlayers.toLowerCase();
    const filtered = state.players.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.player_code || "").toLowerCase().includes(q) ||
      (p.email || "").toLowerCase().includes(q) ||
      (p.phone || "").toLowerCase().includes(q) ||
      (p.nickname || "").toLowerCase().includes(q)
    );
    if(grid) grid.innerHTML = filtered.map(playerCard).join("") || empty("No se encontraron jugadores.");
  });
  $$("[data-del-player]").forEach(b=>b.onclick=()=>del("players", b.dataset.delPlayer, "jugadores"));

  $("#matchForm")?.addEventListener("submit", saveMatch);
  $("#clearMatch")?.addEventListener("click", ()=>{state.editMatch=null;render();});
  $$("[data-edit-match]").forEach(b=>b.onclick=()=>{state.editMatch=Number(b.dataset.editMatch);state.section="partido";render();});
  $$("[data-del-match]").forEach(b=>b.onclick=()=>del("matches", b.dataset.delMatch, "partido"));
  
  $$(".lineup-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val) {
        let count = 0;
        $$(".lineup-select").forEach(s => { if (s.value === val) count++; });
        if (count > 1) {
          toast("Este jugador ya fue seleccionado en otra posición.", true);
          e.target.value = ""; // revert
        }
      }
      if($("#matchForm")) $("#matchForm").requestSubmit();
    });
  });

  $$(".avail-check").forEach(chk => {
    chk.addEventListener("change", () => {
      if($("#matchForm")) $("#matchForm").requestSubmit();
    });
  });

  $("#settingsForm")?.addEventListener("submit", saveSettings);
  $("#videoForm")?.addEventListener("submit", saveVideo);
  $("#highlightForm")?.addEventListener("submit", saveHighlight);
  $$("[data-del-video]").forEach(b=>b.onclick=()=>del("videos", b.dataset.delVideo, "ajustes"));
  $$("[data-del-highlight]").forEach(b=>b.onclick=()=>del("highlights", b.dataset.delHighlight, "ajustes"));

  if(state.editPlayer) fillPlayer(state.players.find(p=>p.id===state.editPlayer));
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    const fd = new FormData(e.currentTarget);
    const data = await api("/api/users/profile", { method: "PUT", body: JSON.stringify(Object.fromEntries(fd)) });
    Object.assign(state.user, data);
    toast("Perfil actualizado correctamente");
    render();
  } catch (err) { toast("Error al guardar perfil", true); }
}

async function uploadProfilePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("photo", file);
  try {
    const res = await api("/api/users/profile/photo", { method: "POST", body: fd });
    state.user.avatar = res.avatar;
    toast("Foto actualizada");
    render();
  } catch (err) { toast("Error subiendo foto", true); }
}

function perfil() {
  const u = state.user;
  const avatarHtml = u.avatar ? `<img src="${esc(u.avatar)}" style="width:140px; height:140px; border-radius:50%; object-fit:cover; border:4px solid var(--primary); box-shadow:0 0 20px rgba(99,102,241,0.3)">` : `<div style="width:140px; height:140px; border-radius:50%; background:var(--bg-panel-solid); display:flex; align-items:center; justify-content:center; font-size:4rem; border:2px solid var(--border); color:var(--muted)"><i class="fa-solid fa-user"></i></div>`;
  
  const playersOptions = state.players.map(p => `<option value="${p.id}" ${Number(u.player_id) === Number(p.id) ? 'selected' : ''}>#${p.number} ${esc(p.name)}</option>`).join("");
  
  return `
  <section class="panel glass" style="max-width:900px; margin:0 auto;">
    <div style="text-align:center; margin-bottom:40px; position:relative;">
      <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:300px; height:300px; background:radial-gradient(circle, var(--primary) 0%, transparent 70%); opacity:0.1; z-index:-1;"></div>
      ${avatarHtml}
      <div style="margin-top:-30px;">
        <label class="btn primary btn-small" style="cursor:pointer; border-radius:50%; width:44px; height:44px; padding:0; box-shadow:var(--shadow)">
          <i class="fa-solid fa-camera"></i>
          <input type="file" id="profilePhoto" hidden accept="image/*">
        </label>
      </div>
      <h2 style="margin-top:20px; font-size:2rem;">${esc(u.display_name)}</h2>
      <p class="muted">@${esc(u.username)} · ${esc(u.email || 'Sin correo vinculado')}</p>
    </div>

    <form id="profileForm" class="form">
      <div class="form-grid">
        <label>Nombre Público <input name="display_name" value="${esc(u.display_name)}" required></label>
        <label>Teléfono <input name="phone" value="${esc(u.phone || '')}" placeholder="+57..."></label>
        <label>Posición Preferida 
          <select name="preferred_position">
            <option value="">No definida</option>
            ${slots.map(s => `<option value="${s}" ${u.preferred_position===s?'selected':''}>${s}</option>`).join("")}
          </select>
        </label>
        <label>Número Camiseta <input type="number" name="shirt_number" value="${u.shirt_number || ''}" placeholder="Ej: 10"></label>
        
        <div class="full" style="background:rgba(255,255,255,0.03); padding:20px; border-radius:12px; border:1px solid var(--border);">
          <h3 style="margin-bottom:8px; display:flex; align-items:center; gap:10px;"><i class="fa-solid fa-link" style="color:var(--primary)"></i> Vincular con Jugador de Plantilla</h3>
          <p class="muted" style="margin-bottom:16px;">Si eres un jugador registrado en el club, selecciónate aquí para vincular tus estadísticas automáticamente.</p>
          <select name="player_id" style="background:rgba(0,0,0,0.4)">
            <option value="">-- Buscar en la lista --</option>
            ${playersOptions}
          </select>
        </div>

        <label class="full">Biografía / Notas <textarea name="bio" rows="3" placeholder="Cuéntanos un poco sobre tu estilo de juego...">${esc(u.bio || '')}</textarea></label>
      </div>

      <div style="display:flex; justify-content:center; margin-top:20px;">
        <button class="btn primary glow-on-hover" style="padding:14px 40px; font-size:1.1rem;"><i class="fa-solid fa-floppy-disk"></i> Actualizar Perfil</button>
      </div>
    </form>
  </section>
  `;
}

function inicio(){
  const s = state.settings || {}, d = state.dashboard || {};
  const nextMatch = state.matches.find(m => m.status !== 'jugado') || state.matches[0];

  return `
  <section class="panel glass" style="position:relative; overflow:hidden;">
    <div style="position:absolute; right:-50px; top:-50px; opacity:0.1; font-size:15rem;"><i class="fa-solid fa-futbol"></i></div>
    <p class="eyebrow">Panel principal</p>
    <h2 style="font-size:2.5rem; margin-bottom: 8px;">${esc(s.next_match_title || "Próximo Partido")}</h2>
    <p class="muted" style="font-size:1.1rem;"><i class="fa-solid fa-location-dot"></i> ${esc(s.venue || "Cancha principal")} &nbsp;|&nbsp; <i class="fa-regular fa-calendar"></i> ${esc(s.schedule || "Pendiente")}</p>
    
    ${nextMatch && nextMatch.has_stream && nextMatch.stream_url ? `
      <div style="margin-top:16px;">
        <a href="${esc(nextMatch.stream_url)}" target="_blank" class="btn primary glow-on-hover" style="display:inline-flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-video"></i> Ver transmisión en vivo
        </a>
      </div>
    ` : ''}
    
    <div class="row" style="margin-top:24px;">
      <div style="display:flex; align-items:center; gap:16px; background:rgba(0,0,0,0.3); padding:12px 24px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
        <div style="width:24px;height:24px;border-radius:50%;background:${esc(s.home_primary || "#ff1558")}"></div>
        <strong style="font-size:1.2rem">${esc(s.home_team_name || "Equipo Local")}</strong>
      </div>
      <span style="font-weight:800; color:var(--muted)">VS</span>
      <div style="display:flex; align-items:center; gap:16px; background:rgba(0,0,0,0.3); padding:12px 24px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
        <div style="width:24px;height:24px;border-radius:50%;background:${esc(s.away_primary || "#2563eb")}"></div>
        <strong style="font-size:1.2rem">${esc(s.away_team_name || "Equipo Rival")}</strong>
      </div>
    </div>
  </section>

  <section class="grid-4">
    ${metric("Plantilla", d.players)}
    ${metric("Partidos", d.matches)}
    ${metric("Videos", d.videos)}
    ${metric("Momentos", d.highlights)}
  </section>
  
  ${nextMatch && (nextMatch.lineup_home.some(x=>x) || nextMatch.lineup_away.some(x=>x)) ? `
  <section class="panel glass" style="margin-top:24px; padding:0; overflow:hidden;">
    <div style="padding:20px; border-bottom:1px solid var(--border);">
      <h2><i class="fa-solid fa-chess-board"></i> Equipos Armados: ${esc(nextMatch.title)}</h2>
    </div>
    <div style="padding:20px;">${renderPitchShell(nextMatch)}</div>
  </section>
  ` : ''}
  `;
}
function metric(label,value){return `<article class="panel metric glass"><span>${esc(label)}</span><b>${esc(value)}</b></article>`}
function empty(t){return `<p class="muted" style="text-align:center; padding:20px; font-style:italic;">${esc(t)}</p>`}

function poster(player){
  const img = player.poster_path || player.photo_path;
  if(img) return `<div class="poster"><img src="${esc(img)}" alt="${esc(player.name)}"></div>`;
  const initial = (player.nickname || player.name || "J").trim()[0] || "J";
  return `<div class="poster placeholder"><strong>${esc(initial.toUpperCase())}</strong></div>`;
}
function playerCard(p){
  const isReg = !!p.is_registered;
  const statusHtml = isReg 
    ? `<span class="badge" style="background:var(--success); color:#fff"><i class="fa-solid fa-check-circle"></i> Registrado</span>`
    : `<span class="badge" style="background:var(--muted); color:#fff"><i class="fa-solid fa-user-clock"></i> Invitado</span>`;
    
  return `<article class="player-card">
    ${poster(p)}
    <div class="player-info">
      <div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h3 style="margin:0">${esc(p.nickname || p.name)}</h3>
          <span style="font-family:monospace; font-weight:700; color:var(--primary); font-size:0.8rem">${esc(p.player_code || '')}</span>
        </div>
        <p class="muted">#${esc(p.number)} · ${esc(p.position || "Sin posición")}</p>
        <div style="margin-top:4px">${statusHtml}</div>
      </div>
      <div class="statline"><span>${p.matches_played||0} PJ</span><span>${p.goals||0} Goles</span><span>⭐ ${p.rating||0}</span></div>
      <div class="row">
        ${state.user.role !== 'PLAYER' ? `
        <button class="btn ghost icon-btn" data-edit-player="${p.id}"><i class="fa-solid fa-pen"></i></button>
        ${state.user.role === 'ADMIN' ? `<button class="btn danger-ghost icon-btn" data-del-player="${p.id}"><i class="fa-solid fa-trash"></i></button>` : ''}
        ` : ''}
      </div>
    </div>
  </article>`;
}

function jugadores(){
  const isAdmin = state.user.role === "ADMIN";
  const isCap = state.user.role === "CAPTAIN";
  const canEdit = isAdmin || isCap;

  const q = (state.searchPlayers || "").toLowerCase();
  const filtered = state.players.filter(p => 
    p.name.toLowerCase().includes(q) || 
    (p.player_code || "").toLowerCase().includes(q) ||
    (p.email || "").toLowerCase().includes(q) ||
    (p.phone || "").toLowerCase().includes(q) ||
    (p.nickname || "").toLowerCase().includes(q)
  );

  return `
  ${canEdit ? `
  <section class="two-cols">
    <article class="panel glass">
      <p class="eyebrow">${state.editPlayer ? "Editar" : "Nuevo jugador"}</p>
      <h2>${state.editPlayer ? "Editar jugador" : "Registrar jugador"}</h2>
      <form id="playerForm" class="form-grid">
        <label class="full">Nombre Completo<input name="name" required placeholder="Ej: Ricardo M"></label>
        <label>Correo (Opcional)<input name="email" type="email"></label>
        <label>Teléfono (Opcional)<input name="phone"></label>
        <label>Número Camiseta<input name="number" type="number" min="0" max="99" value="0"></label>
        <label>Posición Preferida<input name="position" placeholder="Delantero"></label>
        <label>Tipo de Jugador
          <select name="is_registered">
            <option value="1">Registrado (ID Único)</option>
            <option value="0">Invitado / Manual</option>
          </select>
        </label>
        <label>Calificación Inicial (1-10)<input name="rating" type="number" step=".1" value="5.0" min="1" max="10"></label>
        
        <label class="full">Foto del jugador (Generar Tarjeta)<input id="playerPhoto" type="file" accept="image/*"></label>
        <input name="photo_path" type="hidden"><input name="poster_path" type="hidden">
        <div class="full row" style="margin-top:10px;">
          <button class="btn primary glow-on-hover"><i class="fa-solid fa-floppy-disk"></i> ${state.editPlayer ? "Guardar" : "Crear Jugador"}</button>
          <button type="button" class="btn ghost" id="clearPlayer">Cancelar</button>
        </div>
        <div id="playerMsg" class="full"></div>
      </form>
    </article>
    <article class="panel glass">
      <p class="eyebrow">Vista previa</p>
      <h2>Ficha de Presentación</h2>
      <div id="preview" style="display:flex; justify-content:center;">${poster({name:"Tu jugador",nickname:"Jugador",poster_path:""})}</div>
    </article>
  </section>
  ` : ''}

  <section class="panel glass" style="margin-top:24px">
    <div class="row" style="justify-content:space-between; margin-bottom:20px; align-items:center;">
      <div>
        <h2>Plantilla General</h2>
        <p class="muted">Buscar y gestionar jugadores registrados o invitados.</p>
      </div>
      <div style="width:300px">
        <input id="searchPlayers" placeholder="🔍 Buscar por nombre o código..." value="${esc(state.searchPlayers || '')}" style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:12px; padding:12px 20px; width:100%;">
      </div>
    </div>
    <div class="grid-4">${filtered.map(playerCard).join("") || empty("No se encontraron jugadores.")}</div>
  </section>`;
}
function getPlayerForm(){
  const f = Object.fromEntries(new FormData($("#playerForm")).entries());
  return {
    ...f,
    number:+f.number||0, goals:+f.goals||0, assists:+f.assists||0,
    matches_played:+f.matches_played||0, rating:+f.rating||0,
    is_registered: f.is_registered === "1"
  };
}
async function uploadPhoto(e){
  const file = e.target.files[0]; if(!file) return;
  const form = $("#playerForm");
  $("#playerMsg").innerHTML = `<div class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Subiendo y creando presentación con IA...</div>`;
  const fd = new FormData();
  fd.append("photo", file);
  ["name","nickname","number","position","matches_played","goals","assists"].forEach(k=>fd.append(k, form[k]?.value || ""));
  fd.append("team_side", "none");
  try{
    const data = await api("/api/upload-photo", {method:"POST", body:fd});
    form.photo_path.value = data.photo_path;
    form.poster_path.value = data.poster_path;
    $("#preview").innerHTML = poster({...getPlayerForm(), photo_path:data.photo_path, poster_path:data.poster_path});
    $("#playerMsg").innerHTML = `<div style="color:var(--success)"><i class="fa-solid fa-circle-check"></i> Presentación generada.</div>`;
  }catch(err){
    $("#playerMsg").innerHTML = `<div style="color:var(--danger)"><i class="fa-solid fa-circle-xmark"></i> ${esc(err.message)}</div>`;
  }
}
async function savePlayer(e){
  e.preventDefault();
  try{
    const payload = getPlayerForm();
    if(state.editPlayer) await api("/api/players/"+state.editPlayer,{method:"PUT",body:JSON.stringify(payload)});
    else await api("/api/players",{method:"POST",body:JSON.stringify(payload)});
    toast("Jugador guardado");
    state.editPlayer = null;
    await load(); state.section="jugadores"; render();
  }catch(err){ $("#playerMsg").innerHTML = `<div style="color:var(--danger)">${esc(err.message)}</div>`; }
}
function fillPlayer(p){
  if(!p) return;
  const f = $("#playerForm");
  Object.keys(p).forEach(k=>{ if(f[k]) f[k].value = p[k] ?? ""; });
  $("#preview").innerHTML = poster(p);
}

function partido(){
  const s = state.settings;
  if(!s) return empty("Cargando ajustes...");
  const match = state.editMatch ? state.matches.find(m => m.id === state.editMatch) : (state.matches[0] || null);
  
  const isAdmin = state.user.role === "ADMIN";
  const isCap = state.user.role === "CAPTAIN";
  const isManager = match && (match.managers || []).includes(state.user.player_id);
  const canEdit = isAdmin || isCap || isManager;

  const homeStars = (match?.lineup_home || []).reduce((acc,id)=>acc+(player(id)?.rating||0),0);
  const awayStars = (match?.lineup_away || []).reduce((acc,id)=>acc+(player(id)?.rating||0),0);
  const balanceDiff = Math.abs(homeStars - awayStars);
  const isUnbalanced = balanceDiff > 8;

  const canEditHome = isAdmin || (isCap && state.user.id === s.captain_home_id) || isManager;
  const canEditAway = isAdmin || (isCap && state.user.id === s.captain_away_id) || isManager;

  return `
  <section class="two-cols">
    <article class="panel glass">
      <p class="eyebrow">${match ? "Edición de Partido" : "Nuevo Partido"}</p>
      <h2>${match ? "Gestión de Formaciones" : "Publicar Partido"}</h2>
      <form id="matchForm" class="form-grid">
        <label class="full">Título del Encuentro<input name="title" value="${esc(match?.title || state.settings.next_match_title)}" ${isAdmin?'':'readonly'}></label>
        
        ${isAdmin ? `
        <div class="full panel glass" style="padding:16px; margin-bottom:0">
          <h3><i class="fa-solid fa-list-check"></i> Disponibilidad de Jugadores (Call-up)</h3>
          <p class="muted" style="margin-bottom:12px">Marca quiénes jugarán este partido. Otros roles solo podrán elegir de esta lista.</p>
          <div style="display:flex; flex-wrap:wrap; gap:12px; max-height:200px; overflow-y:auto; padding-right:10px;">
            ${state.players.map(p => `
              <label style="flex-direction:row; align-items:center; background:rgba(0,0,0,0.2); padding:8px 12px; border-radius:8px; gap:8px;">
                <input type="checkbox" name="avail_${p.id}" value="${p.id}" class="avail-check" ${match?.available_players?.includes(p.id) ? 'checked' : ''}>
                #${p.number} ${esc(p.nickname || p.name)} (⭐${p.rating})
              </label>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${(isAdmin || isCap) && match ? `
        <div class="full panel glass" style="padding:16px; margin-top:12px">
          <h3><i class="fa-solid fa-user-shield"></i> Gestores del Partido</h3>
          <p class="muted">Asigna jugadores para que ayuden a gestionar este partido específico.</p>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
            ${(match.managers || []).map(mid => {
              const p = player(mid);
              return `<div class="row" style="background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:8px;">
                <span>${p ? esc(p.name) : 'ID: '+mid}</span>
                <button type="button" class="btn danger-ghost icon-btn small" onclick="removeManager(${match.id}, ${mid})"><i class="fa-solid fa-xmark"></i></button>
              </div>`;
            }).join('')}
            <div class="row">
              <select id="newManagerSelect" style="flex:1">
                <option value="">Seleccionar jugador...</option>
                ${state.players.filter(p => !(match.managers||[]).includes(p.id)).map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.player_code)})</option>`).join('')}
              </select>
              <button type="button" class="btn ghost small" onclick="addManager(${match.id})"><i class="fa-solid fa-plus"></i> Añadir</button>
            </div>
          </div>
        </div>
        ` : ''}

        <label>Fecha<input name="match_date" value="${esc(match?.match_date || "")}" placeholder="Ej: Hoy 19:00" ${isAdmin?'':'readonly'}></label>
        <label>Cancha<input name="venue" value="${esc(match?.venue || state.settings.venue)}" ${isAdmin?'':'readonly'}></label>
        <label>Goles Local<input name="score_home" type="number" value="${esc(match?.score_home || 0)}" ${canEdit?'':'readonly'}></label>
        <label>Goles Rival<input name="score_away" type="number" value="${esc(match?.score_away || 0)}" ${canEdit?'':'readonly'}></label>
        
        <div class="full" style="background:rgba(255,255,255,0.05); padding:16px; border-radius:12px; border-left:4px solid ${esc(state.settings.home_primary)}">
          <h3 style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
            ${esc(state.settings.home_team_name)} (⭐ ${homeStars.toFixed(1)})
            ${!canEditHome ? '<span class="badge" style="background:var(--danger)">Solo lectura</span>' : ''}
          </h3>
          <div class="form-grid">${lineupSelectors("home", match?.lineup_home || [], match?.available_players || [], canEditHome)}</div>
        </div>
        
        <div class="full" style="background:rgba(255,255,255,0.05); padding:16px; border-radius:12px; border-left:4px solid ${esc(state.settings.away_primary)}">
          <h3 style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
            ${esc(state.settings.away_team_name)} (⭐ ${awayStars.toFixed(1)})
            ${!canEditAway ? '<span class="badge" style="background:var(--danger)">Solo lectura</span>' : ''}
          </h3>
          <div class="form-grid">${lineupSelectors("away", match?.lineup_away || [], match?.available_players || [], canEditAway)}</div>
        </div>

        ${isUnbalanced ? `
        <div class="full" style="background:rgba(239, 68, 68, 0.2); border:1px solid rgba(239, 68, 68, 0.5); padding:16px; border-radius:12px; color:#fca5a5; display:flex; align-items:center; gap:12px;">
          <i class="fa-solid fa-scale-unbalanced" style="font-size:2rem"></i>
          <div>
            <strong>¡Equipos Desbalanceados!</strong>
            <p>Diferencia de estrellas: ${balanceDiff.toFixed(1)} (límite 8.0). Considera ajustar las formaciones.</p>
          </div>
        </div>
        ` : ''}
        
        <div class="full row">
          ${canEdit ? `<button class="btn primary glow-on-hover"><i class="fa-solid fa-floppy-disk"></i> Guardar Partido</button>` : ''}
          ${isAdmin ? `<button class="btn ghost" type="button" id="clearMatch"><i class="fa-solid fa-plus"></i> Nuevo</button>` : ''}
        </div>
        <div id="matchMsg" class="full"></div>
      </form>
    </article>
    <article class="panel glass" style="padding:0; overflow:hidden; border:none; display:flex; flex-direction:column; background:transparent;">
      <div style="padding:20px; background:var(--bg-panel); border-bottom:1px solid var(--border); border-radius:12px 12px 0 0;">
        <h2><i class="fa-solid fa-chess-board"></i> Pizarra Táctica</h2>
      </div>
      <div style="flex:1; padding:20px;">
        ${match ? renderPitchShell(match) : empty("Selecciona un partido del historial para editarlo.")}
      </div>
    </article>
  </section>
  <section class="panel glass" style="margin-top:24px"><h2>Historial de Partidos</h2><div class="item-list">${state.matches.map(matchItem).join("")}</div></section>`;
}
function lineupSelectors(side, selected=[], availIds=[], canEdit){
  const list = state.players.filter(p => availIds.includes(p.id));
  
  const allSelectedIds = [];
  $$(".lineup-select").forEach(s => { if(s.value) allSelectedIds.push(Number(s.value)); });

  return slots.map((label,i)=>{
    const selVal = selected[i];
    let extraOpt = "";
    if (selVal && !availIds.includes(selVal)) {
      const p = player(selVal);
      if(p) extraOpt = `<option value="${p.id}">#${p.number} ${esc(p.name)} (No disp.)</option>`;
    }
    const p = player(selVal);
    const photoUrl = p ? (p.photo_path || p.poster_path) : null;
    const photoHtml = photoUrl ? `<img src="${esc(photoUrl)}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid var(--primary); flex-shrink:0;">` : `<div style="width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; border:1px dashed var(--border); flex-shrink:0;"><i class="fa-solid fa-user" style="opacity:0.5"></i></div>`;
    
    return `<label style="display:flex; flex-direction:row; align-items:center; gap:12px; background:rgba(0,0,0,0.2); padding:8px 12px; border-radius:12px; margin-bottom:0;">
      ${photoHtml}
      <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:0.8rem; font-weight:700; color:var(--muted)">${label}</span>
        <select name="${side}_${i}" class="lineup-select" ${canEdit?'':'disabled'} onchange="render()" style="padding:8px; border:none; background:rgba(255,255,255,0.05); border-radius:6px; font-size:0.9rem;">
          <option value="">Sin asignar</option>
          ${extraOpt}
          ${list.map(pl => {
            const isPickedByOther = allSelectedIds.includes(Number(pl.id)) && Number(selVal) !== Number(pl.id);
            return `<option value="${pl.id}" ${Number(selVal)===Number(pl.id)?"selected":""} ${isPickedByOther ? 'disabled' : ''}>
              #${pl.number} ${esc(pl.nickname || pl.name)} (⭐${pl.rating}) ${isPickedByOther ? '— Ocupado' : ''}
            </option>`;
          }).join("")}
        </select>
      </div>
    </label>`;
  }).join("");
}
function getMatchPayload(){
  const f = Object.fromEntries(new FormData($("#matchForm")).entries());
  
  // Extract avail checkboxes
  const avail = [];
  for (let key in f) {
    if (key.startsWith("avail_")) avail.push(Number(f[key]));
  }

  return {
    title:f.title, match_date:f.match_date, venue:f.venue, status:f.status || 'programado',
    score_home:+f.score_home||0, score_away:+f.score_away||0,
    lineup_home: slots.map((_,i)=>f["home_"+i] ? +f["home_"+i] : null),
    lineup_away: slots.map((_,i)=>f["away_"+i] ? +f["away_"+i] : null),
    available_players: avail,
    has_stream: f.has_stream ? 1 : 0,
    stream_url: f.stream_url || "",
    video_url: f.video_url || ""
  };
}
async function saveMatch(e){
  e.preventDefault();
  try{
    const payload = getMatchPayload();
    if(state.editMatch) await api("/api/matches/"+state.editMatch,{method:"PUT",body:JSON.stringify(payload)});
    else await api("/api/matches",{method:"POST",body:JSON.stringify(payload)});
  }catch(err){ $("#matchMsg").innerHTML = `<div style="color:var(--danger)">${esc(err.message)}</div>`; }
}
function fillMatch(m){}
function matchItem(m){
  return `<div class="item-row">
    <div>
      <div class="row" style="margin-bottom:4px;"><b>${esc(m.title)}</b><span class="badge">${esc(m.status)}</span></div>
      <p class="muted"><i class="fa-regular fa-clock"></i> ${esc(m.match_date || "Sin fecha")} &nbsp;|&nbsp; <i class="fa-solid fa-location-dot"></i> ${esc(m.venue || "")}</p>
    </div>
    <div style="font-size:1.5rem; font-weight:800; letter-spacing:4px;">${m.score_home} - ${m.score_away}</div>
    <div class="row"><button class="btn ghost icon-btn" data-edit-match="${m.id}"><i class="fa-solid fa-pen"></i></button><button class="btn danger-ghost icon-btn" data-del-match="${m.id}"><i class="fa-solid fa-trash"></i></button></div>
  </div>`;
}
function renderPitchShell(m){
  return `<div class="pitch-container">
    <div class="pitch-lines"></div>
    <div class="pitch-grid">
      <div class="pitch-side">${pitch(m.lineup_home, homePos, "home")}</div>
      <div class="pitch-side">${pitch(m.lineup_away, awayPos, "away")}</div>
    </div>
  </div>`;
}
function pitch(lineup, coords, side){
  const t = team(side);
  return coords.map((xy,i)=>{
    const p = player(lineup?.[i]);
    if(p) {
      const bg = p.photo_path || p.poster_path;
      const bgStyle = bg ? `background-image:url('${esc(bg)}'); background-size:cover; background-position:center; color:transparent; border-color:${t.p};` : `border-color:${t.p}; color:${t.p};`;
      return `<div class="player-dot" style="left:${xy[0]}%;top:${xy[1]}%; ${bgStyle}">
        ${bg ? '' : esc(p.number)}
        <div class="player-label" style="background:${t.p}; color:${contrast(t.p)}">${esc(p.nickname || p.name.split(" ")[0])}</div>
      </div>`;
    } else {
      return `<div class="player-dot empty" style="left:${xy[0]}%;top:${xy[1]}%;"><i class="fa-solid fa-plus"></i></div>`;
    }
  }).join("");
}

function contenido(){
  return `<section class="two-cols">
    <article class="panel glass">
      <h2>Videos / Transmisiones</h2>
      <div class="item-list">${state.videos.map(videoCard).join("") || empty("Aún no hay videos.")}</div>
    </article>
    <article class="panel glass">
      <h2>Momentos Destacados</h2>
      <div class="item-list">${state.highlights.map(h=>{
        const mediaHtml = h.media_path ? (h.media_type === 'video' ? `<video src="${esc(h.media_path)}" controls style="width:100%; border-radius:8px; margin-top:8px;"></video>` : `<img src="${esc(h.media_path)}" style="width:100%; border-radius:8px; margin-top:8px;">`) : '';
        const matchInfo = h.match_id ? `<span class="badge" style="background:rgba(255,255,255,0.1)">Partido #${h.match_id}</span>` : '';
        const momentIcon = h.moment_type==='gol' ? 'fa-futbol' : h.moment_type==='tarjeta' ? 'fa-square' : 'fa-bolt';
        
        return `<div class="item-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
          <div style="width:100%; display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <span class="badge" style="background:var(--primary); color:#fff"><i class="fa-solid fa-stopwatch"></i> ${esc(h.minute)}</span> 
              <span class="badge"><i class="fa-solid ${momentIcon}"></i> ${esc(h.moment_type.toUpperCase())}</span>
              ${matchInfo}
            </div>
          </div>
          <b style="font-size:1.1rem">${esc(h.title)}</b>
          <p class="muted">${esc(h.description)}</p>
          ${mediaHtml}
        </div>`;
      }).join("") || empty("No hay momentos.")}</div>
    </article>
  </section>`;
}
function embed(url){
  try{
    const u = new URL(url);
    if(u.hostname.includes("youtu.be")) return "https://www.youtube.com/embed/"+u.pathname.slice(1);
    const id = u.searchParams.get("v");
    return id ? "https://www.youtube.com/embed/"+id : null;
  }catch{return null}
}
function videoCard(v){
  const e = embed(v.url);
  return `<article class="item-row" style="flex-direction:column; align-items:flex-start; gap:16px;">
    <div style="width:100%; display:flex; justify-content:space-between;"><p class="eyebrow">${esc(v.category)}</p> <h3>${esc(v.title)}</h3></div>
    ${e ? `<div style="width:100%; aspect-ratio:16/9; border-radius:8px; overflow:hidden;"><iframe src="${esc(e)}" style="width:100%;height:100%;border:none;" allowfullscreen></iframe></div>` : `<a class="btn primary" href="${esc(v.url)}" target="_blank"><i class="fa-solid fa-link"></i> Abrir enlace</a>`}
  </article>`;
}

function ajustes(){
  const s = state.settings;
  const isAdmin = state.user.role === "admin";
  
  const capOpts = [
    {id: 2, name: "Capitán Local (capitan1)"},
    {id: 3, name: "Capitán Rival (capitan2)"},
    {id: 4, name: "Espectador (usuario)"}
  ];

  return `<section class="two-cols">
    <article class="panel glass">
      <p class="eyebrow">Personalización</p>
      <h2>Equipos y Tema</h2>
      <form id="settingsForm" class="form-grid">
        <label class="full">Tema de la Interfaz
          <select name="app_theme" ${isAdmin?'':'disabled'}>
            <option value="dark" ${s.app_theme==='dark'?'selected':''}>Oscuro Profundo (Predeterminado)</option>
            <option value="green" ${s.app_theme==='green'?'selected':''}>Césped Verde (Fútbol)</option>
            <option value="white" ${s.app_theme==='white'?'selected':''}>Blanco Luminoso</option>
          </select>
        </label>
        <label class="full">Fondo Personalizado (Sobrescribe el Tema)
          <div style="display:flex; gap:12px">
            <input type="color" name="app_bg_color" value="${esc(s.app_bg_color||'#000000')}" style="height:48px; padding:4px; width:60px" ${isAdmin?'':'disabled'}>
            <button type="button" class="btn ghost" onclick="document.getElementsByName('app_bg_color')[0].value='#000000'; document.getElementsByName('app_bg_color')[0].dataset.cleared='1'" ${isAdmin?'':'disabled'}>Borrar fondo personalizado</button>
          </div>
        </label>

        <label class="full">Nombre de la App<input name="app_name" value="${esc(s.app_name)}" ${isAdmin?'':'readonly'}></label>
        <label>Equipo Local<input name="home_team_name" value="${esc(s.home_team_name)}"></label>
        <label>Equipo Rival<input name="away_team_name" value="${esc(s.away_team_name)}"></label>
        <label>Color Local<input type="color" name="home_primary" value="${esc(s.home_primary)}" style="height:48px; padding:4px"></label>
        <label>Secundario Local<input type="color" name="home_secondary" value="${esc(s.home_secondary)}" style="height:48px; padding:4px"></label>
        <label>Color Rival<input type="color" name="away_primary" value="${esc(s.away_primary)}" style="height:48px; padding:4px"></label>
        <label>Secundario Rival<input type="color" name="away_secondary" value="${esc(s.away_secondary)}" style="height:48px; padding:4px"></label>
        <label class="full">Título Próximo Partido<input name="next_match_title" value="${esc(s.next_match_title)}"></label>
        <label>Cancha<input name="venue" value="${esc(s.venue)}"></label>
        <label>Horario<input name="schedule" value="${esc(s.schedule)}"></label>
        
        <div class="full" style="border-top:1px solid var(--border); padding-top:20px; margin-top:10px;">
          <h3 style="margin-bottom:16px"><i class="fa-solid fa-crown" style="color:gold"></i> Asignación de Capitanes</h3>
          <div class="form-grid">
            <label>Capitán Local (Edita Pizarra Local)
              <select name="captain_home_id" ${isAdmin?'':'disabled'}>
                <option value="0">Nadie</option>
                ${capOpts.map(c=>`<option value="${c.id}" ${s.captain_home_id===c.id?'selected':''}>${c.name}</option>`).join("")}
              </select>
            </label>
            <label>Capitán Rival (Edita Pizarra Rival)
              <select name="captain_away_id" ${isAdmin?'':'disabled'}>
                <option value="0">Nadie</option>
                ${capOpts.map(c=>`<option value="${c.id}" ${s.captain_away_id===c.id?'selected':''}>${c.name}</option>`).join("")}
              </select>
            </label>
          </div>
          ${!isAdmin ? '<p class="muted" style="margin-top:8px">Solo el Administrador puede asignar capitanes.</p>':''}
        </div>

        <label class="full">URL del En Vivo<input name="live_url" value="${esc(s.live_url || "")}" ${isAdmin?'':'readonly'}></label>
        <label>En Vivo (Estado)<select name="live_enabled" ${isAdmin?'':'disabled'}><option value="0">Apagado</option><option value="1" ${Number(s.live_enabled)?"selected":""}>Activo</option></select></label>
        <label>Google Client ID<input name="google_client_id" value="${esc(s.google_client_id || "")}" placeholder="123-abc.apps.googleusercontent.com" ${isAdmin?'':'readonly'}></label>
        
        <div class="full" style="margin-top:16px;"><button class="btn primary glow-on-hover"><i class="fa-solid fa-save"></i> Guardar Ajustes</button></div>
        <div id="settingsMsg" class="full"></div>
      </form>
    </article>
    
    <article class="panel glass">
      <h2><i class="fa-solid fa-lock"></i> Zona de Administración</h2>
      <div class="${isAdmin ? "" : "hidden"}">
        <form id="videoForm" class="form-grid">
          <h3 class="full">Agregar Video</h3>
          <label>Título<input name="title" required></label>
          <label>Plataforma<select name="platform"><option>youtube</option><option>tiktok</option><option>externo</option></select></label>
          <label class="full">URL<input name="url" required></label>
          <label>Categoría<input name="category" value="resumen"></label>
          <div class="full"><button class="btn ghost"><i class="fa-solid fa-plus"></i> Guardar Video</button></div>
          <div id="videoMsg" class="full"></div>
        </form>
        <hr style="border-color:var(--border); margin:24px 0">
        <form id="highlightForm" class="form-grid">
          <h3 class="full">Agregar Momento (Highlight)</h3>
          <label>Título<input name="title" required></label>
          <label>Minuto<input name="minute" placeholder="Ej: 23'"></label>
          <label>Tipo de Momento
            <select name="moment_type">
              <option value="gol">Gol</option>
              <option value="falta">Falta</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="sustitucion">Sustitución</option>
              <option value="destacada">Jugada Destacada</option>
              <option value="otro" selected>Otro</option>
            </select>
          </label>
          <label>Partido Relacionado
            <select name="match_id">
              <option value="">Ninguno</option>
              ${state.matches.map(m=>`<option value="${m.id}">${esc(m.title)} - ${esc(m.match_date)}</option>`).join("")}
            </select>
          </label>
          <label class="full">Archivo Multimedia (Imagen/Video)
            <input type="file" id="highlightMedia" accept="image/*,video/mp4,video/webm">
          </label>
          <label class="full">Descripción<textarea name="description" style="min-height:60px"></textarea></label>
          <div class="full"><button class="btn ghost"><i class="fa-solid fa-bolt"></i> Guardar Momento</button></div>
          <div id="highlightMsg" class="full"></div>
        </form>
      </div>
      <div class="${isAdmin ? "hidden" : "muted"}" style="padding:20px; text-align:center; border:1px dashed var(--border); border-radius:12px;">
        <i class="fa-solid fa-shield-halved" style="font-size:2rem; margin-bottom:12px; opacity:0.5"></i>
        <p>Solo el administrador puede agregar videos, momentos destacados o gestionar configuraciones globales.</p>
      </div>
    </article>
  </section>`;
}
async function saveSettings(e){
  e.preventDefault();
  try{
    const fd = new FormData(e.currentTarget);
    if(!fd.has('live_enabled')) fd.append('live_enabled', e.currentTarget.live_enabled.value);
    if(!fd.has('captain_home_id')) fd.append('captain_home_id', e.currentTarget.captain_home_id.value);
    if(!fd.has('captain_away_id')) fd.append('captain_away_id', e.currentTarget.captain_away_id.value);
    if(!fd.has('app_theme')) fd.append('app_theme', e.currentTarget.app_theme.value);
    
    // Clear bg color if user clicked "Borrar"
    if (e.currentTarget.app_bg_color.dataset.cleared === '1') {
      fd.set('app_bg_color', '');
      e.currentTarget.app_bg_color.dataset.cleared = '0';
    }
    
    await api("/api/settings",{method:"POST",body:JSON.stringify(Object.fromEntries(fd.entries()))});
    toast("Ajustes guardados. Actualizando en tiempo real..."); 
  }catch(err){ $("#settingsMsg").innerHTML = `<div style="color:var(--danger)">${esc(err.message)}</div>`; }
}
async function saveVideo(e){
  e.preventDefault();
  try{ await api("/api/videos",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries()))}); e.target.reset(); toast("Video guardado"); }
  catch(err){ $("#videoMsg").innerHTML = `<div style="color:var(--danger)">${esc(err.message)}</div>`; }
}
async function saveHighlight(e){
  e.preventDefault();
  try{
    const form = e.currentTarget;
    const file = $("#highlightMedia")?.files[0];
    let media_path = "", media_type = "";
    
    if (file) {
      $("#highlightMsg").innerHTML = `<div class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Subiendo archivo...</div>`;
      const fd = new FormData();
      fd.append("media", file);
      const res = await api("/api/upload-media", { method:"POST", body:fd });
      media_path = res.url;
      media_type = res.type;
    }
    
    const body = {
      title: form.title.value,
      minute: form.minute.value,
      description: form.description.value,
      moment_type: form.moment_type.value,
      match_id: form.match_id.value ? Number(form.match_id.value) : null,
      media_path: media_path,
      media_type: media_type
    };
    
    await api("/api/highlights",{method:"POST",body:JSON.stringify(body)});
    form.reset();
    toast("Momento guardado"); 
  }catch(err){ $("#highlightMsg").innerHTML = `<div style="color:var(--danger)">${esc(err.message)}</div>`; }
}
async function del(table,id,section){
  if(!confirm("¿Eliminar este elemento permanentemente?")) return;
  await api(`/api/${table}/${id}`,{method:"DELETE"});
}
window.addManager = async (matchId) => {
  const playerId = $("#newManagerSelect").value;
  if(!playerId) return toast("Selecciona un jugador");
  try {
    await api(`/api/matches/${matchId}/managers`, {
      method: "POST",
      body: JSON.stringify({ player_id: Number(playerId) })
    });
    toast("Gestor añadido");
    await load(false);
    render();
  } catch (err) { toast(err.message); }
};

window.removeManager = async (matchId, playerId) => {
  if(!confirm("¿Quitar gestor?")) return;
  try {
    await api(`/api/matches/${matchId}/managers/${playerId}`, { method: "DELETE" });
    toast("Gestor quitado");
    await load(false);
    render();
  } catch (err) { toast(err.message); }
};

load();
