import {mkdir,readFile,rename,writeFile,lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {TabLabels,TerminalTab} from './terminal-adapters.js';
import {terminalId} from './terminal-adapters.js';
export interface NumberedTarget {terminalId:string;index:number}
interface Owned {tabId:string;terminalId:string;original:string|null;applied:string;previous:string;previousOwned?:boolean}
export const sessionNumber=(index:number)=>index>=1&&index<=20?String.fromCodePoint(0x245f+index):`[${index}]`;
const safe=(s:string)=>s.replace(/[\x00-\x1f\x7f-\x9f]/g,'');
// The write-ahead journal makes a killed daemon recoverable. Only titles still
// matching our exact last write are restored; user edits always take precedence.
export class SessionVisuals {
 #labels=false;#overlay=false;#owned:Owned[]=[];#chain:Promise<unknown>=Promise.resolve();#updating=false;
 #error:string|null=null;
 constructor(private readonly path:string,private readonly adapter:TabLabels,
   private readonly show:(text:string)=>Promise<void>=async()=>{},private readonly hide:()=>void=()=>{}){}
 async load() {
  try {
   const stat=await lstat(this.path);if(!stat.isFile()||stat.size>1024*1024)throw Error('Invalid visual settings');
   const data=JSON.parse(await readFile(this.path,'utf8'));
   this.#labels=data.labels===true;this.#overlay=data.overlay===true;
   if(Array.isArray(data.owned))this.#owned=data.owned.filter((r:Owned)=>r&&typeof r.tabId==='string'
    &&terminalId(r.terminalId)&&(r.original===null||typeof r.original==='string')
    &&typeof r.applied==='string'&&typeof r.previous==='string').slice(0,128);
  } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')this.#error='Cannot read visual settings';}
 }
 status(){return {labels:this.#labels,overlay:this.#overlay,labeledTabs:this.#owned.length,error:this.#error};}
 #serial<T>(fn:()=>Promise<T>):Promise<T> {const p=this.#chain.catch(()=>{}).then(fn);this.#chain=p;return p;}
 async #save(){await mkdir(dirname(this.path),{recursive:true,mode:0o700});
  await writeFile(this.path+'.tmp',JSON.stringify({labels:this.#labels,overlay:this.#overlay,owned:this.#owned}),{mode:0o600});
  await rename(this.path+'.tmp',this.path);}
 async configure(kind:'labels'|'overlay',enabled:boolean) {
  return this.#serial(async()=>{
   if(kind==='labels')this.#labels=enabled;else{this.#overlay=enabled;if(!enabled)this.hide();}
   await this.#save();if(!this.#labels)await this.#reconcile([]);return this.status();
  });
 }
 async activated(index:number,title:string) {
  if(!this.#overlay||!Number.isInteger(index)||index<1||index>99)return;
  try{await this.show(`Opened ${sessionNumber(index)} — ${safe(title).slice(0,160)||'Session'}`);}
  catch{this.#error='Activation succeeded, but the optional overlay is unavailable';}
 }
 async reconcile(targets:NumberedTarget[],valid:()=>boolean=()=>true) {
  if(this.#updating)return;this.#updating=true;
  try{await this.#serial(()=>this.#reconcile(this.#labels&&valid()?targets:[]));}
  catch(e){this.#error=e instanceof Error?e.message:String(e);}
  finally{this.#updating=false;}
 }
 async restore(){await this.#serial(()=>this.#reconcile([]));this.hide();}
 async #reconcile(targets:NumberedTarget[]) {
  if(!targets.length&&!this.#owned.length)return;
  const tabs=await this.adapter.tabs();
  const desired=new Map<string,{tab:TerminalTab;target:NumberedTarget}>();
  for(const target of targets) {
   if(!Number.isInteger(target.index)||target.index<1||target.index>99)continue;
   const tab=tabs.find(t=>t.terminals.length===1&&t.terminals[0]?.id===target.terminalId);
   if(tab&&targets.filter(t=>t.terminalId===target.terminalId).length===1)desired.set(tab.id,{tab,target});
  }
  for(const owned of [...this.#owned]) {
   const tab=tabs.find(t=>t.id===owned.tabId&&t.terminals.some(t=>t.id===owned.terminalId));
   if(!tab){this.#owned=this.#owned.filter(o=>o!==owned);continue;}
   if(desired.has(owned.tabId))continue;
   if(tab.title===owned.applied || owned.previousOwned&&tab.title===owned.previous) {
    // A split added since labeling is not a safe single-surface target. Keep the
    // journal for later cleanup rather than guessing which split owns the title.
    if(tab.terminals.length!==1)continue;
    if(!await this.adapter.setTabTitle(tab,owned.terminalId,owned.original??''))continue;
   }
   this.#owned=this.#owned.filter(o=>o!==owned);
  }
  await this.#save();
  for(const {tab,target} of desired.values()) {
   const surface=tab.terminals[0]!;
   if(surface.title.startsWith('Agent-Buddy-link-'))continue; // Never retain a pairing probe.
   let owned=this.#owned.find(o=>o.tabId===tab.id);
   if(owned && owned.terminalId!==surface.id)continue;
   if(owned && tab.title!==owned.applied && !(owned.previousOwned&&tab.title===owned.previous)) {
    // The user renamed/reset this tab. Preserve their new choice as the base.
    owned.original=tab.title===surface.title?null:tab.title;
   }
   const existing=!!owned;
   if(!owned) {
    owned={tabId:tab.id,terminalId:surface.id,original:tab.title===surface.title?null:tab.title,
     applied:tab.title,previous:tab.title};this.#owned.push(owned);
   }
   const base=owned.original??surface.title;
   if(!base || safe(base)!==base || base.length>8000)continue;
   const title=sessionNumber(target.index)+' '+base;
   if(tab.title===title)continue;
   owned.previousOwned=existing&&(tab.title===owned.applied||!!owned.previousOwned&&tab.title===owned.previous);
   owned.previous=tab.title;owned.applied=title;await this.#save();
   await this.adapter.setTabTitle(tab,surface.id,title);
  }
  this.#error=null;await this.#save();
 }
}
