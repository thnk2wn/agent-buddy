import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DesktopAudio} from '../src/desktop-audio.js';

test('hidden Mac audio follows opt-in, volume and visibility without replaying old states', () => {
 const calls: Array<{cue:string;volume:number;finished:()=>void;stopped:boolean}> = [];
 const audio = new DesktopAudio((cue,volume,finished) => {
  const call={cue,volume,finished,stopped:false};calls.push(call);return ()=>{call.stopped=true;};
 },true);
 audio.play('complete');assert.equal(calls.length,0);
 audio.configure(true,false,10);assert.equal(calls.length,0);
 audio.play('working');assert.equal(calls[0]!.volume,10);
 audio.play('idle');assert.equal(calls.length,1);assert.equal(calls[0]!.stopped,false);
 audio.play('attention');assert.equal(calls[0]!.stopped,true);
 calls[0]!.finished(); // A replaced process cannot forget the current player.
 audio.configure(false,false,10);assert.equal(calls[1]!.stopped,true);
 audio.play('complete');assert.equal(calls.length,2);
 audio.configure(true,false,10);audio.play('complete');
 audio.configure(true,true,10);assert.equal(calls[2]!.stopped,true);
 audio.play('working');assert.equal(calls.length,3);
 audio.configure(true,false,20);assert.equal(calls.length,3);
 audio.play('surprise');assert.equal(calls[3]!.volume,20);
 audio.configure(true,false,0);assert.equal(calls[3]!.stopped,true);
 audio.play('complete');assert.equal(calls.length,4);
 audio.configure(true,false,10);audio.play('complete');audio.close();
 assert.equal(calls[4]!.stopped,true);audio.play('working');assert.equal(calls.length,5);
});
test('unsupported platforms never invoke the native audio player',()=>{
 const audio=new DesktopAudio(()=>{throw Error('must not play');},false);
 audio.configure(true,false,30);audio.play('working');audio.close();
});

test('switch ticks cannot interrupt alerts but can play once the alert finishes',()=>{
 const calls:Array<{cue:string;done:()=>void;stopped:boolean}>=[];
 const audio=new DesktopAudio((cue,_volume,done)=>{const c={cue,done,stopped:false};calls.push(c);return()=>{c.stopped=true;};},true);
 audio.configure(true,false,30);audio.play('attention');audio.play('switch');
 assert.equal(calls.length,1);assert.equal(calls[0]!.stopped,false);
 calls[0]!.done();audio.play('switch');assert.equal(calls[1]!.cue,'switch');
 audio.play('complete');assert.equal(calls[1]!.stopped,true);assert.equal(calls[2]!.cue,'complete');
 audio.close();
});
