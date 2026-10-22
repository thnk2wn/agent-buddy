import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DeviceDemo, type DemoFrame} from '../src/device-demo.js';
import {DeviceTransport} from '../src/device-transport.js';
import {UsbTransport} from '../src/usb-transport.js';
import {WifiTransport} from '../src/wifi-transport.js';

test('stages paused, counts down, advances through every state, and holds the ending isolated', t=>{
 let now=0; const frames:(DemoFrame|null)[]=[];
 const demo=new DeviceDemo(frame=>frames.push(frame),[],()=>now);t.after(()=>demo.close());
 demo.command('stage',{project:'teamjobot',title:'Jobot Potential Impact'});
 assert.equal(demo.status().running,false);
 now=10000;demo.tick();assert.equal(demo.status().stage,0);
 demo.command('start');now+=5000;demo.tick();assert.equal(demo.status().elapsedMs,0);
 now+=5000;demo.tick();assert.equal(frames.at(-1)?.state,'working');
 assert.deepEqual(frames.at(-1)?.active,[{id:'claude',role:'w'}]);
 now+=3000;demo.tick();assert.deepEqual(frames.at(-1)?.lines,['Jobot Potential','Impact']);
 demo.command('pause');now+=20000;demo.tick();assert.equal(demo.status().elapsedMs,3000);
 demo.command('start');now+=5000;demo.tick();assert.equal(demo.status().elapsedMs,3000);
 now+=9000;demo.tick();assert.equal(frames.at(-1)?.state,'attention');
 now+=8000;demo.tick();assert.equal(frames.at(-1)?.state,'working');
 now+=8000;demo.tick();assert.equal(frames.at(-1)?.state,'complete');
 now+=4000;demo.tick();assert.equal(frames.at(-1)?.state,'idle');
 now+=8000;demo.tick();assert.equal(frames.at(-1)?.state,'sleep');
 assert.deepEqual(frames.at(-1)?.active,[]);
 assert.deepEqual(frames.at(-1)?.lines,['Recharging ideas']);
 now+=10000;demo.tick();assert.equal(demo.status().running,false);assert.equal(demo.status().active,true);
 demo.command('restart');assert.equal(demo.status().stage,0);assert.equal(demo.status().running,false);
 demo.command('next');assert.equal(demo.status().stage,1);
 demo.command('exit');assert.equal(frames.at(-1),null);
});

for (const via of ['usb','wifi'] as const) test(`live states, badges and text cannot interrupt demo over ${via}; exit restores latest live values`,t=>{
 const states:string[]=[];const captions:string[][]=[];const badges:unknown[]=[];
 t.mock.getter(UsbTransport.prototype,'connected',()=>via==='usb');
 t.mock.getter(WifiTransport.prototype,'connected',()=>via==='wifi');
 t.mock.method(WifiTransport.prototype,'setEnabled',()=>{});
 const target=via==='usb'?UsbTransport.prototype:WifiTransport.prototype;
 t.mock.method(target,'setState',(state:string)=>states.push(state));
 t.mock.method(target,'setUsage',(lines:readonly string[])=>captions.push([...lines]));
 t.mock.method(target,'setAgentBadges',(_icons:unknown,active:unknown)=>badges.push(active));
 const transport=new DeviceTransport();
 const frame:DemoFrame={key:1,state:'working',lines:['Claude working'],icons:[],active:[{id:'claude',role:'w'}]};
 transport.setDemo(frame);
 for(let i=0;i<10;i++) {
  transport.setState('attention');
  transport.setAgentBadges([],[{id:'codex',role:'a'}]);
  transport.setUsage(['Codex needs input']);
  transport.setDemo({...frame,lines:['Jobot Potential','Impact']});
 }
 assert.deepEqual(states,['working']);
 assert.ok(captions.every(lines=>!lines.join(' ').includes('Codex')));
 assert.ok(badges.every(active=>JSON.stringify(active).includes('claude')));
 transport.setDemo(null);
 assert.equal(states.at(-1),'attention');
 assert.deepEqual(captions.at(-1),['Codex needs input']);
 assert.deepEqual(badges.at(-1),[{id:'codex',role:'a'}]);
});
