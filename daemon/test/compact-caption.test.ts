import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compactPacket} from '../src/compact-caption.js';
import {DeviceTransport} from '../src/device-transport.js';
import {UsbTransport} from '../src/usb-transport.js';
import {WifiTransport} from '../src/wifi-transport.js';
test('compact metadata is bounded, printable, and cannot inject device commands',()=>{
 const packet=compactPacket({agent:'Claude',state:'idle',index:2,count:4,project:'jax-api',title:'Café|\n!sleep '+ 'x'.repeat(500)});
 assert.equal(packet.split('\n').length,2);assert.equal(packet.split('|').length,6);
 assert.ok(packet.length<384);assert.match(packet,/Cafe !sleep/);assert.equal(compactPacket(null),'~\n');
 assert.equal(compactPacket({agent:'a',state:'idle\n!sleep' as never,index:1,count:4,project:'p',title:'t'}),'~\n');
 assert.equal(compactPacket({agent:'a',state:'idle',index:0,count:4,project:'p',title:'t'}),'~\n');
});
test('compact title changes never replay character or sound events',t=>{
 t.mock.method(UsbTransport.prototype,'setState',()=>{throw Error('state replay');});
 t.mock.method(WifiTransport.prototype,'setState',()=>{throw Error('state replay');});
 const sent:unknown[]=[];t.mock.method(WifiTransport.prototype,'setCompact',(c:unknown)=>sent.push(c));
 const device=new DeviceTransport();device.setCompact(null);
 device.setCompact({agent:'Claude',state:'idle',index:2,count:4,project:'jax-api',title:'Project roadmap'});
 assert.equal(sent.length,2);
});

test('protocol 14 indicators are bounded, revisioned, and omitted for protocol 13 devices',()=>{
 const caption={agent:'Claude',state:'idle' as const,index:1,count:4,project:'x'.repeat(64),title:'y'.repeat(256),revision:4294967295,
 targets:[1,2,3,4].map(index=>({index,agent:'claude',state:'w' as const}))};
 assert.ok(compactPacket(caption).length<512);assert.equal(compactPacket(caption).split('|').length,8);
 assert.equal(compactPacket(caption,13).split('|').length,6);
 assert.equal(compactPacket({...caption,targets:[{index:5,agent:'claude',state:'w'}]}),'~\n');
 assert.equal(compactPacket({...caption,targets:[{index:1,agent:'bad|agent',state:'w'}]}),'~\n');
 assert.equal(compactPacket({...caption,targets:[caption.targets[0]!,caption.targets[0]!]}),'~\n');
});
