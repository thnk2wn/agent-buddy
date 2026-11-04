import {characterStates, type CharacterState} from './protocol.js';
export interface CompactTarget {index:number;agent:string;state:'i'|'w'|'a'|'c'}
export interface DesktopHint {index:number;state:'c'|'o'|'u';tick:number;observedAt?:number}
export interface CompactCaption {desktop?:DesktopHint;pinned?:boolean;revision?:number;targets?:CompactTarget[];agent:string; state:CharacterState; index:number; count:number; project:string; title:string}
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
    if(targets.some(t=>!Number.isInteger(t.index)||t.index<1||t.index>caption.count||!['i','w','a','c'].includes(t.state)||!(/^[a-z0-9-]{1,16}$/).test(t.agent))
      ||new Set(targets.map(t=>t.index)).size!==targets.length)return '~\n';
    extra='|'+caption.revision+'|'+targets.map(t=>`${t.index}:${t.agent}:${t.state==='c'&&protocol<16?'i':t.state}`).join(',');
    if(protocol>=16)extra+='|'+(caption.pinned?'1':'0');
    if(protocol>=18&&caption.desktop) {
      const source=caption.desktop;
      const expired=source.observedAt!==undefined&&(Date.now()<source.observedAt||Date.now()-source.observedAt>=3500);
      const d=expired?{...source,index:0,state:'u' as const}:source;
      if(!Number.isInteger(d.index)||d.index<0||d.index>caption.count||!['c','o','u'].includes(d.state)
        ||!Number.isInteger(d.tick)||d.tick<1||d.tick>0xffffffff
        ||d.state==='c'&&d.index!==caption.index||d.state==='o'&&d.index===caption.index)return '~\n';
      extra+=`|${d.index}:${d.state}:${d.tick}`;
    }
  }
  return '~'+[text(caption.agent,16)||'Agent',caption.state,caption.index,caption.count,
    text(caption.project,64),text(caption.title,256)||'Untitled session'].join('|')+extra+'\n';
}
