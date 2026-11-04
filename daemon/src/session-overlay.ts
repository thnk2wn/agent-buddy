import {spawn,type ChildProcess} from 'node:child_process';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
// Optional native helper: no shell, notification permission, focus, or terminal input.
export class SessionOverlay {
 #child:ChildProcess|undefined;
 constructor(private readonly binary=fileURLToPath(new URL('./session-overlay-macos',import.meta.url))){}
 hide(){this.#child?.kill();this.#child=undefined;}
 async show(text:string) {
  await access(this.binary);this.hide();
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(this.binary,[text],{stdio:'ignore'});this.#child=child;
   child.once('error',reject);child.once('spawn',resolve);
   child.once('exit',()=>{if(this.#child===child)this.#child=undefined;});
  });
 }
}
