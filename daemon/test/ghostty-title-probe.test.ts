import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GhosttyTitleProbe, type ProbeIO} from '../src/ghostty-title-probe.js';
import type {TerminalAdapter,TerminalTarget} from '../src/terminal-adapters.js';
const first='11111111-1111-1111-1111-111111111111',second='22222222-2222-2222-2222-222222222222';
async function fixture(t:{after(fn:()=>Promise<void>):void}) {
 const root=await mkdtemp(join(tmpdir(),'buddy-title-probe-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const rows:TerminalTarget[]=[{id:first,title:'Same title',cwd:'/same/repo'},{id:second,title:'Same title',cwd:'/same/repo'}];
 const writes:string[]=[];let closed=0;let fails=0;
 const adapter:TerminalAdapter={id:'ghostty',list:async()=>{if(fails>0){fails--;throw Error('Automation unavailable');}return structuredClone(rows);},focus:async()=>{throw Error('Must never focus while discovering');}};
 const io:ProbeIO={tty:async()=>'/dev/ttys001',open:async()=>({write:async text=>{writes.push(text);const m=text.match(/^\x1b\]2;(.*)\x07$/s);assert.ok(m);rows[1]!.title=m[1]!;},close:async()=>{closed++;}}),pause:async()=>{}};
 const journal=join(root,'probe.json'),probe=new GhosttyTitleProbe(adapter,journal,io);
 const session={id:'claude:a',pid:123,identity:'born',cwd:'/same/repo'};
 return {rows,writes,adapter,io,journal,probe,session,closed:()=>closed,fail:(n:number)=>{fails=n;}};
}
test('identical folders and titles: nonce identifies only the originating terminal and restores it',async t=>{
 const x=await fixture(t);assert.equal(await x.probe.discover(x.session),second);
 assert.deepEqual(x.rows.map(r=>r.title),['Same title','Same title']);assert.equal(x.closed(),1);
 assert.equal(x.writes.length,2);assert.equal(await stat(x.journal).catch(()=>null),null);
});
test('a title update by Claude during discovery is preserved',async t=>{
 const x=await fixture(t);const list=x.adapter.list;let calls=0;
 x.adapter.list=async()=>{calls++;if(calls===3)x.rows[1]!.title='Newer Claude title';return list();};
 assert.equal(await x.probe.discover(x.session),second);assert.equal(x.rows[1]!.title,'Newer Claude title');assert.equal(x.writes.length,1);
});
test('an Automation failure after writing leaves a recoverable journal; recovery restores the title',async t=>{
 const x=await fixture(t);x.io.pause=async()=>{x.fail(2);};
 await assert.rejects(x.probe.discover(x.session),/Automation/);assert.equal(x.closed(),1);
 assert.equal((await stat(x.journal)).mode&0o777,0o600);
 await x.probe.recover();assert.equal(x.rows[1]!.title,'Same title');assert.equal(await stat(x.journal).catch(()=>null),null);
});
test('a changed terminal identity is rejected before writing',async t=>{
 const x=await fixture(t);let n=0;x.io.tty=async()=>++n===1?'/dev/ttys001':'/dev/ttys002';
 await assert.rejects(x.probe.discover(x.session),/changed/);assert.equal(x.writes.length,0);assert.equal(x.closed(),1);
});
test('ambiguous markers are never accepted and leave recovery information',async t=>{
 const x=await fixture(t);x.io.pause=async()=>{x.rows[0]!.title=x.rows[1]!.title;};
 await assert.rejects(x.probe.discover(x.session),/Ambiguous/);assert.ok(await stat(x.journal));assert.equal(x.closed(),1);
});

test('Claude replacing a marker before lookup fails safely without blocking later probes',async t=>{
 const x=await fixture(t);x.io.pause=async()=>{x.rows[1]!.title='New Claude title';};
 await assert.rejects(x.probe.discover(x.session),/No unique/);
 assert.equal(x.rows[1]!.title,'New Claude title');assert.equal(x.writes.length,1);
 assert.equal(await stat(x.journal).catch(()=>null),null);
 x.io.pause=async()=>{};assert.equal(await x.probe.discover(x.session),second);
 assert.equal(x.rows[1]!.title,'New Claude title');
});
test('recovery clears obsolete journal without writing to a reused tty',async t=>{
 const x=await fixture(t);x.io.pause=async()=>{x.fail(2);};
 await assert.rejects(x.probe.discover(x.session),/Automation/);
 x.rows[1]!.title='Different session';x.io.tty=async()=>{throw Error('Process exited');};
 await x.probe.recover();assert.equal(x.writes.length,1);
 assert.equal(await stat(x.journal).catch(()=>null),null);
});
test('restoration revalidates identity after a slow Automation call',async t=>{
 const x=await fixture(t);let n=0;x.io.tty=async()=>++n<=2?'/dev/ttys001':'/dev/ttys009';
 await assert.rejects(x.probe.discover(x.session),/identity changed/);
 assert.equal(x.writes.length,1);assert.ok(await stat(x.journal));
 await assert.rejects(x.probe.recover(),/identity changed/);assert.equal(x.writes.length,1);
});
