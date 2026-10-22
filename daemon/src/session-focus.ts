import {randomInt} from 'node:crypto';
import type {CompactTarget} from './compact-caption.js';
import type {CharacterState} from './protocol.js';
import type {PersistedCoordinatorState, PersistedSession} from './state-coordinator.js';

export type FocusAction = 'next' | 'pin' | 'activate' | {index:number;revision:number;activate?:boolean};
export function isFocusAction(value:unknown):value is FocusAction {
  if(typeof value==='string')return ['next','pin','activate'].includes(value);
  if(!value || typeof value!=='object')return false;
  const v=value as {index?:number;revision?:number;activate?:boolean};
  return (v.activate===undefined||typeof v.activate==='boolean')&&Number.isInteger(v.index)&&Number(v.index)>=1&&Number(v.index)<=99
    &&Number.isInteger(v.revision)&&Number(v.revision)>0&&Number(v.revision)<=0xffffffff;
}
export interface SessionView {
  state: CharacterState;
  browsing?: boolean;
  revision?:number;
  targets?:CompactTarget[];
  sessionId: string | null;
  pinned: boolean;
  index: number;
  count: number;
  notice: boolean;
}
const working = (s: PersistedSession, now: number) => s.activeUntil > now || s.subagents.some(a => a.leaseUntil > now);

// Presentation only. Never changes the underlying work/attention leases.
export class SessionFocus {
  #browseAll = false;
  #roster='';
  #revision=randomInt(1,0xffffffff);
  setBrowseAll(enabled:boolean):void {this.#browseAll=enabled;if(enabled)this.#pinned='';}
  #browseUntil = 0;
  readonly browseMs = 12000;
  #selected = '';
  #until = 0;
  #pinned = '';
  #queue: {id: string; expires: number}[] = [];
  #notice: {id: string; until: number} | null = null;
  #prompt = '';
  readonly rotationMs = 8000;

  retains(id:string,now:number):boolean {return this.#queue.some(n=>n.id===id&&n.expires>now)||this.#notice?.id===id&&this.#notice.until>now;}
  prompt(id: string): void { this.#prompt = id; }
  completed(id: string, now: number): void {
    if (this.#queue.some(n => n.id === id) || this.#notice?.id === id) return;
    this.#queue.push({id, expires: now + 45000});
    if (this.#queue.length > 16) this.#queue.shift();
  }

  frame(state: CharacterState, snapshot: PersistedCoordinatorState, drivers: readonly string[], now: number): SessionView {
    if (!this.#browseAll) return this.#activityFrame(state,snapshot,drivers,now);
    const candidates=[...snapshot.sessions].sort((a,b)=>a.id.localeCompare(b.id));
    const roster=candidates.map(s=>s.id).join('\n');
    if(roster!==this.#roster){this.#roster=roster;this.#revision=this.#revision%0xffffffff+1;}
    this.#pinned='';
    const current=candidates.find(s=>s.id===this.#selected);
    // Manual navigation is a short reading window, never an indefinite pin.
    if(current && now<this.#browseUntil) {
      return this.#browseView({state:current.attentionUntil>now?'attention':working(current,now)?'working':'idle',
        sessionId:current.id,pinned:false,index:0,count:0,notice:false},candidates,now);
    }
    const view=this.#activityFrame(state,snapshot,drivers,now);
    if(view.sessionId) {
      this.#selected=view.sessionId;
      return this.#browseView(view,candidates,now);
    }
    // Keep idle sessions available when the activity carousel has nothing to show.
    this.#selected=current?.id ?? candidates[0]?.id ?? '';
    return this.#browseView({...view,state:this.#selected?'idle':state,sessionId:this.#selected||null},candidates,now);
  }

  #browseView(view:SessionView,candidates:readonly PersistedSession[],now:number):SessionView {
    const index=candidates.findIndex(s=>s.id===view.sessionId);
    const page=Math.max(0,Math.floor(index/4))*4;
    return {...view,browsing:true,pinned:false,revision:this.#revision,
      targets:candidates.slice(page,page+4).map((s,i)=>({index:page+i+1,agent:s.id.split(':')[0]!,
        state:s.attentionUntil>now?'a':working(s,now)?'w':'i'})),
      index:index+1,count:candidates.length};
  }

  #activityFrame(state: CharacterState, snapshot: PersistedCoordinatorState, drivers: readonly string[], now: number): SessionView {
    const sessions=snapshot.sessions;
    const available = sessions.filter(s => s.attentionUntil > now || working(s, now));
    if (!available.some(s => s.id === this.#pinned)) this.#pinned = '';
    // Resumed work or a new input request invalidates a queued completion.
    const valid = (id: string) => sessions.some(s => s.id === id && !working(s, now) && s.attentionUntil <= now);
    this.#queue = this.#queue.filter(n => n.expires > now && valid(n.id));
    if (this.#notice && (!valid(this.#notice.id) || this.#notice.until <= now)) this.#notice = null;
    const attention = available.filter(s => s.attentionUntil > now);
    if (!attention.length) {
      if (!this.#notice && this.#queue.length) this.#notice = {id: this.#queue.shift()!.id, until: now + 8000};
      if (this.#notice) return {state:'complete', sessionId:this.#notice.id, pinned:false, index:0, count:1, notice:true};
    } else if (this.#notice) {
      // Resume a readable notice after a real question, but never replay an old one much later.
      this.#queue.unshift({id:this.#notice.id, expires:now + 45000}); this.#notice = null;
    }
    const candidates = (attention.length ? attention : available.length ? available
      : state === 'complete' ? sessions.filter(s => drivers.includes(s.id)) : []).sort((a,b) => a.id.localeCompare(b.id));
    if (!candidates.length) {
      this.#selected = ''; this.#prompt = '';
      return {state,sessionId:null,pinned:false,index:0,count:0,notice:false};
    }
    const pinned = candidates.find(s => s.id === this.#pinned);
    const prompted = candidates.find(s => s.id === this.#prompt);
    const current = candidates.findIndex(s => s.id === this.#selected);
    let selected = pinned ?? (prompted && !this.#pinned ? prompted : undefined);
    this.#prompt = '';
    if (!selected) selected = current < 0 ? [...candidates].sort((a,b) => b.lastSeenAt-a.lastSeenAt)[0]
      : now >= this.#until ? candidates[(current+1)%candidates.length] : candidates[current];
    if (selected!.id !== this.#selected || now >= this.#until) this.#until = now + this.rotationMs;
    this.#selected = selected!.id;
    return {state:attention.length?'attention':available.length?'working':state,sessionId:this.#selected,
      pinned:this.#pinned===this.#selected,index:candidates.findIndex(s=>s.id===this.#selected)+1,count:candidates.length,notice:false};
  }

  act(action: FocusAction, state: CharacterState, snapshot: PersistedCoordinatorState, drivers: readonly string[], now: number): SessionView {
    if(typeof action==='object') {
      const view=this.frame(state,snapshot,drivers,now);
      if(!isFocusAction(action)||!this.#browseAll||action.revision!==this.#revision)return view;
      const selected=[...snapshot.sessions].sort((a,b)=>a.id.localeCompare(b.id))[action.index-1];
      if(!selected)return view;
      this.#selected=selected.id;this.#browseUntil=now+this.browseMs;this.#until=this.#browseUntil;
      return this.frame(state,snapshot,drivers,now);
    }
    // Use the last presented selection for a touch at a rotation boundary.
    if(this.#browseAll && snapshot.sessions.some(s=>s.id===this.#selected))this.#browseUntil=now+this.browseMs;
    const view = this.frame(state,snapshot,drivers,now);
    if(this.#browseAll) {
      this.#browseUntil=now+this.browseMs;
      this.#until=this.#browseUntil;
      if(action==='next' && snapshot.sessions.length) {
        const candidates=[...snapshot.sessions].sort((a,b)=>a.id.localeCompare(b.id));
        this.#selected=candidates[(candidates.findIndex(s=>s.id===view.sessionId)+1)%candidates.length]!.id;
      }
      return this.frame(state,snapshot,drivers,now);
    }
    if(action==='activate')return view;
    if (view.notice || !view.sessionId || !['working','attention'].includes(view.state)) return view;
    if (action === 'pin') this.#pinned = this.#pinned===view.sessionId ? '' : view.sessionId;
    else {
      // Cycling while pinned moves the pin too; it never dismisses an input request.
      const candidates=snapshot.sessions.filter(s=>view.state==='attention' ? s.attentionUntil>now
        : working(s,now)).sort((a,b)=>a.id.localeCompare(b.id));
      const next=candidates[(candidates.findIndex(s=>s.id===view.sessionId)+1)%candidates.length];
      if(next) {this.#selected=next.id;if(view.pinned)this.#pinned=next.id;}
    }
    this.#until=now+this.rotationMs;
    return this.frame(state,snapshot,drivers,now);
  }
}
