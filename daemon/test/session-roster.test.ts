import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SessionRoster,desktopSessions} from '../src/session-roster.js';
const id='codex:11111111-1111-1111-1111-111111111111';
async function fixture(t:{after(fn:()=>Promise<void>):void}){
 const root=await mkdtemp(join(tmpdir(),'buddy-roster-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
test('idle Claude sessions survive without hooks and disappear when their processes exit',async t=>{
 const root=await fixture(t);let live=[{id:'claude:a',pid:123,identity:'born',cwd:'/same'}];
 const roster=new SessionRoster(join(root,'roster.json'),async()=>live,async()=>[]);
 await roster.load();assert.deepEqual(await roster.refresh(),[{id:'claude:a',cwd:'/same'}]);
 live=[];assert.deepEqual(await roster.refresh(),[]);
});
test('desktop roster reads only observed nonarchived desktop chats, never all saved history',async t=>{
 const root=await fixture(t);await mkdir(join(root,'.codex'));
 const db=new DatabaseSync(join(root,'.codex/state_5.sqlite'));
 db.exec('CREATE TABLE threads (id TEXT,cwd TEXT,originator TEXT,archived INTEGER)');
 const insert=db.prepare('INSERT INTO threads VALUES (?,?,?,?)');insert.run(id.slice(6),'/repo','Codex Desktop',0);
 insert.run('22222222-2222-2222-2222-222222222222','/other','Codex Desktop',0);
 assert.deepEqual(await desktopSessions([id],root,{}),[{id,cwd:'/repo'}]);
 db.exec('UPDATE threads SET archived=1');assert.deepEqual(await desktopSessions([id],root,{}),[]);
 db.exec("UPDATE threads SET archived=0,originator='Codex CLI'");assert.deepEqual(await desktopSessions([id],root,{}),[]);db.close();
});
test('sessionEnd during a roster refresh cannot resurrect the desktop chat',async t=>{
 const root=await fixture(t);let resolve!:(rows:{id:string;cwd:string}[])=>void;
 const gate=new Promise<{id:string;cwd:string}[]>(r=>{resolve=r;});
 const roster=new SessionRoster(join(root,'roster.json'),async()=>[],async()=>gate);
 await roster.load([id]);const pending=roster.refresh();roster.observe(id,true);
 resolve([{id,cwd:'/repo'}]);assert.deepEqual(await pending,[]);await roster.flush();
 assert.deepEqual(JSON.parse(await readFile(join(root,'roster.json'),'utf8')),[]);
});
test('observed desktop chats persist across service restart without retaining prompt content',async t=>{
 const root=await fixture(t);const path=join(root,'roster.json');
 const desktop=async(ids:readonly string[])=>ids.map(id=>({id,cwd:'/repo'}));
 const first=new SessionRoster(path,async()=>[],desktop);await first.load();first.observe(id);await first.flush();
 const second=new SessionRoster(path,async()=>[],desktop);await second.load();assert.deepEqual(await second.refresh(),[{id,cwd:'/repo'}]);
});
