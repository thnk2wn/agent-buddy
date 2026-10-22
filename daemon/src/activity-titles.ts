import {homedir} from 'node:os';
import {sessionMetadata} from './live-captions.js';
import {TranscriptTitles} from './transcript-titles.js';
import type {HookPayload} from './protocol.js';

interface Title {title:string;project:string}
// Reuses the device's explicit-title resolver. No prompt-derived labels or transcript persistence.
export class ActivityTitles {
  #hints = new Map<string,HookPayload>();
  #cache = new Map<string,{at:number;value:Title}>();
  #reader = new TranscriptTitles();
  #pending: Promise<void> | undefined;
  constructor(readonly home=homedir(),readonly env:NodeJS.ProcessEnv=process.env,readonly now=Date.now) {}
  observe(payload:HookPayload) {
    const id=payload.sessionId ?? payload.session_id;
    if(typeof id!=='string')return;
    const safe:HookPayload={...this.#hints.get(id)};
    for(const key of ['cwd','transcript_path','projectName','project_name','sessionTitle','session_title','threadTitle','thread_title'])
      if(typeof payload[key]==='string')safe[key]=payload[key].slice(0,4096);
    if(JSON.stringify(safe)!==JSON.stringify(this.#hints.get(id)))this.#cache.delete(id);
    this.#hints.delete(id);this.#hints.set(id,safe);
    while(this.#hints.size>256)this.#hints.delete(this.#hints.keys().next().value!);
  }
  async resolve(ids:string[]):Promise<Record<string,Title>> {
    const unique=[...new Set(ids)].slice(0,256);
    // Coalesce UI polling; at most eight metadata reads per batch, with a fifteen-second cache.
    if(!this.#pending) {
      const due=unique.filter(id=>this.now()-(this.#cache.get(id)?.at ?? -Infinity)>=15000).slice(0,8);
      this.#pending=Promise.all(due.map(async full=>{
        const hint=this.#hints.get(full);
        const colon=full.indexOf(':'),agent=full.slice(0,colon),id=full.slice(colon+1);
        let value:Title=this.#cache.get(full)?.value ?? {title:'',project:''};
        try {
          if(colon>0 && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
            const payload={...hint};
            value=await sessionMetadata(agent,id,payload,this.home,this.env,this.#reader);
          }
        }catch { /* Missing or locked metadata does not break the inspector. */ }
        if(this.#hints.get(full)===hint)this.#cache.set(full,{at:this.now(),value});
      })).then(()=>{}).finally(()=>{this.#pending=undefined;});
    }
    await this.#pending;
    for(const id of this.#cache.keys())if(!unique.includes(id))this.#cache.delete(id);
    return Object.fromEntries(unique.map(id=>[id,this.#cache.get(id)?.value ?? {title:'',project:''}]));
  }
}
