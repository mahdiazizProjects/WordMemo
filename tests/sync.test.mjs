import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, parseBackup, recordReview, progressKey } from '../src/leitner.ts';
import { rewardsFor } from '../src/rewards.ts';
import { LearningStore } from '../src/learning-store.ts';
import { cloudState, mergeStates } from '../src/sync-merge.ts';
const verses = JSON.parse(readFileSync(new URL('../src/data/verses.json', import.meta.url)));
const fresh = () => initialState(verses);
const parse = raw => parseBackup(raw, verses);
const review = (state, n = 0, correct = true, day = '2026-09-12', direction = 'reference') => recordReview(state, { verseId: verses[n].id, direction, isNew: true }, correct, day);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const disk = () => { const data = new Map(); return { data, getItem: async k => data.get(k) ?? null, setItem: async (k,v) => { data.set(k, v); } }; };
const backend = (initial = null) => { let state = initial, revision = initial ? 1 : 0; return {
  get: async () => ({ state: structuredClone(state), revision }),
  put: async (next, expected) => { if (expected !== revision) throw Object.assign(new Error('Conflict'), { status: 409 }); state = structuredClone(next); revision++; return { revision, state: null, updatedAt: '2026-09-12T12:00:00Z' }; },
  read: () => structuredClone(state), revision: () => revision,
}; };

test('points and goal bonus survive reload without double taps farming rewards', () => {
  let state = fresh(); state.settings.dailyGoal = 2; state.settings.newPerDay = 2;
  state = review(state, 0, true); assert.equal(rewardsFor(state).xp, 10);
  state = review(state, 1, false); assert.equal(rewardsFor(state).xp, 38);
  const reload = parse(JSON.stringify(state));
  assert.equal(rewardsFor(review(reload, 1, true)).xp, 38);
  assert.equal(rewardsFor(reload).badges.find(b => b.id === 'goal').earned, true);
  assert.throws(() => parse(JSON.stringify({ ...state, stacks: [{id: 'abcdefgh', name: 'bad', verseIds: ['made-up'], updatedAt: new Date().toISOString()}] })));
});
test('concurrent devices preserve distinct reviews and combine settings changes', () => {
  const base = fresh(), a = review(base, 0), b = review(base, 1);
  a.settings = { ...a.settings, dailyGoal: 8 }; b.settings = { ...b.settings, fontScale: 1.3 };
  const merged = mergeStates(base, a, b);
  assert.equal(merged.history.length, 2); assert.equal(merged.settings.dailyGoal, 8); assert.equal(merged.settings.fontScale, 1.3);
  assert.equal(rewardsFor(merged).xp, 20); assert.deepEqual(parse(JSON.stringify(merged)), merged);
});
test('two grades on the same day count once and retain the more cautious schedule', () => {
  const base = fresh(), a = review(base, 0, true), b = review(base, 0, false);
  const merged = mergeStates(base, a, b);
  assert.equal(merged.history.length, 1); assert.equal(merged.progress[progressKey(verses[0].id,'reference')].box, 1);
  assert.equal(rewardsFor(merged).xp, 3);
  assert.deepEqual(mergeStates(base, a, b), mergeStates(base, b, a));
});
test('conflicting directions do not leave an unearned second-direction card behind', () => {
  const base = fresh(), a = review(base, 0, true), b = review(base, 0, false, '2026-09-12', 'verse');
  const merged = mergeStates(base, a, b);
  assert.equal(merged.history[0].direction, 'verse'); assert.equal(Object.keys(merged.progress).length, 1);
  assert.equal(merged.progress[progressKey(verses[0].id, 'verse')].box, 1);
});
test('pausing on one device is preserved when another reviews a different card', () => {
  const base = fresh(), a = { ...base, enrolled: base.enrolled.slice(1) }, b = review(base, 1);
  const merged = mergeStates(base, a, b);
  assert.ok(!merged.enrolled.includes(verses[0].id)); assert.equal(merged.history.length, 1);
});
test('legacy guest copy is kept and never automatically becomes an account', async () => {
  const d = disk(), guest = review(fresh()); d.data.set('wordmemo.v1', JSON.stringify(guest));
  const store = new LearningStore(d, fresh, parse); await store.open('guest'); assert.equal(store.snapshot().state.history.length, 1);
  const cloud = backend(); await store.open('user:alice', cloud);
  assert.equal(store.snapshot().state.history.length, 0); assert.equal(store.snapshot().guest.history.length, 1);
  assert.equal(cloud.read().history.length, 0); assert.equal(d.data.get('wordmemo.v1'), JSON.stringify(guest));
});
test('offline edits survive reopening and sync after connection returns', async () => {
  const d = disk(), remote = backend(), offline = { get: async () => { throw new Error('Offline'); }, put: remote.put };
  let store = new LearningStore(d, fresh, parse); await store.open('user:alice', offline); store.update(s => review(s)); await store.flush();
  store = new LearningStore(d, fresh, parse); await store.open('user:alice', remote);
  assert.equal(remote.read().history.length, 1); assert.equal(store.snapshot().status, 'saved');
});
test('edits made while a cloud write is in flight are sent in a subsequent write', async () => {
  const d = disk(), remote = backend(), gate = deferred(); let block = false, calls = 0;
  const cloud = { get: remote.get, put: async (...args) => { calls++; if (block) { block = false; await gate.promise; } return remote.put(...args); } };
  const store = new LearningStore(d, fresh, parse); await store.open('user:alice', cloud);
  block = true; store.update(s => review(s, 0)); const saving = store.sync(); await tick();
  store.update(s => review(s, 1)); gate.resolve(); await saving;
  assert.equal(remote.read().history.length, 2); assert.equal(store.snapshot().status, 'saved'); assert.ok(calls >= 3);
});
test('late responses from account A cannot overwrite or upload account B', async () => {
  const d = disk(), a = backend(), b = backend(), gate = deferred();
  const store = new LearningStore(d, fresh, parse);
  await store.open('user:alice', a); store.update(s => review(s, 0)); await store.sync();
  const pending = store.open('user:alice', { get: () => gate.promise, put: a.put }); await tick();
  await store.open('user:bob', b); store.update(s => review(s, 1)); await store.sync();
  gate.resolve(await a.get()); await pending;
  assert.equal(store.snapshot().scope, 'user:bob'); assert.deepEqual(b.read().history.map(h=>h.verseId), [verses[1].id]);
  assert.deepEqual(a.read().history.map(h=>h.verseId), [verses[0].id]);
});
test('guest import is idempotent, survives a failed upload, and keeps its original copy', async () => {
  const d = disk(), guest = review(fresh()); d.data.set('wordmemo.v1', JSON.stringify(guest));
  const remote = backend(); let fail = false;
  const cloud = { get: remote.get, put: (...args) => fail ? Promise.reject(new Error('Offline')) : remote.put(...args) };
  let store = new LearningStore(d, fresh, parse); await store.open('user:alice', cloud); fail = true;
  await store.importGuest(); assert.equal(store.snapshot().status, 'waiting'); await store.flush();
  assert.equal(remote.read().history.length, 0); assert.equal(d.data.get('wordmemo.v1'), JSON.stringify(guest));
  fail = false; store = new LearningStore(d, fresh, parse); await store.open('user:alice', cloud);
  assert.equal(remote.read().history.length, 1); assert.equal(store.snapshot().guest, undefined);
  await store.importGuest(); assert.equal(remote.read().history.length, 1);
});
test('a revision conflict fetches and merges the latest remote copy before retrying', async () => {
  const remote = backend(); let inject = false;
  const cloud = { get: remote.get, put: async (...args) => { if (inject) { inject = false; await remote.put(cloudState(review(remote.read(), 1)), remote.revision()); } return remote.put(...args); } };
  const store = new LearningStore(disk(), fresh, parse); await store.open('user:alice', cloud);
  store.update(s => review(s, 0)); inject = true; await store.sync();
  assert.equal(remote.read().history.length, 2); assert.equal(store.snapshot().status, 'saved');
});
test('cloud reads cannot replace local progress with a corrupt or foreign schema', async () => {
  const d = disk(), cloud = backend(), store = new LearningStore(d, fresh, parse);
  await store.open('user:alice', cloud); store.update(s => review(s, 0)); await store.sync();
  await store.open('user:alice', { get: async () => ({state:{injected:true},revision:9}), put: () => { throw new Error('Must not upload'); } });
  assert.equal(store.snapshot().state.history.length, 1); assert.equal(store.snapshot().status, 'waiting');
});
