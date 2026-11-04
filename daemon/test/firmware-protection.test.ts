import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FirmwareProtection} from '../src/firmware-protection.js';
import {CompanionService} from '../src/companion-service.js';
import {DeviceTransport} from '../src/device-transport.js';
import {StateCoordinator} from '../src/state-coordinator.js';
import {defaultAgentContext} from '../src/agents/index.js';

test('persistent firmware guard requires fresh explicit acknowledgement and fails closed',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-firmware-guard-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'firmware-protection.json'),p=new FirmwareProtection(path),id='aaaaaaaaaaaaaaaa';
 assert.equal(p.status(id,'1.0').enabled,false);
 await writeFile(path,JSON.stringify({enabled:true,builds:[id]}));
 assert.equal(p.status(id,'1.0').knownCustom,true);
 assert.throws(()=>p.assertReplacement(id,'1.0'),/protected/);
 assert.throws(()=>p.assertReplacement(id,'1.0',true),/protected/);
 const ack=p.status(id,'1.0').confirmation!;
 assert.doesNotThrow(()=>new FirmwareProtection(path).assertReplacement(id,'1.0',ack));
 assert.throws(()=>p.assertReplacement('bbbbbbbbbbbbbbbb','1.0',ack),/protected/);
 assert.throws(()=>p.assertReplacement(id,'2.0',ack),/protected/);
 assert.throws(()=>p.assertReplacement(null,'1.0',ack),/protected/);
 assert.throws(()=>p.assertReplacement(null,'1.0'),/protected/);
 await writeFile(path,'broken');assert.equal(p.status(id,'1.0').enabled,true);
 assert.throws(()=>p.assertReplacement(id,'1.0',ack),/protected/);
 assert.throws(()=>p.assertReplacement(id,'1.0',null),/protected/);
});

test('service blocks direct firmware replacement before touching USB or preparing firmware',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-firmware-service-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'firmware-protection.json'),JSON.stringify({enabled:true,builds:['aaaaaaaaaaaaaaaa']}));
 const coordinator=new StateCoordinator(()=>{},{sweepMs:0});t.after(()=>coordinator.close());
 class Device extends DeviceTransport {override async findUsbPort():Promise<never>{throw Error('Must not touch USB');}}
 const service=new CompanionService(new Device(),coordinator,defaultAgentContext({home:root,dataDir:root,env:{}}));
 await assert.rejects(service.installFirmwareOverUsb('/dev/test'),/Custom firmware is protected/);
 await assert.rejects(service.updateFirmware(),/Custom firmware is protected/);
 assert.equal(service.installBusy,false);
});

test('protection enabled while releasing USB prevents flashing',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-firmware-race-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {DesktopApp}=await import('../src/desktop-app.js');
 const {FirmwareReleases}=await import('../src/firmware-release.js');
 const coordinator=new StateCoordinator(()=>{},{sweepMs:0});t.after(()=>coordinator.close());
 const policy=join(root,'firmware-protection.json');let flashed=false,released=false;
 class Device extends DeviceTransport {
  override get firmware(){return 'aaaaaaaaaaaaaaaa';}
  override async findUsbPort(){return {path:'/dev/test',pid:4097,serialNumber:'test'};}
  override async selectUsbPort(){}
  override async withUsbReleased<T>(run:()=>Promise<T>):Promise<T>{
   released=true;await writeFile(policy,JSON.stringify({enabled:true,builds:['aaaaaaaaaaaaaaaa']}));return run();
  }
 }
 const app=new DesktopApp();t.mock.method(app,'flasher',()=>'/fake/app');
 const releases=new FirmwareReleases();t.mock.method(releases,'prepare',async()=>({version:'1.0',board:'waveshare-amoled-175',dir:'/fake/firmware',id:'bbbbbbbbbbbbbbbb'}));
 const service=new CompanionService(new Device(),coordinator,defaultAgentContext({home:root,dataDir:root,env:{}}),[],undefined,app,undefined,undefined,
  {releases,flash:async()=>{flashed=true;}});
 // This instance's metadata normally comes from the installed runtime VERSION file.
 service.status().service.version='1.0';
 await assert.rejects(service.installFirmwareOverUsb('/dev/test','waveshare-amoled-175'),/Custom firmware is protected/);
 assert.equal(released,true);assert.equal(flashed,false);assert.equal(service.installBusy,false);
});
