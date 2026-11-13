// Unit tests for the history shared between devices (mergeTasks, sharedView in app/js/tasks.js).
// Run with: node tests/unit_tasks_shared.mjs
import assert from 'node:assert/strict';
import { mergeTasks, sharedView, isActive } from '../app/js/tasks.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const task = (n, state, extra = {}) => ({ id: `suwayomi:${n}`, collector: 'suwayomi', nativeId: String(n), kind: 'chapter.download', state,
  createdAt: 1000, startedAt: null, finishedAt: state === 'queued' || state === 'running' ? null : 2000, attempts: 1, error: null, ...extra });
const S = (tasks, cleared = {}) => ({ tasks, cleared });
const both = (a, b, opts) => { const x = mergeTasks(a, b, opts), y = mergeTasks(b, a, opts); assert.deepEqual(x, y, 'merge must not depend on the order'); return x; };
const byId = (m, id) => m.tasks.find((x) => x.id === id);

test('union by identifier, commutative and idempotent', () => {
  const a = S([task(1, 'done'), task(2, 'failed')]);
  const b = S([task(2, 'failed'), task(3, 'done', { finishedAt: 3000 })]);
  const m = both(a, b);
  assert.deepEqual(m.tasks.map((x) => x.id).sort(), ['suwayomi:1', 'suwayomi:2', 'suwayomi:3']);
  assert.deepEqual(mergeTasks(m, m), m);
  assert.deepEqual(mergeTasks(m, a), m);
});
test('associative on a three-way merge', () => {
  const a = S([task(1, 'failed', { finishedAt: 2000 })]), b = S([task(1, 'done', { finishedAt: 5000 })]), c = S([task(1, 'queued', { createdAt: 3000 })]);
  assert.deepEqual(mergeTasks(mergeTasks(a, b), c), mergeTasks(a, mergeTasks(b, c)));
  assert.deepEqual(mergeTasks(mergeTasks(a, c), b), mergeTasks(mergeTasks(c, b), a));
});
test('a finished task beats the same task still active on another device', () => {
  const m = both(S([task(1, 'running', { createdAt: 1000 })]), S([task(1, 'done', { finishedAt: 2000 })]));
  assert.equal(byId(m, 'suwayomi:1').state, 'done');
  assert.equal(m.tasks.filter(isActive).length, 0);
});
test('an active task created after the end is a re-request and wins', () => {
  const m = both(S([task(1, 'queued', { createdAt: 5000 })]), S([task(1, 'failed', { finishedAt: 2000 })]));
  assert.equal(byId(m, 'suwayomi:1').state, 'queued');
});
test('a re-request that then finishes replaces the old failure everywhere', () => {
  const m = both(S([task(1, 'failed', { finishedAt: 2000, attempts: 3 })]), S([task(1, 'done', { createdAt: 5000, finishedAt: 7000, attempts: 4 })]));
  assert.equal(byId(m, 'suwayomi:1').state, 'done');
});
test('cleared history stays cleared when another device still has the entries', () => {
  const stale = S([task(1, 'done'), task(2, 'failed')]);
  const cleared = S([], { 'suwayomi:1': 2000, 'suwayomi:2': 2000 });
  const m = both(stale, cleared);
  assert.deepEqual(m.tasks, []);
  assert.equal(m.cleared['suwayomi:1'], 2000);
  assert.deepEqual(both(m, stale).tasks, []);
});
test('a task finished after the clearing, or re-requested, comes back', () => {
  const cleared = S([], { 'suwayomi:1': 2000, 'suwayomi:2': 2000 });
  const m = both(cleared, S([task(1, 'done', { finishedAt: 2500 }), task(2, 'queued', { createdAt: 3000 }), task(3, 'done')]));
  assert.deepEqual(m.tasks.map((x) => x.id).sort(), ['suwayomi:1', 'suwayomi:2', 'suwayomi:3']);
});
test('clearing does not hide active tasks', () => {
  const m = both(S([task(1, 'running')]), S([], { 'suwayomi:1': 9000 }));
  assert.equal(m.tasks.length, 1);
});
test('size is bounded: finished tasks and tombstones, actives are kept', () => {
  const many = Array.from({ length: 100 }, (_, i) => task(i, 'done', { finishedAt: 2000 + i }));
  const m = both(S([...many, task(500, 'running')]), S([]), { keep: 10 });
  assert.equal(m.tasks.filter((x) => !isActive(x)).length, 10);
  assert.equal(m.tasks.filter(isActive).length, 1);
  assert.deepEqual(m.tasks.filter((x) => !isActive(x))[0].id, 'suwayomi:99');
  const tomb = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`suwayomi:${i}`, 1000 + i]));
  const c = mergeTasks(S([], tomb), null, { keepCleared: 5 });
  assert.deepEqual(Object.keys(c.cleared).sort(), ['suwayomi:45', 'suwayomi:46', 'suwayomi:47', 'suwayomi:48', 'suwayomi:49']);
});
test('old format (plain array, no tombstones) and garbage are accepted', () => {
  const m = both([task(1, 'done'), task(2, 'running')], S([task(3, 'failed')]));
  assert.equal(m.tasks.length, 3);
  assert.deepEqual(mergeTasks(null, undefined), { tasks: [], cleared: {} });
  assert.deepEqual(mergeTasks({ tasks: 'x', cleared: 7 }, [null, { id: 4, state: 'done' }, { id: 'z', state: 'weird' }]), { tasks: [], cleared: {} });
});
test('sharedView keeps finished tasks only, in a fixed order, identical whatever the input order', () => {
  const a = [task(1, 'done', { finishedAt: 3000 }), task(2, 'running'), task(3, 'failed', { finishedAt: 3000 })];
  const v = sharedView(S(a, { 'suwayomi:9': 1 }));
  assert.deepEqual(v.tasks.map((x) => x.id), ['suwayomi:1', 'suwayomi:3']);
  assert.equal(v.v, 1);
  assert.equal(JSON.stringify(v), JSON.stringify(sharedView(S([...a].reverse(), { 'suwayomi:9': 1 }))));
  assert.deepEqual(sharedView(null), { v: 1, tasks: [], cleared: {} });
});

console.log(failed ? `\n${failed} test(s) failed` : '\nAll shared-history unit tests passed');
process.exit(failed ? 1 : 0);
