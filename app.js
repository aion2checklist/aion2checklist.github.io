import {deepClone,createStateNormalizer,readLocal,writeLocal,hasStoredState} from "./storage.js?v=2.0.3";
import {createAuthController,discordDisplayName,discordAvatar} from "./auth.js?v=2.0.3";

window.__AION2_SHARED_STATE__ = window.__AION2_SHARED_STATE__ || null;

const CLOUD_CONFIG=window.AION2_CLOUD||{};
const CLOUD_READY=!!(CLOUD_CONFIG.supabaseUrl&&CLOUD_CONFIG.supabaseKey&&window.supabase?.createClient);
const cloudClient=CLOUD_READY?window.supabase.createClient(CLOUD_CONFIG.supabaseUrl,CLOUD_CONFIG.supabaseKey):null;
const authController=createAuthController(cloudClient);
let cloudSession=null,cloudSyncTimer=null,cloudBusy=false,cloudDirty=false,cloudLoadedForUser=null,cloudLoadingForUser=null;

const DEFAULT = {
 version:5,
 profileName:"Daeva",
 faction:"asmodian",
 membership:true,
 dailyDungeonCap:0,
 dailyReset:"05:00",
 weeklyDay:3,
 weeklyReset:"05:00",
 serverLabel:"Global",
 strategy:"balanced",
 planView:"routine",
 sharedView:false,
 notes:"",
 characters:[
  {id:"main",name:"Main",role:"main",level:1,power:0,odyle:0,nightmare:0,sanctuary:0}
 ],
 daily:{},
 weekly:{},
 weeklyCounts:{dailyDungeon:0,pveCommands:0,pvpCommands:0,shugo:0},
 toolbox:{
  classFilter:"all",
  builder:{
   name:"Build principal",className:"Cleric",focus:"pve",level:1,
   stats:{itemLevel:0,might:0,precision:0,attack:0,accuracy:0,critical:0},
   deity:{justice:0,destruction:0,death:0,wisdom:0,destiny:0,space:0,time:0,life:0,illusion:0,freedom:0},
   skills:{primary:0,secondary:0},
   progression:{arcana:0,daevanion:0,cogni:0,fera:0,natura:0,varian:0,special:0},
   gear:{weapon:"",offhand:"",helmet:"",shoulder:"",chest:"",pants:"",gloves:"",boots:"",cloak:"",necklace:"",earring1:"",earring2:"",ring1:"",ring2:"",bracelet1:"",bracelet2:"",amulet:"",belt:"",brooch1:"",brooch2:"",rune1:"",rune2:"",wings:""}
  },
  savedBuilds:[],
  compare:{a:"",b:""},
  calculator:{
   global:{level:1,itemLevel:0,skillBase:1,skillBonus:0},
   piece:{label:"Attack",total:0,current:0,next:0}
  }
 },
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
let activeView="today";

function persistLocal(touch=true){
 if(readonly)return false;
 // O estado já é normalizado ao carregar/importar e nos formulários que aceitam números.
 // Evitar normalizeState aqui impede clonar Builder/Calculadora/builds em TODO salvamento.
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
 {id:"missions",name:"Missões do dia",note:"Abra o Journal e feche as missões disponíveis no cliente Global. O Control Center não presume limites de outra versão.",tags:[["GLOBAL","green"],["DIÁRIO","blue"]]},
 {id:"odyle",name:"Checar Odyle Energy",note:"Evite chegar ao limite antes de uma sessão longa. Membership aumenta a capacidade máxima e as escolhas de cubo em conteúdos compatíveis.",tags:[["RECURSO","gold"]]},
 {id:"shugo",name:"Checar Shugo Festival",note:"Use o relógio do topo como lembrete pessoal. O cronograma exibido no cliente Global é a referência.",tags:[["EVENTO","violet"]]},
 {id:"gear",name:"Revisar próximo gate de Item Level",note:"Priorize o conteúdo que seu Item Level já abre em vez de gastar recursos tentando subir tudo ao mesmo tempo.",tags:[["PROGRESSÃO","blue"]]}
];

const weeklyDefs=()=>[
 {id:"nightmare",name:"Fechar Nightmare",note:"O cliente Global de lançamento contém 14 tentativas semanais. Acompanhe por personagem no Roster.",tags:[["GLOBAL CLIENT","green"]]},
 {id:"sanctuary",name:"Fechar recompensas de Sanctuary",note:"Abyssal Forge: Ludra aparece com 2 recompensas de chefe final por personagem por semana no cliente Global.",tags:[["GLOBAL CLIENT","green"]]},
 {id:"shugo",name:"Revisar Shugo Festival & loja",note:"Reward Keys, Centuryroot Token e lojas do Festival aparecem no cliente Global.",tags:[["SHUGO","gold"]]},
 {id:"daevanion",name:"Planejar Daevanion",note:"Revise cristais e próximos nós antes de gastar. O cliente Global abre cinco boards até o nível 45.",tags:[["BUILD","violet"]]},
 {id:"review",name:"Revisar limites no cliente Global",note:"Horários e valores controlados pelo servidor devem ser confirmados dentro do jogo antes do reset.",tags:[["FECHAMENTO","blue"]]}
];

function tagHtml(tags){return `<div class="pills">${tags.map(t=>`<span class="badge ${t[1]}">${t[0]}</span>`).join("")}</div>`}
function taskHtml(def,scope){
 const checked=!!state[scope][def.id];
 return `<label class="task ${checked?"done":""}">
  <input class="chk" type="checkbox" data-scope="${scope}" data-id="${def.id}" ${checked?"checked":""} ${readonly?"disabled":""}>
  <div><div class="taskName">${def.name}</div><div class="taskNote">${def.note}</div></div>${tagHtml(def.tags)}
 </label>`
}
function renderDaily(){
 document.getElementById("dailyTasks").innerHTML=dailyDefs.map(d=>taskHtml(d,"daily")).join("");
 const main=state.characters[0]||DEFAULT.characters[0];
 document.getElementById("pulseStats").innerHTML=`
   <div class="stat"><span>Item Level / main</span><b>${main.power||0}</b></div>
   <div class="stat"><span>Nightmare / main</span><b>${main.nightmare||0}/14</b></div>
   <div class="stat"><span>Sanctuary / main</span><b>${main.sanctuary||0}/2</b></div>
   <div class="stat"><span>Membership</span><b>${state.membership?"ATIVA":"OFF"}</b></div>`;
 document.getElementById("dailyKeyBadge").textContent=`timer configurado · ${state.dailyReset}`;
}
function renderWeekly(){
 document.getElementById("weeklyTasks").innerHTML=weeklyDefs().map(d=>taskHtml(d,"weekly")).join("");
}
function charCard(c,idx){
 return `<div class="charCard">
  <div class="charHead"><div><div class="charName">${escapeHtml(c.name)}</div><div class="charRole">${c.role==="main"?"MAIN":"ALT "+idx}</div></div>
    ${c.role!=="main"&&!readonly?`<button class="btn ghost" data-remove-char="${c.id}">Remover</button>`:""}
  </div>
  <div class="fields">
   <div class="field"><label>Nível</label><input class="input charInput" type="number" min="1" max="99" data-char="${c.id}" data-field="level" value="${c.level}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Item Level</label><input class="input charInput" type="number" min="0" data-char="${c.id}" data-field="power" value="${c.power}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Odyle Energy</label><input class="input charInput" type="number" min="0" data-char="${c.id}" data-field="odyle" value="${c.odyle}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Nightmare — feitos</label><input class="input charInput" type="number" min="0" max="14" data-char="${c.id}" data-field="nightmare" value="${c.nightmare}" ${readonly?"disabled":""}></div>
  </div>
  <div class="meterLine"><span>Sanctuary · recompensas de chefe final</span>${smallCounter(c.id,"sanctuary",c.sanctuary||0,2)}</div>
  <div class="mini">${state.membership?"Membership ativa: capacidade máxima de Odyle e escolhas de cubo aumentadas.":"Sem Membership: use o limite de Odyle mostrado no cliente Global."}</div>
 </div>`;
}
function smallCounter(id,field,value,max){
 return `<div class="counter"><button data-char-count="${id}" data-field="${field}" data-max="${max}" data-dir="-1" ${readonly?"disabled":""}>−</button><b>${value}/${max}</b><button data-char-count="${id}" data-field="${field}" data-max="${max}" data-dir="1" ${readonly?"disabled":""}>+</button></div>`
}
function renderCharacters(){
 document.getElementById("characterGrid").innerHTML=state.characters.map(charCard).join("");
 document.getElementById("addCharBtn").disabled=readonly;
}

const launchPlans={
 balanced:{label:"Global · rota segura: desbloqueie sistemas no ritmo do cliente e use Item Level como bússola.",blocks:[
  ["1 — História e desbloqueios",["Avance a campanha e trate o nível 45 como o início do núcleo de endgame presente no cliente Global.","Daevanion abre nos níveis 12, 20, 30, 40 e 45.","Não planeje o dia em torno de conteúdo que ainda apareça bloqueado no servidor."]],
  ["2 — Skills",["O cliente Global usa 4 slots de Stigma e 8 quick slots.","Skills sobem naturalmente até 14; Arcana e Daevanion podem adicionar níveis extras.","Specializations abrem em 8, 12 e 20."]],
  ["3 — Item Level",["Conquest usa gates 700, 1.400 e 2.100 no cliente Global.","Transcendence visível no lançamento usa 1.600 / 1.900 / 2.200 / 2.500.","Abyssal Forge: Ludra aparece em 2.800."]],
  ["4 — Semana",["Nightmare: acompanhe 14 tentativas semanais por personagem.","Sanctuary: acompanhe 2 recompensas de chefe final por personagem.","Use o Database Global para conferir sistemas e itens do cliente atual."]]
 ]},
 hardcore:{label:"Global · ritmo alto: empurre Item Level sem investir pesado em sistemas que ainda não destravam conteúdo.",blocks:[
  ["Rush de desbloqueio",["Campanha até o endgame e os cinco boards Daevanion presentes no cliente.","Use o próximo gate como meta concreta.","Ao atingir 45, organize Conquest, Transcendence e Sanctuary pelo Item Level."]],
  ["Build",["Escolha duas skills-chave.","Distribua Daevanion para a rota que atende sua build.","Use Arcana, gear e progressão para atingir Specializations."]],
  ["Fechamento",["Complete Nightmare e Sanctuary antes dos resets exibidos no cliente.","Revise Shugo Festival, Abyss e lojas.","Compare snapshots no Builder antes de comprometer recursos raros."]]
 ]},
 casual:{label:"Global · simples e eficiente: um main bem cuidado, metas claras e pouca administração.",blocks:[
  ["Seu main",["Avance história até os sistemas que você usa.","Atualize Item Level no Roster e veja o próximo conteúdo na Calculadora.","Não crie alts só para preencher uma planilha."]],
  ["Sua build",["Mantenha duas skills prioritárias.","Abra Daevanion nos níveis 12/20/30/40/45.","Salve um snapshot quando a direção da build estiver clara."]],
  ["Sua semana",["Nightmare e Sanctuary têm contadores úteis para acompanhar.","Membership muda conveniências, mercado e Odyle, sem números inventados.","O cliente Global sempre vence qualquer guia externo."]]
 ]}
};
const routinePlan={label:"Rotina Global · somente dados oficiais ou do cliente Global; o que é controlado pelo servidor fica configurável.",blocks:[
 ["Ao entrar",["Confira Journal, Odyle e o próximo gate de Item Level.","Use o timer de Shugo apenas como lembrete pessoal.","Atualize Item Level do main quando trocar um conjunto importante."]],
 ["Build",["4 Stigma slots e 8 quick slots no cliente Global.","Daevanion: Nezekan 12, Zikel 20, Vaizel 30, Triniel 40 e Azphel 45.","Specializations de Mastery abrem em 8, 12 e 20."]],
 ["Conteúdo",["A partir do nível 45, use a Calculadora para Conquest, Transcendence e Sanctuary.","Nightmare mostra 14 tentativas semanais.","Ludra registra 2 recompensas de chefe final por personagem por semana."]],
 ["Economia & Membership",["Membership Global libera Market, Personal Trading, Remote Storage, Wind Breeze Merchants e Quna Exchange Shop.","Também aumenta capacidade de Odyle e escolhas de Odyle Energy Cube em conteúdos compatíveis.","O site não presume porcentagens ou caps não publicados."]],
 ["Regra do Control Center",["Dados do cliente entram como dados; decisões do servidor entram como configuráveis.","Se o jogo mostrar algo diferente após patch, o cliente vence.","Não usamos números de outra versão para preencher lacunas."]]
]};
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
 document.getElementById("resourceSummary").innerHTML=`
  <div class="dayBlock"><h3>Odyle Energy</h3><div class="sub">Presente no cliente Global. A Membership aumenta a capacidade máxima; o valor numérico fica sob controle do cliente ao vivo.</div></div>
  <div class="dayBlock"><h3>Nightmare</h3><div class="sub"><b>14 tentativas por semana</b> no cliente Global de lançamento.</div></div>
  <div class="dayBlock"><h3>Sanctuary · Abyssal Forge: Ludra</h3><div class="sub">Nível 45 · <b>Item Level 2.800</b> · 10 jogadores · <b>2 recompensas de chefe final por personagem/semana</b>.</div></div>
  <div class="dayBlock"><h3>Shugo Festival</h3><div class="sub">Reward Keys e Centuryroot Token aparecem no cliente Global. O timer do topo é somente um lembrete pessoal.</div></div>
  <div class="dayBlock"><h3>Daevanion</h3><div class="sub">Cinco boards presentes: Nezekan, Zikel, Vaizel, Triniel e Azphel.</div></div>
  <div class="dayBlock"><h3>Craft</h3><div class="sub">Profissões do cliente Global: Alchemy, Blacksmithing, Armorsmithing, Handicrafting e Cooking.</div></div>`;
 document.getElementById("membershipInfo").innerHTML=state.membership
  ? `<b>Special Quai Membership ativa.</b><br>Remote Storage, Personal Trading, Wind Breeze Merchants, Market, Quna Exchange Shop, maior capacidade de Odyle e mais escolhas de Odyle Energy Cube.`
  : `<b>Sem Membership.</b><br>O jogo continua free-to-play; os recursos acima fazem parte dos benefícios da Membership Global.`;
}

const CLASS_DATA=[
 {name:"Templar",role:"Tank",roleKey:"tank",weapon:"Espada",difficulty:"Média",availability:"global",summary:"Linha de frente com foco em proteção, controle de ameaça e sustentação do grupo."},
 {name:"Gladiator",role:"DPS corpo a corpo",roleKey:"dps",weapon:"Espada Grande",difficulty:"Fácil",availability:"global",summary:"Dano físico direto, presença constante no melee e boa tolerância para uma classe ofensiva."},
 {name:"Assassin",role:"DPS corpo a corpo",roleKey:"dps",weapon:"Adaga",difficulty:"Alta",availability:"global",summary:"Mobilidade, burst e pressão posicional; tende a valorizar execução e ataques pelas costas."},
 {name:"Ranger",role:"DPS à distância",roleKey:"dps",weapon:"Arco",difficulty:"Média",availability:"global",summary:"Dano físico à distância com mobilidade e controle do espaço."},
 {name:"Sorcerer",role:"DPS à distância",roleKey:"dps",weapon:"Grimório",difficulty:"Média",availability:"global",summary:"Dano mágico à distância e ferramentas de área, com forte peso no uso correto das skills."},
 {name:"Spiritmaster",role:"Invocador",roleKey:"dps",weapon:"Orbe",difficulty:"Alta",availability:"global",summary:"Combina o próprio kit com um espírito invocado e exige atenção ao posicionamento das duas fontes de dano."},
 {name:"Cleric",role:"Suporte / Cura",roleKey:"support",weapon:"Maça",difficulty:"Média",availability:"global",summary:"Cura e sustentação do grupo com capacidade de participar do combate além do papel defensivo."},
 {name:"Chanter",role:"Suporte híbrido",roleKey:"support",weapon:"Cajado",difficulty:"Alta",availability:"global",summary:"Mistura buffs, sustentação e presença corpo a corpo para fortalecer o grupo."},
 {name:"Brawler",role:"DPS corpo a corpo",roleKey:"dps",weapon:"Manopla",difficulty:"Alta",availability:"kr",summary:"Classe de combos corpo a corpo presente em KR/TW; trate disponibilidade no Global como não confirmada."}
];
const MAIN_STAT_DEFS=[
 ["might","Might","Attack Increase"],["constitution","Constitution","HP Increase"],["dexterity","Dexterity","Evasion + Block + Critical Hit Resist"],
 ["intelligence","Intelligence","Status Effect Chance"],["precision","Precision","Accuracy Increase + Critical Hit Increase"],["willpower","Willpower","Status Effect Resist"]
];
const DEITY_DEFS=[
 ["justice","Justice / Nezekan","Defense Increase","Perfect Chance",false],["destruction","Destruction / Zikel","Attack Increase","Perfect Resist",false],
 ["death","Death / Triniel","Critical Hit Increase","Regeneration Penetration",false],["wisdom","Wisdom / Lumiel","MP Cost","Smite / Double Chance",true],
 ["destiny","Destiny / Marchutan","MP Increase","Endurance",false],["space","Space / Israphel","Move Speed","Block Increase",false],
 ["time","Time / Siel","Combat Speed","Smite Resist / Double Chance Resist",false],["life","Life / Yustiel","HP Increase","Regeneration",false],
 ["illusion","Illusion / Kaisinel","Cooldown","Endurance Penetration",true],["freedom","Freedom / Vaizel","Accuracy Increase","Evasion Increase",false]
];
const BUILDER_GEAR_SLOTS=[
 ["weapon","Arma"],["offhand","Guard / Off-hand"],["helmet","Helmet"],["shoulder","Shoulder"],["chest","Chest"],["pants","Pants"],["gloves","Gloves"],["boots","Boots"],["cloak","Cloak"],
 ["necklace","Necklace"],["earring1","Earring 1"],["earring2","Earring 2"],["ring1","Ring 1"],["ring2","Ring 2"],["bracelet1","Bracelet 1"],["bracelet2","Bracelet 2"],
 ["amulet","Amulet"],["belt","Belt"],["brooch1","Brooch 1"],["brooch2","Brooch 2"],["rune1","Rune 1"],["rune2","Rune 2"],["wings","Wings"]
];
function toolState(){return state.toolbox||DEFAULT.toolbox}
function builderState(){return toolState().builder}
function classOptions(selected){return CLASS_DATA.map(c=>`<option value="${c.name}" ${c.name===selected?"selected":""}>${c.name}${c.availability==="kr"?" · KR/TW":""}</option>`).join("")}
function focusLabel(v){return v==="pvp"?"PvP":v==="hybrid"?"Híbrido":"PvE"}

function renderClasses(){
 const grid=document.getElementById("classGrid"),filter=document.getElementById("classFilter");
 if(!grid||!filter)return;
 const selected=toolState().classFilter||"all";filter.value=selected;
 const list=CLASS_DATA.filter(c=>selected==="all"||(selected==="global"&&c.availability==="global")||(selected==="kr"&&c.availability==="kr")||selected===c.roleKey);
 grid.innerHTML=list.map(c=>`
  <article class="classCard">
   <div class="classCardTop"><span class="classSigil">${c.name.slice(0,2).toUpperCase()}</span><span class="badge ${c.availability==="global"?"green":"gold"}">${c.availability==="global"?"GLOBAL":"KR/TW"}</span></div>
   <h3>${c.name}</h3><p>${c.summary}</p>
   <div class="classMeta"><span><small>Papel</small><b>${c.role}</b></span><span><small>Arma</small><b>${c.weapon}</b></span><span><small>Dificuldade</small><b>${c.difficulty}</b></span></div>
   <button class="btn ghost classBuildBtn" data-class-build="${c.name}">Usar no Builder →</button>
  </article>`).join("");
}

function renderBuilder(){
 const form=document.getElementById("builderForm"),saved=document.getElementById("savedBuildList");if(!form||!saved)return;
 const b=builderState();
 const gear=BUILDER_GEAR_SLOTS.map(([key,label])=>`<div class="field"><label>${label}</label><input class="input builderField" data-builder-path="gear.${key}" value="${escapeHtml(b.gear[key]||"")}" placeholder="Nome / meta do item" ${readonly?"disabled":""}></div>`).join("");
 const genus=["cogni","fera","natura","varian","special"].map(k=>`<div class="field"><label>${k[0].toUpperCase()+k.slice(1)}</label><input class="input builderField" type="number" min="0" max="10" data-builder-path="progression.${k}" value="${b.progression[k]}" ${readonly?"disabled":""}></div>`).join("");
 form.innerHTML=`
  <div class="builderToolbar">
   <div class="field grow"><label>Nome da build</label><input class="input builderField" data-builder-path="name" value="${escapeHtml(b.name)}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Classe</label><select class="select builderField" data-builder-path="className" ${readonly?"disabled":""}>${classOptions(b.className)}</select></div>
   <div class="field"><label>Foco</label><select class="select builderField" data-builder-path="focus" ${readonly?"disabled":""}><option value="pve" ${b.focus==="pve"?"selected":""}>PvE</option><option value="pvp" ${b.focus==="pvp"?"selected":""}>PvP</option><option value="hybrid" ${b.focus==="hybrid"?"selected":""}>Híbrido</option></select></div>
   <div class="field smallField"><label>Nível</label><input class="input builderField" type="number" min="1" max="99" data-builder-path="level" value="${b.level}" ${readonly?"disabled":""}></div>
  </div>
  <div class="builderSummary"><div><span>Classe</span><b>${b.className}</b></div><div><span>Foco</span><b>${focusLabel(b.focus)}</b></div><div><span>Attack</span><b>${b.stats.attack}</b></div><div><span>Accuracy</span><b>${b.stats.accuracy}</b></div><div><span>Crit</span><b>${b.stats.critical}</b></div></div>
  <details class="builderPanel" open><summary>Stats principais</summary><div class="builderFields">${[["might","Might"],["precision","Precision"],["attack","Attack"],["accuracy","Accuracy"],["critical","Critical Hit"]].map(([k,l])=>`<div class="field"><label>${l}</label><input class="input builderField" type="number" min="0" data-builder-path="stats.${k}" value="${b.stats[k]}" ${readonly?"disabled":""}></div>`).join("")}</div></details>
  <details class="builderPanel" open><summary>Skills & progressão</summary><div class="builderFields">
   <div class="field"><label>Active Skill principal</label><input class="input builderField" type="number" min="0" max="40" data-builder-path="skills.primary" value="${b.skills.primary}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Active Skill secundária</label><input class="input builderField" type="number" min="0" max="40" data-builder-path="skills.secondary" value="${b.skills.secondary}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Arcanas equipadas</label><input class="input builderField" type="number" min="0" max="10" data-builder-path="progression.arcana" value="${b.progression.arcana}" ${readonly?"disabled":""}></div>
   <div class="field"><label>Pontos Daevanion</label><input class="input builderField" type="number" min="0" data-builder-path="progression.daevanion" value="${b.progression.daevanion}" ${readonly?"disabled":""}></div>
   ${genus}
  </div><div class="mini builderHint">Marcos úteis para Active Skills citados na Bíblia: 8 · 12 · 16 · 20. Genus aqui é planejamento manual.</div></details>
  <details class="builderPanel"><summary>Equipamento planejado</summary><div class="builderGearGrid">${gear}</div></details>
  <div class="builderActions"><button class="btn primary" id="saveBuildSnapshotBtn" ${readonly?"disabled":""}>Salvar snapshot</button><button class="btn ghost" id="copyBuildCodeBtn">Copiar build</button><button class="btn ghost" id="importBuildCodeBtn" ${readonly?"disabled":""}>Importar build</button><button class="btn danger" id="clearBuilderBtn" ${readonly?"disabled":""}>Limpar</button></div>`;
 const builds=toolState().savedBuilds||[];
 saved.innerHTML=builds.length?builds.slice().reverse().map(item=>`<div class="savedBuildCard"><div><b>${escapeHtml(item.build.name)}</b><span>${item.build.className} · ${focusLabel(item.build.focus)} · Lv ${item.build.level}</span></div><div class="savedBuildActions"><button class="btn ghost" data-open-build="${item.id}">Abrir</button><button class="btn ghost" data-copy-saved-build="${item.id}">Copiar</button><button class="btn danger miniBtn" data-delete-build="${item.id}">×</button></div></div>`).join(""):`<div class="emptyState"><b>Nenhuma build salva.</b><span>Monte algo ao lado e clique em “Salvar snapshot”.</span></div>`;
}

function renderCalculator(){
 const root=document.getElementById("calculatorBody");if(!root)return;
 const calc=toolState().calculator;
 const mainRows=MAIN_STAT_DEFS.map(([key,label,effect])=>{const val=Number(calc.main[key]||0),yieldPct=val*.1;return `<div class="calcRow"><div><b>${label}</b><small>${effect}</small></div><input class="input calcField" type="number" min="0" data-calc-path="main.${key}" value="${val}" ${readonly?"disabled":""}><strong>${yieldPct.toFixed(1)}%</strong></div>`}).join("");
 const deityRows=DEITY_DEFS.map(([key,label,e1,e2,reduction])=>{const val=Number(calc.deity[key]||0),pct=val*.2;return `<div class="calcRow deityRow"><div><b>${label}</b><small>${e1} · ${e2}</small></div><input class="input calcField" type="number" min="0" max="200" data-calc-path="deity.${key}" value="${val}" ${readonly?"disabled":""}><strong>${reduction?"−":""}${pct.toFixed(1)}% / +${pct.toFixed(1)}%</strong></div>`}).join("");
 const p=calc.piece,newTotal=Number(p.total||0)-Number(p.current||0)+Number(p.next||0),diff=Number(p.next||0)-Number(p.current||0),c=calc.context;
 const pveAttack=Number(c.attack||0)+Number(c.pveAttack||0)+(c.isBoss?Number(c.bossAttack||0):0),pvpAttack=Number(c.attack||0)+Number(c.pvpAttack||0),pveDamage=Number(c.damage||0)+Number(c.pveDamage||0)+(c.isBoss?Number(c.bossDamage||0):0),pvpDamage=Number(c.damage||0)+Number(c.pvpDamage||0);
 root.innerHTML=`<div class="calcLayout"><section class="calcPanel"><div class="calcPanelHead"><h3>Main Stats</h3><span class="badge green">0,1% / ponto</span></div>${mainRows}<div class="mini calcSource">Relação usada como referência de cálculo do guia consultado.</div></section><section class="calcPanel"><div class="calcPanelHead"><h3>Deity Stats</h3><span class="badge gold">0,2% / ponto</span></div>${deityRows}<div class="mini calcSource">As fontes usam terminologia diferente em Wisdom/Time; mantivemos os dois nomes no rótulo.</div></section></div>
 <div class="calcLayout calcBottom"><section class="calcPanel"><div class="calcPanelHead"><h3>Comparar uma peça</h3><span class="badge blue">ARITMÉTICA</span></div><div class="builderFields">
  <div class="field"><label>Status</label><input class="input calcTextField" data-calc-text="piece.label" value="${escapeHtml(p.label)}" ${readonly?"disabled":""}></div><div class="field"><label>Total atual</label><input class="input calcField" type="number" data-calc-path="piece.total" value="${p.total}" ${readonly?"disabled":""}></div><div class="field"><label>Peça atual</label><input class="input calcField" type="number" data-calc-path="piece.current" value="${p.current}" ${readonly?"disabled":""}></div><div class="field"><label>Peça nova</label><input class="input calcField" type="number" data-calc-path="piece.next" value="${p.next}" ${readonly?"disabled":""}></div>
 </div><div class="calcResult"><span>${escapeHtml(p.label||"Status")} final</span><b>${newTotal}</b><em class="${diff>=0?"positive":"negative"}">${diff>=0?"+":""}${diff}</em></div></section>
 <section class="calcPanel"><div class="calcPanelHead"><h3>PvE x PvP</h3><span class="badge violet">CONTEXTO</span></div><div class="builderFields contextFields">${[["attack","Attack base"],["pveAttack","Attack PvE"],["pvpAttack","Attack PvP"],["bossAttack","Attack Boss"],["damage","Damage Boost geral"],["pveDamage","Damage Boost PvE"],["pvpDamage","Damage Boost PvP"],["bossDamage","Damage Boost Boss"]].map(([k,l])=>`<div class="field"><label>${l}</label><input class="input calcField" type="number" data-calc-path="context.${k}" value="${c[k]}" ${readonly?"disabled":""}></div>`).join("")}<div class="field"><label>Alvo é boss?</label><select class="select calcBoolField" data-calc-bool="context.isBoss" ${readonly?"disabled":""}><option value="no" ${!c.isBoss?"selected":""}>Não</option><option value="yes" ${c.isBoss?"selected":""}>Sim</option></select></div></div>
 <div class="contextResults"><div><span>PvE Attack</span><b>${pveAttack}</b></div><div><span>PvE Damage</span><b>${pveDamage}</b></div><div><span>PvP Attack</span><b>${pvpAttack}</b></div><div><span>PvP Damage</span><b>${pvpDamage}</b></div></div><div class="mini calcSource">Somamos apenas os bônus do contexto selecionado; isso não é uma fórmula completa de DPS.</div></section></div>`;
}

function renderCompare(){
 const root=document.getElementById("compareBuildsBody");if(!root)return;
 const builds=toolState().savedBuilds||[],cmp=toolState().compare||{a:"",b:""},opts='<option value="">Escolha uma build</option>'+builds.map(i=>`<option value="${i.id}">${escapeHtml(i.build.name)} · ${i.build.className}</option>`).join("");
 const a=builds.find(i=>i.id===cmp.a)?.build,b=builds.find(i=>i.id===cmp.b)?.build;
 const row=(label,av,bv,numeric=true)=>{let dhtml="—";if(numeric&&a&&b){const d=Number(bv||0)-Number(av||0);dhtml=`<em class="${d>=0?"positive":"negative"}">${d>=0?"+":""}${d}</em>`}return `<tr><td>${label}</td><td>${a?av:"—"}</td><td>${b?bv:"—"}</td><td>${dhtml}</td></tr>`};
 root.innerHTML=`<div class="compareSelectors"><div class="field"><label>Build A</label><select class="select compareSelect" id="compareA">${opts}</select></div><div class="vsMark">VS</div><div class="field"><label>Build B</label><select class="select compareSelect" id="compareB">${opts}</select></div></div>
 ${builds.length<2?`<div class="callout warn"><b>Salve pelo menos duas builds.</b><br>O comparador usa os snapshots do Builder.</div>`:`<div class="statTableWrap"><table class="bibleTable compareTable"><thead><tr><th>Campo</th><th>Build A</th><th>Build B</th><th>Δ B−A</th></tr></thead><tbody>${row("Classe",a?.className,b?.className,false)}${row("Foco",a?focusLabel(a.focus):"",b?focusLabel(b.focus):"",false)}${row("Nível",a?.level,b?.level)}${row("Might",a?.stats.might,b?.stats.might)}${row("Precision",a?.stats.precision,b?.stats.precision)}${row("Attack",a?.stats.attack,b?.stats.attack)}${row("Accuracy",a?.stats.accuracy,b?.stats.accuracy)}${row("Critical Hit",a?.stats.critical,b?.stats.critical)}${row("Skill principal",a?.skills.primary,b?.skills.primary)}${row("Skill secundária",a?.skills.secondary,b?.skills.secondary)}${row("Arcanas",a?.progression.arcana,b?.progression.arcana)}${row("Daevanion",a?.progression.daevanion,b?.progression.daevanion)}</tbody></table></div>`}
 <div class="mini compareNote">O comparador mostra diferenças objetivas entre os campos salvos e não escolhe uma build “vencedora”.</div>`;
 const sa=document.getElementById("compareA"),sb=document.getElementById("compareB");if(sa)sa.value=cmp.a||"";if(sb)sb.value=cmp.b||"";
}

function setNested(obj,path,value){const keys=path.split(".");let cur=obj;for(let i=0;i<keys.length-1;i++){if(!cur[keys[i]]||typeof cur[keys[i]]!=="object")cur[keys[i]]={};cur=cur[keys[i]]}cur[keys[keys.length-1]]=value}
function bindPortalDynamic(scope=document){
 const classFilter=scope.querySelector("#classFilter");if(classFilter)classFilter.onchange=e=>{if(readonly)return;state.toolbox.classFilter=e.target.value;save();renderClasses();bindPortalDynamic(scope)};
 scope.querySelectorAll("[data-class-build]").forEach(btn=>btn.onclick=()=>{if(readonly)return;state.toolbox.builder.className=btn.dataset.classBuild;save();setView("builder")});
 scope.querySelectorAll(".builderField").forEach(el=>el.onchange=e=>{if(readonly)return;const path=e.target.dataset.builderPath,value=e.target.type==="number"?Number(e.target.value||0):e.target.value;setNested(state.toolbox.builder,path,value);state=normalizeState(state);save();renderBuilder();bindPortalDynamic(scope)});
 const saveBtn=scope.querySelector("#saveBuildSnapshotBtn");if(saveBtn)saveBtn.onclick=()=>{if(readonly)return;state.toolbox.savedBuilds.push({id:"b"+Date.now(),savedAt:new Date().toISOString(),build:deepClone(state.toolbox.builder)});state.toolbox.savedBuilds=state.toolbox.savedBuilds.slice(-12);save();renderBuilder();bindPortalDynamic(scope)};
 const clearBtn=scope.querySelector("#clearBuilderBtn");if(clearBtn)clearBtn.onclick=()=>{if(readonly||!confirm("Limpar a build atual?"))return;state.toolbox.builder=deepClone(DEFAULT.toolbox.builder);save();renderBuilder();bindPortalDynamic(scope)};
 const copyBuild=scope.querySelector("#copyBuildCodeBtn");if(copyBuild)copyBuild.onclick=async()=>{const code=encodeShare({type:"aion2-build",build:builderState()});alert(await copyText(code)?"Build copiada.":"Não foi possível copiar automaticamente.")};
 const importBuild=scope.querySelector("#importBuildCodeBtn");if(importBuild)importBuild.onclick=()=>{if(readonly)return;const code=prompt("Cole o código da build:");if(!code)return;try{const data=decodeShare(code);if(!data?.build)throw new Error();state.toolbox.builder=data.build;state=normalizeState(state);save();setView("builder")}catch(e){alert("Código de build inválido.")}};
 scope.querySelectorAll("[data-open-build]").forEach(btn=>btn.onclick=()=>{const item=state.toolbox.savedBuilds.find(i=>i.id===btn.dataset.openBuild);if(!item||readonly)return;state.toolbox.builder=deepClone(item.build);save();setView("builder")});
 scope.querySelectorAll("[data-delete-build]").forEach(btn=>btn.onclick=()=>{if(readonly||!confirm("Excluir este snapshot?"))return;state.toolbox.savedBuilds=state.toolbox.savedBuilds.filter(i=>i.id!==btn.dataset.deleteBuild);save();renderBuilder();bindPortalDynamic(scope)});
 scope.querySelectorAll("[data-copy-saved-build]").forEach(btn=>btn.onclick=async()=>{const item=state.toolbox.savedBuilds.find(i=>i.id===btn.dataset.copySavedBuild);if(!item)return;const code=encodeShare({type:"aion2-build",build:item.build});alert(await copyText(code)?"Build copiada.":"Não foi possível copiar automaticamente.")});
 scope.querySelectorAll(".calcField").forEach(el=>el.onchange=e=>{if(readonly)return;setNested(state.toolbox.calculator,e.target.dataset.calcPath,Number(e.target.value||0));state=normalizeState(state);save();renderCalculator();bindPortalDynamic(scope)});
 scope.querySelectorAll(".calcTextField").forEach(el=>el.onchange=e=>{if(readonly)return;setNested(state.toolbox.calculator,e.target.dataset.calcText,e.target.value);state=normalizeState(state);save();renderCalculator();bindPortalDynamic(scope)});
 scope.querySelectorAll(".calcBoolField").forEach(el=>el.onchange=e=>{if(readonly)return;setNested(state.toolbox.calculator,e.target.dataset.calcBool,e.target.value==="yes");save();renderCalculator();bindPortalDynamic(scope)});
 const calcFromBuilder=scope.querySelector("#calcFromBuilderBtn");if(calcFromBuilder)calcFromBuilder.onclick=()=>{if(readonly)return;state.toolbox.calculator.main.might=state.toolbox.builder.stats.might;state.toolbox.calculator.main.precision=state.toolbox.builder.stats.precision;state.toolbox.calculator.context.attack=state.toolbox.builder.stats.attack;save();renderCalculator();bindPortalDynamic(scope)};
 const ca=scope.querySelector("#compareA"),cb=scope.querySelector("#compareB");
 if(ca){ca.disabled=readonly;ca.onchange=e=>{if(readonly)return;state.toolbox.compare.a=e.target.value;save();renderCompare();bindPortalDynamic(scope)}}
 if(cb){cb.disabled=readonly;cb.onchange=e=>{if(readonly)return;state.toolbox.compare.b=e.target.value;save();renderCompare();bindPortalDynamic(scope)}};
 const dbSearch=scope.querySelector("#databaseSearch");if(dbSearch)dbSearch.oninput=e=>{const q=e.target.value.trim().toLocaleLowerCase("pt-BR");let visible=0;scope.querySelectorAll(".dbEntry").forEach(card=>{const ok=!q||(card.dataset.db+" "+card.textContent).toLocaleLowerCase("pt-BR").includes(q);card.classList.toggle("hidden",!ok);if(ok)visible++});const status=scope.querySelector("#databaseSearchStatus");if(status)status.textContent=q?`${visible} referência${visible===1?"":"s"}`:""};
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
const VIEW_RENDERERS={
 today:renderDaily,
 weekly:renderWeekly,
 characters:renderCharacters,
 week1:renderWeek1,
 resources:renderResources,
 classes:renderClasses,
 builder:renderBuilder,
 calculator:renderCalculator,
 compare:renderCompare,
 notes:renderNotes
};
function renderActiveView(view=activeView){
 const renderer=VIEW_RENDERERS[view];
 if(renderer)renderer();
 bindDynamic(view);
}
function renderAll(){
 renderHeader();
 renderProgress();
 renderActiveView(activeView);
}

function bindDynamic(view=activeView){
 const scope=document.getElementById(view);
 if(!scope)return;

 if(view==="bible"){
  const bibleSearch=scope.querySelector("#bibleSearch");
  if(bibleSearch){
   bibleSearch.oninput=e=>{
    const q=e.target.value.trim().toLocaleLowerCase("pt-BR");
    let visible=0;
    scope.querySelectorAll(".bibleChapter").forEach(ch=>{
     const match=!q||ch.textContent.toLocaleLowerCase("pt-BR").includes(q);
     ch.classList.toggle("bibleHidden",!match);
     if(match)visible++;
    });
    const status=scope.querySelector("#bibleSearchStatus");
    if(status)status.textContent=q?`${visible} capítulo${visible===1?"":"s"} encontrado${visible===1?"":"s"}`:"12 capítulos";
   };
  }
 }

 if(view==="notes"){
  const notes=scope.querySelector("#personalNotes");
  if(notes){
   notes.oninput=e=>{
    if(readonly)return;
    state.notes=e.target.value.slice(0,12000);
    const count=scope.querySelector("#notesCount");
    const status=scope.querySelector("#notesStatus");
    if(count)count.textContent=String(state.notes.length);
    if(status)status.textContent=cloudSession?"Salvando…":"Aguardando…";
    clearTimeout(notes._saveTimer);
    clearTimeout(notes._savedTimer);
    notes._saveTimer=setTimeout(()=>save(),300);
    notes._savedTimer=setTimeout(()=>{
     if(status)status.textContent=cloudSession?"Salvamento automático ativo · nuvem conectada.":"Salvamento automático ativo · somente neste navegador.";
    },900);
   };
   notes.onblur=()=>{
    if(readonly)return;
    clearTimeout(notes._saveTimer);
    save();
   };
  }
 }

 scope.querySelectorAll(".chk").forEach(el=>el.onchange=e=>{
  if(readonly)return;
  state[e.target.dataset.scope][e.target.dataset.id]=e.target.checked;
  save();renderHeader();renderProgress();renderActiveView(view);
 });
 scope.querySelectorAll("[data-count]").forEach(btn=>btn.onclick=()=>{
  if(readonly)return;
  const k=btn.dataset.count,max=k==="dailyDungeon"?state.dailyDungeonCap:k==="pveCommands"?12:k==="pvpCommands"?20:shugoMax();
  state.weeklyCounts[k]=Math.max(0,Math.min(max,(state.weeklyCounts[k]||0)+Number(btn.dataset.dir)));
  save();renderHeader();renderProgress();renderActiveView(view);
 });
 scope.querySelectorAll(".charInput").forEach(inp=>inp.onchange=()=>{
  if(readonly)return;
  const c=state.characters.find(c=>c.id===inp.dataset.char);if(!c)return;
  let value=Number(inp.value);if(!Number.isFinite(value))value=0;
  const min=inp.min!==""?Number(inp.min):0,max=inp.max!==""?Number(inp.max):Infinity;
  c[inp.dataset.field]=Math.max(min,Math.min(max,value));
  save();renderHeader();renderProgress();renderActiveView(view);
 });
 scope.querySelectorAll("[data-char-count]").forEach(btn=>btn.onclick=()=>{
  if(readonly)return;
  const c=state.characters.find(c=>c.id===btn.dataset.charCount);if(!c)return;
  c[btn.dataset.field]=Math.max(0,Math.min(3,(c[btn.dataset.field]||0)+Number(btn.dataset.dir)));
  save();renderHeader();renderProgress();renderActiveView(view);
 });
 scope.querySelectorAll("[data-remove-char]").forEach(btn=>btn.onclick=()=>{
  if(readonly)return;
  state.characters=state.characters.filter(c=>c.id!==btn.dataset.removeChar);
  save();renderHeader();renderProgress();renderActiveView(view);
 });
 bindPortalDynamic(scope);
}

const VIEW_TITLES={
 today:"Painel da conta",weekly:"Ciclo semanal",characters:"Personagens",week1:"Guia da conta",resources:"Recursos & entradas",
 classes:"Classes",builder:"Builder",calculator:"Calculadora",compare:"Comparar builds",database:"Database",
 bible:"Bíblia do Aion 2",guides:"Guias",tips:"Dicas gerais",notes:"Anotações pessoais"
};
function setView(view){
 const target=document.getElementById(view);
 if(!target)return;
 activeView=view;
 document.querySelectorAll("#nav button[data-view]").forEach(x=>x.classList.toggle("active",x.dataset.view===view));
 document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
 target.classList.remove("hidden");
 const title=document.getElementById("viewTitle");
 if(title)title.textContent=VIEW_TITLES[view]||"AION 2 Control Center";
 renderActiveView(view);
 document.body.classList.remove("sidebarOpen");
 if(window.innerWidth<980)window.scrollTo({top:0,behavior:"smooth"});
}
document.getElementById("nav").addEventListener("click",e=>{
 const b=e.target.closest("button[data-view]");if(!b)return;
 setView(b.dataset.view);
});
document.querySelectorAll("[data-go-view]").forEach(el=>el.addEventListener("click",()=>setView(el.dataset.goView)));
const menuBtn=document.getElementById("menuBtn");
const sidebarBackdrop=document.getElementById("sidebarBackdrop");
if(menuBtn)menuBtn.addEventListener("click",()=>document.body.classList.toggle("sidebarOpen"));
if(sidebarBackdrop)sidebarBackdrop.addEventListener("click",()=>document.body.classList.remove("sidebarOpen"));
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.body.classList.remove("sidebarOpen")});
document.getElementById("planModeSelect").onchange=e=>{if(readonly)return;state.planView=e.target.value;save();renderWeek1()};
document.getElementById("strategySelect").onchange=e=>{if(readonly)return;state.strategy=e.target.value;save();renderWeek1()};
document.getElementById("addCharBtn").onclick=()=>{
 if(readonly)return;
 const name=prompt("Nome do personagem:");if(!name)return;
 state.characters.push({id:"c"+Date.now(),name:name.trim().slice(0,28)||"Alt",role:"alt",level:1,power:0,odyle:0,nightmare:0,ascension:0,battleground:0});save();renderProgress();renderActiveView(activeView);
};
document.getElementById("resetWeeklyBtn").onclick=()=>{
 if(readonly)return;if(!confirm("Limpar progresso semanal?"))return;
 state.weekly={};state.weeklyCounts={dailyDungeon:0,pveCommands:0,pvpCommands:0,shugo:0};state.characters.forEach(c=>{c.ascension=0;c.battleground=0});state.meta.weeklyKey=weeklyKey();save();renderProgress();renderActiveView(activeView);
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
 state=normalizeState(state);
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
 out.toolbox=deepClone(DEFAULT.toolbox);
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
let privateNotesBeforeShare=null,privateToolboxBeforeShare=null;
document.getElementById("importCodeBtn").onclick=()=>{
 try{
  privateNotesBeforeShare=state.notes||"";
  privateToolboxBeforeShare=deepClone(state.toolbox||DEFAULT.toolbox);
  state=normalizeState(decodeShare(document.getElementById("importCodeArea").value));readonly=true;state.sharedView=true;closeModal("shareModal");renderAll();
 }catch(e){alert("Código inválido.");}
};
document.getElementById("adoptShare").onclick=()=>{
 readonly=false;state=normalizeState(state);state.sharedView=false;
 if(privateNotesBeforeShare!==null)state.notes=privateNotesBeforeShare;
 if(privateToolboxBeforeShare!==null)state.toolbox=deepClone(privateToolboxBeforeShare);
 privateNotesBeforeShare=null;privateToolboxBeforeShare=null;
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
   assetText("styles.css?v=2.0.3"),
   assetText("storage.js?v=2.0.3"),
   assetText("auth.js?v=2.0.3"),
   assetText("app.js?v=2.0.3")
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
  privateToolboxBeforeShare=deepClone(state.toolbox||DEFAULT.toolbox);
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
window.addEventListener("pagehide",()=>{if(!readonly)persistLocal(false)});
setInterval(updateCountdown,1000);updateCountdown();renderAll();
