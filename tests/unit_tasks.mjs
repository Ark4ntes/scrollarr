// Unit tests for the task model (app/js/tasks.js). Run with: node tests/unit_tasks.mjs
import assert from 'node:assert/strict';
import { STATE, normalize, reconcile, missing, cancelled, isActive } from '../app/js/tasks.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const raw = (extra = {}) => ({ nativeId: 7, reader: 'suwayomi', seriesId: 3, chapterId: '3.7', seriesTitle: 'S', chapterTitle: 'C', state: 'queued', progress: 0, attempts: 0, cancellable: true, ...extra });
const T = (extra) => normalize('suwayomi', raw(extra));

test('normalize builds the common shape', () => {
  const t = T();
  assert.equal(t.id, 'suwayomi:7');
  assert.deepEqual(Object.keys(t).sort(), ['attempts', 'cancellable', 'chapterId', 'chapterTitle', 'collector', 'createdAt', 'error', 'finishedAt',
    'id', 'kind', 'nativeId', 'progress', 'reader', 'seriesId', 'seriesTitle', 'startedAt', 'state']);
  assert.equal(t.kind, 'chapter.download');
  assert.equal(t.seriesId, '3');
});
test('normalize refuses a task without identifier or with an unknown state', () => {
  assert.throws(() => T({ nativeId: null }), /identifiant/);
  assert.throws(() => T({ state: 'paused' }), /état inconnu/);
  assert.throws(() => T({ kind: 'series.search' }), /nature inconnue/);
});
test('progress is clamped, null when unknown, 1 when done', () => {
  assert.equal(T({ progress: 1.7 }).progress, 1);
  assert.equal(T({ progress: undefined }).progress, null);
  assert.equal(T({ state: 'done', progress: 0.2 }).progress, 1);
});
test('an error is only kept on a failed task; a finished task cannot be cancelled', () => {
  assert.equal(T({ state: 'running', error: 'x' }).error, null);
  assert.equal(T({ state: 'failed', error: 'timeout' }).error, 'timeout');
  assert.equal(T({ state: 'failed' }).cancellable, false);
});

test('life of a task: queued → running → done, with dates', () => {
  let list = reconcile([], [T()], { now: 100 });
  assert.deepEqual([list[0].createdAt, list[0].startedAt, list[0].finishedAt], [100, null, null]);
  list = reconcile(list, [T({ state: 'running', progress: 0.4 })], { now: 200 });
  assert.deepEqual([list[0].createdAt, list[0].startedAt, list[0].finishedAt, list[0].progress], [100, 200, null, 0.4]);
  list = reconcile(list, [T({ state: 'done' })], { now: 300 });
  assert.deepEqual([list[0].createdAt, list[0].startedAt, list[0].finishedAt, list[0].progress], [100, 200, 300, 1]);
});
test('dates given by the collector win over observed ones', () => {
  const list = reconcile([], [T({ state: 'done', startedAt: 10, finishedAt: 20 })], { now: 999 });
  assert.deepEqual([list[0].startedAt, list[0].finishedAt], [10, 20]);
});
test('a failure keeps its error and the highest attempt count', () => {
  let list = reconcile([], [T({ state: 'running', attempts: 2 })], { now: 1 });
  list = reconcile(list, [T({ state: 'failed', error: 'HTTP 503', attempts: 1 })], { now: 2 });
  assert.deepEqual([list[0].state, list[0].error, list[0].attempts, list[0].finishedAt], ['failed', 'HTTP 503', 2, 2]);
});
test('a finished task is not rewritten by a late report, but a new request starts over', () => {
  let list = reconcile([], [T({ state: 'done' })], { now: 5 });
  list = reconcile(list, [T({ state: 'failed', error: 'late' })], { now: 6 });
  assert.equal(list[0].state, 'done');
  list = reconcile(list, [T({ state: 'queued' })], { now: 7 });
  assert.deepEqual([list.length, list[0].state, list[0].createdAt, list[0].finishedAt], [1, 'queued', 7, null]);
});
test('tasks missing from a report are left alone and listed for follow-up', () => {
  const a = T(), b = T({ nativeId: 8 }), other = normalize('tranga', raw({ nativeId: 1 }));
  const known = reconcile(reconcile([], [a, b], { now: 1 }), [other], { now: 1 });
  const after = reconcile(known, [a], { now: 2 });
  assert.equal(after.length, 3);
  assert.deepEqual(missing(after, 'suwayomi', [a]).map((t) => t.id), ['suwayomi:8']);
});
test('cancelling closes an active task only', () => {
  let list = reconcile([], [T(), T({ nativeId: 8, state: 'done' })], { now: 1 });
  list = cancelled(cancelled(list, 'suwayomi:7', 9), 'suwayomi:8', 9);
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  assert.deepEqual([byId['suwayomi:7'].state, byId['suwayomi:7'].finishedAt, byId['suwayomi:7'].cancellable], ['cancelled', 9, false]);
  assert.equal(byId['suwayomi:8'].state, 'done');
});
test('history is bounded, active tasks are never dropped, running first', () => {
  const done = Array.from({ length: 10 }, (_, i) => T({ nativeId: 100 + i, state: 'done', finishedAt: i + 1 }));
  const list = reconcile([], [...done, T({ nativeId: 1 }), T({ nativeId: 2, state: 'running' })], { now: 50, keep: 3 });
  assert.deepEqual(list.map((t) => t.nativeId), ['2', '1', '109', '108', '107']);
  assert.equal(list.filter(isActive).length, 2);
});
test('every state of the model is accepted', () => {
  for (const s of Object.values(STATE)) assert.equal(T({ state: s }).state, s);
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll task unit tests passed');
process.exit(failed ? 1 : 0);
