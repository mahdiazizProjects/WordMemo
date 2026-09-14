import type { AppState } from './types';
import { totalSteps } from './lessons.ts';
export function gardenFor(state: AppState) {
  const reviews = new Set(state.history.map(r => r.id)).size;
  const lessons = new Set((state.lessons ?? []).filter(l => !l.stackId.endsWith('-review') && l.step >= totalSteps(l)).map(l => l.id)).size;
  const growth = reviews + lessons;
  const plants = [1, 5, 10, 25, 50, 100].map((target, i) => ({ target, name: ['First seed', 'Olive shoot', 'Peace lily', 'Hope blossom', 'Faithful branches', 'Abundant garden'][i], earned: growth >= target }));
  return { reviews, lessons, growth, plants, next: plants.find(p => !p.earned) };
}
