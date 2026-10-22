import {characterStates, type CharacterState} from './protocol.js';
export interface CompactTarget {index:number;agent:string;state:'i'|'w'|'a'}
export interface CompactCaption {revision?:number;targets?:CompactTarget[];agent:string; state:CharacterState; index:number; count:number; project:string; title:string}
const text=(value:string,limit:number)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^ -~]|\|/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
// Protocol 13 carries metadata independently of legacy caption pages and animation events.
export function compactPacket(caption:CompactCaption|null,protocol=14):string {
  if(!caption || !characterStates.includes(caption.state))return '~\n';
  if(!Number.isInteger(caption.index)||!Number.isInteger(caption.count)||caption.index<1||caption.count>99||caption.index>caption.count)
    return '~\n';
  let extra='';
  if(protocol>=14 && caption.targets?.length && Number.isInteger(caption.revision) && caption.revision!>0 && caption.revision!<=0xffffffff) {
    const targets=caption.targets.slice(0,4);
    if(targets.some(t=>!Number.isInteger(t.index)||t.index<1||t.index>caption.count||!['i','w','a'].includes(t.state)||!(/^[a-z0-9-]{1,16}$/).test(t.agent))
      ||new Set(targets.map(t=>t.index)).size!==targets.length)return '~\n';
    extra='|'+caption.revision+'|'+targets.map(t=>`${t.index}:${t.agent}:${t.state}`).join(',');
  }
  return '~'+[text(caption.agent,16)||'Agent',caption.state,caption.index,caption.count,
    text(caption.project,64),text(caption.title,256)||'Untitled session'].join('|')+extra+'\n';
}
