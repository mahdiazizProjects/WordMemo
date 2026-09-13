import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeBible, combineCatalog, verseId } from '../src/bible-model.ts';
import { makeSearchIndex } from '../src/search.ts';
import { buildQueue, initialState, parseBackup, recordReview } from '../src/leitner.ts';

const load = name => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), 'utf8'));
const rows = load('bible'), books = load('books'), topics = load('topics'), annotations = load('annotations');
const notes = load('verse-notes'), selections = load('curated-sources'), starter = load('verses');
const bible = makeBible(rows, books, annotations, topics, notes, selections);
const catalog = combineCatalog(bible, starter);
const search = makeSearchIndex(bible, books, topics);
const byId = new Map(catalog.map(v => [v.id, v]));
const at = (book, chapter, verse) => byId.get(verseId(book, chapter, verse));

test('every book and chapter of this edition is included exactly once', () => {
  assert.equal(books.length, 66); assert.equal(books.reduce((n, b) => n + b.chapters, 0), 1189);
  assert.equal(bible.length, 31103); assert.equal(new Set(bible.map(v => v.id)).size, bible.length);
  assert.equal(books[0].id, 'GEN'); assert.equal(books.at(-1).id, 'REV');
  assert.equal(books.filter(b => b.testament === 'Old Testament').length, 39);
  assert.equal(books.filter(b => b.testament === 'New Testament').length, 27);
});
test('the shipped full text matches its recorded checksum', () => {
  const bytes = readFileSync(new URL('../src/data/bible.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), load('bible-provenance').bibleSha256);
});
test('every verse has book metadata and an aligned classification row', () => {
  assert.equal(annotations.length, rows.length);
  for (let i = 0; i < bible.length; i++) {
    const v = bible[i]; assert.ok(v.bookId && v.testament && v.section && v.sourceUrl);
    assert.equal(v.text, rows[i][3]); assert.equal(v.sourceIndex, i);
    assert.ok(v.tags.every(t => topics.some(topic => topic.id === t)));
    assert.equal(new Set(v.tags).size, v.tags.length);
  }
});
test('published text notes remain notes and cannot enter a practice queue', () => {
  const empty = bible.filter(v => !v.text); assert.equal(empty.length, 5);
  assert.ok(empty.every(v => v.textNote)); assert.equal(bible.filter(v => v.text).length, 31098);
  const s = initialState(catalog); s.enrolled = empty.map(v => v.id);
  assert.deepEqual(buildQueue(s, catalog, '2026-09-09'), []);
});
test('source numbering is preserved when it differs from familiar editions', () => {
  assert.ok(at('ROM', 14, 24).text); assert.ok(at('ROM', 16, 25).textNote);
  assert.equal(at('ROM', 16, 26), undefined);
});
test('multi-verse starter cards and older backups remain compatible', () => {
  for (const v of starter) assert.ok(byId.has(v.id));
  let old = initialState(starter); old = recordReview(old, buildQueue(old, starter, '2026-09-09')[0], true, '2026-09-09');
  assert.deepEqual(parseBackup(JSON.stringify(old), catalog), old);
  const range = byId.get('webp-jas-1-2-4');
  assert.equal(range.text, [2, 3, 4].map(v => at('JAS', 1, v).text).join(' '));
});
test('reference searches support common book spellings, abbreviations, and ranges', () => {
  for (const q of ['John 3:16', 'Jn3:16', 'JHN 3:16']) assert.deepEqual(search.find({ query: q }).map(v => v.id), [verseId('JHN', 3, 16)]);
  assert.equal(search.find({ query: '1 John 4:19' })[0].id, verseId('1JN', 4, 19));
  assert.equal(search.find({ query: 'Psalm 23' }).length, 6);
  assert.equal(search.find({ query: 'John 3:16–18' }).length, 3);
  assert.equal(search.find({ query: 'John 999:1' }).length, 0);
});
test('keyword and topic searches reach the full Bible rather than the starter set', () => {
  assert.ok(search.find({ query: 'created the heavens' }).some(v => v.id === verseId('GEN', 1, 1)));
  assert.ok(search.find({ query: 'perseverance' }).some(v => v.id === verseId('HEB', 12, 1)));
  assert.ok(search.find({ query: 'endurance' }).some(v => v.id === verseId('JAS', 1, 3)));
});
test('curated topic filters return the exact reported collection and hide suggestions', () => {
  for (const topic of topics) {
    const curated = search.find({ topicId: topic.id, curatedOnly: true });
    const all = search.find({ topicId: topic.id });
    assert.equal(curated.length, topic.counts.curated);
    assert.equal(all.length, topic.counts.curated + topic.counts.suggested);
    assert.ok(curated.every(v => v.assignments.some(a => a.topic === topic.id && a.basis === 'curated')));
  }
});
test('editorial evidence is retained for each curated topic', () => {
  for (const v of bible) for (const a of v.assignments) if (a.basis === 'curated') assert.ok(a.sourceRange);
  assert.ok(at('GEN', 1, 1).assignments.some(a => a.topic === 'creation' && a.basis === 'curated'));
  assert.ok(at('JAS', 1, 3).assignments.some(a => a.topic === 'perseverance' && a.basis === 'curated'));
});
test('reverence language is not automatically labeled as anxiety', () => {
  assert.ok(at('PRO', 9, 10).text.toLowerCase().includes('fear'));
  assert.ok(!at('PRO', 9, 10).tags.includes('anxiety'));
});
test('book, chapter, and collection filters compose without leaking other verses', () => {
  const ids = new Set([verseId('GEN', 1, 1), verseId('JHN', 3, 16)]);
  const results = search.find({ ids, bookId: 'JHN', chapter: 3 });
  assert.equal(results.length, 1); assert.equal(results[0].id, verseId('JHN', 3, 16));
  assert.equal(search.find({ bookId: 'REV', chapter: 22 }).length, 21);
});
test('any full-Bible verse can join a daily session within the existing limits', () => {
  const s = initialState(catalog); s.enrolled = [verseId('REV', 22, 21)];
  const q = buildQueue(s, catalog, '2026-09-09');
  assert.equal(q.length, 1); assert.equal(q[0].verseId, verseId('REV', 22, 21));
});
