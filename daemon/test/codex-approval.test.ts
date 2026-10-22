import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {usesAutomaticApproval} from '../src/codex-approval.js';
import {StateCoordinator,type ActivityEvent} from '../src/state-coordinator.js';

test('reads only the matching session latest approval mode, never inferring from unknown policy',async t=>{
 const home=await mkdtemp(join(tmpdir(),'buddy-approval-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'.codex/sessions');await mkdir(dir,{recursive:true});const path=join(dir,'rollout-abc.jsonl');
 const row=(mode?:string)=>JSON.stringify({type:'turn_context',payload:{approvals_reviewer:mode}})+'\n';
 const payload={session_id:'abc',transcript_path:path};
 await writeFile(path,row('auto_review'));assert.equal(await usesAutomaticApproval(payload,home,{}),true);
 await writeFile(path,row('auto_review')+row('user'));assert.equal(await usesAutomaticApproval(payload,home,{}),false);
 await writeFile(path,row('auto_review')+row());assert.equal(await usesAutomaticApproval(payload,home,{}),undefined);
 assert.equal(await usesAutomaticApproval({...payload,session_id:'other'},home,{}),undefined);
 const outside=join(home,'abc.jsonl');await writeFile(outside,row('auto_review'));
 assert.equal(await usesAutomaticApproval({...payload,transcript_path:outside},home,{}),undefined);
});
test('automatic requests neither interrupt work nor clear an existing real question, but are recorded',t=>{
 const events:ActivityEvent[]=[];const c=new StateCoordinator(()=>{},{sweepMs:0,onEvent:e=>events.push(e)});t.after(()=>c.close());
 c.handle('preToolUse',{sessionId:'codex:s'});
 c.handle('notification',{sessionId:'codex:s',automaticApproval:true});assert.equal(c.state,'working');
 assert.equal(events.at(-1)?.automaticApproval,true);
 c.handle('notification',{sessionId:'codex:s',notification_type:'agent_needs_input'});assert.equal(c.state,'attention');
 c.handle('notification',{sessionId:'codex:s',automaticApproval:true});assert.equal(c.state,'attention');
 c.handle('agentStop',{sessionId:'codex:s',clearAttention:true});assert.equal(c.state,'complete');
});
