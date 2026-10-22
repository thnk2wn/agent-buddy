import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {ActivityHistory} from '../src/activity-history.js';
import {StateCoordinator, type ActivityEvent} from '../src/state-coordinator.js';
import {claudeAdapter} from '../src/agents/claude.js';

test('bounded history persists only whitelisted metadata and survives reload',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'buddy-history-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'history.json'), history=new ActivityHistory(path,2);
 for(let i=0;i<3;i++)history.add({at:i,event:'preToolUse',before:'idle',after:'working',accepted:true,
  sessionId:'claude:s',tool:'Bash',...{prompt:'SECRET',tool_input:{command:'SECRET'}}});
 await history.flush();const raw=await readFile(path,'utf8');assert.ok(!raw.includes('SECRET'));
 assert.equal(history.recent().length,2);assert.equal(history.recent()[0]?.at,1);
 if(process.platform!=='win32')assert.equal((await stat(path)).mode & 0o777,0o600);
 const restored=new ActivityHistory(path,2);await restored.load();assert.deepEqual(restored.recent(),history.recent());
 const copy=restored.recent();copy.pop();assert.equal(restored.recent().length,2);
});

test('records hook decisions, rejected stale events and automatic expiration without changing behavior',t=>{
 let now=1000;const events:ActivityEvent[]=[];
 const c=new StateCoordinator(()=>{}, {now:()=>now,sweepMs:0,activeLeaseMs:100,onEvent:e=>events.push(e)});t.after(()=>c.close());
 c.handle('preToolUse',{sessionId:'claude:s',hook_event_name:'PreToolUse',tool_name:'Bash',timestamp:now,tool_input:{command:'SECRET'}});
 assert.equal(events.at(-1)?.after,'working');assert.equal(events.at(-1)?.nativeEvent,'PreToolUse');
 c.handle('agentStop',{sessionId:'claude:s',timestamp:999});assert.equal(events.at(-1)?.accepted,false);
 assert.match(c.diagnostics().sessions[0]!.reason,/no stop/);
 now=1101;c.sweep();assert.equal(events.at(-1)?.event,'leaseSweep');assert.equal(c.state,'idle');
 assert.ok(!JSON.stringify(events).includes('SECRET'));
});

test('Claude informational notices do not request attention and normal Stop clears prior input alerts',t=>{
 const c=new StateCoordinator(()=>{},{sweepMs:0});t.after(()=>c.close());
 const deliver=(event:string,payload={})=>{for(const h of claudeAdapter.normalize(event,{session_id:'s',...payload},Date.now()))c.handle(h.event,h.payload);};
 for(const type of ['auth_success','agent_completed','plugin_notification','unknown']) {
  assert.deepEqual(claudeAdapter.normalize('Notification',{session_id:'s',notification_type:type},100),[]);
 }
 deliver('PreToolUse',{tool_name:'Bash'});deliver('PermissionRequest');assert.equal(c.state,'attention');
 deliver('Stop');assert.equal(c.state,'complete');
 assert.equal(c.snapshot().sessions[0]?.attentionUntil,0);
 deliver('Notification',{notification_type:'permission_prompt'});assert.equal(c.state,'attention');
 deliver('Notification',{notification_type:'auth_success'});assert.equal(c.state,'attention');
});
