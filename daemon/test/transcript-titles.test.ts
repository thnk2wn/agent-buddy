import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, appendFile, rm, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TranscriptTitles} from '../src/transcript-titles.js';

const title = (name: string) => JSON.stringify({type:'custom-title', sessionId:'abc', customTitle:name}) + '\n';
const large = JSON.stringify({type:'user', message:'x'.repeat(2 * 1024 * 1024 + 100)}) + '\n';
async function fixture(t: {after: (fn: () => Promise<void>) => void}) {
  const dir = await mkdtemp(join(tmpdir(),'transcript-titles-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  return join(dir,'abc.jsonl');
}

test('known title survives growth, cold startup finds old title, and later rename is indexed', async t => {
  const path=await fixture(t); const reader=new TranscriptTitles();
  await writeFile(path,title('Initial title'));
  assert.equal(await reader.read(path,'abc'),'Initial title');
  await appendFile(path,large + title('Latest title'));
  assert.equal(await reader.read(path,'abc'),'Initial title'); // first bounded scan stops in the large record
  assert.equal(await reader.read(path,'abc'),'Latest title');
  const cold=new TranscriptTitles();
  assert.equal(await cold.read(path,'abc'),'Initial title');
  assert.equal(await cold.read(path,'abc'),'Latest title');
});

test('startup with a title beyond the first read budget makes progress on subsequent refreshes', async t => {
  const path=await fixture(t);const reader=new TranscriptTitles();
  await writeFile(path,large + title('Later metadata'));
  assert.equal(await reader.read(path,'abc'),'');
  assert.equal(await reader.read(path,'abc'),'Later metadata');
});

test('partial UTF-8 metadata records survive chunk boundaries and later appends', async t => {
  const path=await fixture(t);const reader=new TranscriptTitles();
  const line=Buffer.from(title('Café launch'));
  const split=line.indexOf(Buffer.from('é'))+1;
  await writeFile(path,Buffer.concat([Buffer.from('x'.repeat(65536-split)+'\n'),line.subarray(0,split)]));
  assert.equal(await reader.read(path,'abc'),'');
  await appendFile(path,line.subarray(split));
  assert.equal(await reader.read(path,'abc'),'Cafe launch');
  await appendFile(path,title('Final title').trimEnd());
  assert.equal(await reader.read(path,'abc'),'Final title');
});

test('file truncation and inode replacement restart the index instead of keeping an old title', async t => {
  const path=await fixture(t);const reader=new TranscriptTitles();
  await writeFile(path,title('A sufficiently long original title'));
  assert.equal(await reader.read(path,'abc'),'A sufficiently long original title');
  await writeFile(path,'{}\n');
  assert.equal(await reader.read(path,'abc'),'');
  await writeFile(path+'.new',title('Replacement'));
  await rename(path+'.new',path);
  assert.equal(await reader.read(path,'abc'),'Replacement');
});
