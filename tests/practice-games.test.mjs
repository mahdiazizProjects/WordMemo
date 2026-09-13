import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQuestions } from '../src/practice-games.ts';
const verses = [
  { id: 'a', reference: 'Book 1:1', text: 'Carry these words with courage.' },
  { id: 'b', reference: 'Book 1:2', text: 'Remember patience, kindness and wisdom.' },
  { id: 'c', reference: 'Book 1:3', text: 'Walk with hope through every season.' },
  { id: 'd', reference: 'Book 1:4', text: 'Keep these promises in your heart.' },
];
test('Questions have one correct choice and keep source text intact', () => {
  const before = JSON.stringify(verses);
  for (let seed = 0; seed < 20; seed++) for (const q of makeQuestions(verses, seed)) {
    assert.equal(q.options.filter(x => x === q.answer).length, 1);
    assert.equal(new Set(q.options.map(x => x.toLowerCase())).size, q.options.length);
    assert.ok(q.options.length >= 2);
    if (q.title === 'Complete the verse') assert.equal(q.prompt.replace('_____', q.answer), q.verse.text);
  }
  assert.equal(JSON.stringify(verses), before);
});
test('Empty, duplicate and short passages never produce unanswerable games', () => {
  assert.deepEqual(makeQuestions([]), []);
  assert.deepEqual(makeQuestions([verses[0], verses[0]]), []);
  for (const q of makeQuestions([{ id:'x', reference:'X 1:1',text:'I am.' }, ...verses])) assert.ok(q.options.includes(q.answer));
});
