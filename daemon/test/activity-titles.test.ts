import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ActivityTitles} from '../src/activity-titles.js';

test('resolves historical Claude titles without hook hints and Codex titles without exposing prompts',async t=>{
 const home=await mkdtemp(join(tmpdir(),'buddy-titles-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.claude/projects/example'),{recursive:true});await mkdir(join(home,'.codex'),{recursive:true});
 await writeFile(join(home,'.claude/projects/example/abc.jsonl'),JSON.stringify({type:'user',message:'PRIVATE'})+'\n'+JSON.stringify({type:'custom-title',sessionId:'abc',customTitle:'Family dashboard'})+'\n');
 await writeFile(join(home,'.codex/session_index.jsonl'),JSON.stringify({id:'def',thread_name:'Fix captions'})+'\n');
 const titles=new ActivityTitles(home,{});
 const result=await titles.resolve(['claude:abc','codex:def','claude:missing']);
 assert.equal(result['claude:abc']?.title,'Family dashboard');assert.equal(result['codex:def']?.title,'Fix captions');
 assert.equal(result['claude:missing']?.title,'');assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('title lookup refreshes renamed metadata and rejects unsafe session paths',async t=>{
 const home=await mkdtemp(join(tmpdir(),'buddy-titles-'));t.after(()=>rm(home,{recursive:true,force:true}));
 let now=0;const titles=new ActivityTitles(home,{},()=>now);
 titles.observe({sessionId:'claude:abc',sessionTitle:'Old title',cwd:'/repo/demo',prompt:'PRIVATE'});
 assert.equal((await titles.resolve(['claude:abc']))['claude:abc']?.title,'Old title');
 titles.observe({sessionId:'claude:abc',sessionTitle:'New title'});now++;
 assert.equal((await titles.resolve(['claude:abc']))['claude:abc']?.title,'New title');
 assert.equal((await titles.resolve(['claude:../../secret']))['claude:../../secret']?.title,'');
});
