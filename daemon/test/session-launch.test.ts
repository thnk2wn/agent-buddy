import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionLauncher, type LiveLaunchSession} from '../src/session-launch.js';
import {GhosttyAdapter, type TerminalAdapter} from '../src/terminal-adapters.js';
const target='A124925B-DED1-4B18-9BF6-E95304BDB3DE';
async function setup(t: {after(fn:()=>Promise<void>):void}) {
 const root=await mkdtemp(join(tmpdir(),'buddy-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let live:LiveLaunchSession[]=[{id:'claude:a',pid:123,identity:'birth-a',cwd:'/repo'}];
 const calls:string[]=[];
 const adapter:TerminalAdapter={id:'ghostty',list:async()=>[{id:target,title:'Claude',cwd:'/repo'}],focus:async id=>{calls.push(id);}};
 const path=join(root,'session-launch.json');
 const create=()=>new SessionLauncher(path,async()=>live,[adapter],true);
 const launcher=create();await launcher.load();
 const pair=()=>launcher.command({action:'pair',sessionId:'claude:a',adapter:'ghostty',terminalId:target});
 return {launcher,pair,calls,create,path,setLive:(rows:LiveLaunchSession[])=>{live=rows;},adapter};
}
test('off by default; pairing does not enable or focus; explicit open and persistence',async t=>{
 const x=await setup(t);await x.pair();assert.equal(x.launcher.status().enabled,false);
 x.launcher.devicePinned('claude:a');assert.equal(x.calls.length,0);
 await assert.rejects(x.launcher.open('claude:a'),/disabled/);
 await x.launcher.command({action:'enable'});await x.launcher.open('claude:a');assert.deepEqual(x.calls,[target]);
 const restored=x.create();await restored.load();assert.equal(restored.status().enabled,true);
 await restored.open('claude:a');assert.equal(x.calls.length,2);
 assert.equal((await stat(x.path)).mode&0o777,0o600);
 assert.equal((await readFile(x.path,'utf8')).includes('/repo'),false);
 await restored.command({action:'disable'});await assert.rejects(restored.open('claude:a'),/disabled/);
});
test('PID reuse, ended processes, unknown sessions and closed terminal fail without fallback',async t=>{
 const x=await setup(t);await x.pair();await x.launcher.command({action:'enable'});
 x.setLive([{id:'claude:a',pid:123,identity:'birth-b',cwd:'/repo'}]);
 await assert.rejects(x.launcher.open('claude:a'),/ended/);assert.equal(x.calls.length,0);
 x.setLive([]);await assert.rejects(x.launcher.open('claude:a'),/ended/);
 await assert.rejects(x.launcher.open('claude:other'),/no terminal pairing/);
 x.setLive([{id:'claude:a',pid:123,identity:'birth-a',cwd:'/repo'}]);
 x.adapter.focus=async()=>{throw Error('terminal has closed');};
 await assert.rejects(x.launcher.open('claude:a'),/closed/);assert.equal(x.launcher.status().last?.ok,false);
});
test('device pin opens a paired session; unpaired pins do nothing',async t=>{
 const x=await setup(t);await x.pair();await x.launcher.command({action:'enable'});
 x.launcher.devicePinned('codex:a');x.launcher.devicePinned(null);assert.equal(x.calls.length,0);
 x.launcher.devicePinned('claude:a');await new Promise(r=>setImmediate(r));assert.deepEqual(x.calls,[target]);
});
test('disable during an in-flight lookup cancels focus',async t=>{
 const x=await setup(t);await x.pair();await x.launcher.command({action:'enable'});
 let resolve!:(v:LiveLaunchSession[])=>void;
 const gate=new Promise<LiveLaunchSession[]>(r=>{resolve=r;});
 const delayed=new SessionLauncher(x.path,()=>gate,[x.adapter],true);await delayed.load();
 const pending=delayed.open('claude:a');const rejected=assert.rejects(pending,/configuration changed/);
 await delayed.command({action:'disable'});
 resolve([{id:'claude:a',pid:123,identity:'birth-a',cwd:'/repo'}]);await rejected;assert.equal(x.calls.length,0);
});
test('corrupt settings stay off and unsupported platforms cannot enable',async t=>{
 const x=await setup(t);await writeFile(x.path,'{');const restored=x.create();await restored.load();assert.equal(restored.status().enabled,false);
 const other=new SessionLauncher(x.path,async()=>[],[],false);await assert.rejects(other.command({action:'enable'}),/macOS/);
 await assert.rejects(x.launcher.command({action:'pair',sessionId:'claude:a',adapter:'ghostty',terminalId:'"; do shell script'}),/terminal/);
});
test('Ghostty passes only validated IDs as arguments and uses no text-input commands',async()=>{
 const calls:{script:string;args:string[]}[]=[];
 const adapter=new GhosttyAdapter(async(script,args=[])=>{calls.push({script,args});return JSON.stringify([{id:target,title:'Claude',cwd:'/repo'}]);});
 assert.equal((await adapter.list())[0]?.id,target);await adapter.focus(target);
 assert.deepEqual(calls[1]?.args,[target]);assert.match(calls[1]!.script,/app.focus\(target\)/);
 assert.doesNotMatch(calls[1]!.script,/inputText|newWindow|sendKey/);
 await assert.rejects(adapter.focus('bad-id'),/Invalid/);assert.equal(calls.length,2);
});

test('automatic discovery respects opt-in and preserves an established manual pairing',async t=>{
 const x=await setup(t);await x.pair();await x.launcher.command({action:'enable'});
 let probes=0;const auto=new SessionLauncher(x.path,async()=>[{id:'claude:a',pid:123,identity:'birth-a',cwd:'/repo'}],[x.adapter],true,async()=>{probes++;return target;});
 await auto.load();await assert.rejects(auto.register('claude:a'),/disabled/);
 await auto.command({action:'auto-enable'});await auto.register('claude:a');assert.equal(probes,0);
 assert.equal(auto.status().pairings[0]?.terminalId,target);
});
test('automatic discovery replaces a stale process association only after a successful probe',async t=>{
 const x=await setup(t);await x.pair();await x.launcher.command({action:'enable'});
 let fail=true;const auto=new SessionLauncher(x.path,async()=>[{id:'claude:a',pid:124,identity:'birth-b',cwd:'/repo'}],[x.adapter],true,async()=>{if(fail)throw Error('No marker');return target;});
 await auto.load();await auto.command({action:'auto-enable'});
 await assert.rejects(auto.register('claude:a'),/No marker/);assert.equal(auto.status().pairings[0]?.pid,123);
 fail=false;await auto.register('claude:a');assert.equal(auto.status().pairings[0]?.pid,124);
 assert.equal(auto.status().pairings[0]?.source,'title-probe');assert.equal(x.calls.length,0);
});

test('hook registration drains multiple sessions without blocking and never focuses',async t=>{
 const x=await setup(t);const sessions=['a','b'].map((id,i)=>({id:'claude:'+id,pid:200+i,identity:'birth',cwd:'/same'}));
 const probed:string[]=[];
 const auto=new SessionLauncher(x.path,async()=>sessions,[x.adapter],true,async s=>{probed.push(s.id);return target;});
 await auto.command({action:'enable'});await auto.command({action:'auto-enable'});
 auto.observe('claude:a');auto.observe('claude:b');
 for(let i=0;i<100 && auto.status().pairings.length<2;i++)await new Promise(r=>setTimeout(r,2));
 assert.deepEqual(probed,['claude:a','claude:b']);assert.equal(auto.status().pairings.length,2);assert.equal(x.calls.length,0);
});

 test('disabling automatic pairing during registry lookup prevents any terminal probe',async t=>{
 const x=await setup(t);let resolve!:(rows:LiveLaunchSession[])=>void;let probes=0;
 const lookup=new Promise<LiveLaunchSession[]>(r=>{resolve=r;});
 const auto=new SessionLauncher(x.path,()=>lookup,[x.adapter],true,async()=>{probes++;return target;});
 await auto.command({action:'enable'});await auto.command({action:'auto-enable'});
 const pending=assert.rejects(auto.register('claude:a'),/settings changed/);
 await auto.command({action:'auto-disable'});
 resolve([{id:'claude:a',pid:123,identity:'birth',cwd:'/repo'}]);
 await pending;assert.equal(probes,0);assert.equal(auto.status().pairings.length,0);
});
test('disabling during a probe prevents saving its result and preserves manual fallback',async t=>{
 const x=await setup(t);await x.pair();await x.launcher.command({action:'enable'});
 let resolve!:(id:string)=>void;let started!:()=>void;
 const start=new Promise<void>(r=>{started=r;});const gate=new Promise<string>(r=>{resolve=r;});
 const auto=new SessionLauncher(x.path,async()=>[{id:'claude:a',pid:124,identity:'new-birth',cwd:'/repo'}],[x.adapter],true,async()=>{started();return gate;});
 await auto.load();await auto.command({action:'auto-enable'});
 const pending=assert.rejects(auto.register('claude:a'),/settings changed/);await start;
 await auto.command({action:'auto-disable'});resolve(target);await pending;
 assert.equal(auto.status().pairings[0]?.pid,123);assert.equal(x.calls.length,0);
});

test('Codex activation targets only verified desktop roster entries and never toggles pin',async t=>{
 const x=await setup(t);const opened:string[]=[];
 const id='codex:11111111-1111-1111-1111-111111111111';
 const launcher=new SessionLauncher(x.path,async()=>[],[x.adapter],true,undefined,async id=>{opened.push(id);});
 launcher.setDesktopSessions([id]);await assert.rejects(launcher.open(id),/disabled/);
 await launcher.command({action:'enable'});await launcher.open(id);await launcher.open(id);
 assert.deepEqual(opened,[id,id]);assert.equal(x.calls.length,0);
 launcher.setDesktopSessions([]);await assert.rejects(launcher.open(id),/no terminal pairing/);
});


test('rapid device activation retains the last target instead of losing it while busy',async t=>{
 const x=await setup(t);const opened:string[]=[];let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});
 const ids=[1,2,3].map(n=>'codex:'+String(n).repeat(8)+'-1111-1111-1111-111111111111');
 const launcher=new SessionLauncher(x.path,async()=>[],[],true,undefined,async id=>{
   opened.push(id);if(opened.length===1)await gate;
 });
 launcher.setDesktopSessions(ids);await launcher.command({action:'enable'});
 launcher.deviceActivated(ids[0]!);launcher.deviceActivated(ids[1]!);launcher.deviceActivated(ids[2]!);
 assert.deepEqual(opened,[ids[0]]);release();
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(opened,[ids[0],ids[2]]);assert.equal(launcher.status().last?.ok,true);
});
test('disable clears pending device activations without replay after re-enable',async t=>{
 const x=await setup(t);const opened:string[]=[];let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});
 const ids=[1,2].map(n=>'codex:'+String(n).repeat(8)+'-1111-1111-1111-111111111111');
 const launcher=new SessionLauncher(x.path,async()=>[],[],true,undefined,async id=>{opened.push(id);await gate;});
 launcher.setDesktopSessions(ids);await launcher.command({action:'enable'});
 launcher.deviceActivated(ids[0]!);launcher.deviceActivated(ids[1]!);
 await launcher.command({action:'disable'});release();await new Promise(r=>setImmediate(r));
 await launcher.command({action:'enable'});await new Promise(r=>setImmediate(r));
 assert.deepEqual(opened,[ids[0]]);
});
