import assert from 'node:assert/strict';
import {test} from 'node:test';
import {captionCards, captionContextFromHook, captionFrame, CaptionPlayback, captionText, wrapCaption} from '../src/task-captions.js';
const context = {status: 'Making progress', project: 'platform', title: 'Investigate webhook memory usage and verify the production fix'};

test('word pages preserve the entire long title in reading order', () => {
  const cards = captionCards(context).filter(c => c.kind === 'title');
  assert.equal(cards.flatMap(c => c.lines).join(' '), context.title);
  assert.ok(cards.length > 1);
  for (const card of cards) {assert.ok(card.lines.length <= 2); assert.ok(card.lines.every(s => s.length <= 18));}
});
test('very long identifiers are split without losing characters', () => {
  const word = 'SuperLongSessionIdentifierWithNoSpacesAtAll';
  assert.equal(wrapCaption(word).join(''), word);
});
test('status and long project names are also preserved', () => {
  const c = {...context, status: 'Waiting for your approval', project: 'very long project name'};
  assert.equal(captionCards(c).filter(x => x.kind === 'context').flatMap(x => x.lines).join(' '), `${c.status} ${c.project}`);
});
test('timing gives context three seconds and title pages five seconds, then loops', () => {
  const cards = captionCards(context);
  assert.equal(captionFrame(context, 2999).kind, 'context');
  assert.equal(captionFrame(context, 3000).index, 1);
  assert.equal(captionFrame(context, 7999).index, 1);
  assert.equal(captionFrame(context, 8000).index, 2);
  assert.equal(captionFrame(context, cards.reduce((n, c) => n+c.durationMs, 0)).index, 0);
});
test('repeated events do not restart playback, changed task or status does', () => {
  const p = new CaptionPlayback();
  p.frame(context, 1000);
  assert.equal(p.frame({...context}, 4500).index, 1);
  assert.equal(p.frame({...context, title: 'A new task'}, 4600).index, 0);
  assert.equal(p.frame({...context, status: 'Your call'}, 4700).index, 0);
});
test('ticker dwells at both ends and exposes the end of a long title', () => {
  assert.equal(captionFrame(context, 1999, 'ticker').lines[1], context.title.slice(0,18));
  const duration = captionFrame(context, 0, 'ticker').durationMs;
  assert.equal(captionFrame(context, duration-1, 'ticker').lines[1], context.title.slice(-18));
});
test('unsupported characters cannot inject serial commands; Unicode is normalized', () => {
  assert.equal(captionText('Café — task\n$RESET| now'), 'Cafe task RESET now');
  assert.ok(captionText('a'.repeat(10000)).length <= 512);
});
test('empty titles and invalid times yield useful bounded cards', () => {
  for (const time of [0, -1, NaN, Infinity]) {
    const frame = captionFrame({status: '', project: '', title: ''}, time);
    assert.deepEqual(frame.lines, ['Working']);
  }
});
test('hook context reads explicit titles and repository basename, never prompt text', () => {
  assert.deepEqual(captionContextFromHook({cwd: '/Users/me/repos/platform/', session_title: 'Fix pagination'}),
    {project: 'platform', title: 'Fix pagination'});
  assert.deepEqual(captionContextFromHook({cwd: 'C:\\repos\\platform', prompt: 'Private prompt', tool_input: {command:'secret'}}),
    {project: 'platform', title: ''});
});
