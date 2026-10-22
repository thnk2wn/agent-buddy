import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {LiveCaptions, sessionMetadata} from '../src/live-captions.js';
import type {PersistedCoordinatorState} from '../src/state-coordinator.js';

async function fixture(t: {after: (fn: () => Promise<void>) => void}) {
  const home = await mkdtemp(join(tmpdir(), 'captions-'));
  t.after(() => rm(home, {recursive:true,force:true}));
  await mkdir(join(home,'.codex'), {recursive:true});
  return home;
}
test('Codex reads sidebar name, not prompt-shaped title, and opens database read-only', async t => {
  const home = await fixture(t);
  const db = new DatabaseSync(join(home,'.codex/state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, cwd TEXT)');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('session1','Fix search ranking','PRIVATE prompt', '/repos/search');
  db.close();
  assert.deepEqual(await sessionMetadata('codex','session1',{},home,{}), {project:'search',title:'Fix search ranking'});
});
test('Codex falls back to newest index title; absent metadata never reveals prompts', async t => {
  const home = await fixture(t);
  await writeFile(join(home,'.codex/session_index.jsonl'),
    '{"id":"a","thread_name":"Old"}\ninvalid\n{"id":"a","thread_name":"New title"}\n');
  assert.equal((await sessionMetadata('codex','a',{},home,{})).title, 'New title');
  assert.deepEqual(await sessionMetadata('codex','unknown',{cwd:'/repos/demo',prompt:'PRIVATE'},home,{}), {project:'demo',title:''});
});
test('Claude reads custom-title only in the matching session under its projects folder', async t => {
  const home = await fixture(t);
  const root = join(home,'.claude/projects/project'); await mkdir(root,{recursive:true});
  const path = join(root,'abc.jsonl');
  await writeFile(path, [JSON.stringify({type:'user',message:'PRIVATE'}),
    JSON.stringify({type:'custom-title',sessionId:'abc',customTitle:'Match candidates'})].join('\n'));
  assert.equal((await sessionMetadata('claude','abc',{transcript_path:path},home,{})).title, 'Match candidates');
  assert.equal((await sessionMetadata('claude','other',{transcript_path:path},home,{})).title, '');
  const outside = join(home,'abc.jsonl'); await writeFile(outside, await (await import('node:fs/promises')).readFile(path));
  assert.equal((await sessionMetadata('claude','abc',{transcript_path:outside},home,{})).title, '');
});
const session = (id:string, attentionUntil=0) => ({id,attentionUntil,activeUntil:100000,
  lastMainEventAt:1,lastSeenAt:1,hadWork:true,completionPending:false,subagents:[]});
test('live pages survive repeated hooks, prioritize attention, and fall back when disabled or idle', async t => {
  const home = await fixture(t); const config=join(home,'task-captions.json');
  const live = new LiveCaptions(config,home,{});
  const snapshot: PersistedCoordinatorState={version:1,sessions:[session('codex:a'),session('claude:b',100000)]};
  live.observe({sessionId:'codex:a',cwd:'/repos/project',sessionTitle:'Fix the search pagination'});
  live.observe({sessionId:'claude:b',cwd:'/repos/other',sessionTitle:'Review migration'});
  await live.refresh(snapshot); assert.equal(live.lines('working',snapshot,1000),null);
  await writeFile(config,JSON.stringify({enabled:true,phrases:{working:'Building'}})); await live.refresh(snapshot);
  assert.deepEqual(live.lines('working',snapshot,1000),['Codex Building','project']);
  live.observe({sessionId:'codex:a',cwd:'/repos/project'});
  assert.deepEqual(live.lines('working',snapshot,4000),['Fix the search','pagination']);
  assert.deepEqual(live.lines('attention',snapshot,4500),['Claude needs input','other']);
  assert.equal(live.lines('idle',snapshot,4600),null);
  assert.deepEqual(live.lines('complete',snapshot,4700,['claude:b']),['Claude finished','other']);
  await writeFile(config,'broken'); await live.refresh(snapshot);
  assert.equal(live.lines('working',snapshot,5000),null);
});


test('a new Claude prompt immediately takes over from Codex; tool bursts keep its title readable', async t => {
  const home=await fixture(t); const config=join(home,'task-captions.json');
  await writeFile(config,JSON.stringify({enabled:true}));
  const live=new LiveCaptions(config,home,{});
  const snapshot: PersistedCoordinatorState={version:1,sessions:[session('codex:a'),session('claude:b')]};
  live.observe({sessionId:'codex:a',cwd:'/repos/first',sessionTitle:'First task'},'userPromptSubmitted');
  live.observe({sessionId:'claude:b',cwd:'/repos/second',sessionTitle:'Second task'},'preToolUse');
  await live.refresh(snapshot);
  assert.deepEqual(live.lines('working',snapshot,1000),['Codex working','first']);
  live.observe({sessionId:'claude:b'},'userPromptSubmitted');
  assert.deepEqual(live.lines('working',snapshot,1500),['Claude working','second']);
  live.observe({sessionId:'codex:a'},'postToolUse');
  snapshot.sessions[0]!.lastSeenAt=4500;
  assert.deepEqual(live.lines('working',snapshot,4500),['Second task']);
  snapshot.sessions[1]!.activeUntil=0;
  assert.deepEqual(live.lines('working',snapshot,5000),['Codex working','first']);
});

test('without a prompt, newer agent activity takes over after at most five seconds', async t => {
  const home=await fixture(t);const config=join(home,'task-captions.json');
  await writeFile(config,JSON.stringify({enabled:true}));
  const live=new LiveCaptions(config,home,{});
  const snapshot: PersistedCoordinatorState={version:1,sessions:[session('codex:a'),session('claude:b')]};
  await live.refresh(snapshot);
  assert.equal(live.lines('working',snapshot,1000)?.[0],'Codex working');
  snapshot.sessions[1]!.lastSeenAt=2000;
  assert.equal(live.lines('working',snapshot,2000)?.[0],'Codex working');
  assert.equal(live.lines('working',snapshot,6000)?.[0],'Claude working');
});

test('playful messages appear only after quiet idle time and yield to real work immediately', async t => {
  const home=await fixture(t);const config=join(home,'task-captions.json');
  await writeFile(config,JSON.stringify({enabled:true,idleAfterSeconds:60,idleMessages:['Dreaming in code']}));
  const live=new LiveCaptions(config,home,{});
  const snapshot: PersistedCoordinatorState={version:1,sessions:[session('codex:a')]};
  await live.refresh(snapshot);
  assert.equal(live.lines('idle',snapshot,1000),null);
  assert.equal(live.lines('idle',snapshot,60999),null);
  assert.deepEqual(live.lines('idle',snapshot,61000),['Dreaming in code']);
  assert.equal(live.lines('idle',snapshot,66000),null);
  assert.equal(live.lines('working',snapshot,67000)?.[0],'Codex working');
  assert.equal(live.lines('idle',snapshot,68000),null);
});

test('a new hook arriving during configuration I/O survives pruning and subsequent refreshes', async t => {
  const home=await fixture(t);const config=join(home,'task-captions.json');
  await writeFile(config,JSON.stringify({enabled:true}));
  const live=new LiveCaptions(config,home,{});
  const refreshing=live.refresh({version:1,sessions:[]});
  live.observe({sessionId:'codex:new',cwd:'/repo/project',sessionTitle:'New task'},'userPromptSubmitted');
  await refreshing;
  const snapshot: PersistedCoordinatorState={version:1,sessions:[session('codex:new')]};
  await live.refresh(snapshot);
  assert.deepEqual(live.lines('working',snapshot,1000),['Codex working','project']);
  assert.deepEqual(live.lines('working',snapshot,4000),['New task']);
});

test('completion uses the actual completed session even when the last prompt belongs to an older session', async t => {
  const {StateCoordinator}=await import('../src/state-coordinator.js');
  const home=await fixture(t);const config=join(home,'task-captions.json');
  await writeFile(config,JSON.stringify({enabled:true}));
  const live=new LiveCaptions(config,home,{});let now=1000;
  const coordinator=new StateCoordinator(()=>{}, {now:()=>now,sweepMs:0});
  t.after(()=>coordinator.close());
  const event=(name: import('../src/protocol.js').HookEvent,id:string,extra={})=>{
    const payload={sessionId:id,...extra};coordinator.handle(name,payload);live.observe(payload,name);
  };
  event('userPromptSubmitted','codex:a',{cwd:'/repo/old-task',sessionTitle:'Old task'});
  event('preToolUse','codex:a');event('agentStop','codex:a');
  await live.refresh(coordinator.snapshot());
  assert.deepEqual(coordinator.drivingSessionIds,['codex:a']);
  live.lines(coordinator.state,coordinator.snapshot(),now,coordinator.drivingSessionIds);
  now=2000;event('preToolUse','codex:b',{cwd:'/repo/new-task',sessionTitle:'Actual latest task'});
  await live.refresh(coordinator.snapshot());
  assert.deepEqual(live.lines(coordinator.state,coordinator.snapshot(),now,coordinator.drivingSessionIds),['Codex working','new task']);
  now=3000;event('agentStop','codex:b');
  assert.equal(coordinator.state,'complete');
  assert.deepEqual(coordinator.drivingSessionIds,['codex:b']);
  assert.deepEqual(live.lines(coordinator.state,coordinator.snapshot(),now,coordinator.drivingSessionIds),['Codex finished','new task']);
  assert.deepEqual(live.lines(coordinator.state,coordinator.snapshot(),now+3000,coordinator.drivingSessionIds),['Actual latest task']);
});

test('approval requests and errors do not falsely say the user has an unanswered question',async t=>{
 const home=await fixture(t),config=join(home,'task-captions.json');
 await writeFile(config,JSON.stringify({enabled:true}));const live=new LiveCaptions(config,home,{});
 const snapshot:PersistedCoordinatorState={version:1,sessions:[session('codex:a',100000)]};
 live.observe({sessionId:'codex:a',notification_type:'permission_prompt'},'notification');await live.refresh(snapshot);
 assert.ok(live.lines('attention',snapshot,1000)?.join(' ').includes('approval requested'));
 live.observe({sessionId:'codex:a',notification_type:'agent_needs_input'},'notification');
 assert.ok(live.lines('attention',snapshot,2000)?.join(' ').includes('needs input'));
 snapshot.sessions[0]!.attentionReason='error';
 assert.ok(live.lines('attention',snapshot,3000)?.join(' ').includes('hit an error'));
});

test('focused captions name the selected badge, include position, and read pinned long titles',async t=>{
 const home=await fixture(t),config=join(home,'task-captions.json');await writeFile(config,JSON.stringify({enabled:true}));
 const live=new LiveCaptions(config,home,{}),snapshot:PersistedCoordinatorState={version:1,sessions:[session('codex:a'),session('claude:b')]};
 live.observe({sessionId:'codex:a',projectName:'Search',sessionTitle:'First title'});
 live.observe({sessionId:'claude:b',projectName:'Jax',sessionTitle:'Fix candidate matching pagination and search results'});
 await live.refresh(snapshot);
 const view={state:'working' as const,sessionId:'claude:b',pinned:false,index:2,count:2,notice:false};
 assert.deepEqual(live.lines('working',snapshot,1000,[],view),['Claude working 2:2','Jax']);
 const pinned={...view,pinned:true};
 assert.deepEqual(live.lines('working',snapshot,2000,[],pinned),['Claude pinned','Jax']);
 assert.deepEqual(live.lines('working',snapshot,10000,[],pinned),['pagination and','search results']);
 snapshot.sessions[1]!.activeUntil=0;
 assert.deepEqual(live.lines('complete',snapshot,12000,[],{...view,state:'complete',notice:true}),['Claude finished','Jax']);
});

test('Claude automatic session titles reach device captions through the shared resolver',async t=>{
 const home=await fixture(t),config=join(home,'task-captions.json');
 await writeFile(config,JSON.stringify({enabled:true}));
 const root=join(home,'.claude/projects/project');await mkdir(root,{recursive:true});
 const path=join(root,'abc.jsonl');await writeFile(path,JSON.stringify({type:'ai-title',sessionId:'abc',aiTitle:'Project roadmap and next steps'})+'\n');
 assert.equal((await sessionMetadata('claude','abc',{},home,{})).title,'Project roadmap and next steps');
 const live=new LiveCaptions(config,home,{}),snapshot:PersistedCoordinatorState={version:1,sessions:[session('claude:abc')]};
 live.observe({sessionId:'claude:abc',cwd:'/repos/kitchen-frame',transcript_path:path});await live.refresh(snapshot);
 assert.deepEqual(live.lines('working',snapshot,1000),['Claude working','kitchen frame']);
 assert.deepEqual(live.lines('working',snapshot,4000),['Project roadmap','and next steps']);
});

test('idle browsing keeps title pages and session count visible instead of playful or blank captions',async t=>{
 const home=await fixture(t);const path=join(home,'task-captions.json');
 await writeFile(path,JSON.stringify({enabled:true,idleMessages:['Silly phrase'],idleAfterSeconds:15}));
 const live=new LiveCaptions(path,home,{});
 const snapshot:PersistedCoordinatorState={version:1,sessions:[{...session('claude:a'),activeUntil:0}]};
 live.observe({sessionId:'claude:a',cwd:'/repo',sessionTitle:'Project roadmap'});await live.refresh(snapshot);
 const view={state:'idle' as const,sessionId:'claude:a',pinned:false,index:2,count:4,notice:false,browsing:true};
 assert.deepEqual(live.lines('idle',snapshot,0,[],view),['Claude idle 2:4','repo']);
 assert.deepEqual(live.lines('idle',snapshot,4000,[],view),['Project roadmap']);
 assert.ok(live.lines('idle',snapshot,60000,[],view)?.length);
});
