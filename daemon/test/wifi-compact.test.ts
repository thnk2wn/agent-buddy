import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WifiTransport} from '../src/wifi-transport.js';
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');}
test('slow Wi-Fi sends newest compact snapshot and neutralizes expired foreground evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-wifi-compact-')),path=join(root,'wifi.json');
 const prior=process.env.AGENT_COMPANION_WIFI_CONFIG;process.env.AGENT_COMPANION_WIFI_CONFIG=path;
 t.after(async()=>{if(prior===undefined)delete process.env.AGENT_COMPANION_WIFI_CONFIG;else process.env.AGENT_COMPANION_WIFI_CONFIG=prior;await rm(root,{recursive:true,force:true});});
 await writeFile(path,JSON.stringify({deviceId:'1111111111111111',token:'1'.repeat(32),address:'127.0.0.1',port:12345}));
 const packets:string[]=[];let screens=0;
 t.mock.method(globalThis,'fetch',async(input:unknown,options?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/status'))return Response.json({deviceId:'1111111111111'.padEnd(16,'1'),boot:1,protocol:18,orientationOffsetTenths:0});
  if(url.endsWith('/switcher')){packets.push(String(options?.body));await new Promise(r=>setTimeout(r,80));}
  if(url.endsWith('/screen')){screens++;await new Promise(r=>setTimeout(r,100));}
  return Response.json({ok:true});
 });
 const wifi=new WifiTransport();wifi.setEnabled(true);
 const c=(tick:number,observedAt=Date.now())=>({agent:'Claude',state:'idle' as const,index:1,count:1,project:'p',title:'t',revision:1,
 targets:[{index:1,agent:'claude',state:'i' as const}],desktop:{index:1,state:'c' as const,tick,observedAt}});
 try{
  await wifi.start();await until(()=>wifi.connected);wifi.setCompact(c(1));await until(()=>packets.length===1);
  for(let i=2;i<=30;i++)wifi.setCompact(c(i));
  await until(()=>packets.length===2);await new Promise(r=>setTimeout(r,100));assert.equal(packets.length,2);assert.match(packets[1]!,/1:c:30/);
  wifi.setScreenProtection('>1|900|3600|20|0|w|1|60\n');await until(()=>screens===1);
  wifi.setCompact(c(31,Date.now()-3450));await until(()=>packets.length===3);assert.match(packets[2]!,/0:u:31/);
  await new Promise(r=>setTimeout(r,100));
 }finally{wifi.stop();}
});
