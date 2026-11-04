import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionVisuals} from '../src/session-visuals.js';
import type {TerminalTab,TabLabels} from '../src/terminal-adapters.js';
const id='11111111-1111-1111-1111-111111111111';
async function setup(t:{after(fn:()=>Promise<void>):void},custom?:string) {
 const root=await mkdtemp(join(tmpdir(),'buddy-labels-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const tab:TerminalTab={id:'tab-one',title:custom??'◐ Actual Claude title',terminals:[{id,title:'◐ Actual Claude title'}]};
 const calls:string[]=[],shown:string[]=[];
 const adapter:TabLabels={tabs:async()=>structuredClone([tab]),setTabTitle:async(before,target,title)=>{
  if(tab.id!==before.id||tab.title!==before.title||tab.terminals[0]?.id!==target||tab.terminals[0]?.title!==before.terminals[0]?.title)return false;
  calls.push(title);tab.title=title||tab.terminals[0]!.title;return true;
 }};
 const path=join(root,'session-visuals.json');
 const create=()=>new SessionVisuals(path,adapter,async text=>{shown.push(text);});
 const v=create();await v.load();
 return {v,create,tab,calls,shown,path,adapter,target:[{terminalId:id,index:2}]};
}
test('off by default; prefix preserves underlying title and follows changes, disable restores live title',async t=>{
 const x=await setup(t);await x.v.reconcile(x.target);assert.deepEqual(x.calls,[]);
 await x.v.configure('labels',true);await x.v.reconcile(x.target);
 assert.equal(x.tab.title,'② ◐ Actual Claude title');assert.equal(x.tab.terminals[0]!.title,'◐ Actual Claude title');
 x.tab.terminals[0]!.title='✳ Renamed by Claude';await x.v.reconcile(x.target);
 assert.equal(x.tab.title,'② ✳ Renamed by Claude');
 await x.v.configure('labels',false);assert.equal(x.tab.title,'✳ Renamed by Claude');
});
test('manual titles retain exact wording through numbering, rename, and disabling',async t=>{
 const x=await setup(t,'My custom tab');await x.v.configure('labels',true);await x.v.reconcile(x.target);
 assert.equal(x.tab.title,'② My custom tab');x.tab.terminals[0]!.title='Agent changed';await x.v.reconcile(x.target);
 assert.equal(x.tab.title,'② My custom tab');x.tab.title='My NEW custom title';await x.v.reconcile(x.target);
 assert.equal(x.tab.title,'② My NEW custom title');await x.v.configure('labels',false);assert.equal(x.tab.title,'My NEW custom title');
});
test('disable preserves a user edit made after our last write',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile(x.target);
 x.tab.title='User wins';await x.v.configure('labels',false);assert.equal(x.tab.title,'User wins');
});
test('restarts recover owned labels without double-prefixing and preserve dynamic behavior',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile(x.target);
 const v=x.create();await v.load();await v.reconcile([{terminalId:id,index:4}]);assert.equal(x.tab.title,'④ ◐ Actual Claude title');
 await v.restore();assert.equal(x.tab.title,'◐ Actual Claude title');assert.equal(v.status().labels,true);
});
test('closed or ambiguous pairings remove labels; splits and title probes never get labeled',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile([...x.target,...x.target]);assert.deepEqual(x.calls,[]);
 x.tab.terminals.push({id:'22222222-2222-2222-2222-222222222222',title:'Other'});await x.v.reconcile(x.target);assert.deepEqual(x.calls,[]);
 x.tab.terminals.pop();x.tab.terminals[0]!.title='Agent-Buddy-link-uuid';await x.v.reconcile(x.target);assert.deepEqual(x.calls,[]);
 x.tab.terminals[0]!.title=x.tab.title;await x.v.reconcile(x.target);await x.v.reconcile([]);assert.equal(x.tab.title,'◐ Actual Claude title');
});
test('failed compare-and-set cannot overwrite a concurrent manual rename',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);
 x.adapter.setTabTitle=async()=>{x.tab.title='Concurrent edit';return false;};await x.v.reconcile(x.target);
 await x.v.configure('labels',false);assert.equal(x.tab.title,'Concurrent edit');
});
test('write-ahead recovery can remove prior prefix if killed before the next write',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile(x.target);
 const data=JSON.parse(await readFile(x.path,'utf8'));data.owned[0].previous=data.owned[0].applied;
 data.owned[0].previousOwned=true;data.owned[0].applied='③ Pending change';await writeFile(x.path,JSON.stringify(data));
 const v=x.create();await v.load();await v.configure('labels',false);assert.equal(x.tab.title,'◐ Actual Claude title');
});
test('overlay is separately opt-in and emits actual session number, never automatic rotation',async t=>{
 const x=await setup(t);await x.v.activated(2,'Hello');assert.deepEqual(x.shown,[]);
 await x.v.configure('overlay',true);await x.v.reconcile(x.target);assert.deepEqual(x.shown,[]);
 await x.v.activated(3,'Hello');assert.deepEqual(x.shown,['Opened ③ — Hello']);
 await x.v.configure('overlay',false);await x.v.activated(2,'Hello');assert.equal(x.shown.length,1);
});
test('canceled refresh restores instead of applying stale labels',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile(x.target,()=>false);assert.deepEqual(x.calls,[]);
});
test('repeated title races preserve ownership without double prefixing',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile(x.target);
 const write=x.adapter.setTabTitle;x.adapter.setTabTitle=async()=>false;
 x.tab.terminals[0]!.title='B';await x.v.reconcile(x.target);
 x.tab.terminals[0]!.title='C';await x.v.reconcile(x.target);
 x.adapter.setTabTitle=write;await x.v.reconcile(x.target);assert.equal(x.tab.title,'② C');
 await x.v.configure('labels',false);assert.equal(x.tab.title,'C');
});
test('split added to owned tab defers its cleanup without failing disable or other updates',async t=>{
 const x=await setup(t);await x.v.configure('labels',true);await x.v.reconcile(x.target);
 x.tab.terminals.push({id:'22222222-2222-2222-2222-222222222222',title:'Split'});
 const write=x.adapter.setTabTitle;x.adapter.setTabTitle=async(...args)=>{
  if(args[0].terminals.length!==1)throw Error('Invalid tab label');return write(...args);
 };
 await x.v.configure('labels',false);assert.equal(x.v.status().labels,false);assert.equal(x.v.status().labeledTabs,1);
 x.tab.terminals.pop();await x.v.reconcile([]);assert.equal(x.v.status().labeledTabs,0);assert.equal(x.tab.title,'◐ Actual Claude title');
});
