import {isFocusAction,type FocusAction} from './session-focus.js';
interface Input {sequence:number;index:number;revision:number;activate:boolean}
// Firmware retains a bounded chronological queue. Baseline on connect/reboot;
// afterwards preserve gesture order and consume each event at most once.
export class SessionInputTracker {
  #boot=-1;#sequence=0;
  read(boot:number,raw:unknown,reconnected=false):FocusAction[] {
    if(!Number.isInteger(boot)||boot<0||!Array.isArray(raw)||raw.length>8)return [];
    if(raw.some(v=>!v||typeof v!=='object'||!Number.isInteger(v.sequence)||v.sequence<1||v.sequence>0xffffffff||!isFocusAction(v)))return [];
    const inputs=raw as Input[];const latest=inputs.at(-1)?.sequence??0;
    if(this.#boot!==boot||reconnected){this.#boot=boot;this.#sequence=latest;return [];}
    const fresh=inputs.filter(v=>{const distance=(v.sequence-this.#sequence)>>>0;return distance>0&&distance<0x80000000;});
    if(new Set(fresh.map(v=>v.sequence)).size!==fresh.length)return [];
    fresh.sort((a,b)=>((a.sequence-this.#sequence)>>>0)-((b.sequence-this.#sequence)>>>0));
    if(fresh.length)this.#sequence=fresh.at(-1)!.sequence;
    return fresh.map(({index,revision,activate})=>({index,revision,...(activate?{activate:true}:{})}));
  }
}
