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
  assert.deepEqual(live.lines('working',snapshot,1000),['Building','project']);
  live.observe({sessionId:'codex:a',cwd:'/repos/project'});
  assert.deepEqual(live.lines('working',snapshot,4000),['Fix the search','pagination']);
  assert.deepEqual(live.lines('attention',snapshot,4500),['Need your input','other']);
  assert.equal(live.lines('idle',snapshot,4600),null);
  assert.deepEqual(live.lines('complete',snapshot,4700,['claude']),['All done','other']);
  await writeFile(config,'broken'); await live.refresh(snapshot);
  assert.equal(live.lines('working',snapshot,5000),null);
});
