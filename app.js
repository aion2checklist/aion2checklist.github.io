import {deepClone,createStateNormalizer,readLocal,writeLocal,hasStoredState} from "./storage.js?v=1.0.0-final5";
import {createAuthController,discordDisplayName,discordAvatar} from "./auth.js?v=1.0.0-final5";

window.__AION2_SHARED_STATE__ = window.__AION2_SHARED_STATE__ || null;

const CLOUD_CONFIG=window.AION2_CLOUD||{};
const CLOUD_READY=!!(CLOUD_CONFIG.supabaseUrl&&CLOUD_CONFIG.supabaseKey&&window.supabase?.createClient);
const cloudClient=CLOUD_READY?window.supabase.createClient(CLOUD_CONFIG.supabaseUrl,CLOUD_CONFIG.supabaseKey):null;
const authController=createAuthController(cloudClient);
let cloudSession=null,cloudSyncTimer=null,cloudBusy=false,cloudDirty=false,cloudLoadedForUser=null,cloudLoadingForUser=null;

const DEFAULT = {
 version:3,
 profileName:"Daeva",
 faction:"asmodian",
 membership:true,
 dailyDungeonCap:14,
 dailyReset:"05:00",
 weeklyDay:3,
 weeklyReset:"05:00",
 serverLabel:"Global",
 strategy:"balanced",
 planView:"routine",
 sharedView:false,
 notes:"",
 characters:[
  {id:"main",name:"Main",role:"main",level:1,power:0,odyle:0,nightmare:0,ascension:0,battleground:0}
 ],
 daily:{},
 weekly:{},
 weeklyCounts:{dailyDungeon:0,pveCommands:0,pvpCommands:0,shugo:0},
 meta:{dailyKey:null,weeklyKey:null,localUpdatedAt:null,cloudUserId:null,lastCloudSync:null}
};

const normalizeState=createStateNormalizer(DEFAULT);

const LEGACY_LOCAL_KEY="aion2-progression-v2";
const GUEST_LOCAL_KEY="aion2-progression-v2:guest";
const USER_LOCAL_PREFIX="aion2-progression-v2:user:";

function userLocalKey(userId){return USER_LOCAL_PREFIX+userId}
function activeLocalKey(){return cloudSession?.user?.id?userLocalKey(cloudSession.user.id):GUEST_LOCAL_KEY}
function loadLocalState(key=activeLocalKey()){return normalizeState(readLocal(key))}

// One-time safe migration from the old shared cache.
if(!localStorage.getItem(GUEST_LOCAL_KEY)){
 const legacy=readLocal(LEGACY_LOCAL_KEY);
 if(hasStoredState(legacy)&&!legacy?.meta?.cloudUserId)writeLocal(GUEST_LOCAL_KEY,normalizeState(legacy));
}

let state = window.__AION2_SHARED_STATE__ ? normalizeState(window.__AION2_SHARED_STATE__) : loadLocalState(GUEST_LOCAL_KEY);
let readonly = !!window.__AION2_SHARED_STATE__ || !!state.sharedView;

function persistLocal(touch=true){
 if(readonly)return false;
 state=normalizeState(state);
 state.sharedView=false;
 state.meta=state.meta||{};
 if(touch)state.meta.localUpdatedAt=new Date().toISOString();
 return writeLocal(activeLocalKey(),state);
}
function save(){
 persistLocal(true);
 scheduleCloudSave();
}
function cloudPayload(){
 const out=deepClone(state);
 out.sharedView=false;
 return out;
}
function scheduleCloudSave(delay=800){
 if(!cloudClient||!cloudSession||readonly)return;
 if(cloudBusy){cloudDirty=true;return}
 clearTimeout(cloudSyncTimer);
 cloudSyncTimer=setTimeout(()=>pushCloudState(false),delay);
}
async function pushCloudState(showFeedback=true){
 if(!cloudClient||!cloudSession||readonly)return false;
 if(cloudBusy){cloudDirty=true;return false}
 clearTimeout(cloudSyncTimer);
 cloudBusy=true;cloudDirty=false;updateAuthUI("syncing");
 const userId=cloudSession.user.id;
 try{
  state.meta=state.meta||{};
  state.meta.cloudUserId=userId;
  persistLocal(false);
  const snapshot=cloudPayload();
  const now=new Date().toISOString();
  const {error}=await cloudClient.from("checklist_states").upsert({
   user_id:userId,state:snapshot,updated_at:now
  },{onConflict:"user_id"});
  if(error)throw error;
  if(cloudSession?.user?.id===userId){
   state.meta=state.meta||{};
   state.meta.cloudUserId=userId;
   state.meta.lastCloudSync=now;
   persistLocal(false);
   updateAuthUI("online");
  }
  if(showFeedback)alert("Checklist sincronizado com a nuvem.");
  return true;
 }catch(e){
  console.error("Cloud sync failed",e);
  updateAuthUI("error");
  if(showFeedback)alert("Não foi possível sincronizar. Suas alterações continuam salvas neste navegador.");
  return false;
 }finally{
  cloudBusy=false;
  if(cloudDirty){cloudDirty=false;scheduleCloudSave(120)}
 }
}
async function loadCloudForSession(session){
 if(!cloudClient||!session||readonly)return;
 const userId=session.user.id;
 if(cloudLoadedForUser===userId||cloudLoadingForUser===userId)return;
 cloudLoadingForUser=userId;
 try{
  updateAuthUI("syncing");
  const key=userLocalKey(userId);
  let cached=readLocal(key);

  if(!hasStoredState(cached)){
   const legacy=readLocal(LEGACY_LOCAL_KEY);
   if(legacy?.meta?.cloudUserId===userId){
    cached=legacy;
    writeLocal(key,normalizeState(cached));
   }
  }

  const localState=hasStoredState(cached)?normalizeState(cached):normalizeState(DEFAULT);
  localState.meta=localState.meta||{};
  localState.meta.cloudUserId=userId;

  const {data,error}=await cloudClient.from("checklist_states").select("state,updated_at").eq("user_id",userId).maybeSingle();
  if(error)throw error;
  if(cloudSession?.user?.id!==userId)return;

  let shouldPush=false;
  if(!data){
   state=localState;
   shouldPush=true;
  }else{
   const cloudState=normalizeState(data.state||{});
   const localTime=Date.parse(localState.meta?.localUpdatedAt||0)||0;
   const cloudTime=Date.parse(data.updated_at||0)||0;
   if(localTime>cloudTime+1500){
    state=localState;
    shouldPush=true;
   }else{
    state=cloudState;
    state.meta=state.meta||{};
    state.meta.cloudUserId=userId;
    state.meta.lastCloudSync=data.updated_at||null;
   }
  }

  readonly=false;
  const resetChanged=maybeAutoReset(false);
  persistLocal(false);
  renderAll();

  cloudLoadedForUser=userId;
  if(shouldPush||resetChanged)await pushCloudState(false);
  updateAuthUI("online");
 }catch(e){
  console.error("Cloud load failed",e);
  updateAuthUI("error");
 }finally{
  if(cloudLoadingForUser===userId)cloudLoadingForUser=null;
 }
}
function updateAuthUI(mode){
 const btnText=document.getElementById("authBtnText");
 const msg=document.getElementById("authMessage");
 const dot=document.getElementById("cloudDot");
 const status=document.getElementById("cloudStatusText");
 const login=document.getElementById("discordLoginBtn");
 const sync=document.getElementById("cloudSyncBtn");
 const logout=document.getElementById("discordLogoutBtn");
 const wrap=document.getElementById("authProfileWrap");
 if(!btnText||!msg)return;
 dot.className="cloudDot";
 if(!CLOUD_READY){
  btnText.textContent="Entrar com Discord";
  msg.innerHTML="<b>Nuvem aguardando configuração.</b><br>O site já está preparado; falta conectar o projeto Supabase.";
  status.textContent="Somente neste navegador";
  login.disabled=true;sync.classList.add("hidden");logout.classList.add("hidden");wrap.innerHTML="";
  return;
 }
 if(cloudSession){
  const name=discordDisplayName(cloudSession.user),avatar=discordAvatar(cloudSession.user);
  btnText.textContent=name;
  wrap.innerHTML='<div class="authProfile">'+(avatar?'<img class="authAvatar" src="'+escapeHtml(avatar)+'" alt="">':'<div class="authAvatarFallback">D</div>')+'<div><b>'+escapeHtml(name)+'</b><div class="mini">Discord conectado</div></div></div>';
  login.classList.add("hidden");sync.classList.remove("hidden");logout.classList.remove("hidden");
  if(mode==="syncing"){dot.classList.add("warn");status.textContent="Sincronizando…";msg.innerHTML="<b>Conta conectada.</b><br>Salvando alterações na nuvem."}
  else if(mode==="error"){status.textContent="Falha na sincronização";msg.innerHTML="<b>Conta conectada, mas a nuvem falhou.</b><br>Confira a tabela e as políticas do Supabase."}
  else{dot.classList.add("on");status.textContent="Salvo na nuvem";msg.innerHTML="<b>Sincronização ativa.</b><br>Este checklist pertence à sua conta do Discord."}
 }else{
  btnText.textContent="Entrar com Discord";wrap.innerHTML="";login.disabled=false;login.classList.remove("hidden");sync.classList.add("hidden");logout.classList.add("hidden");
  msg.innerHTML="<b>Login disponível.</b><br>Entre com Discord para salvar e recuperar seu checklist em qualquer dispositivo.";
  status.textContent="Somente neste navegador";
 }
}
async function signInDiscord(){
 if(!cloudClient)return;
 const redirectTo=location.origin+location.pathname;
 const {error}=await authController.signInDiscord(redirectTo);
 if(error)alert("Não foi possível abrir o login do Discord.");
}
function pad(n){return String(n).padStart(2,"0")}
function parseTime(v){const [h,m]=(v||"05:00").split(":").map(Number);return {h:h||0,m:m||0}}

function dailyKey(now=new Date()){
 const {h,m}=parseTime(state.dailyReset);
 const d=new Date(now);
 const resetToday=new Date(d); resetToday.setHours(h,m,0,0);
 if(d<resetToday)d.setDate(d.getDate()-1);
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function nextDailyReset(now=new Date()){
 const {h,m}=parseTime(state.dailyReset);
 const next=new Date(now);
 next.setHours(h,m,0,0);
 if(next<=now)next.setDate(next.getDate()+1);
 return next;
}
function nextShugoFestival(now=new Date()){
 const next=new Date(now);
 next.setMinutes(0,0,0);
 next.setHours(next.getHours()+1);
 return next;
}
function weekStart(now=new Date()){
 const {h,m}=parseTime(state.weeklyReset);
 const d=new Date(now);
 const diff=(d.getDay()-Number(state.weeklyDay)+7)%7;
 d.setDate(d.getDate()-diff); d.setHours(h,m,0,0);
 if(d>now)d.setDate(d.getDate()-7);
 return d;
}
function weeklyKey(now=new Date()){const d=weekStart(now);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function nextWeeklyReset(now=new Date()){const d=weekStart(now);d.setDate(d.getDate()+7);return d}
function maybeAutoReset(syncCloud=true){
 if(readonly)return false;
 state.meta=state.meta||{};
 const dk=dailyKey(),wk=weeklyKey();
 let changed=false;
 if(state.meta.dailyKey&&state.meta.dailyKey!==dk){state.daily={};changed=true}
 if(state.meta.weeklyKey&&state.meta.weeklyKey!==wk){
  state.weekly={};state.weeklyCounts={dailyDungeon:0,pveCommands:0,pvpCommands:0,shugo:0};
  state.characters.forEach(c=>{c.ascension=0;c.battleground=0});
  changed=true;
 }
 if(state.meta.dailyKey!==dk||state.meta.weeklyKey!==wk)changed=true;
 state.meta.dailyKey=dk;state.meta.weeklyKey=wk;
 if(changed){
  persistLocal(false);
  if(syncCloud)scheduleCloudSave(120);
 }
 return changed;
}
maybeAutoReset(false);

const dailyDefs=[
 {id:"duties",name:"Duty Missions — 5",note:"Server-wide. Faça no personagem que você quer usar como referência de progressão.",tags:[["DIÁRIO","blue"],["SERVER","gold"]]},
 {id:"supply",name:"Checar Supply Request",note:"Só entregue se o custo fizer sentido. Se o material disparou no mercado, vender pode valer mais que entregar.",tags:[["ECONOMIA","gold"]]},
 {id:"field",name:"Olhar Field Boss / evento próximo",note:"Oportunista: faça se coincidir com sua sessão. Não precisa transformar isso em alarme obrigatório.",tags:[["OPCIONAL","green"]]},
 {id:"capcheck",name:"Checar recursos perto do cap",note:"Nightmare e Odyle podem acumular. A prioridade é evitar cap, não gastar tudo imediatamente.",tags:[["GESTÃO","blue"]]}
];

function shugoMax(){return state.membership?14:7}
function odyleInfo(){return state.membership?{regen:15,day:120,cap:840}:{regen:10,day:80,cap:560}}

const weeklyDefs=()=>[
 {id:"shops",name:"Compras / craft semanais",note:"Odyle, tickets e itens de progressão que façam sentido para sua conta.",tags:[["SEMANA","gold"]]},
 {id:"abyss",name:"Abyss Corridors / eventos de facção",note:"Faça os corredores disponíveis antes do próximo ciclo/reset relevante.",tags:[["ABYSS","red"]]},
 {id:"review",name:"Revisar caps antes do reset",note:"Daily Dungeon, Commands, Ascension, Battleground e Shugo.",tags:[["FECHAMENTO","blue"]]}
];

function tagHtml(tags){return `<div class="pills">${tags.map(t=>`<span class="badge ${t[1]}">${t[0]}</span>`).join("")}</div>`}
function taskHtml(def,scope){
 const checked=!!state[scope][def.id];
 return `<label class="task ${checked?"done":""}">
  <input class="chk" type="checkbox" data-scope="${scope}" data-id="${def.id}" ${checked?"checked":""} ${readonly?"disabled":""}>
  <div><div class="taskName">${def.name}</div><div class="taskNote">${def.note}</div></div>${tagHtml(def.tags)}
 </label>`
}
function countControl(key,value,max,label){
 return `<div class="task">
  <div></div><div><div class="taskName">${label}</div><div class="taskNote">${value} de ${max}</div></div>
  <div class="counter"><button data-count="${key}" data-dir="-1" ${readonly?"disabled":""}>−</button><b>${value}/${max}</b><button data-count="${key}" data-dir="1" ${readonly?"disabled":""}>+</button></div>
 </div>`
}

function renderDaily(){
 document.getElementById("dailyTasks").innerHTML=dailyDefs.map(d=>taskHtml(d,"daily")).join("");
 const oi=odyleInfo();
 const main=state.characters[0]||DEFAULT.characters[0];
 document.getElementById("pulseStats").innerHTML=`
   <div class="stat"><span>Odyle / main</span><b>${main.odyle}/${oi.cap}</b></div>
   <div class="stat"><span>Nightmare / main</span><b>${main.nightmare}/14</b></div>
   <div class="stat"><span>Shugo / servidor</span><b>${state.weeklyCounts.shugo}/${shugoMax()}</b></div>
   <div class="stat"><span>Daily Dungeon</span><b>${state.weeklyCounts.dailyDungeon}/${state.dailyDungeonCap}</b></div>`;
 document.getElementById("dailyKeyBadge").textContent=`reset ${state.dailyReset}`;
}
function renderWeekly(){
 let html=weeklyDefs().map(d=>taskHtml(d,"weekly")).join("");
 html+=countControl("dailyDungeon",state.weeklyCounts.dailyDungeon,state.dailyDungeonCap,"Daily Dungeon — entradas semanais (server-wide)");
 html+=countControl("pveCommands",state.weeklyCounts.pveCommands,12,"Command Missions PvE — 12");
 html+=countControl("pvpCommands",state.weeklyCounts.pvpCommands,20,"Commands PvP — meta da transcrição (ajuste se o Global mostrar diferente)");
 html+=countControl("shugo",state.weeklyCounts.shugo,shugoMax(),`Shugo Reward Keys — ${shugoMax()} por servidor`);
 document.getElementById("weeklyTasks").innerHTML=html;
}

function charCard(c,idx){
 const oi=odyleInfo();
 return `<div class="charCard">
  <div class="charHead"><div><div class="charName">${escapeHtml(c.name)}</div><div class="charRole">${c.role==="main"?"MAIN":"ALT "+idx}</div></div>
    ${c.role!=="main"&&!readonly?`<button class="btn ghost" data-remove-char="${c.id}">Remover</button>`:""}
  </div>
  <div class="fields">
   <div class="field"><label>Nível</label><input class="input charInput" type="number" min="1" max="99" data-char="${c.id}" data-field="level" value="${c.level}" ${readonly?"disabled":""}></div>
   <div class="field"><label>CP / Item Level</label><input class="input charInput" type="number" min="0" data-char="${c.id}" data-field="power" value="${c.power}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Odyle</label><input class="input charInput" type="number" min="0" max="${oi.cap}" data-char="${c.id}" data-field="odyle" value="${c.odyle}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Nightmare tickets</label><input class="input charInput" type="number" min="0" max="14" data-char="${c.id}" data-field="nightmare" value="${c.nightmare}" ${readonly?"disabled":""}></div>
  </div>
  <div class="meterLine"><span>Ascension Trial</span>${smallCounter(c.id,"ascension",c.ascension,3)}</div>
  <div class="meterLine"><span>Battleground wins</span>${smallCounter(c.id,"battleground",c.battleground,3)}</div>
  <div class="mini">Odyle estimado: +${oi.regen}/3h · ${oi.day}/dia · cap ${oi.cap}${state.membership?" com membership":""}</div>
 </div>`;
}
function smallCounter(id,field,value,max){
 return `<div class="counter"><button data-char-count="${id}" data-field="${field}" data-dir="-1" ${readonly?"disabled":""}>−</button><b>${value}/${max}</b><button data-char-count="${id}" data-field="${field}" data-dir="1" ${readonly?"disabled":""}>+</button></div>`
}
function renderCharacters(){
 document.getElementById("characterGrid").innerHTML=state.characters.map(charCard).join("");
 document.getElementById("addCharBtn").disabled=readonly;
}

const launchPlans={
 balanced:{
  label:"Lançamento · padrão recomendado: protege desbloqueios do main e encaixa alts sem transformar o Dia 1 em trabalho.",
  blocks:[
   ["Dia 1 — main primeiro",["Leve o main ao nível 22 para iniciar Odyle.","Continue o main até o nível 45 para abrir os sistemas importantes.","Faça as 5 Duty Missions do dia.","Se ainda tiver tempo/energia, leve seus alts ao 22; não atrase o main só para multiplicar personagens."]],
   ["Dias 2–3 — destravar a conta",["Alts ao nível 22 e depois 45 conforme seu tempo.","Side quests, Sealed Dungeons e Strongholds/Garrisons que dão poder permanente.","Colecionáveis/Monolith que realmente aumentam progressão."]],
   ["Dias 4–6 — atender gates",["Priorize o gate real mostrado pelo cliente para seu próximo Expedition/Conquest.","O vídeo cita ~1400 para Bacchron Sky Island; trate isso como referência, não dogma.","Use Odyle onde o loot já é relevante para o endgame, em vez de abrir todo cubo de leveling."]],
   ["Antes do reset",["Feche Daily Dungeon, Commands, Ascension e Battleground.","Gaste Nightmare antes de 14/14, preferencialmente quando estiver mais forte.","Feche compras/craft semanais e Shugo Reward Keys."]]
  ]
 },
 hardcore:{
  label:"Lançamento · rota do vídeo: maximiza recargas cedo e assume que você vai jogar bastante.",
  blocks:[
   ["Dia 1 — multiplicar geração",["Levar main + todos os alts ao nível 22.","Depois levar o main ao 45.","Fazer as 5 Duties no main."]],
   ["Dias 2–6 — roster",["5 Duties primeiro.","Levar alts ao máximo.","Limpar side content, Sealed Dungeons, Strongholds/Garrisons e Monolith.","Mirar o gate de equipamento do primeiro farm relevante; o vídeo usa ~1400 como referência."]],
   ["Último bloco antes do reset",["Consumir energia/tickets acumulados.","Ascension Trial e conteúdo pontuado quando estiver mais forte.","Daily Dungeons, craft e lojas.","Nightmare antes de capar."]]
  ]
 },
 casual:{
  label:"Lançamento · para quem quer progredir bem sem administrar uma fábrica de alts.",
  blocks:[
   ["Dia 1",["Main ao 22 e depois 45.","5 Duties.","Desbloqueios essenciais no caminho."]],
   ["Resto da semana",["Um único personagem bem feito > vários alts pela metade.","Side content que dá poder permanente.","Daily Dungeon, Ascension, Battleground e Commands antes do reset."]],
   ["Energia",["Não abra cubo de leveling por hábito.","Guarde Odyle para conteúdo cujo loot você realmente quer.","Evite Nightmare em dificuldade baixa se ainda há espaço no cap para ficar mais forte."]]
  ]
 }
};

const routinePlan={
 label:"Rotina normal · foque em constância semanal, não em pressa de lançamento.",
 blocks:[
  ["Quando logar",["Comece pelo que realmente reseta no dia: Duty Missions e checagem rápida das tarefas do dia.","Veja se algum recurso acumulável está perto do cap antes de decidir onde gastar tempo.","Se houver Field Boss, evento ou janela boa de jogo em grupo, encaixe de forma oportunista."]],
  ["Durante a semana",["Feche primeiro o que é server-wide ou tem limite fixo claro: compras/crafts, Daily Dungeon, Command Missions e Shugo.","Use Odyle e Nightmare de forma inteligente: evitar cap é mais importante que gastar cedo.","Ascension e conteúdo pontuado costumam render melhor quando você já ganhou mais poder na semana."]],
  ["Prioridades avançadas — Bíblia",["Escolha cedo as 2 Active Skills que mais definem sua build e mire os marcos 12/16/20 antes de espalhar recursos.","Evite gastar Manastones/Soulstones superiores em gear temporário, porque essas linhas não transferem.","Economize Transfer Stones/Fragments Heroic para equipamentos que realmente pretende manter.","No Pet Genus, a referência Asia favorece subir o board antes de começar a travar linhas; confirme o ritmo do Global antes de seguir isso como regra rígida."]],
  ["Antes do reset",["Passe pela aba Semana e zere tudo que ainda estiver aberto.","Cheque cada personagem: Ascension, Battleground e recursos acumulados.","Faça uma revisão rápida de mercado/supply request para não deixar valor na mesa."]],
  ["Regra de ouro",["Rotina boa é repetível. Se uma estratégia te faz gastar mais tempo organizando do que jogando, simplifique.","Main consistente + poucos alts bem cuidados costuma render melhor do que um roster enorme largado pela metade."]]
 ]
};

function renderWeek1(){
 const planView=state.planView||"routine";
 const isLaunch=planView==="launch";
 document.getElementById("planModeSelect").value=planView;
 document.getElementById("strategySelect").style.display=isLaunch?"":"none";
 if(isLaunch){
  const p=launchPlans[state.strategy]||launchPlans.balanced;
  document.getElementById("strategySelect").value=state.strategy;
  document.getElementById("strategyLabel").textContent=p.label;
  document.getElementById("week1Plan").innerHTML=p.blocks.map(([t,items])=>`<div class="dayBlock"><h3>${t}</h3><ul>${items.map(i=>`<li>${i}</li>`).join("")}</ul></div>`).join("");
 }else{
  document.getElementById("strategyLabel").textContent=routinePlan.label;
  document.getElementById("week1Plan").innerHTML=routinePlan.blocks.map(([t,items])=>`<div class="dayBlock"><h3>${t}</h3><ul>${items.map(i=>`<li>${i}</li>`).join("")}</ul></div>`).join("");
 }
}
function renderResources(){
 const oi=odyleInfo();
 document.getElementById("resourceSummary").innerHTML=`
  <div class="dayBlock"><h3>Odyle Energy</h3><div class="sub">Estimativa do perfil atual: <b>${oi.regen} a cada 3h</b> · <b>${oi.day}/dia</b> · cap base <b>${oi.cap}</b>. Custo típico do cubo: 40.</div></div>
  <div class="dayBlock"><h3>Nightmare</h3><div class="sub">+2 cargas/dia por personagem · cap 14. Não precisa gastar diariamente; precisa evitar cap.</div></div>
  <div class="dayBlock"><h3>Shugo Festival</h3><div class="sub"><b>${shugoMax()} Reward Keys/semana por servidor</b> no perfil atual (${state.membership?"membership ativa":"sem membership"}). Modelo revisado 2026.</div></div>
  <div class="dayBlock"><h3>Ascension Trial</h3><div class="sub">3 tentativas por semana por personagem.</div></div>
  <div class="dayBlock"><h3>Battleground</h3><div class="sub">Até 3 recompensas de vitória por semana por personagem.</div></div>
  <div class="dayBlock"><h3>Daily Dungeon</h3><div class="sub">Seu site está configurado para <b>${state.dailyDungeonCap}/semana</b> server-wide. Ajuste em Configurações quando confirmar o contador no Global.</div></div>`;
 document.getElementById("membershipInfo").innerHTML=state.membership
  ? `<b>Membership ativa.</b><br>O site usa Odyle +15/3h (120/dia), cap base 840 e Shugo 14 chaves/semana.`
  : `<b>Sem membership.</b><br>O site usa Odyle +10/3h (80/dia), cap base 560 e Shugo 7 chaves/semana.`;
}

function renderNotes(){
 const area=document.getElementById("personalNotes");
 const count=document.getElementById("notesCount");
 const status=document.getElementById("notesStatus");
 if(!area||!count||!status)return;
 if(document.activeElement!==area)area.value=state.notes||"";
 area.disabled=readonly;
 count.textContent=String((state.notes||"").length);
 status.textContent=readonly?"Snapshot em modo leitura.":"Salvamento automático ativo.";
}
function renderHeader(){
 document.documentElement.dataset.faction=state.faction;
 document.getElementById("profileLine").textContent=`${state.profileName} · ${state.faction==="asmodian"?"Asmodian":"Elyos"} · ${state.serverLabel||"Global"}`;
 const days=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
 document.getElementById("dailyResetMeta").textContent=`Todos os dias · ${state.dailyReset} · ${state.serverLabel||"servidor"}`;
 document.getElementById("resetMeta").textContent=`${days[state.weeklyDay]} · ${state.weeklyReset} · ${state.serverLabel||"servidor"}`;
 if(readonly){
  document.getElementById("shareBanner").classList.add("show");
  document.getElementById("shareOwner").textContent=`Snapshot de ${state.profileName}. Alterações estão bloqueadas.`;
 }else document.getElementById("shareBanner").classList.remove("show");
}
function getDailyProgress(){
 const total=dailyDefs.length;
 if(!total)return 0;
 const done=dailyDefs.filter(def=>!!state.daily[def.id]).length;
 return Math.round((done/total)*100);
}
function getWeeklyProgress(){
 const defs=weeklyDefs();
 const checkProgress=defs.length?defs.filter(def=>!!state.weekly[def.id]).length/defs.length:0;
 const countParts=[
  state.weeklyCounts.dailyDungeon/Math.max(1,state.dailyDungeonCap),
  state.weeklyCounts.pveCommands/12,
  state.weeklyCounts.pvpCommands/20,
  state.weeklyCounts.shugo/Math.max(1,shugoMax()),
  ...state.characters.map(c=>c.ascension/3),
  ...state.characters.map(c=>c.battleground/3)
 ];
 const countProgress=countParts.length?countParts.reduce((sum,value)=>sum+Math.min(1,Math.max(0,value)),0)/countParts.length:0;
 if(!defs.length&&!countParts.length)return 0;
 if(!defs.length)return Math.round(countProgress*100);
 if(!countParts.length)return Math.round(checkProgress*100);
 return Math.round((checkProgress*.45+countProgress*.55)*100);
}
function renderProgress(){
 const daily=getDailyProgress();
 const weekly=getWeeklyProgress();
 document.getElementById("dailyProgressFill").style.width=daily+"%";
 document.getElementById("dailyProgressText").textContent=daily+"%";
 document.getElementById("weeklyProgressFill").style.width=weekly+"%";
 document.getElementById("weeklyProgressText").textContent=weekly+"%";
}
function renderAll(){renderHeader();renderDaily();renderWeekly();renderCharacters();renderWeek1();renderResources();renderNotes();renderProgress();bindDynamic();}

function bindDynamic(){
 const bibleSearch=document.getElementById("bibleSearch");
 if(bibleSearch){
  bibleSearch.oninput=e=>{
   const q=e.target.value.trim().toLocaleLowerCase("pt-BR");
   let visible=0;
   document.querySelectorAll(".bibleChapter").forEach(ch=>{
    const match=!q||ch.textContent.toLocaleLowerCase("pt-BR").includes(q);
    ch.classList.toggle("bibleHidden",!match);
    if(match)visible++;
   });
   const status=document.getElementById("bibleSearchStatus");
   if(status)status.textContent=q?`${visible} capítulo${visible===1?"":"s"} encontrado${visible===1?"":"s"}`:"12 capítulos";
  };
 }
 const notes=document.getElementById("personalNotes");
 if(notes){
  notes.oninput=e=>{
   if(readonly)return;
   state.notes=e.target.value.slice(0,12000);
   const count=document.getElementById("notesCount");
   const status=document.getElementById("notesStatus");
   if(count)count.textContent=String(state.notes.length);
   if(status)status.textContent=cloudSession?"Salvando…":"Salvo neste navegador.";
   save();
   clearTimeout(notes._savedTimer);
   notes._savedTimer=setTimeout(()=>{
    if(status)status.textContent=cloudSession?"Salvamento automático ativo · nuvem conectada.":"Salvamento automático ativo · somente neste navegador.";
   },1000);
  };
 }
 document.querySelectorAll(".chk").forEach(el=>el.onchange=e=>{
  if(readonly)return;state[e.target.dataset.scope][e.target.dataset.id]=e.target.checked;save();renderAll();
 });
 document.querySelectorAll("[data-count]").forEach(btn=>btn.onclick=()=>{
  if(readonly)return;const k=btn.dataset.count,max=k==="dailyDungeon"?state.dailyDungeonCap:k==="pveCommands"?12:k==="pvpCommands"?20:shugoMax();
  state.weeklyCounts[k]=Math.max(0,Math.min(max,(state.weeklyCounts[k]||0)+Number(btn.dataset.dir)));save();renderAll();
 });
 document.querySelectorAll(".charInput").forEach(inp=>inp.onchange=()=>{
  if(readonly)return;const c=state.characters.find(c=>c.id===inp.dataset.char);if(!c)return;
  let value=Number(inp.value);if(!Number.isFinite(value))value=0;
  const min=inp.min!==""?Number(inp.min):0,max=inp.max!==""?Number(inp.max):Infinity;
  c[inp.dataset.field]=Math.max(min,Math.min(max,value));save();renderAll();
 });
 document.querySelectorAll("[data-char-count]").forEach(btn=>btn.onclick=()=>{
  if(readonly)return;const c=state.characters.find(c=>c.id===btn.dataset.charCount);if(!c)return;
  const max=3;c[btn.dataset.field]=Math.max(0,Math.min(max,(c[btn.dataset.field]||0)+Number(btn.dataset.dir)));save();renderAll();
 });
 document.querySelectorAll("[data-remove-char]").forEach(btn=>btn.onclick=()=>{
  if(readonly)return;state.characters=state.characters.filter(c=>c.id!==btn.dataset.removeChar);save();renderAll();
 });
}

document.getElementById("nav").addEventListener("click",e=>{
 const b=e.target.closest("button[data-view]");if(!b)return;
 document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
 document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));document.getElementById(b.dataset.view).classList.remove("hidden");
});
document.getElementById("planModeSelect").onchange=e=>{if(readonly)return;state.planView=e.target.value;save();renderWeek1()};
document.getElementById("strategySelect").onchange=e=>{if(readonly)return;state.strategy=e.target.value;save();renderWeek1()};
document.getElementById("addCharBtn").onclick=()=>{
 if(readonly)return;
 const name=prompt("Nome do personagem:");if(!name)return;
 state.characters.push({id:"c"+Date.now(),name:name.trim().slice(0,28)||"Alt",role:"alt",level:1,power:0,odyle:0,nightmare:0,ascension:0,battleground:0});save();renderAll();
};
document.getElementById("resetWeeklyBtn").onclick=()=>{
 if(readonly)return;if(!confirm("Limpar progresso semanal?"))return;
 state.weekly={};state.weeklyCounts={dailyDungeon:0,pveCommands:0,pvpCommands:0,shugo:0};state.characters.forEach(c=>{c.ascension=0;c.battleground=0});state.meta.weeklyKey=weeklyKey();save();renderAll();
};

document.getElementById("clearNotesBtn").onclick=()=>{
 if(readonly)return;
 if(!confirm("Apagar todas as suas anotações pessoais?"))return;
 state.notes="";
 save();
 renderNotes();
};

function openModal(id){document.getElementById(id).classList.add("show")}
function closeModal(id){document.getElementById(id).classList.remove("show")}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
document.getElementById("authBtn").onclick=()=>{updateAuthUI();openModal("authModal")};
document.getElementById("discordLoginBtn").onclick=signInDiscord;
document.getElementById("cloudSyncBtn").onclick=()=>pushCloudState(true);
document.getElementById("discordLogoutBtn").onclick=async()=>{
 if(!cloudClient)return;
 clearTimeout(cloudSyncTimer);
 if(cloudSession&&!readonly)persistLocal(false);
 const {error}=await authController.signOut();
 if(error)alert("Não foi possível sair da conta. Tente novamente.");
};
document.getElementById("settingsBtn").onclick=()=>{
 if(readonly)return alert("Este snapshot está em modo leitura. Clique em “Usar como meu checklist” primeiro.");
 document.getElementById("profileNameInput").value=state.profileName;
 document.getElementById("factionSelect").value=state.faction;
 document.getElementById("membershipSelect").value=state.membership?"yes":"no";
 document.getElementById("dailyDungeonCapSelect").value=String(state.dailyDungeonCap);
 document.getElementById("dailyResetInput").value=state.dailyReset;
 document.getElementById("weeklyDaySelect").value=String(state.weeklyDay);
 document.getElementById("weeklyResetInput").value=state.weeklyReset;
 document.getElementById("serverLabelInput").value=state.serverLabel;
 openModal("settingsModal");
};
document.getElementById("saveSettingsBtn").onclick=()=>{
 state.profileName=document.getElementById("profileNameInput").value.trim()||"Daeva";
 state.faction=document.getElementById("factionSelect").value;
 state.membership=document.getElementById("membershipSelect").value==="yes";
 state.dailyDungeonCap=Number(document.getElementById("dailyDungeonCapSelect").value);
 state.dailyReset=document.getElementById("dailyResetInput").value||"05:00";
 state.weeklyDay=Number(document.getElementById("weeklyDaySelect").value);
 state.weeklyReset=document.getElementById("weeklyResetInput").value||"05:00";
 state.serverLabel=document.getElementById("serverLabelInput").value.trim()||"Global";
 state.meta.dailyKey=dailyKey();state.meta.weeklyKey=weeklyKey();save();closeModal("settingsModal");renderAll();
};

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function encodeShare(obj){
 const txt=JSON.stringify({...obj,sharedView:true});
 const bytes=new TextEncoder().encode(txt);let bin="";bytes.forEach(b=>bin+=String.fromCharCode(b));
 return btoa(bin);
}
function decodeShare(code){
 const bin=atob(code.trim());const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes));
}
function sharePayload(){
 const out=deepClone(state);
 out.notes="";
 out.meta={...(out.meta||{}),cloudUserId:null,lastCloudSync:null};
 return out;
}
function shareCode(){return encodeShare(sharePayload())}
async function copyText(text){
 try{
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true}
 }catch(e){}
 const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.focus();ta.select();
 let ok=false;try{ok=document.execCommand("copy")}catch(e){}ta.remove();return ok;
}
document.getElementById("shareBtn").onclick=()=>{
 document.getElementById("shareCodeArea").value=shareCode();openModal("shareModal");
};
document.getElementById("copyShareCodeBtn").onclick=async()=>{
 const code=shareCode();document.getElementById("shareCodeArea").value=code;
 alert(await copyText(code)?"Código copiado.":"Não foi possível copiar automaticamente. Selecione o código e copie manualmente.");
};
document.getElementById("copyShareLinkBtn").onclick=async()=>{
 const code=shareCode();
 if(location.protocol==="file:"){alert("Como você abriu o site como arquivo local, esse link apontaria para o seu PC. Use “Baixar snapshot .html” ou o código.");return}
 const u=new URL(location.href);u.hash="share="+code;
 alert(await copyText(u.toString())?"Link copiado.":"Não foi possível copiar automaticamente.");
};
let privateNotesBeforeShare=null;
document.getElementById("importCodeBtn").onclick=()=>{
 try{
  privateNotesBeforeShare=state.notes||"";
  state=normalizeState(decodeShare(document.getElementById("importCodeArea").value));readonly=true;state.sharedView=true;closeModal("shareModal");renderAll();
 }catch(e){alert("Código inválido.");}
};
document.getElementById("adoptShare").onclick=()=>{
 readonly=false;state=normalizeState(state);state.sharedView=false;
 if(privateNotesBeforeShare!==null)state.notes=privateNotesBeforeShare;
 privateNotesBeforeShare=null;
 save();
 if(location.hash.startsWith("#share="))history.replaceState(null,"",location.pathname+location.search);
 renderAll();alert("Snapshot copiado para o seu checklist.");
};

document.getElementById("downloadSnapshotBtn").onclick=async()=>{
 const embedded={...sharePayload(),sharedView:true};
 const button=document.getElementById("downloadSnapshotBtn");
 const originalText=button.textContent;
 button.disabled=true;button.textContent="Preparando…";
 try{
  const base=new URL("./",location.href);
  const assetText=async path=>{
   const response=await fetch(new URL(path,base),{cache:"no-store"});
   if(!response.ok)throw new Error("Falha ao carregar "+path);
   return response.text();
  };
  const [css,storageSource,authSource,appSource]=await Promise.all([
   assetText("styles.css?v=1.0.0-final5"),
   assetText("storage.js?v=1.0.0-final5"),
   assetText("auth.js?v=1.0.0-final5"),
   assetText("app.js?v=1.0.0-final5")
  ]);
  const stripModule=source=>source
   .replace(/^import\s+[^;]+;\s*$/gm,"")
   .replace(/^export\s+/gm,"");
  let bundled=stripModule(storageSource)+"\n"+stripModule(authSource)+"\n"+stripModule(appSource);
  const marker="window.__AION2_SHARED_STATE__ = window.__AION2_SHARED_STATE__ || null;";
  const replacement="window.__AION2_SHARED_STATE__ = "+JSON.stringify(embedded).replace(/</g,"\\u003c")+";";
  bundled=bundled.replace(marker,replacement);

  let source=document.documentElement.outerHTML;
  source=source.replace(/<link[^>]+href=["']\.\/styles\.css[^"']*["'][^>]*>/i,"<style>"+css+"</style>");
  source=source.replace(/<script[^>]+src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2["'][^>]*><\/script>/i,"");
  source=source.replace(/<script[^>]+src=["']\.\/config\.js[^"']*["'][^>]*><\/script>/i,"");
  source=source.replace(/<script[^>]+type=["']module["'][^>]+src=["']\.\/app\.js[^"']*["'][^>]*><\/script>/i,"<script>"+bundled.replace(/<\/script/gi,"<\\/script")+"</script>");
  source="<!DOCTYPE html>\n"+source;

  const blob=new Blob([source],{type:"text/html;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  const safe=(state.profileName||"Daeva").replace(/[^a-z0-9_-]+/gi,"_");
  a.download=`AION2_${safe}_Checklist.html`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 }catch(error){
  console.error("Snapshot build failed",error);
  alert("Não foi possível preparar o snapshot. Tente novamente.");
 }finally{
  button.disabled=false;button.textContent=originalText;
 }
};

function applyHashShare(){
 const h=location.hash||"";if(!h.startsWith("#share="))return;
 try{
  privateNotesBeforeShare=state.notes||"";
  state=normalizeState(decodeShare(h.slice(7)));readonly=true;state.sharedView=true;
 }catch(e){}
}
applyHashShare();

function formatCountdown(ms,{showDays=false}={}){
 const total=Math.max(0,Math.floor(ms/1000));
 const d=Math.floor(total/86400);
 const h=Math.floor((total%86400)/3600);
 const m=Math.floor((total%3600)/60);
 const s=total%60;
 return showDays?`${d}d ${pad(h)}:${pad(m)}:${pad(s)}`:`${pad(Math.floor(total/3600))}:${pad(m)}:${pad(s)}`;
}
function updateCountdown(){
 const now=new Date();
 const nextShugo=nextShugoFestival(now);
 document.getElementById("dailyCountdown").textContent=formatCountdown(nextDailyReset(now)-now);
 document.getElementById("shugoCountdown").textContent=formatCountdown(nextShugo-now);
 document.getElementById("shugoResetMeta").textContent=`A cada hora · próxima janela ${pad(nextShugo.getHours())}:00`;
 document.getElementById("weeklyCountdown").textContent=formatCountdown(nextWeeklyReset(now)-now,{showDays:true});

 // Detecta a virada do ciclo mesmo com a página aberta.
 if(maybeAutoReset(true))renderAll();
}
if(cloudClient){
 authController.onAuthStateChange((event,session)=>{
  cloudSession=session;updateAuthUI();
  if(session&&(event==="SIGNED_IN"||event==="INITIAL_SESSION"))setTimeout(()=>loadCloudForSession(session),0);
  if(event==="SIGNED_OUT"){
   cloudLoadedForUser=null;cloudLoadingForUser=null;cloudSession=null;readonly=false;
   state=loadLocalState(GUEST_LOCAL_KEY);
   renderAll();updateAuthUI();
  }
 });
 authController.getSession().then(({data})=>{
  cloudSession=data.session||null;updateAuthUI();
  if(cloudSession)setTimeout(()=>loadCloudForSession(cloudSession),0);
 });
}else updateAuthUI();
setInterval(updateCountdown,1000);updateCountdown();renderAll();
