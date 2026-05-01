const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const nav = [
  ["inicio", "Inicio", "fa-house"],
  ["jugadores", "Plantilla General", "fa-users"],
  ["partido", "Partido 7v7", "fa-map"],
  ["contenido", "Videos", "fa-video"],
  ["ajustes", "Ajustes", "fa-gear"]
];

const slots = ["ARQ", "DEF I", "DEF D", "MED I", "MED D", "EXT", "DEL"];
const homePos = [[50,85],[20,60],[80,60],[30,35],[70,35],[20,15],[50,5]];
const awayPos = [[50,15],[20,40],[80,40],[30,65],[70,65],[80,85],[50,95]];

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

  socket.on("data_changed", (data) => {
    load(false);
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
  
  let roleDisplay = "Usuario";
  if(state.user.role === "admin") roleDisplay = "Admin";
  if(state.user.id === s.captain_home_id) roleDisplay = "Capitán Local";
  if(state.user.id === s.captain_away_id) roleDisplay = "Capitán Rival";
  $("#roleText").textContent = roleDisplay;

  $("#nav").innerHTML = nav.map(n => `<button class="${state.section===n[0]?'active':''}" data-sec="${n[0]}"><i class="fa-solid ${n[2]}"></i> <span>${n[1]}</span></button>`).join("");
  $$("[data-sec]").forEach(b => b.onclick = () => { state.section = b.dataset.sec; render(); });
  
  const live = Number(state.settings.live_enabled) && state.settings.live_url;
  $("#liveBtn").classList.toggle("hidden", !live);
  $("#liveBtn").href = state.settings.live_url || "#";
}
function render(){
  shell();
  const views = {inicio, jugadores, partido, contenido, ajustes};
  $("#content").innerHTML = views[state.section]();
  $("#pageTitle").textContent = nav.find(n=>n[0]===state.section)?.[1] || "";
  
  bind();
}
function bind(){
  $("#playerForm")?.addEventListener("submit", savePlayer);
  $("#playerPhoto")?.addEventListener("change", uploadPhoto);
  $("#clearPlayer")?.addEventListener("click", ()=>{state.editPlayer=null;render();});
  $$("[data-edit-player]").forEach(b=>b.onclick=()=>{state.editPlayer=Number(b.dataset.editPlayer);state.section="jugadores";render();});
  $$("[data-del-player]").forEach(b=>b.onclick=()=>del("players", b.dataset.delPlayer, "jugadores"));

  $("#matchForm")?.addEventListener("submit", saveMatch);
  $("#clearMatch")?.addEventListener("click", ()=>{state.editMatch=null;render();});
  $$("[data-edit-match]").forEach(b=>b.onclick=()=>{state.editMatch=Number(b.dataset.editMatch);state.section="partido";render();});
  $$("[data-del-match]").forEach(b=>b.onclick=()=>del("matches", b.dataset.delMatch, "partido"));
  
  $$(".lineup-select").forEach(sel => {
    sel.addEventListener("change", () => {
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

function inicio(){
  const s = state.settings || {}, d = state.dashboard || {};
  const nextMatch = state.matches.find(m => m.status !== 'jugado') || state.matches[0];

  return `
  <section class="panel glass" style="position:relative; overflow:hidden;">
    <div style="position:absolute; right:-50px; top:-50px; opacity:0.1; font-size:15rem;"><i class="fa-solid fa-futbol"></i></div>
    <p class="eyebrow">Panel principal</p>
    <h2 style="font-size:2.5rem; margin-bottom: 8px;">${esc(s.next_match_title || "Próximo Partido")}</h2>
    <p class="muted" style="font-size:1.1rem;"><i class="fa-solid fa-location-dot"></i> ${esc(s.venue || "Cancha principal")} &nbsp;|&nbsp; <i class="fa-regular fa-calendar"></i> ${esc(s.schedule || "Pendiente")}</p>
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
  return `<article class="player-card">
    ${poster(p)}
    <div class="player-info">
      <div>
        <h3>${esc(p.nickname || p.name)}</h3>
        <p class="muted">#${esc(p.number)} · ${esc(p.position || "Sin posición")}</p>
      </div>
      <div class="statline"><span>${p.matches_played||0} PJ</span><span>${p.goals||0} Goles</span><span>⭐ ${p.rating||0}</span></div>
      <div class="row"><button class="btn ghost icon-btn" data-edit-player="${p.id}"><i class="fa-solid fa-pen"></i></button><button class="btn danger-ghost icon-btn" data-del-player="${p.id}"><i class="fa-solid fa-trash"></i></button></div>
    </div>
  </article>`;
}

function jugadores(){
  return `<section class="two-cols">
    <article class="panel glass">
      <p class="eyebrow">${state.editPlayer ? "Editar" : "Nuevo jugador"}</p>
      <h2>${state.editPlayer ? "Editar jugador" : "Registrar jugador al pool"}</h2>
      <p class="muted" style="margin-bottom:16px;">Los jugadores se añaden al pozo general. Los equipos se asignan al armar el partido.</p>
      <form id="playerForm" class="form-grid">
        <label class="full">Nombre<input name="name" required placeholder="Ej: Ricardo M"></label>
        <label>Apodo / portada<input name="nickname" placeholder="Ricky"></label>
        <label>Número<input name="number" type="number" min="0" max="99" value="0"></label>
        <label>Posición<input name="position" placeholder="Delantero"></label>
        <label>Partidos<input name="matches_played" type="number" value="0"></label>
        <label>Goles<input name="goals" type="number" value="0"></label>
        <label>Asistencias<input name="assists" type="number" value="0"></label>
        <label>Calificación (0-10)<input name="rating" type="number" step=".1" value="0"></label>
        <label class="full">Foto del jugador (Auto-genera tarjeta)<input id="playerPhoto" type="file" accept="image/*"></label>
        <input name="photo_path" type="hidden"><input name="poster_path" type="hidden">
        <input name="team_side" type="hidden" value="none">
        <div class="full row" style="margin-top:10px;"><button class="btn primary glow-on-hover"><i class="fa-solid fa-floppy-disk"></i> ${state.editPlayer ? "Guardar cambios" : "Añadir a Plantilla"}</button><button type="button" class="btn ghost" id="clearPlayer">Limpiar</button></div>
        <div id="playerMsg" class="full"></div>
      </form>
    </article>
    <div style="display:flex; flex-direction:column; gap:24px;">
      <article class="panel glass">
        <p class="eyebrow">Vista previa</p>
        <h2>Ficha de Presentación</h2>
        <div id="preview" style="display:flex; justify-content:center;">${poster({name:"Tu jugador",nickname:"Jugador",poster_path:""})}</div>
      </article>
    </div>
  </section>

  <section class="panel glass" style="margin-top:24px">
    <div class="row" style="justify-content:space-between; margin-bottom:20px;"><h2>Plantilla General</h2><span class="badge" style="font-size:1rem;">${state.players.length} jugadores</span></div>
    <div class="grid-4">${state.players.map(playerCard).join("") || empty("Registra el primer jugador.")}</div>
  </section>`;
}
function getPlayerForm(){
  const f = Object.fromEntries(new FormData($("#playerForm")).entries());
  return {
    ...f,
    number:+f.number||0, goals:+f.goals||0, assists:+f.assists||0,
    matches_played:+f.matches_played||0, rating:+f.rating||0
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
  const match = state.editMatch ? state.matches.find(m=>m.id===state.editMatch) : (state.matches[0] || null);
  
  const isCapHome = state.user.id === state.settings.captain_home_id;
  const isCapAway = state.user.id === state.settings.captain_away_id;
  const isAdmin = state.user.role === "admin";
  const canEditHome = isAdmin || isCapHome;
  const canEditAway = isAdmin || isCapAway;

  // Compute Balance Check
  let homeStars = 0; let awayStars = 0;
  if (match) {
    match.lineup_home.forEach(id => { const p = player(id); if(p) homeStars += p.rating; });
    match.lineup_away.forEach(id => { const p = player(id); if(p) awayStars += p.rating; });
  }
  const balanceDiff = Math.abs(homeStars - awayStars);
  const isUnbalanced = balanceDiff > 8;

  return `<section class="two-cols">
    <article class="panel glass">
      <p class="eyebrow">Partido & Formación</p>
      <h2>${state.editMatch ? "Editar partido" : "Pizarra Táctica (Tiempo Real)"}</h2>
      
      <form id="matchForm" class="form-grid">
        <label class="full">Título del Encuentro<input name="title" value="${esc(match?.title || state.settings.next_match_title)}" ${isAdmin?'':'readonly'}></label>
        
        ${isAdmin ? `
        <div class="full panel glass" style="padding:16px; margin-bottom:0">
          <h3><i class="fa-solid fa-list-check"></i> Disponibilidad de Jugadores (Call-up)</h3>
          <p class="muted" style="margin-bottom:12px">El admin marca quiénes jugarán este partido. Los capitanes solo podrán seleccionar de esta lista.</p>
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

        <label>Fecha<input name="match_date" value="${esc(match?.match_date || "")}" placeholder="Ej: Hoy 19:00" ${isAdmin?'':'readonly'}></label>
        <label>Cancha<input name="venue" value="${esc(match?.venue || state.settings.venue)}" ${isAdmin?'':'readonly'}></label>
        <label>Goles Local<input name="score_home" type="number" value="${esc(match?.score_home || 0)}" ${isAdmin?'':'readonly'}></label>
        <label>Goles Rival<input name="score_away" type="number" value="${esc(match?.score_away || 0)}" ${isAdmin?'':'readonly'}></label>
        
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
            <p>La diferencia de estrellas entre los equipos es de ${balanceDiff.toFixed(1)} (mayor a 8.0). Considera intercambiar jugadores para un partido más justo.</p>
          </div>
        </div>
        ` : ''}
        
        <div class="full row">
          ${isAdmin || canEditHome || canEditAway ? `<button class="btn primary glow-on-hover"><i class="fa-solid fa-check-double"></i> Guardar Pizarra</button>` : ''}
          ${isAdmin ? `<button class="btn ghost" type="button" id="clearMatch"><i class="fa-solid fa-plus"></i> Publicar Nuevo Partido</button>` : ''}
        </div>
        <div id="matchMsg" class="full"></div>
      </form>
    </article>
    <article class="panel glass" style="padding:0; overflow:hidden; border:none; display:flex; flex-direction:column; background:transparent;">
      <div style="padding:20px; background:var(--bg-panel); border-bottom:1px solid var(--border); border-radius:12px 12px 0 0;">
        <h2><i class="fa-solid fa-chess-board"></i> Pizarra</h2>
      </div>
      <div style="flex:1; padding:20px;">
        ${match ? renderPitchShell(match) : empty("Aún no hay partido seleccionado.")}
      </div>
    </article>
  </section>
  <section class="panel glass" style="margin-top:24px"><h2>Historial de Partidos</h2><div class="item-list">${state.matches.map(matchItem).join("")}</div></section>`;
}
function lineupSelectors(side, selected=[], availIds=[], canEdit){
  // Filter players by availability, unless it's an admin who didn't select any (in which case, show all for legacy support, or strict logic)
  const list = state.players.filter(p => availIds.includes(p.id));
  const playerOptions = list.map(p=>`<option value="${p.id}">#${p.number} ${esc(p.name)} (⭐${p.rating})</option>`).join("");
  
  return slots.map((label,i)=>{
    const selVal = selected[i];
    // We must ensure the selected player appears in the dropdown even if suddenly marked unavailable, 
    // to prevent losing them accidentally when editing.
    let extraOpt = "";
    if (selVal && !availIds.includes(selVal)) {
      const p = player(selVal);
      if(p) extraOpt = `<option value="${p.id}">#${p.number} ${esc(p.name)} (No disp.)</option>`;
    }
    return `<label>${label}<select name="${side}_${i}" class="lineup-select" ${canEdit?'':'disabled'}>
      <option value="">Sin asignar</option>
      ${extraOpt}
      ${list.map(p=>`<option value="${p.id}" ${Number(selVal)===Number(p.id)?"selected":""}>#${p.number} ${esc(p.name)} (⭐${p.rating})</option>`).join("")}
    </select></label>`;
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
    available_players: avail
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
      return `<div class="player-dot" style="left:${xy[0]}%;top:${xy[1]}%; border-color:${t.p}; color:${t.p};">
        ${esc(p.number)}
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
      <h2>Videos</h2>
      <div class="item-list">${state.videos.map(videoCard).join("") || empty("Aún no hay videos.")}</div>
    </article>
    <article class="panel glass">
      <h2>Momentos</h2>
      <div class="item-list">${state.highlights.map(h=>`<div class="item-row" style="flex-direction:column; align-items:flex-start; gap:8px;"><div><span class="badge" style="background:var(--primary); color:#fff"><i class="fa-solid fa-stopwatch"></i> ${esc(h.minute)}</span> <b>${esc(h.title)}</b></div><p class="muted">${esc(h.description)}</p></div>`).join("") || empty("No hay momentos.")}</div>
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
  try{ await api("/api/highlights",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries()))}); e.target.reset(); toast("Momento guardado"); }
  catch(err){ $("#highlightMsg").innerHTML = `<div style="color:var(--danger)">${esc(err.message)}</div>`; }
}
async function del(table,id,section){
  if(!confirm("¿Eliminar este elemento permanentemente?")) return;
  await api(`/api/${table}/${id}`,{method:"DELETE"});
}

load();
