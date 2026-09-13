import type { AppState, Verse } from './types';

export const CORRECT_XP = 10;
export const PRACTICE_XP = 3;
export const DAILY_GOAL_XP = 25;
export const LEVEL_XP = 100;

export function rewardsFor(state: AppState, verses: Pick<Verse, 'id' | 'tags'>[] = []) {
  const reviews = [...new Map(state.history.map(review => [review.id, review])).values()];
  const correct = reviews.filter(review => review.correct).length;
  const days = new Set(reviews.map(review => review.day));
  const goalDays = new Set((state.goalDays ?? []).filter(day => days.has(day)));
  const xp = correct * CORRECT_XP + (reviews.length - correct) * PRACTICE_XP + goalDays.size * DAILY_GOAL_XP;
  const learned = new Set(reviews.filter(review => review.correct).map(review => review.verseId));
  const topics = new Set(verses.filter(verse => learned.has(verse.id)).flatMap(verse => verse.tags));
  const badges = [
    { id: 'first', name: 'First step', description: 'Complete your first review', icon: 'sunrise', current: reviews.length, target: 1 },
    { id: 'goal', name: 'A daily rhythm', description: 'Reach your daily goal', icon: 'target', current: goalDays.size, target: 1 },
    { id: 'ten', name: 'Words to carry', description: 'Recall 10 different verses correctly', icon: 'book-open', current: learned.size, target: 10 },
    { id: 'return', name: 'Keep returning', description: 'Practise on 7 different days', icon: 'calendar', current: days.size, target: 7 },
    { id: 'topics', name: 'Every season', description: 'Recall verses across 5 topics', icon: 'compass', current: topics.size, target: 5 },
    { id: 'hundred', name: 'Growing roots', description: 'Complete 100 reviews', icon: 'award', current: reviews.length, target: 100 },
  ].map(badge => ({ ...badge, earned: badge.current >= badge.target }));
  const level = Math.floor(xp / LEVEL_XP) + 1;
  const names = ['A beginning', 'Taking root', 'Growing steadily', 'Branching out', 'Bearing fruit'];
  return { xp, level, levelName: names[Math.min(names.length - 1, Math.floor((level - 1) / 3))],
    levelProgress: xp % LEVEL_XP, toNextLevel: LEVEL_XP - xp % LEVEL_XP,
    correct, practiceDays: days.size, goalDays: goalDays.size, learned: learned.size, badges };
}
