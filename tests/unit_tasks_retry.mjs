// Unit tests for the automatic retry policy (app/js/tasks.js). Run with: node tests/unit_tasks_retry.mjs
import assert from 'node:assert/strict';
import { RETRY, normalize, reconcile, retryDelay, retryJitter, retryPlan, claimed, retried, mergeTasks, sharedView, isActive } from '../app/js/tasks.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const MIN = 60000;
const NOJ = { ...RETRY, jitterMs: 0 };
const rep = (state, extra = {}) => normalize('suwayomi', { nativeId: 7, reader: 'suwayomi', seriesId: 3, chapterId: '3.7', state, attempts: 3, ...extra });
const get = (list) => list.find((x) => x.id === 'suwayomi:7');
const fail = (list, now) => reconcile(list, [rep('failed')], { now, retry: NOJ });

test('defaults: 1 min, 5 min, 30 min, then nothing', () => {
  assert.deepEqual([0, 1, 2].map((n) => retryDelay(n)), [MIN, 5 * MIN, 30 * MIN]);
  assert.equal(retryDelay(3), null);
  assert.equal(retryDelay(99), null);
});
test('a task that fails is scheduled after the first delay, from its end date', () => {
  const t = get(fail([], 10000));
  assert.equal(t.finishedAt, 10000); assert.equal(t.nextRetryAt, 10000 + MIN); assert.equal(t.autoRetries, 0);
});
test('plan: scheduled, then due once the time has come', () => {
  const t = get(fail([], 0));
  assert.deepEqual(retryPlan(t, { now: MIN - 1, opts: NOJ }), { status: 'scheduled', at: MIN });
  assert.equal(retryPlan(t, { now: MIN, opts: NOJ }).status, 'due');
});
test('the delays grow along the automatic retries and stop at the maximum', () => {
  let list = fail([], 0);
  const seen = [];
  let now = 0;
  for (let i = 0; i < 4; i++) {
    const t = get(list);
    const plan = retryPlan(t, { now, opts: NOJ });
    if (plan.status === 'exhausted') { seen.push('exhausted'); break; }
    seen.push(t.nextRetryAt - t.finishedAt);
    now = t.nextRetryAt;
    list = retried(list, t.id, { auto: true });
    list = reconcile(list, [rep('queued')], { now, retry: NOJ });   // re-requested : the count continues
    list = reconcile(list, [rep('failed')], { now: now + 1000, retry: NOJ });
    now += 1000;
  }
  assert.deepEqual(seen, [MIN, 5 * MIN, 30 * MIN, 'exhausted']);
  const last = get(list);
  assert.equal(last.autoRetries, 3); assert.equal(last.nextRetryAt, null);
  assert.equal(retryPlan(last, { now: 1e12, opts: NOJ }).status, 'exhausted');
});
test('a manual retry resets the automatic counter', () => {
  let list = fail([], 0);
  for (let i = 0; i < 3; i++) { list = retried(list, 'suwayomi:7', { auto: true }); list = reconcile(list, [rep('queued')], { now: 1, retry: NOJ }); list = reconcile(list, [rep('failed')], { now: 2 + i, retry: NOJ }); }
  assert.equal(retryPlan(get(list), { now: 1e12, opts: NOJ }).status, 'exhausted');
  list = retried(list, 'suwayomi:7', { auto: false });
  list = reconcile(list, [rep('queued')], { now: 100, retry: NOJ });
  assert.equal(get(list).autoRetries, 0);
  list = reconcile(list, [rep('failed')], { now: 200, retry: NOJ });
  assert.equal(get(list).nextRetryAt, 200 + MIN);
});
test('a task that finishes after retries keeps no pending retry', () => {
  let list = retried(fail([], 0), 'suwayomi:7', { auto: true });
  list = reconcile(list, [rep('queued')], { now: 5, retry: NOJ });
  list = reconcile(list, [rep('done')], { now: 9, retry: NOJ });
  assert.equal(get(list).state, 'done'); assert.equal(get(list).nextRetryAt, null);
  assert.equal(retryPlan(get(list), { now: 1e12, opts: NOJ }).status, 'none');
});
test('no retry for a cancelled task, for a collector without retry, or for an old failure with no schedule', () => {
  const cancelledTask = { ...get(fail([], 0)), state: 'cancelled', nextRetryAt: null };
  assert.equal(retryPlan(cancelledTask, { now: 1e12, opts: NOJ }).status, 'none');
  assert.equal(retryPlan(get(fail([], 0)), { now: 1e12, canRetry: false, opts: NOJ }).status, 'none');
  const legacy = { ...get(fail([], 0)) }; delete legacy.nextRetryAt; delete legacy.autoRetries;
  assert.equal(retryPlan(legacy, { now: 1e12, opts: NOJ }).status, 'none');
  assert.equal(retryPlan({ ...rep('running') }, { now: 1e12, opts: NOJ }).status, 'none');
});
test('a failure reported again does not move the schedule', () => {
  const a = fail([], 0), b = reconcile(a, [rep('failed')], { now: 50000, retry: NOJ });
  assert.deepEqual(a, b);
});
test('jitter is stable per device, within bounds, and differs between devices', () => {
  assert.equal(retryJitter('abc'), retryJitter('abc'));
  const js = ['d1', 'd2', 'x9k3', 'q', 'zz'].map((d) => retryJitter(d));
  assert.ok(js.every((j) => j >= 0 && j < RETRY.jitterMs));
  assert.ok(new Set(js).size > 1);
  assert.equal(retryJitter('abc', { ...RETRY, jitterMs: 0 }), 0);
});
test('custom delays (tests) bound the number of retries', () => {
  const opts = { ...RETRY, delays: [10, 20], jitterMs: 0 };
  let list = reconcile([], [rep('failed')], { now: 0, retry: opts });
  assert.equal(get(list).nextRetryAt, 10);
  list = retried(list, 'suwayomi:7', { auto: true }); list = reconcile(list, [rep('queued')], { now: 1, retry: opts }); list = reconcile(list, [rep('failed')], { now: 2, retry: opts });
  assert.equal(get(list).nextRetryAt, 22);
  list = retried(list, 'suwayomi:7', { auto: true }); list = reconcile(list, [rep('queued')], { now: 3, retry: opts }); list = reconcile(list, [rep('failed')], { now: 4, retry: opts });
  assert.equal(retryPlan(get(list), { now: 1e9, opts }).status, 'exhausted');
});

// ── Two devices ──
const A = 'devA', B = 'devB';
const S = (tasks) => ({ tasks, cleared: {} });
const failedTask = (extra = {}) => ({ ...get(fail([], 0)), ...extra });

test('claim: another device sees the claim and waits, then takes over once it expires', () => {
  const base = [failedTask()];
  const mine = claimed(base, 'suwayomi:7', A, { now: MIN, opts: NOJ });
  assert.equal(get(mine).claimBy, A);
  const theirs = get(mergeTasks(S(base), S(mine)).tasks.length ? mergeTasks(S(base), S(mine)).tasks : []);
  assert.equal(retryPlan(theirs, { now: MIN + 10, device: B, opts: NOJ }).status, 'claimed');
  assert.equal(retryPlan(theirs, { now: MIN + 10, device: A, opts: NOJ }).status, 'due');
  assert.equal(retryPlan(theirs, { now: MIN + NOJ.claimMs + 1, device: B, opts: NOJ }).status, 'due');
});
test('claim: concurrent claims merge to the same single winner on both devices', () => {
  const base = [failedTask()];
  const ca = claimed(base, 'suwayomi:7', A, { now: MIN, opts: NOJ }), cb = claimed(base, 'suwayomi:7', B, { now: MIN + 5, opts: NOJ });
  const x = mergeTasks(S(ca), S(cb)), y = mergeTasks(S(cb), S(ca));
  assert.deepEqual(x, y);
  assert.equal(get(x.tasks).claimBy, B);                  // the later claim wins
  const same = mergeTasks(S(claimed(base, 'suwayomi:7', A, { now: MIN, opts: NOJ })), S(claimed(base, 'suwayomi:7', B, { now: MIN, opts: NOJ })));
  assert.deepEqual(same, mergeTasks(S(claimed(base, 'suwayomi:7', B, { now: MIN, opts: NOJ })), S(claimed(base, 'suwayomi:7', A, { now: MIN, opts: NOJ }))));
});
test('merge: a retried task (more automatic retries) beats the stale failure and the claim', () => {
  const base = [failedTask()];
  const claim = claimed(base, 'suwayomi:7', A, { now: MIN, opts: NOJ });
  const done = retried(claim, 'suwayomi:7', { auto: true });
  const m1 = mergeTasks(S(claim), S(done)), m2 = mergeTasks(S(done), S(claim));
  assert.deepEqual(m1, m2);
  assert.equal(get(m1.tasks).autoRetries, 1); assert.equal(get(m1.tasks).claimBy, null);
  assert.deepEqual(mergeTasks(m1, m1), m1);
});
test('merge: associative and idempotent with the retry fields', () => {
  const v1 = failedTask(), v2 = claimed([v1], 'suwayomi:7', A, { now: MIN, opts: NOJ })[0], v3 = retried([v2], 'suwayomi:7', { auto: true })[0];
  const [a, b, c] = [S([v1]), S([v2]), S([v3])];
  assert.deepEqual(mergeTasks(mergeTasks(a, b), c), mergeTasks(a, mergeTasks(b, c)));
  assert.deepEqual(mergeTasks(mergeTasks(c, a), b), mergeTasks(mergeTasks(b, c), a));
  assert.deepEqual(mergeTasks(a, a), mergeTasks(a, a));
});
test('shared view: an automatic retry in flight is shared, so the other device sees it', () => {
  const retriedFailure = get(retried([failedTask()], 'suwayomi:7', { auto: true }));
  const inFlight = { ...retriedFailure, state: 'queued', finishedAt: null, createdAt: 5000, nextRetryAt: null };
  assert.ok(isActive(inFlight));
  const view = sharedView(S([inFlight]));
  assert.deepEqual(view.tasks.map((x) => x.state), ['queued']);
  const other = mergeTasks(S([failedTask()]), view);      // the other device still has the failure
  assert.equal(get(other.tasks).state, 'queued');
  assert.deepEqual(sharedView(S([{ ...inFlight, autoRetries: 0 }])).tasks, []);   // a manual or fresh request is not shared
  assert.deepEqual(sharedView(S([inFlight])), sharedView(sharedView(S([inFlight]))));
});

console.log(failed ? `${failed} test(s) failed` : 'all passed');
process.exit(failed ? 1 : 0);
