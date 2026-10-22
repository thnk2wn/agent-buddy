import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionService} from '../src/companion-service.js';
import {DeviceTransport} from '../src/device-transport.js';
import {StateCoordinator} from '../src/state-coordinator.js';
import {LiveCaptions} from '../src/live-captions.js';
import {defaultAgentContext} from '../src/agents/index.js';
import type {CharacterState} from '../src/protocol.js';
import type {AgentBadgeActive,AgentBadgeIconDefinition} from '../src/agent-badges.js';
class Device extends DeviceTransport {
 value:CharacterState='idle'; states:CharacterState[]=[]; badges:readonly AgentBadgeActive[]=[];
 override get state(){return this.value;}
 override setState(state:CharacterState){this.value=state;this.states.push(state);}
 override setUsage(_lines:readonly string[]){}
 override setAgentBadges(_icons:readonly AgentBadgeIconDefinition[],active:readonly AgentBadgeActive[]){this.badges=active;}
}
test('service routes completion and focus consistently without changing aggregate activity or replaying work',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-focus-service-'));
 const env={AGENT_COMPANION_AGENTS_CONFIG:join(root,'agents.json'),AGENT_COMPANION_DISPLAY_CONFIG:join(root,'display.json')};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(async()=>{await new Promise(r=>setTimeout(r,50));for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(root,{recursive:true,force:true});});
 let now=1000;t.mock.method(Date,'now',()=>now);t.mock.getter(LiveCaptions.prototype,'enabled',()=>true);
 const c=new StateCoordinator(()=>{},{sweepMs:0});t.after(()=>c.close());const d=new Device();
 const service=new CompanionService(d,c,defaultAgentContext({home:root,dataDir:root,env:{}}));
 service.handleHook('claude','userPromptSubmitted',{sessionId:'a'});
 service.handleHook('codex','userPromptSubmitted',{sessionId:'b'});
 service.handleHook('claude','preToolUse',{sessionId:'a'});
 service.handleHook('codex','preToolUse',{sessionId:'b'});
 assert.equal(service.sessionView?.sessionId,'codex:b');assert.deepEqual(d.badges,[{id:'codex',role:'w'}]);
 const stateCount=d.states.length;service.focusSession('next');assert.equal(d.states.length,stateCount);
 assert.equal(service.sessionView?.sessionId,'claude:a');assert.deepEqual(d.badges,[{id:'claude',role:'w'}]);
 service.handleHook('claude','agentStop',{sessionId:'a',clearAttention:true});
 assert.equal(c.state,'working');assert.equal(d.state,'complete');assert.equal(service.sessionView?.notice,true);
 assert.deepEqual(d.badges,[{id:'claude',role:'c'}]);
 service.handleHook('codex','notification',{sessionId:'b',automaticApproval:true});assert.equal(d.state,'complete');
 now+=8000;service.syncUsage();assert.equal(d.state,'working');assert.deepEqual(d.badges,[{id:'codex',role:'w'}]);
 service.focusSession('pin');assert.equal(service.sessionView?.pinned,true);
 service.handleHook('codex','agentStop',{sessionId:'b',clearAttention:true});assert.equal(service.sessionView?.pinned,false);
 assert.deepEqual(c.drivingSessionIds,['codex:b']);
});

test('installed switcher presentation returns from idle browsing to concurrent work without new hooks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-switcher-service-'));
 const env={AGENT_COMPANION_AGENTS_CONFIG:join(root,'agents.json'),AGENT_COMPANION_DISPLAY_CONFIG:join(root,'display.json')};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(async()=>{await new Promise(r=>setTimeout(r,50));for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(root,{recursive:true,force:true});});
 let now=1000;t.mock.method(Date,'now',()=>now);t.mock.getter(LiveCaptions.prototype,'enabled',()=>true);
 const c=new StateCoordinator(()=>{},{sweepMs:0});t.after(()=>c.close());const d=new Device();
 const service=new CompanionService(d,c,defaultAgentContext({home:root,dataDir:root,env:{}}));
 service.setSwitchableSessions([{id:'claude:a',cwd:'/roadmap'},
  {id:'claude:b',cwd:'/tracker'},{id:'codex:c',cwd:'/game'}]);
 service.focusSession('activate'); // holds idle roadmap while another session starts
 service.handleHook('claude','userPromptSubmitted',{sessionId:'b'});
 service.handleHook('codex','userPromptSubmitted',{sessionId:'c'});
 service.handleHook('claude','preToolUse',{sessionId:'b'});
 service.handleHook('codex','preToolUse',{sessionId:'c'});
 assert.equal(service.sessionView?.sessionId,'claude:a');assert.equal(d.state,'idle');assert.equal(c.state,'working');
 now=13000;service.syncUsage();assert.equal(d.state,'working');assert.equal(service.sessionView?.sessionId,'codex:c');
 now=21000;service.syncUsage();assert.equal(service.sessionView?.sessionId,'claude:b');assert.equal(d.state,'working');
 assert.deepEqual(d.badges,[{id:'claude',role:'w'}]);assert.equal(service.sessionView?.count,3);
 service.focusSession('next');service.focusSession('next');assert.equal(service.sessionView?.sessionId,'claude:a');
 assert.equal(d.state,'idle');assert.equal(c.state,'working');
 now=33000;service.syncUsage();assert.equal(d.state,'working');
 // Finishing the last worker during manual browsing still produces a notice later.
 service.focusSession('activate');
 service.handleHook('claude','agentStop',{sessionId:'b',clearAttention:true});
 service.handleHook('codex','agentStop',{sessionId:'c',clearAttention:true});
 now=45000;service.syncUsage();assert.equal(d.state,'complete');assert.equal(service.sessionView?.sessionId,'claude:b');
 now=53000;service.syncUsage();assert.equal(d.state,'complete');assert.equal(service.sessionView?.sessionId,'codex:c');
});

test('switcher keeps undiscovered activity visible and reports completion after the last child stops',async t=>{
 const root=await mkdtemp(join(tmpdir(),'buddy-review-service-'));
 const env={AGENT_COMPANION_AGENTS_CONFIG:join(root,'agents.json'),AGENT_COMPANION_DISPLAY_CONFIG:join(root,'display.json')};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(async()=>{await new Promise(r=>setTimeout(r,50));for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(root,{recursive:true,force:true});});
 let now=1000;t.mock.method(Date,'now',()=>now);t.mock.getter(LiveCaptions.prototype,'enabled',()=>true);
 const c=new StateCoordinator(()=>{},{sweepMs:0});t.after(()=>c.close());const d=new Device();
 const service=new CompanionService(d,c,defaultAgentContext({home:root,dataDir:root,env:{}}));
 service.setSwitchableSessions([{id:'claude:parent',cwd:'/project'},{id:'codex:desktop',cwd:'/game'}]);
 service.handleHook('codex','preToolUse',{sessionId:'cli'});
 assert.equal(d.state,'working');assert.equal(service.sessionView?.sessionId,'codex:cli');assert.equal(service.sessionView?.count,3);
 service.handleHook('codex','notification',{sessionId:'cli'});
 assert.equal(d.state,'attention');assert.equal(service.sessionView?.sessionId,'codex:cli');
 service.handleHook('codex','preToolUse',{sessionId:'cli'});
 service.handleHook('claude','preToolUse',{sessionId:'parent'});
 service.handleHook('claude','subagentStart',{sessionId:'child-session',parentSessionId:'parent',agentId:'child'});
 service.focusSession('activate');
 service.handleHook('claude','agentStop',{sessionId:'parent',clearAttention:true});
 service.handleHook('claude','subagentStop',{sessionId:'child-session',agentId:'child'});
 assert.equal(c.state,'working');
 now=13000;service.syncUsage();
 assert.equal(d.state,'complete');assert.equal(service.sessionView?.sessionId,'claude:parent');
 assert.equal(c.acknowledgeCompletion('claude:parent'),false);
 now=21000;service.syncUsage();assert.equal(d.state,'working');assert.equal(service.sessionView?.sessionId,'codex:cli');
 service.handleHook('codex','agentStop',{sessionId:'cli',clearAttention:true});
 assert.equal(d.state,'complete');assert.equal(service.sessionView?.sessionId,'codex:cli');assert.equal(service.sessionView?.notice,true);
});
