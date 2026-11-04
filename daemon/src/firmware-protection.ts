import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export interface FirmwareProtectionStatus {
 enabled: boolean;
 knownCustom: boolean;
 label: string;
 confirmation: string | null;
}
export const protectedFirmwareMessage = 'Custom firmware is protected. Stock Agent Buddy firmware would remove your fork features. Use the explicit replacement option in USB recovery only if you intend to lose those features.';

/** Lives outside the installed runtime, so restarting or rebuilding the app cannot reset it. */
export class FirmwareProtection {
 constructor(private readonly path:string) {}
 status(device:string|null,release:string|null):FirmwareProtectionStatus {
  let raw:string;
  try {raw=readFileSync(this.path,'utf8');}
  catch(error) {
   if((error as NodeJS.ErrnoException).code==='ENOENT')return {enabled:false,knownCustom:false,label:'',confirmation:null};
   return {enabled:true,knownCustom:false,label:'Firmware protection needs attention',confirmation:null};
  }
  try {
   const value=JSON.parse(raw);
   if(value.enabled===false)return {enabled:false,knownCustom:false,label:'',confirmation:null};
   if(value.enabled!==true||!Array.isArray(value.builds)||value.builds.some((id:unknown)=>typeof id!=='string'||!/^[a-f0-9]{16}$/.test(id)))throw Error('Invalid policy');
   return {enabled:true,knownCustom:!!device&&value.builds.includes(device),
    label:'Custom firmware protected',
    confirmation:release?createHash('sha256').update(raw+'\0'+(device??'disconnected')+'\0'+release).digest('hex'):null};
  } catch {return {enabled:true,knownCustom:false,label:'Firmware protection needs attention',confirmation:null};}
 }
 assertReplacement(device:string|null,release:string|null,acknowledgement?:unknown):void {
  const status=this.status(device,release);
  if(status.enabled&&(!status.confirmation||acknowledgement!==status.confirmation))throw Error(protectedFirmwareMessage);
 }
}
