import type {CharacterState} from './protocol.js';
import type {AgentBadgeActive, AgentBadgeIconDefinition} from './agent-badges.js';
import {captionCards, captionFrame, captionText} from './task-captions.js';

export interface DemoFrame {
  key: number;
  state: CharacterState;
  lines: string[];
  icons: readonly AgentBadgeIconDefinition[];
  active: readonly AgentBadgeActive[];
}
export const demoStages: {label:string; state:CharacterState; durationMs:number; phrase:string}[] = [
  {label:'Ready',state:'idle',durationMs:5000,phrase:'Ready'},
  {label:'Claude working',state:'working',durationMs:12000,phrase:'Claude working'},
  {label:'Needs your input',state:'attention',durationMs:8000,phrase:'Claude needs input'},
  {label:'Working again',state:'working',durationMs:8000,phrase:'Claude working'},
  {label:'Finished',state:'complete',durationMs:4000,phrase:'Claude finished'},
  {label:'Quiet idle',state:'idle',durationMs:8000,phrase:'Ready when you are'},
  {label:'Sleeping',state:'sleep',durationMs:10000,phrase:'Recharging ideas'},
];
export type DemoAction = 'stage'|'start'|'pause'|'next'|'restart'|'exit'|'status';

// Only presentation is overridden. Real hook/session state continues updating underneath.
export class DeviceDemo {
  #active=false;
  #running=false;
  #stage=0;
  #elapsed=0;
  #countdown=0;
  #last=0;
  #key=0;
  #project='';
  #title='';
  #timer: NodeJS.Timeout | null=null;
  constructor(readonly display:(frame:DemoFrame|null)=>void,
    readonly icons:readonly AgentBadgeIconDefinition[], readonly now=()=>performance.now()) {}

  command(action:DemoAction, context?:{project:string;title:string}) {
    if (action==='status') return this.status();
    this.tick();
    if (action==='exit') {this.close();return this.status();}
    if (action==='stage') {
      this.#project=captionText(context?.project || 'Project');
      this.#title=captionText(context?.title || 'Demo session');
      this.#active=true;this.#running=false;this.#stage=0;this.#elapsed=0;this.#countdown=0;this.#key++;
      this.#last=this.now();
      this.#timer ??= setInterval(()=>this.tick(),100);
      this.#timer.unref();
    } else {
      if (!this.#active) throw new Error('Stage a demo first.');
      if (action==='pause') this.#running=false;
      if (action==='restart') {this.#stage=0;this.#elapsed=0;this.#running=false;this.#countdown=0;this.#key++;}
      if (action==='start') {
        if (this.#stage===demoStages.length-1 && this.#elapsed>=demoStages[this.#stage]!.durationMs) {
          this.#stage=0;this.#elapsed=0;this.#key++;
        }
        this.#key++; // Reassert the stage if firmware fell asleep while waiting to record.
        this.#countdown=5000;this.#running=true;this.#last=this.now();
      }
      if (action==='next') {this.#stage=Math.min(demoStages.length-1,this.#stage+1);this.#elapsed=0;this.#countdown=0;this.#key++;}
    }
    this.#render();return this.status();
  }
  tick() {
    const now=this.now();let dt=Math.max(0,now-this.#last);this.#last=now;
    if (!this.#active || !this.#running) return;
    if (this.#countdown>0) {const used=Math.min(dt,this.#countdown);this.#countdown-=used;dt-=used;}
    this.#elapsed+=dt;
    while (this.#elapsed>=demoStages[this.#stage]!.durationMs) {
      if (this.#stage===demoStages.length-1) {
        this.#elapsed=demoStages[this.#stage]!.durationMs;this.#running=false;break;
      }
      this.#elapsed-=demoStages[this.#stage]!.durationMs;this.#stage++;this.#key++;
    }
    this.#render();
  }
  #render() {
    if (!this.#active) return;
    const stage=demoStages[this.#stage]!;
    const resting=stage.state==='idle' || stage.state==='sleep';
    const context={status:stage.phrase,project:resting?'':this.#project,title:resting?'':this.#title};
    const duration=captionCards(context).reduce((sum,card)=>sum+card.durationMs,0);
    const lines=captionFrame(context,Math.min(this.#elapsed,duration-1)).lines;
    const active:AgentBadgeActive[]=resting?[]:[{id:'claude',role:stage.state==='attention'?'a':stage.state==='complete'?'c':'w'}];
    this.display({key:this.#key,state:stage.state,lines,icons:this.icons,active});
  }
  status() {return {active:this.#active,running:this.#running,stage:this.#stage,label:demoStages[this.#stage]!.label,
    elapsedMs:this.#elapsed,countdownMs:this.#countdown,durationMs:demoStages[this.#stage]!.durationMs,
    title:this.#title,project:this.#project,totalMs:demoStages.reduce((sum,s)=>sum+s.durationMs,0)};}
  close() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer=null;this.#active=false;this.#running=false;this.#countdown=0;this.display(null);
  }
}
