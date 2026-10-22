import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SessionInputTracker} from '../src/session-input.js';
const event=(sequence:number,index:number,activate=false)=>({sequence,index,revision:7,activate});
test('Wi-Fi preserves select/open order, rejects replay, and baselines on reconnect or reboot',()=>{
 const t=new SessionInputTracker();assert.deepEqual(t.read(1,[]),[]);
 assert.deepEqual(t.read(1,[event(1,2),event(2,2,true)]),[{index:2,revision:7},{index:2,revision:7,activate:true}]);
 assert.deepEqual(t.read(1,[event(1,2),event(2,2,true)]),[]);
 assert.deepEqual(t.read(1,[event(3,1,true),event(4,3)]),[{index:1,revision:7,activate:true},{index:3,revision:7}]);
 assert.deepEqual(t.read(2,[event(1,2,true)]),[]);
 assert.deepEqual(t.read(2,[event(2,2,true)],true),[]);
 assert.deepEqual(t.read(2,[event(3,2,true)]),[{index:2,revision:7,activate:true}]);
 assert.deepEqual(t.read(2,[{...event(4,1),revision:0}]),[]);
});
test('Wi-Fi sequence rollover still delivers each new input once',()=>{
 const t=new SessionInputTracker();t.read(1,[event(0xffffffff,1)]);
 assert.deepEqual(t.read(1,[event(0xffffffff,1),event(1,2,true)]),[{index:2,revision:7,activate:true}]);
 assert.deepEqual(t.read(1,[event(0xffffffff,1),event(1,2,true)]),[]);
});
