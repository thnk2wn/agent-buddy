import {readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {claudeHome} from './agents/homes.js';
import type {HookPayload} from './protocol.js';

// Restored sessions have no hook metadata yet. Discover only the requested session,
// using the live registry for its project and exact transcript filenames otherwise.
export async function claudeSessionSource(id:string,payload:HookPayload,home:string,env:NodeJS.ProcessEnv):Promise<HookPayload> {
 const source={...payload};
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))return source;
 if(!source.cwd) {
  const registry=join(claudeHome(home,env),'sessions');
  for(const file of (await readdir(registry).catch(()=>[])).filter(n=>/^\d+\.json$/.test(n)).slice(0,256)) {
   const path=join(registry,file);
   if(((await stat(path).catch(()=>null))?.size ?? Infinity)>16384)continue;
   try {
    const row=JSON.parse(await readFile(path,'utf8'));
    if(row.sessionId===id && typeof row.cwd==='string'){source.cwd=row.cwd.slice(0,4096);break;}
   }catch { /* A session can exit while its registry entry is read. */ }
  }
 }
 if(!source.transcript_path && !source.cwd) {
  const root=join(claudeHome(home,env),'projects');
  const dirs=(await readdir(root,{withFileTypes:true}).catch(()=>[])).filter(d=>d.isDirectory()).slice(0,1024);
  const paths:string[]=[];
  for(let i=0;i<dirs.length;i+=32) {
   const found=await Promise.all(dirs.slice(i,i+32).map(async d=>{
    const file=join(root,d.name,id+'.jsonl');return (await stat(file).catch(()=>null))?.isFile()?file:'';
   }));
   paths.push(...found.filter(Boolean));
  }
  if(paths.length===1)source.transcript_path=paths[0];
 }
 // The caller verifies realpath containment and exact session filename before reading.
 return source;
}
