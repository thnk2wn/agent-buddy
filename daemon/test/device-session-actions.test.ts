import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deviceSessionAction} from '../src/device-session-actions.js';
import type {SessionView,FocusAction} from '../src/session-focus.js';
test('character taps activate repeatedly, captions cycle, and disabled switcher keeps legacy pin',()=>{
 const actions:FocusAction[]=[],opened:(string|null)[]=[];let enabled=true;
 const view:SessionView={state:'idle',sessionId:'claude:a',pinned:false,index:1,count:4,notice:false,browsing:true};
 const display={sessionView:view,focusSession:(action:FocusAction)=>{actions.push(action);}};
 const launcher={status:()=>({enabled}),deviceActivated:(id:string|null)=>{opened.push(id);}};
 deviceSessionAction('pin',display,launcher);deviceSessionAction('pin',display,launcher);deviceSessionAction('next',display,launcher);
 assert.deepEqual(actions,['activate','activate','next']);assert.deepEqual(opened,['claude:a','claude:a']);assert.equal(view.pinned,false);
 enabled=false;deviceSessionAction('pin',display,launcher);assert.equal(actions.at(-1),'pin');assert.equal(opened.length,2);
});

test('direct indicator taps activate only a validated roster target',()=>{
 const opened:(string|null)[]=[];let accepted=true;
 const display={sessionView:{state:'idle',sessionId:'claude:b',pinned:false,index:2,count:3,notice:false} as SessionView,
  focusSession:(_action:FocusAction)=>accepted};
 const launcher={status:()=>({enabled:true}),deviceActivated:(id:string|null)=>opened.push(id)};
 deviceSessionAction({index:2,revision:7,activate:true},display,launcher);assert.deepEqual(opened,['claude:b']);
 accepted=false;deviceSessionAction({index:2,revision:6,activate:true},display,launcher);assert.equal(opened.length,1);
});
