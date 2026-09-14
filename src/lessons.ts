import type { AppState, Verse, VerseStack } from './types';
export type Lesson = {
  id: string; stackId: string; name: string; verseIds: string[]; unit: number;
  step: number; mistakes: string[]; result: boolean | null; input: string; tiles: number[];
  hinted: boolean; correct: number; updatedAt: string;
};
export type StackDraft = { value: VerseStack | null; updatedAt: string };
export const lessonId = (stackId: string, unit: number) => `${stackId}:${unit}`;
export const totalSteps = (lesson: Lesson) => lesson.verseIds.length * 4 + lesson.mistakes.length;
export function newLesson(stack: VerseStack, unit: number): Lesson {
  return { id: lessonId(stack.id, unit), stackId: stack.id, name: stack.name, unit,
    verseIds: stack.verseIds.slice(unit * 3, unit * 3 + 3), step: 0, mistakes: [], result: null,
    input: '', tiles: [], hinted: false, correct: 0, updatedAt: new Date().toISOString() };
}
export function currentExercise(l: Lesson) {
  const base = l.verseIds.length * 4;
  return { verseId: l.step < base ? l.verseIds[Math.floor(l.step / 4)] : l.mistakes[l.step - base], phase: l.step < base ? l.step % 4 : 3, retry: l.step >= base };
}
export const normalizeAnswer = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export function phraseFor(v: Verse) { return v.text.split(/\s+/).slice(0, 12); }
export function gapFor(v: Verse) {
  const words = v.text.split(/\s+/), candidates = words.map((word, index) => ({ word, index })).filter(x => /^[A-Za-z]{4,}[,.;!?]?$/.test(x.word));
  const gap = candidates[Math.floor(candidates.length / 2)] ?? { word: words[0], index: 0 };
  return { answer: gap.word, prompt: words.map((w, i) => i === gap.index ? '_____' : w).join(' ') };
}
export function gradeLesson(l: Lesson, correct: boolean): Lesson {
  if (l.result !== null || l.step >= totalSteps(l)) return l;
  const exercise = currentExercise(l), independent = correct && !l.hinted;
  return { ...l, result: independent, correct: l.correct + (independent ? 1 : 0), mistakes: !independent && !l.mistakes.includes(exercise.verseId) ? [...l.mistakes, exercise.verseId] : l.mistakes, updatedAt: new Date().toISOString() };
}
export function nextExercise(l: Lesson): Lesson {
  if (l.result === null) return l;
  return { ...l, step: l.step + 1, result: null, input: '', tiles: [], hinted: false, updatedAt: new Date().toISOString() };
}
export function putLesson(state: AppState, lesson: Lesson): AppState {
  const other = (state.lessons ?? []).filter(l => l.id !== lesson.id);
  if (other.length >= 4000) throw new Error('Your lesson collection is full. Export a backup before adding more.');
  return { ...state, lessons: [...other, lesson] };
}
/** Validate only references and bounded interaction state; never import Scripture text. */
export function validLesson(l: any, ids: Set<string>): l is Lesson {
  const list = (x: any, max: number) => Array.isArray(x) && x.length <= max && x.every((id: any) => typeof id === 'string' && ids.has(id)) && new Set(x).size === x.length;
  const integer = (x: any, max: number) => Number.isInteger(x) && x >= 0 && x <= max;
  return !!l && Object.keys(l).sort().join(',') === 'correct,hinted,id,input,mistakes,name,result,stackId,step,tiles,unit,updatedAt,verseIds' && typeof l.stackId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(l.stackId) && integer(l.unit, 66) && l.id === lessonId(l.stackId, l.unit)
    && typeof l.name === 'string' && l.name.trim().length > 0 && l.name.length <= 80 && list(l.verseIds, 3) && l.verseIds.length > 0
    && list(l.mistakes, 3) && l.mistakes.every((id: string) => l.verseIds.includes(id)) && integer(l.step, totalSteps(l))
    && (l.result === null || typeof l.result === 'boolean') && (l.step < totalSteps(l) || l.result === null) && typeof l.input === 'string' && l.input.length <= 4000
    && Array.isArray(l.tiles) && l.tiles.length <= 12 && l.tiles.every((i: any) => integer(i, 11)) && new Set(l.tiles).size === l.tiles.length
    && typeof l.hinted === 'boolean' && integer(l.correct, l.step + (l.result === null ? 0 : 1))
    && typeof l.updatedAt === 'string' && l.updatedAt.length <= 40 && Number.isFinite(Date.parse(l.updatedAt));
}
