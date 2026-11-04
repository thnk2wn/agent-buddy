import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ForegroundReader,desktopHint,foregroundScript} from '../src/foreground-session.js';
test('reader returns only observed app/validated terminal IDs and never drives input or activation',async()=>{
 const id='11111111-1111-1111-1111-111111111111';
 assert.deepEqual(await new ForegroundReader(async()=>JSON.stringify({app:'com.mitchellh.ghostty',terminalId:id})).read(),{app:'com.mitchellh.ghostty',terminalId:id});
 assert.equal((await new ForegroundReader(async()=>'{"app":null,"terminalId":"bad"}').read()).terminalId,null);
 assert.doesNotMatch(foregroundScript,/app\.focus|performAction|inputText|sendKey|newTab|activate\(/);
 assert.match(foregroundScript,/before===after/);
});
test('current desktop session is independent of displayed session; stale/future observations become unknown',()=>{
 const context={at:1000,current:'claude:a',other:['claude:b']};
 assert.deepEqual(desktopHint(context,['claude:a','claude:b'],'claude:b',1200),{index:1,state:'o',tick:1001,observedAt:1000});
 assert.equal(desktopHint(context,['claude:a','claude:b'],'claude:a',1200)?.state,'c');
 assert.equal(desktopHint(context,['claude:a','claude:b'],'claude:a',4500)?.state,'u');
 assert.equal(desktopHint(context,['claude:a','claude:b'],'claude:a',999)?.index,0);
 assert.equal(desktopHint(context,['claude:b'],'claude:b',1200)?.index,0);
 assert.equal(desktopHint(null,[],'claude:a',1200),undefined);
});
