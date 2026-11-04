import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SessionFocus} from '../src/session-focus.js';
import {StateCoordinator, type PersistedCoordinatorState, type PersistedSession} from '../src/state-coordinator.js';
import {parseFocusLine} from '../src/usb-transport.js';
const session=(id:string):PersistedSession=>({id,activeUntil:100000,attentionUntil:0,hadWork:true,
  lastMainEventAt:1,lastSeenAt:1,completionPending:false,subagents:[]});
const fixture=()=>({version:1,sessions:[session('claude:a'),session('codex:b')]} satisfies PersistedCoordinatorState);

test('rotation is fair despite noisy hooks; next, pin, next-while-pinned and unpin are readable',()=>{
 const f=new SessionFocus(),s=fixture();
 assert.equal(f.frame('working',s,[],0).sessionId,'claude:a');
 s.sessions[0]!.lastSeenAt=7999;
 assert.equal(f.frame('working',s,[],7999).sessionId,'claude:a');
 assert.equal(f.frame('working',s,[],8000).sessionId,'codex:b');
 assert.equal(f.act('pin','working',s,[],8001).pinned,true);
 f.prompt('claude:a'); assert.equal(f.frame('working',s,[],17000).sessionId,'codex:b');
 assert.equal(f.act('next','working',s,[],18000).sessionId,'claude:a');
 assert.equal(f.frame('working',s,[],30000).pinned,true);
 assert.equal(f.act('pin','working',s,[],30001).pinned,false);
 assert.equal(f.frame('working',s,[],38001).sessionId,'codex:b');
});
test('real attention interrupts a pin and rotates only pending questions, then restores the pin',()=>{
 const f=new SessionFocus(),s=fixture();f.frame('working',s,[],0);f.act('pin','working',s,[],1);
 s.sessions[1]!.attentionUntil=50000;s.sessions[1]!.activeUntil=0;
 assert.equal(f.frame('attention',s,[],100).sessionId,'codex:b');
 assert.equal(f.act('next','attention',s,[],200).sessionId,'codex:b');
 s.sessions[1]!.attentionUntil=0;
 assert.equal(f.frame('working',s,[],300).sessionId,'claude:a');
 assert.equal(f.frame('working',s,[],300).pinned,true);
 s.sessions[0]!.activeUntil=0;
 assert.equal(f.frame('idle',s,[],400).pinned,false);
});
test('completion interrupts working for eight seconds; queued notices expire and resumed work cancels them',()=>{
 const f=new SessionFocus(),s=fixture();s.sessions[0]!.activeUntil=0;
 f.completed('claude:a',0);f.completed('claude:a',1);
 assert.equal(f.frame('working',s,[],2).notice,true);
 assert.equal(f.frame('working',s,[],8001).sessionId,'claude:a');
 assert.equal(f.frame('working',s,[],8002).sessionId,'codex:b');
 f.completed('claude:a',9000);s.sessions[1]!.attentionUntil=100000;
 assert.equal(f.frame('attention',s,[],9001).sessionId,'codex:b');
 s.sessions[1]!.attentionUntil=0;
 assert.equal(f.frame('working',s,[],55000).notice,false);
 f.completed('claude:a',56000);s.sessions[0]!.activeUntil=100000;
 assert.equal(f.frame('working',s,[],56001).notice,false);
});
test('completion receipt prevents a duplicate delayed completion after another session finishes',t=>{
 let now=1000; const c=new StateCoordinator(()=>{},{now:()=>now,sweepMs:0});t.after(()=>c.close());
 c.handle('preToolUse',{sessionId:'claude:a'});c.handle('preToolUse',{sessionId:'codex:b'});
 c.handle('agentStop',{sessionId:'claude:a',clearAttention:true});
 assert.equal(c.state,'working');assert.equal(c.acknowledgeCompletion('claude:a'),true);
 assert.equal(c.acknowledgeCompletion('claude:a'),false);
 now++;c.handle('agentStop',{sessionId:'codex:b',clearAttention:true});
 assert.deepEqual(c.drivingSessionIds,['codex:b']);
});
test('USB focus events reject malformed and out-of-range counters',()=>{
 assert.equal(parseFocusLine('TOUCH focus=pin presses=1'),'pin');
 assert.equal(parseFocusLine('TOUCH focus=next presses=4294967295'),'next');
 for(const line of ['TOUCH focus=pin presses=0','TOUCH focus=pin presses=4294967296','TOUCH focus=bad presses=1'])assert.equal(parseFocusLine(line),null);
});

test('switcher keeps idle sessions selectable, holds taps, then follows active work',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);
 const s:PersistedCoordinatorState={version:1,sessions:['claude:a','claude:b','claude:c','codex:d'].map(id=>({...session(id),activeUntil:0}))};
 s.sessions[3]!.activeUntil=100000;
 const before=structuredClone(s);
 let v=f.frame('working',s,[],0);assert.equal(v.count,4);assert.equal(v.state,'working');assert.equal(v.sessionId,'codex:d');
 const seen=[];
 for(let i=0;i<4;i++) {
  v=f.act('next','working',s,[],i+1);seen.push(v.sessionId);
  assert.equal(f.act('activate','working',s,[],i+1).pinned,false);
 }
 assert.deepEqual(seen,['claude:a','claude:b','claude:c','codex:d']);
 v=f.act('next','working',s,[],100);assert.equal(v.sessionId,'claude:a');assert.equal(v.state,'idle');
 f.prompt('codex:d');assert.equal(f.frame('working',s,[],12099).sessionId,'claude:a');
 v=f.frame('working',s,[],12100);assert.equal(v.sessionId,'codex:d');assert.equal(v.state,'working');assert.equal(v.index,4);
 assert.deepEqual(s,before); // browsing never extends work or attention leases
 for(const item of s.sessions)item.activeUntil=0;
 assert.equal(f.frame('sleep',s,[],200000).count,4);assert.equal(f.frame('sleep',s,[],200000).state,'idle');
 s.sessions.pop();assert.equal(f.frame('idle',s,[],200001).sessionId,'claude:a');
});

test('switcher rotates concurrent work despite noisy hooks and freezes the visible target for activation',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();
 assert.equal(f.frame('working',s,[],0).sessionId,'claude:a');
 s.sessions[0]!.lastSeenAt=7999;
 assert.equal(f.frame('working',s,[],8000).sessionId,'codex:b');
 assert.equal(f.act('activate','working',s,[],16000).sessionId,'codex:b');
 assert.equal(f.frame('working',s,[],27999).sessionId,'codex:b');
 assert.equal(f.frame('working',s,[],28000).sessionId,'claude:a');
 assert.equal(f.frame('working',s,[],36000).sessionId,'codex:b');
});

test('switcher preserves completion notices during browsing and prioritizes real attention afterward',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();
 f.frame('working',s,[],0);f.act('next','working',s,[],1);
 s.sessions[0]!.activeUntil=0;f.completed('claude:a',2);
 assert.equal(f.frame('working',s,[],3).sessionId,'codex:b');
 let v=f.frame('working',s,[],12001);assert.equal(v.notice,true);assert.equal(v.state,'complete');
 assert.equal(v.sessionId,'claude:a');assert.equal(v.count,2);assert.equal(v.index,1);
 s.sessions[1]!.attentionUntil=50000;
 v=f.frame('attention',s,[],12002);assert.equal(v.sessionId,'codex:b');assert.equal(v.state,'attention');
 s.sessions[1]!.attentionUntil=0;
 assert.equal(f.frame('working',s,[],12003).notice,true);
 assert.equal(f.frame('working',s,[],20003).state,'working');
});

test('switcher leaves idle selection visible until real activity, including subagent work',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();
 for(const item of s.sessions)item.activeUntil=0;
 f.frame('idle',s,[],0);f.act('next','idle',s,[],1);
 assert.equal(f.frame('idle',s,[],90000).sessionId,'codex:b');
 s.sessions[0]!.subagents=[{id:'child',leaseUntil:200000,instances:1,lastEventAt:90001}];
 const v=f.frame('working',s,[],90001);assert.equal(v.sessionId,'claude:a');assert.equal(v.state,'working');
});

test('fixed indicators retain other work while browsing, select directly, and reject stale roster touches',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();s.sessions[0]!.activeUntil=0;
 const v=f.frame('working',s,[],0);assert.deepEqual(v.targets,[{index:1,agent:'claude',state:'i'},{index:2,agent:'codex',state:'w'}]);
 const idle=f.act({index:1,revision:v.revision!},'working',s,[],100);
 assert.equal(idle.sessionId,'claude:a');assert.equal(idle.state,'idle');assert.equal(idle.targets?.[1]?.state,'w');
 assert.equal(f.frame('working',s,[],12099).sessionId,'claude:a');
 assert.equal(f.frame('working',s,[],12100).sessionId,'codex:b');
 s.sessions.unshift({...session('claude:0'),activeUntil:0});
 const changed=f.frame('working',s,[],13000);assert.notEqual(changed.revision,v.revision);
 assert.equal(f.act({index:1,revision:v.revision!},'working',s,[],13001).sessionId,'codex:b');
 assert.equal(f.act({index:1,revision:changed.revision!},'working',s,[],13002).sessionId,'claude:0');
 assert.deepEqual(parseFocusLine(`TOUCH select=2 revision=${changed.revision} presses=4`),{index:2,revision:changed.revision});
 for(const line of ['TOUCH select=0 revision=1 presses=1','TOUCH select=1 revision=4294967296 presses=1','TOUCH select=1 revision=1 presses=0'])assert.equal(parseFocusLine(line),null);
});
test('fixed indicators page in groups of four and preserve each session number',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);
 const s:PersistedCoordinatorState={version:1,sessions:Array.from({length:6},(_,i)=>({...session(`claude:${i}`),activeUntil:0}))};
 const v=f.frame('idle',s,[],0);
 const next=f.act({index:5,revision:v.revision!},'idle',s,[],1);
 assert.deepEqual(next.targets?.map(t=>t.index),[5,6]);assert.equal(next.index,5);assert.equal(next.count,6);
});


test('persistent pin isolates portrait state while background indicators remain live',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();
 s.sessions[0]!.activeUntil=0;
 const v=f.frame('working',s,[],0);
 let p=f.act({index:1,revision:v.revision!,pin:true},'working',s,[],1);
 assert.equal(p.pinned,true);assert.equal(p.state,'idle');assert.equal(p.sessionId,'claude:a');
 const original=structuredClone(s);
 f.setBrowseAll(true); // Discovery refresh must not release an existing pin.
 f.prompt('codex:b');s.sessions[1]!.attentionUntil=200000;
 p=f.frame('attention',s,[],20000);
 assert.equal(p.sessionId,'claude:a');assert.equal(p.state,'idle');assert.equal(p.targets?.[1]?.state,'a');
 s.sessions[1]!.attentionUntil=0;s.sessions[1]!.activeUntil=0;f.completed('codex:b',20001);
 p=f.frame('complete',s,['codex:b'],20002);assert.equal(p.state,'idle');assert.equal(p.notice,false);
 s.sessions[0]!.activeUntil=30000;
 p=f.frame('working',s,[],21000);assert.equal(p.state,'working');assert.equal(p.pinned,true);
 s.sessions[0]!.attentionUntil=30000;
 assert.equal(f.frame('attention',s,[],22000).state,'attention');
 s.sessions[0]!.attentionUntil=0;s.sessions[0]!.activeUntil=0;f.completed('claude:a',23000);
 assert.equal(f.frame('complete',s,[],23001).state,'complete');
 assert.equal(f.frame('idle',s,[],31001).state,'idle');
 assert.equal(f.frame('working',s,[],200000).pinned,true);
 assert.equal(f.act({index:1,revision:v.revision!,activate:true},'idle',s,[],200001).pinned,true);
 assert.equal(f.act({index:1,revision:v.revision!,pin:true},'idle',s,[],200002).pinned,false);
 // Pinning is presentation-only, never extends the selected work lease.
 assert.equal(original.sessions[0]!.activeUntil,0);assert.equal(s.sessions[0]!.activeUntil,0);
});
test('switching away releases pin, closed sessions clear it, and stale holds are rejected',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();
 const v=f.frame('working',s,[],0);
 f.act({index:1,revision:v.revision!,pin:true},'working',s,[],1);
 assert.equal(f.act({index:2,revision:v.revision!,activate:true},'working',s,[],2).pinned,false);
 f.act({index:2,revision:v.revision!,pin:true},'working',s,[],3);
 assert.equal(f.act('next','working',s,[],4).pinned,false);
 f.act({index:1,revision:v.revision!,pin:true},'working',s,[],5);
 s.sessions.shift();
 const remaining=f.frame('working',s,[],6);assert.equal(remaining.pinned,false);assert.equal(remaining.sessionId,'codex:b');
 assert.equal(f.act({index:1,revision:v.revision!,pin:true},'working',s,[],7).pinned,false);
 assert.deepEqual(parseFocusLine('TOUCH select=1 revision=7 presses=1 activate=0 pin=1'),{index:1,revision:7,pin:true});
 assert.equal(parseFocusLine('TOUCH select=1 revision=7 presses=1 activate=1 pin=1'),null);
});

test('background completion indicator lasts ten seconds and yields immediately to new work/input',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();s.sessions[0]!.activeUntil=0;
 const v=f.frame('working',s,[],0);f.act({index:1,revision:v.revision!,pin:true},'working',s,[],1);
 s.sessions[1]!.activeUntil=0;f.completed('codex:b',100);
 assert.equal(f.frame('complete',s,[],101).targets?.[1]?.state,'c');
 assert.equal(f.frame('complete',s,[],101).state,'idle');
 assert.equal(f.frame('idle',s,[],10099).targets?.[1]?.state,'c');
 assert.equal(f.frame('idle',s,[],10100).targets?.[1]?.state,'i');
 s.sessions[1]!.activeUntil=50000;assert.equal(f.frame('working',s,[],10200).targets?.[1]?.state,'w');
 s.sessions[1]!.activeUntil=0;f.completed('codex:b',10300);
 assert.equal(f.frame('complete',s,[],10301).targets?.[1]?.state,'c');
 s.sessions[1]!.attentionUntil=50000;
 assert.equal(f.frame('attention',s,[],10302).targets?.[1]?.state,'a');
 s.sessions[1]!.attentionUntil=0;assert.equal(f.frame('idle',s,[],10303).targets?.[1]?.state,'i');
});

test('finishing again during a manual browse refreshes the green indicator',()=>{
 const f=new SessionFocus();f.setBrowseAll(true);const s=fixture();
 const v=f.frame('working',s,[],0);f.act('activate','working',s,[],1);
 s.sessions[0]!.activeUntil=0;f.completed('claude:a',2);
 assert.equal(f.frame('working',s,[],3).targets?.[0]?.state,'c');
 s.sessions[0]!.activeUntil=100000;assert.equal(f.frame('working',s,[],4).targets?.[0]?.state,'w');
 s.sessions[0]!.activeUntil=0;f.completed('claude:a',5);
 assert.equal(f.frame('working',s,[],6).targets?.[0]?.state,'c');
});
