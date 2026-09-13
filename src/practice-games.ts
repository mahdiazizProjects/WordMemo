import type { Verse } from './types';
export type GameQuestion = { id: string; title: string; prompt: string; answer: string; options: string[]; verse: Verse };
export function makeQuestions(verses: Verse[], seed = 0): GameQuestion[] {
  const unique = [...new Map(verses.filter(v => v.text.trim()).map(v => [v.id, v])).values()];
  const rotated = unique.slice(seed % Math.max(1, unique.length)).concat(unique.slice(0, seed % Math.max(1, unique.length)));
  return rotated.slice(0, 5).map((verse, i) => {
    const words = verse.text.split(/\s+/);
    const eligible = words.map((word, index) => ({ word, index })).filter(x => /^[A-Za-z]{4,}[,.;!?]?$/.test(x.word));
    const missing = eligible[(seed + i) % Math.max(1, eligible.length)];
    const blank = i % 2 === 1 && !!missing;
    const answer = blank ? missing.word.replace(/[^A-Za-z]/g, '') : verse.reference;
    const alternatives = blank ? rotated.slice(0, 100).flatMap(v => v.text.match(/\b[A-Za-z]{4,}\b/g) ?? []) : rotated.slice(0, 100).map(v => v.reference);
    const options = [answer, ...[...new Map(alternatives.map(w => [w.toLowerCase(), w])).values()].filter(w => w.toLowerCase() !== answer.toLowerCase()).slice(0, 3)];
    const shift = (seed + i + 1) % options.length;
    if (blank) words[missing.index] = missing.word.replace(/[A-Za-z]+/, '_____');
    return { id: verse.id, title: blank ? 'Complete the verse' : 'Find the reference', prompt: blank ? words.join(' ') : verse.text, answer, options: options.slice(shift).concat(options.slice(0, shift)), verse };
  }).filter(q => q.options.length > 1);
}
