import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SessionInputTracker,SessionInputReceipts} from '../src/session-input.js';
const event=(sequence:number,index:number,activate=false)=>({sequence,index,revision:7,activate});
test('Wi-Fi preserves select/open order, rejects replay, and baselines on reconnect or reboot',()=>{
 const t=new SessionInputTracker();assert.deepEqual(read(t,1,[]),[]);
 assert.deepEqual(read(t,1,[event(1,2),event(2,2,true)]),[{index:2,revision:7},{index:2,revision:7,activate:true}]);
 assert.deepEqual(read(t,1,[event(1,2),event(2,2,true)]),[]);
 assert.deepEqual(read(t,1,[event(3,1,true),event(4,3)]),[{index:1,revision:7,activate:true},{index:3,revision:7}]);
 assert.deepEqual(read(t,2,[event(1,2,true)]),[]);
 assert.deepEqual(read(t,2,[event(2,2,true)],true),[]);
 assert.deepEqual(read(t,2,[event(3,2,true)]),[{index:2,revision:7,activate:true}]);
 assert.deepEqual(read(t,2,[{...event(4,1),revision:0}]),[]);
});
test('Wi-Fi sequence rollover still delivers each new input once',()=>{
 const t=new SessionInputTracker();read(t,1,[event(0xffffffff,1)]);
 assert.deepEqual(read(t,1,[event(0xffffffff,1),event(1,2,true)]),[{index:2,revision:7,activate:true}]);
 assert.deepEqual(read(t,1,[event(0xffffffff,1),event(1,2,true)]),[]);
});

test('pin gestures survive Wi-Fi transport exactly once and never activate',()=>{
 const t=new SessionInputTracker();read(t,1,[]);
 const pin={...event(1,2),pin:true};
 assert.deepEqual(read(t,1,[pin]),[{index:2,revision:7,pin:true}]);
 assert.deepEqual(read(t,1,[pin]),[]);
 assert.deepEqual(read(t,1,[{...event(2,2,true),pin:true}]),[]);
 assert.deepEqual(read(t,1,[{...event(2,2),pin:'yes'}]),[]);
});

function read(t:SessionInputTracker,boot:number,raw:unknown,reconnected=false) {
 return t.read(boot,raw,reconnected).map(action=>{
   if(typeof action==='string')return action;
   const {boot:ignoredBoot,sequence:ignoredSequence,...rest}=action;return rest;
 });
}

test('USB to Wi-Fi handoff cannot replay a physical pin toggle',async()=>{
 const {parseFocusLine}=await import('../src/usb-transport.js');
 const {SessionFocus}=await import('../src/session-focus.js');
 const receipts=new SessionInputReceipts(),wifi=new SessionInputTracker(),focus=new SessionFocus();
 focus.setBrowseAll(true);
 const snapshot={version:1 as const,sessions:[{id:'claude:a',activeUntil:0,attentionUntil:0,
   lastSeenAt:0,lastMainEventAt:0,completionPending:false,hadWork:false,subagents:[]}]};
 const view=focus.frame('idle',snapshot,[],0);wifi.read(10,[]);
 const usb=parseFocusLine(`TOUCH select=1 revision=${view.revision} presses=1 activate=0 pin=1 boot=10`)!;
 assert.equal(receipts.accept(usb),true);focus.act(usb,'idle',snapshot,[],1);
 assert.equal(focus.frame('idle',snapshot,[],2).pinned,true);
 // USB disconnects before Wi-Fi's next poll; its queue still contains that hold.
 const replay=wifi.read(10,[{sequence:1,index:1,revision:view.revision,activate:false,pin:true}]);
 assert.equal(replay.length,1);assert.equal(receipts.accept(replay[0]!),false);
 assert.equal(focus.frame('idle',snapshot,[],3).pinned,true);
 // A new hold unpins once; a reboot may reuse sequence numbers safely.
 const second=wifi.read(10,[{sequence:2,index:1,revision:view.revision,activate:false,pin:true}])[0]!;
 assert.equal(receipts.accept(second),true);focus.act(second,'idle',snapshot,[],4);
 assert.equal(focus.frame('idle',snapshot,[],5).pinned,false);
 assert.equal(receipts.accept({...second as object,boot:11} as typeof second),true);
});
