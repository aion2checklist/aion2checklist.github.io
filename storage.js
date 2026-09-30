// Estado, validação e cache local do AION 2 Checklist.
export function deepClone(value){
  return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value){
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function mergeState(base,incoming){
  if(!isPlainObject(incoming)) return deepClone(base);
  const out=deepClone(base);
  for(const [key,value] of Object.entries(incoming)){
    if(Array.isArray(value)) out[key]=deepClone(value);
    else if(isPlainObject(value)) out[key]=mergeState(isPlainObject(out[key])?out[key]:{},value);
    else out[key]=value;
  }
  return out;
}

export function clampNum(value,min,max,fallback=min){
  const number=Number(value);
  if(!Number.isFinite(number)) return fallback;
  return Math.max(min,Math.min(max,number));
}

export function createStateNormalizer(defaultState){
  return function normalizeState(incoming){
    const x=mergeState(defaultState,isPlainObject(incoming)?incoming:{});
    x.version=Number.isFinite(Number(x.version))?Number(x.version):defaultState.version;
    x.profileName=String(x.profileName||defaultState.profileName).slice(0,60);
    x.faction=x.faction==="elyos"?"elyos":"asmodian";
    x.membership=!!x.membership;
    x.dailyDungeonCap=[7,14].includes(Number(x.dailyDungeonCap))?Number(x.dailyDungeonCap):defaultState.dailyDungeonCap;
    x.weeklyDay=clampNum(x.weeklyDay,0,6,defaultState.weeklyDay);
    x.dailyReset=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.dailyReset))?String(x.dailyReset):defaultState.dailyReset;
    x.weeklyReset=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.weeklyReset))?String(x.weeklyReset):defaultState.weeklyReset;
    x.daily=isPlainObject(x.daily)?x.daily:{};
    x.weekly=isPlainObject(x.weekly)?x.weekly:{};
    x.weeklyCounts=isPlainObject(x.weeklyCounts)?x.weeklyCounts:{};
    x.weeklyCounts.dailyDungeon=clampNum(x.weeklyCounts.dailyDungeon,0,x.dailyDungeonCap,0);
    x.weeklyCounts.pveCommands=clampNum(x.weeklyCounts.pveCommands,0,12,0);
    x.weeklyCounts.pvpCommands=clampNum(x.weeklyCounts.pvpCommands,0,20,0);
    x.weeklyCounts.shugo=clampNum(x.weeklyCounts.shugo,0,x.membership?14:7,0);
    x.meta=isPlainObject(x.meta)?x.meta:{};
    x.notes=String(x.notes||"").slice(0,12000);

    const classNames=["Templar","Gladiator","Assassin","Ranger","Sorcerer","Spiritmaster","Cleric","Chanter","Brawler"];
    const focusNames=["pve","pvp","hybrid"];
    const normalizeBuild=(incomingBuild)=>{
      const base=deepClone(defaultState.toolbox.builder);
      const b=mergeState(base,isPlainObject(incomingBuild)?incomingBuild:{});
      b.name=String(b.name||base.name).slice(0,48);
      b.className=classNames.includes(String(b.className))?String(b.className):base.className;
      b.focus=focusNames.includes(String(b.focus))?String(b.focus):base.focus;
      b.level=clampNum(b.level,1,99,1);
      b.stats=isPlainObject(b.stats)?b.stats:{};
      for(const key of Object.keys(base.stats)) b.stats[key]=clampNum(b.stats[key],0,99999999,0);
      b.deity=isPlainObject(b.deity)?b.deity:{};
      for(const key of Object.keys(base.deity)) b.deity[key]=clampNum(b.deity[key],0,200,0);
      b.skills=isPlainObject(b.skills)?b.skills:{};
      b.skills.primary=clampNum(b.skills.primary,0,40,0);
      b.skills.secondary=clampNum(b.skills.secondary,0,40,0);
      b.progression=isPlainObject(b.progression)?b.progression:{};
      b.progression.arcana=clampNum(b.progression.arcana,0,10,0);
      b.progression.daevanion=clampNum(b.progression.daevanion,0,9999,0);
      for(const key of ["cogni","fera","natura","varian","special"]) b.progression[key]=clampNum(b.progression[key],0,10,0);
      b.gear=isPlainObject(b.gear)?b.gear:{};
      for(const key of Object.keys(base.gear)) b.gear[key]=String(b.gear[key]||"").slice(0,90);
      return b;
    };

    x.toolbox=isPlainObject(x.toolbox)?x.toolbox:deepClone(defaultState.toolbox);
    x.toolbox.classFilter=["all","global","kr","tank","dps","support"].includes(String(x.toolbox.classFilter))?String(x.toolbox.classFilter):"all";
    x.toolbox.builder=normalizeBuild(x.toolbox.builder);
    x.toolbox.savedBuilds=(Array.isArray(x.toolbox.savedBuilds)?x.toolbox.savedBuilds:[]).slice(-12).filter(isPlainObject).map((item,index)=>({
      id:String(item.id||("build"+index)).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,60)||("build"+index),
      savedAt:String(item.savedAt||"").slice(0,40),
      build:normalizeBuild(item.build)
    }));
    x.toolbox.compare=isPlainObject(x.toolbox.compare)?x.toolbox.compare:{a:"",b:""};
    x.toolbox.compare.a=String(x.toolbox.compare.a||"").slice(0,60);
    x.toolbox.compare.b=String(x.toolbox.compare.b||"").slice(0,60);

    const calcBase=defaultState.toolbox.calculator;
    x.toolbox.calculator=mergeState(calcBase,isPlainObject(x.toolbox.calculator)?x.toolbox.calculator:{});
    const calc=x.toolbox.calculator;
    calc.main=isPlainObject(calc.main)?calc.main:{};
    for(const key of Object.keys(calcBase.main)) calc.main[key]=clampNum(calc.main[key],0,99999999,0);
    calc.deity=isPlainObject(calc.deity)?calc.deity:{};
    for(const key of Object.keys(calcBase.deity)) calc.deity[key]=clampNum(calc.deity[key],0,200,0);
    calc.piece=isPlainObject(calc.piece)?calc.piece:{};
    calc.piece.label=String(calc.piece.label||"Attack").slice(0,40);
    for(const key of ["total","current","next"]) calc.piece[key]=clampNum(calc.piece[key],-99999999,99999999,0);
    calc.context=isPlainObject(calc.context)?calc.context:{};
    for(const key of ["attack","pveAttack","pvpAttack","bossAttack","damage","pveDamage","pvpDamage","bossDamage"]) calc.context[key]=clampNum(calc.context[key],-99999999,99999999,0);
    calc.context.isBoss=!!calc.context.isBoss;

    const seen=new Set();
    const characters=Array.isArray(x.characters)?x.characters:[];
    x.characters=characters.filter(isPlainObject).map((character,index)=>{
      let id=String(character.id||("c"+index)).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,48)||("c"+index);
      while(seen.has(id)) id=id+"_"+index;
      seen.add(id);
      return {
        id,
        name:String(character.name||"Personagem").slice(0,28),
        role:character.role==="main"?"main":"alt",
        level:clampNum(character.level,1,99,1),
        power:clampNum(character.power,0,99999999,0),
        odyle:clampNum(character.odyle,0,x.membership?840:560,0),
        nightmare:clampNum(character.nightmare,0,14,0),
        ascension:clampNum(character.ascension,0,3,0),
        battleground:clampNum(character.battleground,0,3,0)
      };
    });

    if(!x.characters.length) x.characters=deepClone(defaultState.characters);
    if(!x.characters.some(character=>character.role==="main")) x.characters[0].role="main";
    return x;
  };
}

export function readLocal(key){
  try{
    return JSON.parse(localStorage.getItem(key)||"{}");
  }catch(error){
    console.warn("Falha ao ler cache local",error);
    return {};
  }
}

export function writeLocal(key,value){
  try{
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }catch(error){
    console.warn("Falha ao salvar cache local",error);
    return false;
  }
}

export function hasStoredState(value){
  return isPlainObject(value) && Object.keys(value).length>0;
}
