import {open,realpath} from 'node:fs/promises';
import {basename,join,sep} from 'node:path';
import {homedir} from 'node:os';
import {codexHome} from './agents/homes.js';
import type {HookPayload} from './protocol.js';

// Per-session policy only: the global setting can differ from the running chat.
// Transcript metadata is version-dependent. Missing/unrecognized policy stays unknown.
export async function usesAutomaticApproval(payload:HookPayload,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<boolean|undefined> {
 const id=String(payload.sessionId ?? payload.session_id ?? '').replace(/^codex:/,'');
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || typeof payload.transcript_path!=='string')return undefined;
 const root=await realpath(codexHome(home,env)).catch(()=>'');
 const path=await realpath(payload.transcript_path).catch(()=>'');
 if(!root || !path || !['sessions','archived_sessions'].some(dir=>path.startsWith(join(root,dir)+sep))
   || !(basename(path)===id+'.jsonl' || basename(path).endsWith('-'+id+'.jsonl')))return undefined;
 try {
  const f=await open(path,'r');let text='';
  try {
   const size=(await f.stat()).size,start=Math.max(0,size-4*1024*1024);
   const b=Buffer.alloc(size-start);const {bytesRead}=await f.read(b,0,b.length,start);
   text=b.subarray(0,bytesRead).toString('utf8');if(start)text=text.slice(text.indexOf('\n')+1);
  }finally{await f.close();}
  for(const line of text.split('\n').reverse()) {
   if(line.length>256*1024 || !/"type"\s*:\s*"turn_context"/.test(line))continue;
   try {
    const row=JSON.parse(line);if(row.type!=='turn_context')continue;
    const reviewer=row.payload?.approvals_reviewer;
    if(reviewer==='auto_review' || reviewer==='guardian_subagent')return true;
    if(reviewer==='user')return false;
    return undefined; // Never inherit an older turn's approval mode.
   }catch { /* An incomplete last write is not a complete context record. */ }
  }
 }catch { /* No transcript access must not break a hook. */ }
 return undefined;
}
