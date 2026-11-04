import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {terminalId} from './terminal-adapters.js';
import type {CompactCaption} from './compact-caption.js';
const exec=promisify(execFile);
export interface ForegroundObservation {app:string|null;terminalId:string|null}
export interface DesktopContext {at:number;current:string|null;other:string[]}
// No Accessibility scraping, titles, terminal input, or activation. Ghostty's
// front window -> selected tab -> focused terminal identifies the exact surface.
export const foregroundScript=`ObjC.import('AppKit');
function front(){return ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier)||null;}
const before=front();let terminal=null;
if(before==='com.mitchellh.ghostty') {
 try {
  const app=Application('com.mitchellh.ghostty');
  if(app.running()&&app.frontmost()) {
   const win=app.frontWindow(),tab=win.selectedTab(),id=tab.focusedTerminal.id();
   if(app.frontmost()&&app.frontWindow.id()===win.id()&&app.frontWindow.selectedTab.id()===tab.id()
      &&tab.focusedTerminal.id()===id)terminal=id;
  }
 } catch(_) {} // Missing permission/window is unknown, never the last activated tab.
}
const after=front();JSON.stringify(before===after?{app:after,terminalId:terminal}:{app:null,terminalId:null});`;
export class ForegroundReader {
 constructor(private readonly run=async()=> (await exec('/usr/bin/osascript',['-l','JavaScript','-e',foregroundScript],
  {timeout:1800,maxBuffer:4096})).stdout){}
 async read():Promise<ForegroundObservation> {
  const row=JSON.parse(await this.run());
  return {app:typeof row.app==='string'?row.app:null,terminalId:terminalId(row.terminalId)?row.terminalId:null};
 }
}
export function desktopHint(context:DesktopContext|null,ids:readonly string[],selected:string,now:number):CompactCaption['desktop'] {
 if(!context)return undefined;
 const fresh=now>=context.at&&now-context.at<3500;
 const index=fresh&&context.current?ids.indexOf(context.current)+1:0;
 return {index,state:fresh&&context.current===selected?'c':fresh&&context.other.includes(selected)?'o':'u',
  observedAt:context.at,tick:Math.floor(context.at%0xffffffff)+1};
}
