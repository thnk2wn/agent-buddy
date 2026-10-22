import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat, mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {claudeHome} from './agents/homes.js';
import type {TerminalAdapter} from './terminal-adapters.js';
import {terminalId} from './terminal-adapters.js';

const exec = promisify(execFile);
export interface LiveLaunchSession {id: string; pid: number; identity: string; cwd: string}
interface Pairing {sessionId: string; pid: number; identity: string; adapter: string; terminalId: string; source?: 'manual' | 'title-probe'}
export type LaunchCommand = {action: 'status' | 'list' | 'enable' | 'disable' | 'pair' | 'unpair' | 'open' | 'auto-enable' | 'auto-disable' | 'discover';
  sessionId?: string; terminalId?: string; adapter?: string};
const sessionId = (id: unknown): id is string => typeof id === 'string' && /^claude:[a-zA-Z0-9_-]{1,128}$/.test(id);

// The registry supplies a PID, not a title-based guess. Process birth time prevents stale
// saved pairings from targeting a new process that happens to reuse the same PID.
export async function liveClaudeSessions(home: string, env: NodeJS.ProcessEnv): Promise<LiveLaunchSession[]> {
  if (process.platform !== 'darwin') return [];
  const directory = join(claudeHome(home,env),'sessions');
  const files = (await readdir(directory).catch(()=>[])).filter(f=>/^\d+\.json$/.test(f)).slice(0,256);
  const found: LiveLaunchSession[] = [];
  for (const file of files) {
    try {
      const path = join(directory,file), info = await lstat(path);
      if (!info.isFile() || info.size > 16384) continue;
      const row = JSON.parse(await readFile(path,'utf8'));
      if (!Number.isSafeInteger(row.pid) || row.pid <= 0 || file !== `${row.pid}.json`
          || typeof row.sessionId !== 'string' || !sessionId('claude:'+row.sessionId) || typeof row.cwd !== 'string') continue;
      const result = await exec('/bin/ps',['-p',String(row.pid),'-o','uid=,lstart=,comm='], {timeout:1000,maxBuffer:4096});
      const match = result.stdout.trim().match(/^(\d+)\s+(.+?)\s+(?:\S*\/)?claude$/);
      if (!match || Number(match[1]) !== process.getuid?.()) continue;
      found.push({id:'claude:'+row.sessionId,pid:row.pid,identity:match[2]!,cwd:row.cwd.slice(0,4096)});
    } catch { /* Closed, stale or unreadable sessions are unavailable. */ }
  }
  // Duplicate registry IDs are ambiguous, even if their processes are both alive.
  return found.filter(s=>found.filter(other=>other.id===s.id).length===1);
}

export class SessionLauncher {
  #enabled = false;
  #desktopSessions = new Set<string>();
  setDesktopSessions(ids:readonly string[]):void {
    this.#desktopSessions=new Set(ids.filter(id=>/^codex:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)));
  }
  #automatic = false;
  #registration: {ok:boolean;message:string;at:number} | null = null;
  #attempted = new Map<string,number>();
  #pending = new Set<string>();
  #registering = false;
  #draining = false;
  #pairs = new Map<string,Pairing>();
  #busy = false;
  #pendingActivation: string | null = null;
  #activating = false;
  #last: {ok: boolean; message: string; at: number} | null = null;
  #revision = 0;
  #save: Promise<void> = Promise.resolve();
  constructor(private readonly path: string, private readonly sessions: ()=>Promise<LiveLaunchSession[]>,
    private readonly adapters: TerminalAdapter[], private readonly supported = process.platform === 'darwin',
    private readonly discover?: (session:LiveLaunchSession)=>Promise<string>,
    private readonly openDesktop: (id:string)=>Promise<void> = async id=>{
      await exec('/usr/bin/open',['-b','com.openai.codex','codex://threads/'+id.slice(6)],{timeout:5000});
    }) {}
  async load(): Promise<void> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.size > 65536) return;
      const value = JSON.parse(await readFile(this.path,'utf8'));
      if (!Array.isArray(value.pairings)) return;
      for (const p of value.pairings.slice(0,128)) {
        if (p && sessionId(p.sessionId) && Number.isSafeInteger(p.pid) && p.pid > 0
            && typeof p.identity === 'string' && p.identity.length <= 128
            && terminalId(p.terminalId) && this.adapters.some(a=>a.id===p.adapter)) this.#pairs.set(p.sessionId,p);
      }
      this.#enabled = this.supported && value.enabled === true;
      this.#automatic = this.supported && value.automatic === true;
    } catch { /* Off by default, including corrupt/missing configuration. */ }
  }
  status() {return {enabled:this.#enabled,automatic:this.#automatic,registration:this.#registration,supported:this.supported,pairings:[...this.#pairs.values()],last:this.#last};}
  async #persist(): Promise<void> {
    const json = JSON.stringify({enabled:this.#enabled,automatic:this.#automatic,pairings:[...this.#pairs.values()]},null,2)+'\n';
    this.#save = this.#save.catch(()=>{}).then(async()=>{
      await mkdir(dirname(this.path),{recursive:true,mode:0o700});
      await writeFile(this.path+'.tmp',json,{mode:0o600});
      await rename(this.path+'.tmp',this.path);
    });
    await this.#save;
  }
  async command(request: LaunchCommand) {
    if (request.action === 'status') return this.status();
    if (request.action === 'disable') {this.#enabled=false;this.#pendingActivation=null;this.#revision++;await this.#persist();return this.status();}
    if (!this.supported) throw Error('Session launching is experimental and currently supports macOS only');
    if (request.action === 'auto-enable' || request.action === 'auto-disable') {
      this.#automatic=request.action==='auto-enable';this.#revision++;await this.#persist();return this.status();
    }
    if (request.action === 'enable') {this.#enabled=true;await this.#persist();return this.status();}
    if (request.action === 'list') return {...this.status(),sessions:await this.sessions(),
      terminals:await Promise.all(this.adapters.map(async a=>({adapter:a.id,terminals:await a.list()})))};
    if (request.action === 'open' && typeof request.sessionId==='string') {await this.open(request.sessionId);return this.status();}
    if (!sessionId(request.sessionId)) throw Error('Choose a live Claude session');
    if (request.action === 'discover') {await this.register(request.sessionId);return this.status();}
    if (request.action === 'unpair') {this.#pairs.delete(request.sessionId);this.#revision++;await this.#persist();return this.status();}
    if (request.action !== 'pair') throw Error('Unknown session-launch action');
    const adapter = this.adapters.find(a=>a.id===request.adapter);
    const session = (await this.sessions()).find(s=>s.id===request.sessionId);
    if (!adapter || !session) throw Error('Session or terminal adapter is unavailable');
    if (!terminalId(request.terminalId) || !(await adapter.list()).some(t=>t.id===request.terminalId))
      throw Error('Choose an existing Ghostty terminal');
    if (this.#pairs.size >= 128 && !this.#pairs.has(session.id)) throw Error('Remove an old pairing first');
    this.#pairs.set(session.id,{sessionId:session.id,pid:session.pid,identity:session.identity,
      adapter:adapter.id,terminalId:request.terminalId,source:'manual'});
    this.#revision++;await this.#persist();return this.status();
  }
  async register(id:string):Promise<void> {
    if (!this.#enabled || !this.#automatic || !this.discover) throw Error('Automatic terminal pairing is disabled');
    if (this.#registering) throw Error('Automatic registration is already running');
    this.#registering=true;
    const revision=this.#revision;
    try {
      const session=(await this.sessions()).find(s=>s.id===id);
      if (!session) throw Error('Claude process is not in the live registry yet');
      if (!this.#enabled || !this.#automatic || revision!==this.#revision) throw Error('Registration settings changed');
      const old=this.#pairs.get(id);
      // Established, live manual pairings always take precedence.
      if (old?.pid===session.pid && old.identity===session.identity) return;
      if(this.#pairs.size>=128 && !old)throw Error('Remove an old pairing first');
      const target=await this.discover(session);
      const live=(await this.sessions()).find(s=>s.id===id);
      if (!this.#enabled || !this.#automatic || revision!==this.#revision) throw Error('Registration settings changed');
      if (!live || live.pid!==session.pid || live.identity!==session.identity) throw Error('Claude process changed during discovery');
      if (!terminalId(target)) throw Error('Invalid discovered terminal');
      if(this.#pairs.size>=128 && !old)throw Error('Remove an old pairing first');
      this.#pairs.set(id,{sessionId:id,pid:session.pid,identity:session.identity,adapter:'ghostty',terminalId:target,source:'title-probe'});
      await this.#persist();
      this.#registration={ok:true,message:'Automatically paired Claude with its Ghostty terminal',at:Date.now()};
    } catch(error) {
      this.#registration={ok:false,message:error instanceof Error?error.message:String(error),at:Date.now()};throw error;
    } finally {this.#registering=false;}
  }
  // Existing hooks are only a wake-up signal. They supply no terminal paths or script text.
  // The asynchronous work never holds the hook reply or changes agent state.
  observe(id:string):void {
    if(!this.#enabled || !this.#automatic || !sessionId(id) || this.#pending.has(id))return;
    if(this.#pending.size>=32 || (this.#attempted.get(id)??0)>Date.now()-60000)return;
    this.#attempted.set(id,Date.now());this.#pending.add(id);
    if(this.#attempted.size>256)this.#attempted.delete(this.#attempted.keys().next().value!);
    const run=async()=>{
      this.#draining=true;
      try {
        while(this.#pending.size) {
          const next=this.#pending.values().next().value!;this.#pending.delete(next);
          await this.register(next).catch(()=>{});
        }
      } finally {this.#draining=false;}
    };
    if(!this.#draining)void run();
  }
  async open(id: string): Promise<void> {
    if (!this.#enabled) throw Error('Session launching is disabled');
    if (this.#busy) throw Error('A terminal focus request is already in progress');
    if(this.#desktopSessions.has(id)) {
      this.#busy=true;
      try {await this.openDesktop(id);this.#last={ok:true,message:'Opened selected Codex chat',at:Date.now()};}
      catch(error){this.#last={ok:false,message:error instanceof Error?error.message:String(error),at:Date.now()};throw error;}
      finally{this.#busy=false;this.#drainActivation();}
      return;
    }
    const pair = this.#pairs.get(id), revision=this.#revision;
    if (!pair) throw Error('This session has no terminal pairing');
    this.#busy=true;
    try {
      const live = (await this.sessions()).find(s=>s.id===id);
      if (!live || live.pid!==pair.pid || live.identity!==pair.identity) throw Error('Paired Claude process has ended; pair its new session before opening');
      const adapter=this.adapters.find(a=>a.id===pair.adapter);
      if (!adapter) throw Error('Terminal adapter unavailable');
      if (!this.#enabled || revision!==this.#revision) throw Error('Session launching configuration changed');
      await adapter.focus(pair.terminalId);
      this.#last={ok:true,message:'Focused paired '+pair.adapter+' terminal',at:Date.now()};
    } catch(error) {
      this.#last={ok:false,message:error instanceof Error?error.message:String(error),at:Date.now()};throw error;
    } finally {this.#busy=false;this.#drainActivation();}
  }
  deviceActivated(id:string|null):void {
    if(!this.#enabled || !id)return;
    this.#pendingActivation=id;
    this.#drainActivation();
  }
  // Coalesce rapid taps while an OS focus request is in flight. The final tapped
  // session wins, with live identity/opt-in checks repeated when it is opened.
  #drainActivation():void {
    if(this.#activating || this.#busy || !this.#enabled || !this.#pendingActivation)return;
    this.#activating=true;
    void (async()=>{
      try {
        while(this.#enabled && this.#pendingActivation) {
          const id=this.#pendingActivation;this.#pendingActivation=null;
          await this.open(id).catch(error=>{
            this.#last={ok:false,message:error instanceof Error?error.message:String(error),at:Date.now()};
          });
        }
      } finally {this.#activating=false;}
    })();
  }
  // Legacy entry point. Only a physical, explicit pin action triggers this. Cycling and automatic rotation never do.
  devicePinned(id: string | null): void {
    if (this.#enabled && id && this.#pairs.has(id)) void this.open(id).catch(()=>{});
  }
}
