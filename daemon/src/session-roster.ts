import {DatabaseSync} from 'node:sqlite';
import {lstat, readFile, readdir, mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {codexHome} from './agents/homes.js';
import {liveClaudeSessions, type LiveLaunchSession} from './session-launch.js';

export interface BrowsableSession {id:string;cwd:string}
const codexId=(id:string)=>/^codex:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);

// Desktop chats have no per-chat OS process. Keep chats observed through hooks,
// not the entire saved history; explicit end/archive removes them from this roster.
export async function desktopSessions(ids:readonly string[],home:string,env:NodeJS.ProcessEnv):Promise<BrowsableSession[]> {
 const root=codexHome(home,env);
 const databases=(await readdir(root).catch(()=>[])).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
 for(const file of databases) {
  let db:DatabaseSync|undefined;
  try {
   db=new DatabaseSync(join(root,file),{readOnly:true});
   const query=db.prepare('SELECT cwd, originator, archived FROM threads WHERE id = ?');
   return ids.filter(codexId).flatMap(id=>{
    const row=query.get(id.slice(6));
    return row && row.archived===0 && row.originator==='Codex Desktop' && typeof row.cwd==='string' ? [{id,cwd:row.cwd}] : [];
   });
  } catch { /* Older schemas cannot establish desktop ownership; do not guess. */ }
  finally {db?.close();}
 }
 return [];
}

export class SessionRoster {
 #desktop=new Set<string>();
 #save=Promise.resolve();
 constructor(private readonly path:string,private readonly claude:()=>Promise<LiveLaunchSession[]>,
  private readonly desktop:(ids:readonly string[])=>Promise<BrowsableSession[]>) {}
 async load(seed:readonly string[]=[]):Promise<void> {
  try {
   const info=await lstat(this.path);
   if(info.isFile()&&info.size<32768) {
    const ids:unknown=JSON.parse(await readFile(this.path,'utf8'));
    if(Array.isArray(ids))for(const id of ids.slice(0,64))if(typeof id==='string'&&codexId(id))this.#desktop.add(id);
   }
  } catch { /* New or invalid roster starts from observed sessions only. */ }
  for(const id of seed)this.observe(id);
  await this.flush();
 }
 observe(id:string,ended=false):void {
  if(!codexId(id))return;
  const changed=ended?this.#desktop.delete(id):!this.#desktop.has(id);
  if(!changed)return;
  if(!ended)this.#desktop.add(id);
  if(this.#desktop.size>64)this.#desktop.delete(this.#desktop.values().next().value!);
  const json=JSON.stringify([...this.#desktop]);
  this.#save=this.#save.catch(()=>{}).then(async()=>{
   await mkdir(dirname(this.path),{recursive:true,mode:0o700});
   await writeFile(this.path+'.tmp',json,{mode:0o600});await rename(this.path+'.tmp',this.path);
  });
  void this.#save.catch(()=>{});
 }
 async flush():Promise<void> {await this.#save;}
 async refresh():Promise<BrowsableSession[]> {
  const [claude,desktop]=await Promise.all([this.claude(),this.desktop([...this.#desktop])]);
  // A sessionEnd that arrives during I/O must not be undone by the completed read.
  return [...claude,...desktop.filter(s=>this.#desktop.has(s.id))]
   .filter((s,i,a)=>a.findIndex(other=>other.id===s.id)===i)
   .map(({id,cwd})=>({id,cwd}));
 }
}
export function localSessionRoster(path:string,home:string,env:NodeJS.ProcessEnv):SessionRoster {
 return new SessionRoster(path,()=>liveClaudeSessions(home,env),ids=>desktopSessions(ids,home,env));
}
