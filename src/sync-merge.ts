import { schedule, progressKey } from './leitner.ts';
import type { AppState, Review, Progress } from './types';

/** Stable comparison for snapshots received with a different JSON key order. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + stableJson(object[key])).join(',') + '}';
}
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** Notification scheduling belongs to this device, never another signed-in phone. */
export function cloudState(state: AppState): AppState {
  return { ...state, goalDays: state.goalDays ?? [], stacks: state.stacks ?? [], settings: { ...state.settings, reminderEnabled: false, reminderTime: '08:00' } };
}

function mergeSet(base: string[], local: string[], remote: string[]): string[] {
  const original = new Set(base), left = new Set(local), right = new Set(remote);
  return [...new Set([...local, ...remote])].filter(id => original.has(id) ? left.has(id) && right.has(id) : left.has(id) || right.has(id)).sort();
}

function chooseReview(left: Review, right: Review): Review {
  // A verse reviewed twice on two devices still counts once that day. If
  // grades disagree, keep the less confident grade so it returns for practice.
  if (left.correct !== right.correct) return left.correct ? right : left;
  return stableJson(left) < stableJson(right) ? left : right;
}

/** Three-way merge: changes on another device cannot erase unsent local reviews. */
export function mergeStates(base: AppState, local: AppState, remote: AppState): AppState {
  const reviews = new Map<string, Review>();
  for (const review of [...local.history, ...remote.history]) {
    reviews.set(review.id, reviews.has(review.id) ? chooseReview(reviews.get(review.id)!, review) : review);
  }
  const history = [...reviews.values()].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const settings = { ...remote.settings };
  for (const key of Object.keys(local.settings) as (keyof AppState['settings'])[]) {
    if (!same(local.settings[key], base.settings[key])) (settings as Record<string, unknown>)[key] = local.settings[key];
  }
  settings.newPerDay = Math.min(settings.newPerDay, settings.dailyGoal);
  settings.reminderEnabled = local.settings.reminderEnabled;
  settings.reminderTime = local.settings.reminderTime;
  const progress: Record<string, Progress> = {};
  const relatedByKey = new Map<string, Review[]>();
  for (const r of history) { const key = progressKey(r.verseId, r.direction); const list = relatedByKey.get(key) ?? []; list.push(r); relatedByKey.set(key, list); }
  const discardedDays = new Map<string, string>();
  for (const r of [...local.history, ...remote.history]) {
    if (reviews.get(r.id)?.direction !== r.direction) { const key = progressKey(r.verseId, r.direction); discardedDays.set(key, [discardedDays.get(key) ?? '', r.day].sort().at(-1)!); }
  }
  for (const key of new Set([...Object.keys(local.progress), ...Object.keys(remote.progress)])) {
    const before = base.progress[key], left = local.progress[key], right = remote.progress[key];
    const related = relatedByKey.get(key) ?? [];
    const newReviews = related.filter(review => !before || review.day > before.lastReviewed);
    const latest = !left ? right : !right ? left : left.lastReviewed >= right.lastReviewed ? left : right;
    if (newReviews.length) {
      let result = before;
      for (const review of newReviews) result = schedule(result, review.correct, review.day);
      // Preserve older imported counters if their history was incomplete.
      progress[key] = latest && (latest.lastReviewed > result!.lastReviewed || latest.reviews > result!.reviews) ? latest : result!;
    } else {
      const discarded = (discardedDays.get(key) ?? '') > (before?.lastReviewed ?? '');
      if (discarded) { if (before) progress[key] = before; }
      else if (!left || same(left, before)) { if (right) progress[key] = right; }
      else if (latest) progress[key] = latest;
    }
  }
  const stackIds = mergeSet((base.stacks ?? []).map(s => s.id), (local.stacks ?? []).map(s => s.id), (remote.stacks ?? []).map(s => s.id));
  const overflow: NonNullable<AppState['stacks']> = [];
  const stacks = stackIds.map(id => {
    const l = local.stacks?.find(s => s.id === id), r = remote.stacks?.find(s => s.id === id), b = base.stacks?.find(s => s.id === id);
    if (!l || same(l, b)) return r!;
    if (!r || same(r, b)) return l;
    // Preserve both sets of cards on concurrent edits to one stack.
    const chosen = l.updatedAt >= r.updatedAt ? l : r;
    const cards = mergeSet(b?.verseIds ?? [], l.verseIds, r.verseIds);
    if (cards.length > 200) overflow.push({ ...chosen, id: id.slice(0, 65) + '-merged', name: (chosen.name + ' (continued)').slice(0, 80), verseIds: cards.slice(200) });
    return { ...chosen, verseIds: cards.slice(0, 200) };
  }).filter(s => s && s.verseIds.length > 0).map(s => ({ ...s, verseIds: [...s.verseIds] }));
  for (const extra of overflow) {
    const existing = stacks.find(s => s.id === extra.id);
    if (existing) existing.verseIds = [...new Set([...existing.verseIds, ...extra.verseIds])]; else stacks.push(extra);
  }
  if (stacks.length > 50 || stacks.some(s => s.verseIds.length > 200)) throw new Error('These devices have more stacks than can be combined safely. Export a backup, reduce the number of stacks, then retry saving.');
  const lessons = new Map<string, NonNullable<AppState['lessons']>[number]>();
  for (const item of [...(remote.lessons ?? []), ...(local.lessons ?? [])]) {
    const old = lessons.get(item.id);
    if (!old || item.updatedAt > old.updatedAt || (item.updatedAt === old.updatedAt && stableJson(item) > stableJson(old))) lessons.set(item.id, item);
  }
  if (lessons.size > 4000) throw new Error('There are too many lessons to merge safely. Export a backup.');
  const ld = local.stackDraft, rd = remote.stackDraft;
  const stackDraft = !ld ? rd : !rd ? ld : same(ld, base.stackDraft) ? rd : same(rd, base.stackDraft) ? ld : ld.updatedAt >= rd.updatedAt ? ld : rd;
  const days = new Set(history.map(r => r.day));
  return { ...(local.lessons !== undefined || remote.lessons !== undefined ? { lessons: [...lessons.values()] } : {}), ...(stackDraft ? { stackDraft } : {}), version: 1, onboarded: local.onboarded || remote.onboarded, settings, stacks,
    enrolled: mergeSet(base.enrolled, local.enrolled, remote.enrolled),
    favorites: mergeSet(base.favorites, local.favorites, remote.favorites), progress, history,
    goalDays: [...new Set([...(local.goalDays ?? []), ...(remote.goalDays ?? [])])].filter(day => days.has(day)).sort() };
}
