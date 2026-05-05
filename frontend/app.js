const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const nav = [
  ["inicio", "Inicio", "fa-house"],
  ["perfil", "Mi Perfil", "fa-user"],
  ["jugadores", "Plantilla", "fa-users"],
  ["partido", "Partido 7v7", "fa-map"],
  ["usuarios", "Usuarios", "fa-user-shield"],
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
    document.body.style.backgroundImage = 'none';
  } else {
    document.body.style.backgroundColor = '';
    document.body.style.backgroundImage = '';
  }
}

window.toggleAuth = (isReg) => {
  $("#loginBox").classList.toggle("hidden", isReg);
  $("#registerBox").classList.toggle("hidden", !isReg);
};

$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#loginMsg").textContent = "";
  const btn = e.target.querySelector("button");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
  btn.disabled = true;
  try{
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    const data = await api("/api/login", {method:"POST", body:JSON.stringify(f)});
    state.token = data.token;
    localStorage.f7_clean_token = state.token;
    await load();
  }catch(err){ 
    $("#loginMsg").textContent = err.message; 
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
});

$("#registerForm")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#registerMsg").textContent = "";
  const f = Object.fromEntries(new FormData(e.currentTarget).entries());
  if(f.password !== f.confirm_password) return $("#registerMsg").textContent = "Las contraseñas no coinciden";
  
  const btn = e.target.querySelector("button");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Registrando...`;
  btn.disabled = true;
  
  try{
    const data = await api("/api/register", {method:"POST", body:JSON.stringify(f)});
    state.token = data.token;
    localStorage.f7_clean_token = state.token;
    await load();
    toast("Registro exitoso. ¡Bienvenido!");
  }catch(err){ 
    $("#registerMsg").textContent = err.message; 
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
});

function resetLoginButton() {
  const btn = $("#loginForm button");
  if(btn) {
    btn.innerHTML = "Ingresar al Studio";
    btn.disabled = false;
  }
  const rBtn = $("#registerForm button");
  if(rBtn) {
    rBtn.innerHTML = "Registrarse";
    rBtn.disabled = false;
  }
}

$("#logoutBtn").onclick = async () => {
  try{ await api("/api/logout"); }catch{}
  localStorage.removeItem("f7_clean_token");
  state.token = "";
  state.user = null;
  resetLoginButton();
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
    if (n[0] === "usuarios") return isAdmin;
    if (n[0] === "jugadores") return isAdmin || isCap; // Player doesn't see general roster
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
  const views = {inicio, perfil, jugadores, partido, contenido, ajustes, usuarios};
  const viewFunc = views[state.section];
  if (viewFunc) {
    $("#content").innerHTML = viewFunc();
  } else {
    $("#content").innerHTML = empty("Sección no encontrada.");
  }
  $("#pageTitle").textContent = nav.find(n=>n[0]===state.section)?.[1] || "";
  
  bind();
}
function bind(){
  $("#profileForm")?.addEventListener("submit", saveProfile);
  $("#profilePhoto")?.addEventListener("change", uploadProfilePhoto);

  $("#playerForm")?.addEventListener("submit", savePlayer);
  $("#playerPhoto")?.addEventListener("change", uploadPhoto);
  $("#cancelPlayerBtn")?.addEventListener("click", ()=>{state.editPlayer=null;state._lastEditType=null;render();});
  $("#clearPlayer")?.addEventListener("click", ()=>{state.editPlayer=null;state._lastEditType=null;render();});
  $$("[data-edit-player]").forEach(b=>b.onclick=()=>{editPlayer(Number(b.dataset.editPlayer));});
  $$("[data-roster-remove]").forEach(b=>b.onclick=async ()=>{
    const pid = b.dataset.rosterRemove;
    const p = player(pid);
    if(confirm(`¿Quitar a ${p?.name || 'este jugador'} de tu Plantilla General? Esto no eliminará su cuenta ni su perfil registrado.`)) {
      await api("/api/players/"+pid+"/roster",{method:"DELETE"});
      await load();
      render();
    }
  });
  $$("[data-del-player]").forEach(b=>b.onclick=async ()=>{if(confirm("¿Eliminar jugador permanentemente de la base de datos?")) {await api("/api/players/"+b.dataset.delPlayer,{method:"DELETE"}); load();}});

  $("#searchPlayers")?.addEventListener("input", (e) => {
    state.searchPlayers = e.target.value;
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

  // Player type toggles in jugadores
  $$(".ptype-btn").forEach(b => b.onclick = () => {
    const type = b.dataset.type;
    $$(".ptype-btn").forEach(btn => btn.classList.remove("active"));
    b.classList.add("active");
    $("#playerTypeInput").value = type;
    
    $("#regField").classList.toggle("hidden", type !== 'registrado');
    $("#manualFields").classList.toggle("hidden", type === 'registrado');
    $("#nnMsg").classList.toggle("hidden", type !== 'nn');
    
    if(type === 'nn') {
      const nextNN = state.players.filter(p => p.is_nn).length + 1;
      $("#playerNameInput").value = `NN ${nextNN}`;
      $("#playerNameInput").required = false;
      $("#statsFields").classList.add("hidden");
    } else {
      $("#playerNameInput").required = true;
      if(type === 'registrado') {
        $("#playerNameInput").value = "";
        $("#statsFields").classList.add("hidden");
      } else {
        $("#statsFields").classList.remove("hidden");
      }
    }
  });

  $("#searchCodeBtn")?.addEventListener("click", searchPlayerByID);

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
    chk.addEventListener("click", (e) => {
      e.preventDefault(); // Control manual via modal
      const pid = Number(chk.value);
      const isChecking = !chk.checked;
      const p = player(pid);
      
      if (!p) return;
      
      if (!isChecking) {
        // Just remove without modal if unchecking
        chk.checked = false;
        saveMatchConvocatoria();
        return;
      }

      showPlayerModal(p, () => {
        chk.checked = true;
        closeModal();
        saveMatchConvocatoria();
      }, "Confirmar Asistencia");
    });
  });

  $$(".match-meta-input").forEach(sel => {
    sel.addEventListener("change", () => {
      if($("#matchForm")) $("#matchForm").requestSubmit();
    });
  });

  $("#saveMatchBtn")?.addEventListener("click", () => {
    $("#matchForm")?.requestSubmit();
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
  const p = state.players.find(x => x.id === u.player_id);
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
      
      <div style="margin-top:16px; background:rgba(0,0,0,0.2); padding:12px; border-radius:12px; display:inline-flex; align-items:center; gap:12px; border:1px solid var(--border);">
        <span style="font-weight:600; color:var(--primary);">Código de Jugador:</span>
        <code style="font-size:1.2rem; font-weight:800; color:#fff;">${esc(p?.player_code || 'No asignado')}</code>
        ${p?.player_code ? `<button class="btn ghost btn-small" onclick="navigator.clipboard.writeText('${p.player_code}'); toast('ID Copiado');" title="Copiar ID"><i class="fa-solid fa-copy"></i></button>` : ''}
      </div>
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
function playerCard(p) {
  const isAdmin = state.user.role === "ADMIN";
  const isCap = state.user.role === "CAPTAIN";
  const canEdit = isAdmin || isCap;
  
  let typeTag = "Registrado";
  if (p.is_guest) typeTag = "Invitado";
  if (p.is_nn) typeTag = "NN";

  return `
  <div class="player-card">
    <div class="player-card-header">
      <img src="${esc(p.photo_path || '')}" class="player-card-img" onerror="this.src='https://ui-avatars.com/api/?name=${esc(p.name)}&background=random&color=fff'">
      <div class="player-card-info">
        <h4 class="player-card-name" title="${esc(p.name)}">${esc(p.name)}</h4>
        <span class="player-card-code">${esc(p.player_code || '---')}</span>
      </div>
    </div>
    
    <div style="font-size: 0.8rem; color: var(--muted); margin-bottom: 4px;">
      <i class="fa-solid fa-person-running"></i> ${esc(p.position || 'Sin posición')} · #${p.number || '0'}
    </div>

    <div class="player-card-stats">
      <div><span>PJ</span><b>${p.matches_played || 0}</b></div>
      <div><span>Goles</span><b>${p.goals || 0}</b></div>
      <div><span>Asist</span><b>${p.assists || 0}</b></div>
      <div><span>⭐</span><b>${(p.rating || 5.0).toFixed(1)}</b></div>
    </div>

    <div class="player-card-footer">
      <span class="player-card-tag">${typeTag}</span>
      <div class="row" style="gap:8px">
        ${canEdit ? `<button class="btn ghost icon-btn small" onclick="editPlayer(${p.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>` : ''}
        ${canEdit ? `<button class="btn ghost icon-btn small danger-hover" data-roster-remove="${p.id}" title="Quitar de Plantilla"><i class="fa-solid fa-user-minus"></i></button>` : ''}
        ${isAdmin ? `<button class="btn ghost icon-btn small danger-hover" data-del-player="${p.id}" title="Eliminar de BD"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    </div>
  </div>`;
}

function jugadores(){
  const isAdmin = state.user.role === "ADMIN";
  const isCap = state.user.role === "CAPTAIN";
  if (!isAdmin && !isCap) return empty("No tienes permiso para ver la plantilla general.");

  const q = (state.searchPlayers || "").toLowerCase();
  const typeFilter = state.playerTypeFilter || "todos";
  
  const filtered = state.players.filter(p => {
    const matchesQuery = p.name.toLowerCase().includes(q) || (p.player_code || "").toLowerCase().includes(q);
    const matchesType = typeFilter === "todos" || 
                        (typeFilter === "registrado" && !p.is_guest && !p.is_nn) ||
                        (typeFilter === "invitado" && p.is_guest) ||
                        (typeFilter === "nn" && p.is_nn);
    return matchesQuery && matchesType;
  });

  return `
  <div style="display: flex; flex-direction: column; gap: 32px;">
    
    <section class="two-cols" style="align-items: flex-start; gap: 24px;">
      <article class="panel glass" style="position: sticky; top: 20px;">
        <p class="eyebrow">${state.editPlayer ? "Modificando" : "Gestión"}</p>
        <h2 style="margin-bottom: 20px;">${state.editPlayer ? "Editar jugador" : "Registrar jugador"}</h2>
        
        <div style="display:flex; gap:10px; margin-bottom:24px; background:rgba(0,0,0,0.2); padding:6px; border-radius:12px; border: 1px solid var(--border);">
          <button class="btn ghost ptype-btn ${(!state._lastEditType || state._lastEditType==='registrado')?'active':''}" data-type="registrado" style="flex:1">Registrado</button>
          <button class="btn ghost ptype-btn ${state._lastEditType==='invitado'?'active':''}" data-type="invitado" style="flex:1">Invitado</button>
          <button class="btn ghost ptype-btn ${state._lastEditType==='nn'?'active':''}" data-type="nn" style="flex:1">NN</button>
        </div>

        <form id="playerForm" class="form-grid">
          <input type="hidden" name="player_type" id="playerTypeInput" value="registrado">
          
          <div id="regField" class="full" style="background:rgba(255,255,255,0.03); padding:16px; border-radius:12px; margin-bottom:12px; border: 1px solid var(--border);">
            <label>Buscar por Código (JUG-XXXX)
              <div class="row" style="margin-top: 8px;">
                <input id="searchCodeInput" placeholder="Ej: JUG-0001" style="flex:1">
                <button type="button" class="btn primary" id="searchCodeBtn"><i class="fa-solid fa-magnifying-glass"></i></button>
              </div>
            </label>
          </div>

          <div id="manualFields" class="full form-grid" style="grid-template-columns: 1fr 1fr; gap:16px;">
            <label class="full">Nombre Completo<input name="name" id="playerNameInput" required placeholder="Ej: Ricardo M"></label>
            <label>Teléfono<input name="phone" placeholder="+57..."></label>
            <label>Número<input name="number" type="number" min="0" max="99" value="0"></label>
            <label class="full">Posición Preferida
              <select name="position">
                <option value="">Cualquiera</option>
                ${slots.map(s => `<option value="${s}">${s}</option>`).join("")}
              </select>
            </label>
            <label class="full">Calificación (1-10)<input name="rating" type="number" step=".1" value="5.0" min="1" max="10" ${isAdmin || isCap ? '' : 'disabled'} title="${isAdmin || isCap ? 'Solo admin/capitán pueden editar calificación' : ''}"></label>
          </div>

          <div id="nnMsg" class="full hidden" style="background:rgba(255,255,255,0.03); padding:16px; border-radius:12px; margin-bottom:12px; color:var(--muted); border: 1px solid var(--border);">
            <p><i class="fa-solid fa-circle-info"></i> El jugador se guardará con un alias automático.</p>
          </div>
          
          <div class="full">
            <label>Foto del Jugador (Opcional)</label>
            <div style="display:flex; gap:12px; align-items:center; margin-top:8px;">
              <label class="btn ghost btn-small" style="cursor:pointer; flex:1">
                <i class="fa-solid fa-camera"></i> Subir Foto
                <input id="playerPhoto" type="file" accept="image/*" hidden>
              </label>
              <input name="photo_path" type="hidden">
              <input name="poster_path" type="hidden">
            </div>
            <p class="muted" style="font-size:0.7rem; margin-top:4px;">Se generará una tarjeta de presentación automáticamente.</p>
          </div>

          <div id="statsFields" class="full form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap:12px; background:rgba(0,0,0,0.2); padding:12px; border-radius:12px; margin-top:10px;">
            <label>PJ<input name="matches_played" type="number" value="0"></label>
            <label>Goles<input name="goals" type="number" value="0"></label>
            <label>Asist.<input name="assists" type="number" value="0"></label>
          </div>
          
          <div class="full row" style="margin-top:20px; gap: 12px;">
            <button class="btn primary glow-on-hover" style="flex:2" id="playerSubmitBtn"><i class="fa-solid fa-floppy-disk"></i> ${state.editPlayer ? "Guardar Cambios" : "Crear Jugador"}</button>
            <button type="button" class="btn ghost" id="cancelPlayerBtn" style="flex:1">Cancelar</button>
          </div>
          <div id="playerMsg" class="full" style="font-size:0.8rem; min-height:24px;"></div>
        </form>
      </article>

      <div style="flex: 1; display: flex; flex-direction: column; gap: 24px; min-width: 0;">
        <article class="panel glass">
          <div class="row" style="justify-content:space-between; margin-bottom:20px; align-items:center; flex-wrap: wrap; gap: 16px;">
            <div>
              <h2 style="font-size: 1.8rem;">Plantilla General</h2>
              <p class="muted">Lista de jugadores registrados e invitados.</p>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <select id="typeFilter" onchange="state.playerTypeFilter=this.value; render();" style="width:auto; padding:10px 16px; background:rgba(255,255,255,0.05); border-radius:10px;">
                <option value="todos" ${typeFilter==='todos'?'selected':''}>Todos los tipos</option>
                <option value="registrado" ${typeFilter==='registrado'?'selected':''}>Registrados</option>
                <option value="invitado" ${typeFilter==='invitado'?'selected':''}>Invitados</option>
                <option value="nn" ${typeFilter==='nn'?'selected':''}>NN</option>
              </select>
              <div style="min-width:240px; position:relative;">
                <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--muted)"></i>
                <input id="searchPlayers" placeholder="Nombre o código..." value="${esc(state.searchPlayers || '')}" style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:12px; padding:12px 16px 12px 40px; width:100%;">
              </div>
            </div>
          </div>
          
          <div class="grid-4">
            ${filtered.map(playerCard).join("") || empty("No se encontraron jugadores.")}
          </div>
        </article>

        <article class="panel glass">
          <p class="eyebrow">Vista Previa</p>
          <div id="preview" style="display:flex; justify-content:center; margin-top: 10px;">
            ${poster({name:"Tu jugador",nickname:"Jugador",poster_path:""})}
          </div>
        </article>
      </div>
    </section>
  </div>`;
}
function getPlayerForm(){
  const f = Object.fromEntries(new FormData($("#playerForm")).entries());
  const type = f.player_type || 'registrado';
  return {
    ...f,
    name: f.name || $("#playerNameInput").value,
    number:+f.number||0, goals:+f.goals||0, assists:+f.assists||0,
    matches_played:+f.matches_played||0, rating:+f.rating||0,
    is_registered: type === "registrado",
    is_guest: type === "invitado",
    is_nn: type === "nn"
  };
}

async function searchPlayerByID() {
  const code = $("#searchCodeInput").value.trim().toUpperCase();
  if(!code) return toast("Ingresa un código");
  try {
    const p = await api(`/api/players/search?code=${code}`);
    
    // Check if already in roster
    if (state.players.find(x => x.id === p.id)) {
      return toast("Este jugador ya está en tu Plantilla General", true);
    }

    showPlayerModal(p, async () => {
      await api(`/api/players/${p.id}/roster`, {method:"POST"});
      toast("Jugador agregado a la plantilla");
      closeModal();
      await load();
      render();
    }, "Agregar a Plantilla");
    
  } catch(err) {
    toast("No se encontró ningún jugador con ese ID", true);
  }
}

function showPlayerModal(p, onConfirm, confirmText = "Confirmar") {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-overlay";
  
  const photoUrl = p.photo_path || p.poster_path || `https://ui-avatars.com/api/?name=${esc(p.name)}&background=random&color=fff&size=128`;
  const typeLabel = p.is_guest ? "Invitado" : (p.is_nn ? "NN" : "Registrado");

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 style="margin:0;">Detalle del Jugador</h3>
        <button class="btn ghost icon-btn small" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body">
        <div class="player-detail-card">
          <img src="${esc(photoUrl)}" class="player-detail-img">
          <h2 class="player-detail-name">${esc(p.name)}</h2>
          <span class="player-detail-code">${esc(p.player_code || 'SIN CÓDIGO')}</span>
          
          <div class="player-detail-grid">
            <div class="player-detail-item">
              <label>Estado</label>
              <span>${typeLabel}</span>
            </div>
            <div class="player-detail-item">
              <label>Número</label>
              <span>#${p.number || 0}</span>
            </div>
            <div class="player-detail-item">
              <label>Posición</label>
              <span>${esc(p.position || 'No definida')}</span>
            </div>
            <div class="player-detail-item">
              <label>Teléfono</label>
              <span>${esc(p.phone || 'No disponible')}</span>
            </div>
            <div class="player-detail-item">
              <label>PJ</label>
              <span>${p.matches_played || 0}</span>
            </div>
            <div class="player-detail-item">
              <label>Goles</label>
              <span>${p.goals || 0}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn primary glow-on-hover" id="modalConfirmBtn" style="flex:1">${confirmText}</button>
        <button class="btn ghost" onclick="closeModal()" style="flex:1">Cancelar</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  $("#modalConfirmBtn").onclick = onConfirm;
  overlay.onclick = (e) => { if(e.target === overlay) closeModal(); };
}

function closeModal() {
  $("#modal-overlay")?.remove();
}
window.closeModal = closeModal;
async function uploadPhoto(e){
  const file = e.target.files[0]; 
  if(!file) return;
  
  const form = $("#playerForm");
  const msg = $("#playerMsg");
  const btn = $("#playerSubmitBtn");
  
  msg.innerHTML = `<div class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Subiendo y generando tarjeta...</div>`;
  if(btn) btn.disabled = true;

  const fd = new FormData();
  fd.append("photo", file);
  
  // Send current form data to use in poster generation
  ["name","number","position","matches_played","goals","assists"].forEach(k => {
    fd.append(k, form[k]?.value || "");
  });
  fd.append("team_side", "home");

  try{
    const data = await api("/api/upload-photo", {method:"POST", body:fd});
    form.photo_path.value = data.photo_path;
    form.poster_path.value = data.poster_path;
    
    // Update preview
    const previewData = {...getPlayerForm(), photo_path: data.photo_path, poster_path: data.poster_path};
    $("#preview").innerHTML = poster(previewData);
    
    msg.innerHTML = `<div style="color:var(--success)"><i class="fa-solid fa-circle-check"></i> Imagen cargada con éxito.</div>`;
    toast("Imagen procesada correctamente");
  } catch(err) {
    console.error(err);
    msg.innerHTML = `<div style="color:var(--danger)"><i class="fa-solid fa-circle-xmark"></i> Error: ${esc(err.message)}</div>`;
    toast("No tienes permisos o el archivo es inválido", true);
  } finally {
    if(btn) btn.disabled = false;
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
  if(!f) return;
  
  Object.keys(p).forEach(k=>{ if(f[k]) f[k].value = p[k] ?? ""; });
  
  // Set the tab
  let type = 'registrado';
  if(p.is_guest) type = 'invitado';
  else if(p.is_nn) type = 'nn';
  
  state._lastEditType = type; // for render sync
  $("#playerTypeInput").value = type;
  
  // Hide/Show manual fields according to type
  $("#regField")?.classList.toggle("hidden", type !== 'registrado');
  $("#manualFields")?.classList.toggle("hidden", type === 'registrado');
  $("#statsFields")?.classList.toggle("hidden", type === 'registrado' || type === 'nn');
  
  $("#preview").innerHTML = poster(p);
}

window.editPlayer = (id) => {
  state.editPlayer = Number(id);
  state.section = "jugadores";
  render();
  fillPlayer(player(id));
};

function partido(){
  const s = state.settings;
  if(!s) return empty("Cargando ajustes...");
  const match = state.editMatch ? state.matches.find(m => m.id === state.editMatch) : (state.matches[0] || null);
  
  if(!match && state.user.role === 'PLAYER') {
    return `
    <section class="panel glass" style="text-align:center; padding:60px 20px;">
      <i class="fa-solid fa-calendar-xmark" style="font-size:4rem; color:var(--muted); margin-bottom:20px; opacity:0.3;"></i>
      <h2>No estás convocado a ningún partido</h2>
      <p class="muted" style="max-width:500px; margin:12px auto 24px;">Cuando el capitán te agregue a la convocatoria de un partido, podrás ver los equipos y la información aquí.</p>
    </section>`;
  }

  const isAdmin = state.user.role === "ADMIN";
  const isCap = state.user.role === "CAPTAIN";
  const isManager = match && (match.managers || []).includes(state.user.player_id);
  const canEdit = isAdmin || isCap || isManager;

  const availIds = match?.available_players || [];
  const homeStars = (match?.lineup_home || []).reduce((acc,id)=>acc+(player(id)?.rating||0),0);
  const awayStars = (match?.lineup_away || []).reduce((acc,id)=>acc+(player(id)?.rating||0),0);
  
  const canEditHome = isAdmin || (isCap && state.user.id === s.captain_home_id) || isManager || (match?.captain_home_id === state.user.player_id);
  const canEditAway = isAdmin || (isCap && state.user.id === s.captain_away_id) || isManager || (match?.captain_away_id === state.user.player_id);

  // Correct captain selection: must be from convocation
  const convocationList = state.players.filter(p => availIds.includes(p.id));

  return `
  <div style="display: flex; flex-direction: column; gap: 32px;">
    
    <!-- CARD 1: INFORMACIÓN -->
    <article class="panel glass">
      <div class="row" style="justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 20px;">
        <div style="flex: 1; min-width: 300px;">
          <p class="eyebrow">${match?.status.toUpperCase() || 'PROGRAMADO'}</p>
          <h2 style="font-size: 2rem; margin-top: 4px;">${esc(match?.title || "Partido de Hoy")}</h2>
          <p class="muted" style="margin-top: 8px;">
            <i class="fa-regular fa-calendar"></i> ${esc(match?.match_date || "Pendiente")} &nbsp;|&nbsp; 
            <i class="fa-solid fa-location-dot"></i> ${esc(match?.venue || "Cancha principal")}
          </p>
        </div>
        ${isAdmin ? `
        <div class="row" style="gap: 12px;">
          <button class="btn primary glow-on-hover" onclick="$('#matchForm').requestSubmit()"><i class="fa-solid fa-floppy-disk"></i> Guardar Cambios</button>
          <button class="btn ghost" type="button" id="clearMatch"><i class="fa-solid fa-plus"></i> Crear Nuevo</button>
        </div>
        ` : ''}
      </div>
    </article>

    <div class="two-cols" style="align-items: flex-start; gap: 32px;">
      
      <div style="display: flex; flex-direction: column; gap: 32px; flex: 1.2; min-width: 0;">
        
        <!-- CARD 2: CONVOCATORIA -->
        <article class="panel glass">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="margin:0;"><i class="fa-solid fa-list-check"></i> 1. Convocatoria del Partido</h3>
            <span class="badge" style="background:rgba(255,255,255,0.05); color:var(--primary);">${availIds.length} Seleccionados</span>
          </div>
          
          ${canEdit ? `
          <p class="muted" style="margin-bottom:16px">Selecciona quiénes van a jugar hoy desde la plantilla. Solo ellos podrán ser asignados a equipos.</p>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:10px; max-height:300px; overflow-y:auto; padding:10px; background:rgba(0,0,0,0.2); border-radius:12px; border:1px solid var(--border);">
            ${state.players.map(p => {
              const isChecked = availIds.includes(p.id);
              return `
                <label class="avail-item ${isChecked ? 'active' : ''}">
                  <input type="checkbox" value="${p.id}" class="avail-check" ${isChecked ? 'checked' : ''} style="display:none">
                  <div style="display:flex; align-items:center; gap:8px; justify-content:center;">
                    <span style="font-family:monospace; opacity:0.5; font-size:0.7rem;">${esc(p.player_code || '---')}</span>
                    <span style="font-weight:700;">#${p.number} ${esc(p.nickname || p.name)}</span>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
          ` : `
          <div class="row" style="flex-wrap:wrap; gap:8px;">
            ${availIds.length ? availIds.map(id => {
              const p = player(id);
              return p ? `<span class="badge" style="background:rgba(255,255,255,0.05); padding:8px 12px;">#${p.number} ${esc(p.name)}</span>` : '';
            }).join('') : empty("No hay jugadores convocados aún.")}
          </div>
          `}
        </article>

        <!-- CARD 3: CAPITANES DE PARTIDO -->
        <article class="panel glass">
          <h3><i class="fa-solid fa-crown"></i> 2. Capitanes del Partido</h3>
          <p class="muted" style="margin-bottom:16px">Solo se pueden elegir capitanes entre los jugadores convocados.</p>
          <div class="form-grid">
            <label>Capitán Local (Arma Equipo A)
              <select name="captain_home_id" class="match-meta-input" ${canEdit?'':'disabled'}>
                <option value="">-- Seleccionar convocado --</option>
                ${convocationList.map(p => `<option value="${p.id}" ${match?.captain_home_id===p.id?'selected':''}>${esc(p.player_code || '---')} - ${esc(p.name)}</option>`).join('')}
              </select>
            </label>
            <label>Capitán Rival (Arma Equipo B)
              <select name="captain_away_id" class="match-meta-input" ${canEdit?'':'disabled'}>
                <option value="">-- Seleccionar convocado --</option>
                ${convocationList.map(p => `<option value="${p.id}" ${match?.captain_away_id===p.id?'selected':''}>${esc(p.player_code || '---')} - ${esc(p.name)}</option>`).join('')}
              </select>
            </label>
          </div>
        </article>

        <!-- CARD 4: EQUIPOS -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; min-width: 0;">
          <div class="panel glass" style="border-top: 4px solid ${esc(s.home_primary)};">
            <h4 style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              ${esc(s.home_team_name)} 
              <span class="badge" style="background:var(--primary)">⭐ ${homeStars.toFixed(1)}</span>
            </h4>
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${lineupSelectors("home", match?.lineup_home || [], availIds, canEditHome)}
            </div>
          </div>
          <div class="panel glass" style="border-top: 4px solid ${esc(s.away_primary)};">
            <h4 style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              ${esc(s.away_team_name)}
              <span class="badge" style="background:var(--primary)">⭐ ${awayStars.toFixed(1)}</span>
            </h4>
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${lineupSelectors("away", match?.lineup_away || [], availIds, canEditAway)}
            </div>
          </div>
        </div>
        
        <form id="matchForm" style="display:none">
          <input name="title" value="${esc(match?.title || "")}">
          <input name="match_date" value="${esc(match?.match_date || "")}">
          <input name="venue" value="${esc(match?.venue || "")}">
          <input name="score_home" value="${match?.score_home || 0}">
          <input name="score_away" value="${match?.score_away || 0}">
          <input name="status" value="${match?.status || 'programado'}">
        </form>
      </div>

      <!-- SIDEBAR: PIZARRA Y OTROS -->
      <div style="flex: 1; display: flex; flex-direction: column; gap: 32px; position: sticky; top: 20px; min-width: 0;">
        <article class="panel glass" style="padding: 0; overflow: hidden; border: none;">
          <div style="padding: 16px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border);">
            <h3 style="margin:0;"><i class="fa-solid fa-chess-board"></i> Pizarra Táctica</h3>
          </div>
          <div style="padding: 20px;">
            ${match ? renderPitchShell(match) : empty("Selecciona un partido.")}
          </div>
        </article>

        <article class="panel glass">
          <h3>Historial Reciente</h3>
          <div class="item-list" style="margin-top: 16px; max-height: 400px; overflow-y: auto;">
            ${state.matches.map(matchItem).join("")}
          </div>
        </article>
      </div>

    </div>
  </div>`;
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
              ${esc(pl.player_code || '')} — #${pl.number} ${esc(pl.nickname || pl.name)} (⭐${pl.rating}) ${isPickedByOther ? '— Ocupado' : ''}
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
  $$(".avail-check").forEach(chk => { if(chk.checked) avail.push(Number(chk.value)); });

  // Extract match captains
  const cHomeId = $(".match-meta-input[name='captain_home_id']")?.value;
  const cAwayId = $(".match-meta-input[name='captain_away_id']")?.value;

  return {
    title:f.title, match_date:f.match_date, venue:f.venue, status:f.status || 'programado',
    score_home:+f.score_home||0, score_away:+f.score_away||0,
    lineup_home: slots.map((_,i)=>f["home_"+i] ? +f["home_"+i] : null),
    lineup_away: slots.map((_,i)=>f["away_"+i] ? +f["away_"+i] : null),
    available_players: avail,
    captain_home_id: cHomeId ? Number(cHomeId) : null,
    captain_away_id: cAwayId ? Number(cAwayId) : null,
    has_stream: f.has_stream ? 1 : 0,
    stream_url: f.stream_url || "",
    video_url: f.video_url || ""
  };
}
async function saveMatch(e){
  e.preventDefault();
  const msg = $("#matchMsg");
  try{
    const payload = getMatchPayload();
    
    // Validations
    if (payload.captain_home_id && payload.captain_away_id && payload.captain_home_id === payload.captain_away_id) {
      throw new Error("No puedes seleccionar el mismo jugador como Capitán Local y Capitán Rival.");
    }
    
    if (payload.available_players.length < 2 && (payload.captain_home_id || payload.captain_away_id)) {
      // If they are trying to set captains but don't have enough players
      // This is more of a warning, but let's be strict if they are selecting someone
      if (payload.captain_home_id && payload.captain_away_id) {
         // This case is already covered by length < 2, but just in case
      }
    }

    if(state.editMatch) await api("/api/matches/"+state.editMatch,{method:"PUT",body:JSON.stringify(payload)});
    else await api("/api/matches",{method:"POST",body:JSON.stringify(payload)});
    
    toast("Configuración del partido guardada");
    msg.innerHTML = "";
  }catch(err){ 
    msg.innerHTML = `<div style="background:rgba(255,0,0,0.1); border:1px solid var(--danger); color:var(--danger); padding:12px; border-radius:8px; margin-top:12px;">
      <i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}
    </div>`; 
  }
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
  const isAdmin = state.user.role === "ADMIN";
  if (!isAdmin) return empty("Solo el administrador tiene acceso a la configuración global del sistema.");

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
        
        <label class="full">URL del En Vivo (Global)<input name="live_url" value="${esc(s.live_url || "")}" ${isAdmin?'':'readonly'}></label>
        <label>En Vivo (Estado)<select name="live_enabled" ${isAdmin?'':'disabled'}><option value="0">Apagado</option><option value="1" ${Number(s.live_enabled)?"selected":""}>Activo</option></select></label>
        
        <div class="full" style="margin-top:24px; border-top: 1px solid var(--border); padding-top: 24px;">
          ${isAdmin ? '<button class="btn primary glow-on-hover" style="width:100%"><i class="fa-solid fa-save"></i> Guardar Ajustes Globales</button>' : '<p class="muted"><i class="fa-solid fa-lock"></i> Solo el administrador puede modificar la configuración global.</p>'}
        </div>
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

function usuarios() {
  if (state.user.role !== 'ADMIN') return empty("No tienes permiso para ver esta sección.");
  
  if (!state._users) {
    api("/api/users").then(data => {
      state._users = data;
      render();
    });
    return empty("Cargando usuarios...");
  }

  return `
  <section class="panel glass">
    <h2>Gestión de Usuarios y Roles</h2>
    <p class="muted" style="margin-bottom:20px;">Solo el Administrador puede asignar el rol de Capitán o cambiar privilegios globales.</p>
    
    <div class="item-list">
      ${state._users.map(u => {
        const p = state.players.find(x => x.id === u.player_id);
        return `<div class="item-row" style="padding:16px;">
          <div style="display:flex; align-items:center; gap:16px; flex:1;">
            <div style="width:44px; height:44px; border-radius:50%; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; border:1px solid var(--border);">
              <i class="fa-solid fa-user"></i>
            </div>
            <div>
              <b style="font-size:1.1rem">${esc(u.display_name)}</b>
              <p class="muted">@${esc(u.username)} · ${p ? esc(p.player_code) : 'Sin perfil de jugador'}</p>
            </div>
          </div>
          <div class="row" style="gap:20px;">
            <select onchange="updateRole(${u.id}, this.value)" style="background:rgba(0,0,0,0.3); border:1px solid var(--border); padding:8px 12px; border-radius:8px; min-width:140px;">
              <option value="PLAYER" ${u.role==='PLAYER'?'selected':''}>PLAYER</option>
              <option value="CAPTAIN" ${u.role==='CAPTAIN'?'selected':''}>CAPTAIN</option>
              <option value="ADMIN" ${u.role==='ADMIN'?'selected':''}>ADMIN</option>
            </select>
          </div>
        </div>`;
      }).join("")}
    </div>
  </section>
  `;
}

window.updateRole = async (userId, newRole) => {
  try {
    await api(`/api/users/${userId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role: newRole })
    });
    toast("Rol actualizado correctamente");
    state._users = null; // force reload
    await load(false);
    render();
  } catch (err) { toast(err.message, true); }
};

async function saveMatchConvocatoria() {
  const match = state.editMatch ? state.matches.find(m => m.id === state.editMatch) : (state.matches[0] || null);
  if (!match) return;
  
  const selectedIds = $$(".avail-check:checked").map(c => Number(c.value));
  
  try {
    const res = await api(`/api/matches/${match.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...match,
        available_players: selectedIds,
        lineup_home: match.lineup_home,
        lineup_away: match.lineup_away
      })
    });
    const idx = state.matches.findIndex(m => m.id === res.id);
    if(idx > -1) state.matches[idx] = res;
    
    toast("Convocatoria actualizada");
    // Don't call render() here because we are in the middle of a click sequence, 
    // and we want to keep the UI responsive. The load() will update everything.
    await load(false);
    render();
  } catch (err) {
    toast("Error al guardar convocatoria", true);
  }
}

load();
