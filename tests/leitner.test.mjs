import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addDays, boxCounts, buildQueue, initialState, localDay, parseBackup, progressKey, recordReview, schedule } from '../src/leitner.ts';

const verses = JSON.parse(readFileSync(new URL('../src/data/verses.json', import.meta.url), 'utf8'));
const day = '2026-09-09';
const base = () => initialState(verses);

test('first session respects the daily cap and contains distinct passages', () => {
  const q = buildQueue(base(), verses, day);
  assert.equal(q.length, 5); assert.equal(new Set(q.map(x => x.verseId)).size, 5);
  assert.ok(q.every(x => x.isNew));
});
test('a due existing review precedes new material', () => {
  const s = base(); s.settings.mode = 'reference';
  const id = verses[7].id;
  s.progress[progressKey(id, 'reference')] = { box: 4, due: '2026-09-01', lastReviewed: '2026-08-18', reviews: 4 };
  assert.equal(buildQueue(s, verses, day)[0].verseId, id);
});
test('new-verse limit is cumulative across interrupted sessions', () => {
  let s = base(); s.settings.newPerDay = 2;
  const first = buildQueue(s, verses, day)[0]; s = recordReview(s, first, true, day);
  const second = buildQueue(s, verses, day); assert.equal(second.length, 1);
  s = recordReview(s, second[0], true, day); assert.equal(buildQueue(s, verses, day).length, 0);
});
test('a grade changes only its tested direction', () => {
  const s = base(); const item = buildQueue(s, verses, day)[0];
  const next = recordReview(s, item, true, day);
  assert.deepEqual(next.progress[progressKey(item.verseId, 'reference')], { box: 2, due: '2026-09-12', lastReviewed: day, reviews: 1 });
  assert.equal(next.progress[progressKey(item.verseId, 'verse')], undefined);
  assert.equal(s.history.length, 0);
});
test('mixed practice can test the other direction on a later day', () => {
  const s = base(); const item = buildQueue(s, verses, day)[0];
  const next = recordReview(s, item, true, day); next.settings.newPerDay = 0;
  assert.equal(buildQueue(next, verses, addDays(day, 1))[0].direction, 'verse');
});
test('failure returns a high-box card to tomorrow, even after a long absence', () => {
  const p = schedule({ box: 5, due: '2025-01-01', lastReviewed: '2024-12-02', reviews: 7 }, false, day);
  assert.equal(p.box, 1); assert.equal(p.due, '2026-09-10'); assert.equal(p.reviews, 8);
});
test('box five keeps a recurring 30-day review', () => {
  const p = schedule({ box: 5, due: day, lastReviewed: '2026-08-10', reviews: 8 }, true, day);
  assert.equal(p.box, 5); assert.equal(p.due, '2026-10-09');
});
test('double taps and second-direction reviews cannot double count a day', () => {
  let s = base(); const item = buildQueue(s, verses, day)[0]; s = recordReview(s, item, true, day);
  assert.equal(recordReview(s, item, false, day), s);
  assert.equal(recordReview(s, { ...item, direction: 'verse' }, true, day), s);
  assert.equal(s.history.length, 1);
});
test('reducing the goal below today’s total leaves history intact', () => {
  let s = base(); const q = buildQueue(s, verses, day); for (const item of q.slice(0, 3)) s = recordReview(s, item, true, day);
  s.settings.dailyGoal = 2; s.settings.newPerDay = 2;
  assert.equal(buildQueue(s, verses, day).length, 0); assert.equal(s.history.length, 3);
  assert.equal(recordReview(s, q[3], true, day), s);
});
test('future cards stay out of a fixed-direction session', () => {
  let s = base(); s.settings.mode = 'reference'; s.settings.dailyGoal = 1;
  s = recordReview(s, buildQueue(s, verses, day)[0], true, day);
  s.settings.newPerDay = 0;
  assert.equal(buildQueue(s, verses, '2026-09-10').length, 0);
  assert.equal(buildQueue(s, verses, '2026-09-12').length, 1);
});
test('review-only mode introduces no new verses', () => {
  const s = base(); s.settings.newPerDay = 0;
  assert.deepEqual(buildQueue(s, verses, day), []);
});
test('pausing excludes a verse without losing its progress', () => {
  let s = base(); const item = buildQueue(s, verses, day)[0]; s = recordReview(s, item, true, day);
  s.enrolled = s.enrolled.filter(id => id !== item.verseId);
  assert.ok(!buildQueue(s, verses, '2026-10-01').some(i => i.verseId === item.verseId));
  assert.ok(s.progress[progressKey(item.verseId, item.direction)]);
  assert.equal(boxCounts(s).reduce((a, b) => a + b, 0), 0);
});
test('calendar arithmetic handles leap days, years, and daylight saving', () => {
  const oldZone = process.env.TZ; process.env.TZ = 'America/Vancouver';
  try {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-07', 2), '2026-03-09');
    assert.equal(addDays('2026-10-31', 2), '2026-11-02');
    assert.equal(localDay(new Date('2026-09-10T01:00:00Z')), '2026-09-09');
  } finally { if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone; }
});
test('backup round trip preserves reviewed progress and rejects corruption', () => {
  let s = base(); s = recordReview(s, buildQueue(s, verses, day)[0], true, day);
  assert.deepEqual(parseBackup(JSON.stringify(s), verses), s);
  for (const corrupt of [
    { ...s, version: 2 }, { ...s, settings: { ...s.settings, dailyGoal: -1 } },
    { ...s, settings: { ...s.settings, reminderTime: '25:00' } },
    { ...s, enrolled: ['made-up-verse'] }, { ...s, history: [...s.history, ...s.history] },
    { ...s, history: [{ ...s.history[0], day: '2026-02-30', id: `2026-02-30:${s.history[0].verseId}` }] },
  ]) assert.throws(() => parseBackup(JSON.stringify(corrupt), verses));
});
test('the catalog contains unique, attributed, multi-tag passages', () => {
  assert.equal(verses.length, 30); assert.equal(new Set(verses.map(v => v.id)).size, 30);
  for (const v of verses) {
    assert.equal(v.translation, 'WEBP'); assert.ok(v.sourceUrl.startsWith('https://ebible.org/engwebp/'));
    assert.ok(v.text.length > 8 && !v.text.includes('<')); assert.ok(v.tags.length);
    assert.ok(v.endVerse >= v.startVerse);
  }
  assert.equal(verses[0].text, 'Let’s not be weary in doing good, for we will reap in due season if we don’t give up.');
});
