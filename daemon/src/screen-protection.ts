import {readFile} from 'node:fs/promises';
import type {CharacterState} from './protocol.js';
export interface ScreenProtectionConfig {
  enabled:boolean;dimAfterMinutes:number;offAfterMinutes:number;dimPercent:number;
  quietStartHour:number;quietEndHour:number;timeZone:string;wakeOnAttention:boolean;quietWakeSeconds:number;
}
export const defaultScreenProtection:ScreenProtectionConfig={enabled:true,dimAfterMinutes:15,offAfterMinutes:60,
  dimPercent:20,quietStartHour:0,quietEndHour:6,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
  wakeOnAttention:true,quietWakeSeconds:60};
export function screenProtectionConfig(value:unknown):ScreenProtectionConfig {
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Expected screen protection settings');
  const c={...defaultScreenProtection,...value} as ScreenProtectionConfig;
  for(const [key,min,max] of [['dimAfterMinutes',1,1440],['offAfterMinutes',1,1440],['dimPercent',1,100],
    ['quietStartHour',0,23],['quietEndHour',0,23],['quietWakeSeconds',5,600]] as const)
    if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw Error('Invalid '+key);
  if(c.offAfterMinutes<c.dimAfterMinutes||typeof c.enabled!=='boolean'||typeof c.wakeOnAttention!=='boolean')throw Error('Invalid screen protection settings');
  if(typeof c.timeZone!=='string')throw Error('Invalid timeZone');
  new Intl.DateTimeFormat('en-US',{timeZone:c.timeZone}).format();
  return c;
}
export async function loadScreenProtection(path:string):Promise<ScreenProtectionConfig> {
  try{return screenProtectionConfig(JSON.parse(await readFile(path,'utf8')));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('[screen] Invalid settings; using safe defaults.');return {...defaultScreenProtection};}
}
export function quietSeconds(c:ScreenProtectionConfig,now:Date):number {
  if(c.quietStartHour===c.quietEndHour)return 0;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:c.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(now);
  const n=(name:string)=>Number(parts.find(p=>p.type===name)!.value);
  const seconds=n('hour')*3600+n('minute')*60+n('second');
  const duration=(c.quietEndHour-c.quietStartHour+24)%24*3600;
  const elapsed=(seconds-c.quietStartHour*3600+86400)%86400;
  return elapsed<duration?duration-elapsed:0;
}
export function screenProtectionPacket(c:ScreenProtectionConfig,state:CharacterState,now=new Date()):string {
  const activity=state==='attention'?'a':state==='working'?'w':'i';
  return '>'+[Number(c.enabled),c.dimAfterMinutes*60,c.offAfterMinutes*60,c.dimPercent,quietSeconds(c,now),activity,
    Number(c.wakeOnAttention),c.quietWakeSeconds].join('|')+'\n';
}
