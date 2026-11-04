import assert from 'node:assert/strict';
import {test} from 'node:test';
import {screenProtectionConfig,quietSeconds,screenProtectionPacket} from '../src/screen-protection.js';
const config=screenProtectionConfig({timeZone:'America/New_York'});
test('protection uses requested thresholds and local midnight through six',()=>{
 assert.equal(config.dimAfterMinutes,15);assert.equal(config.offAfterMinutes,60);
 assert.equal(quietSeconds(config,new Date('2026-10-22T03:59:59Z')),0);
 assert.equal(quietSeconds(config,new Date('2026-10-22T04:00:00Z')),21600);
 assert.equal(quietSeconds(config,new Date('2026-10-22T09:59:59Z')),1);
 assert.equal(quietSeconds(config,new Date('2026-10-22T10:00:00Z')),0);
 assert.equal(quietSeconds(config,new Date('2026-12-22T05:00:00Z')),21600);
});
test('overnight crossing midnight and disabled quiet windows',()=>{
 const cross=screenProtectionConfig({timeZone:'UTC',quietStartHour:22,quietEndHour:6});
 assert.equal(quietSeconds(cross,new Date('2026-10-22T23:00:00Z')),7*3600);
 assert.equal(quietSeconds(cross,new Date('2026-10-22T12:00:00Z')),0);
 assert.equal(quietSeconds({...cross,quietEndHour:22},new Date('2026-10-22T23:00:00Z')),0);
});
test('packets carry aggregate state even while quiet, never session titles',()=>{
 assert.equal(screenProtectionPacket(config,'working',new Date('2026-10-22T04:00:00Z')), '>1|900|3600|20|21600|w|1|60\n');
 assert.match(screenProtectionPacket(config,'attention'),/\|a\|1\|60\n$/);
 assert.match(screenProtectionPacket(config,'complete'),/\|i\|1\|60\n$/);
});
test('invalid protection settings fail validation',()=>{
 for(const bad of [{offAfterMinutes:2},{dimAfterMinutes:0},{dimPercent:101},{quietEndHour:24},{enabled:'false'},{timeZone:'made/up'},null,[]])assert.throws(()=>screenProtectionConfig(bad));
});


test('screen policy updates use a separate transport command, never an animation event',async t=>{
 const {DeviceTransport}=await import('../src/device-transport.js');
 const {WifiTransport}=await import('../src/wifi-transport.js');
 const {UsbTransport}=await import('../src/usb-transport.js');
 t.mock.method(UsbTransport.prototype,'setState',()=>{throw Error('unexpected animation event');});
 t.mock.method(WifiTransport.prototype,'setState',()=>{throw Error('unexpected animation event');});
 const sent:string[]=[];t.mock.method(WifiTransport.prototype,'setScreenProtection',(p:string)=>sent.push(p));
 const transport=new DeviceTransport();const packet=screenProtectionPacket(config,'working');
 transport.setScreenProtection(packet);assert.deepEqual(sent,[packet]);
});
