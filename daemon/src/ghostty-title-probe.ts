import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {promisify} from 'node:util';
import type {LiveLaunchSession} from './session-launch.js';
import type {TerminalAdapter, TerminalTarget} from './terminal-adapters.js';
const exec=promisify(execFile);
const safeTitle=(s:string)=>s.replace(/[\x00-\x1f\x7f-\x9f]/g,'').slice(0,4096);
interface ProcessRow {pid:number;parent:number;uid:number;tty:string;identity:string;command:string}
async function processRow(pid:number):Promise<ProcessRow> {
 const {stdout}=await exec('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,uid=,tty=,lstart=,comm='],{timeout:1000,maxBuffer:8192});
 const m=stdout.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/);
 if(!m)throw Error('Process is no longer available');
 return {pid:+m[1]!,parent:+m[2]!,uid:+m[3]!,tty:m[4]!,identity:m[5]!.replace(/\s+/g,' '),command:m[6]!};
}
export async function directGhosttyTty(session:LiveLaunchSession):Promise<string> {
 let row=await processRow(session.pid);
 if(row.uid!==process.getuid?.() || row.identity!==session.identity.replace(/\s+/g,' ')
    || !/(^|\/)claude$/.test(row.command) || !/^ttys\d+$/.test(row.tty))throw Error('Claude terminal identity changed');
 const tty=row.tty;
 for(let i=0;i<12;i++) {
  if(/\/Ghostty\.app\/Contents\/MacOS\/ghostty$/.test(row.command) && row.uid===process.getuid?.())return '/dev/'+tty;
  // Direct local terminal sessions only. Do not probe tmux, screen, SSH or other hosts.
  if(i>0 && !/^[-]?(?:\/[^\s]+\/)?(?:zsh|bash|fish|sh|login)$/.test(row.command))break;
  if(row.parent<=1)break;
  row=await processRow(row.parent);
  if(row.tty!==tty && !/\/Ghostty\.app\/Contents\/MacOS\/ghostty$/.test(row.command))break;
 }
 throw Error('Automatic pairing currently requires Claude directly inside Ghostty (no tmux/SSH)');
}
export interface ProbeIO {
 tty(session:LiveLaunchSession):Promise<string>;
 open(tty:string):Promise<{write(text:string):Promise<unknown>;close():Promise<unknown>}>;
 pause():Promise<void>;
}
const io:ProbeIO={tty:directGhosttyTty,open:async tty=>{
 if(!/^\/dev\/ttys\d+$/.test(tty))throw Error('Invalid terminal device');
 const handle=await open(tty,constants.O_WRONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const info=await handle.stat();
 if(!info.isCharacterDevice() || info.uid!==process.getuid?.()){await handle.close();throw Error('Terminal device is not owned by this user');}
 return handle;
},pause:()=>new Promise(r=>setTimeout(r,100))};
interface Journal {session:LiveLaunchSession;tty:string;marker:string;before:TerminalTarget[];target?:string}
// The journal permits cleanup after a process crash or an Automation error. A failed
// cleanup blocks later probes; manual pairings still work. No stdin or keystrokes.
export class GhosttyTitleProbe {
 #busy=false;
 constructor(private readonly adapter:TerminalAdapter,private readonly journal:string,private readonly effects:ProbeIO=io) {}
 async #save(value:Journal) {
  await mkdir(dirname(this.journal),{recursive:true,mode:0o700});
  await writeFile(this.journal+'.tmp',JSON.stringify(value),{mode:0o600});
  await rename(this.journal+'.tmp',this.journal);
 }
 async #restore(j:Journal,write:(text:string)=>Promise<unknown>):Promise<void> {
  const current=await this.adapter.list();
  const matches=current.filter(t=>t.title===j.marker);
  if(matches.length>1)throw Error('Ambiguous marker; automatic pairing paused');
  const target=j.target ?? matches[0]?.id;
  // Claude may replace the marker before discovery can read it. There is then
  // nothing to restore; discovery still fails rather than guessing a terminal.
  if(!target){await unlink(this.journal);return;}
  const original=j.before.find(t=>t.id===target),now=current.find(t=>t.id===target);
  if(!original)throw Error('Terminal was created during discovery; automatic pairing paused');
  if(now?.title===j.marker) {
   // Automation can stall; recheck process identity immediately before restoration.
   if(await this.effects.tty(j.session)!==j.tty)throw Error('Recovery terminal identity changed');
   await write('\x1b]2;'+safeTitle(original.title)+'\x07');
  }
  // If Claude updated its title meanwhile, preserve the newer title instead.
  const after=await this.adapter.list();
  if(after.some(t=>t.title===j.marker))throw Error('Temporary title was not restored');
  await unlink(this.journal);
 }
 async recover():Promise<void> {
  const info=await lstat(this.journal).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!info)return;
  if(!info.isFile() || info.size>1024*1024)throw Error('Invalid title-probe recovery file');
  const j=JSON.parse(await readFile(this.journal,'utf8')) as Journal;
  if(!j || !/^Agent-Buddy-link-[a-f0-9-]{36}$/.test(j.marker) || !Array.isArray(j.before))throw Error('Invalid title-probe recovery data');
  // A newer title or a closed terminal needs no tty write, even if Claude exited.
  if(!(await this.adapter.list()).some(t=>t.title===j.marker)){await unlink(this.journal);return;}
  // A closed/replaced process may have a reused tty; never write to it.
  if(await this.effects.tty(j.session)!==j.tty)throw Error('Recovery terminal identity changed');
  const handle=await this.effects.open(j.tty);
  try {await this.#restore(j,text=>handle.write(text));}finally{await handle.close();}
 }
 async discover(session:LiveLaunchSession):Promise<string> {
  if(this.#busy)throw Error('A title probe is already running');this.#busy=true;
  try {
   await this.recover();
   const tty=await this.effects.tty(session);
   const before=await this.adapter.list();if(!before.length)throw Error('No Ghostty terminals available');
   const marker='Agent-Buddy-link-'+randomUUID(),j:Journal={session,tty,marker,before};
   const handle=await this.effects.open(tty);
   try {
    // Verify the PID again after Automation permission prompts, before touching its tty.
    if(await this.effects.tty(session)!==tty)throw Error('Terminal changed during discovery');
    await this.#save(j);
    try {
     await handle.write('\x1b]2;'+marker+'\x07');
     await this.effects.pause();
     const matches=(await this.adapter.list()).filter(t=>t.title===marker);
     if(matches.length!==1 || !before.some(t=>t.id===matches[0]?.id))throw Error('No unique Ghostty terminal matched the marker');
     j.target=matches[0]!.id;await this.#save(j);
    } finally {await this.#restore(j,text=>handle.write(text));}
    return j.target!;
   } finally {await handle.close();}
  } finally {this.#busy=false;}
 }
}
