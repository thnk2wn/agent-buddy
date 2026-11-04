import {isFocusAction,type FocusAction} from './session-focus.js';
interface Input {sequence:number;index:number;revision:number;activate:boolean;pin?:boolean}
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
    return fresh.map(({sequence,index,revision,activate,pin})=>({index,revision,boot,sequence,...(activate?{activate:true}:{}),...(pin?{pin:true}:{})}));
  }
}

// A physical input is exposed through USB immediately and Wi-Fi's retained queue
// later. Keep receipts across route changes so a toggle can only run once.
export class SessionInputReceipts {
  #seen=new Set<string>();
  accept(action:FocusAction):boolean {
    if(typeof action==='string'||action.boot===undefined||action.sequence===undefined)return true;
    const key=`${action.boot}:${action.sequence}`;
    if(this.#seen.has(key))return false;
    this.#seen.add(key);
    if(this.#seen.size>128)this.#seen.delete(this.#seen.values().next().value!);
    return true;
  }
}
