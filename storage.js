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
