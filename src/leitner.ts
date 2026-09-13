import type { AppState, Direction, Progress, QueueItem, Verse } from './types';

// Product defaults, not a claim that these are uniquely optimal intervals.
export const INTERVALS = [1, 3, 7, 14, 30] as const;
export const DIRECTIONS: Direction[] = ['reference', 'verse'];

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Calendar arithmetic at noon avoids UTC-boundary and DST-hour arithmetic bugs.
export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return localDay(new Date(year, month - 1, date + count, 12));
}

export const progressKey = (id: string, direction: Direction) => `${id}:${direction}`;
export const wasIntroduced = (state: AppState, id: string) => DIRECTIONS.some(d => !!state.progress[progressKey(id, d)]);
export const reviewedToday = (state: AppState, day = localDay()) => new Set(state.history.filter(h => h.day === day).map(h => h.verseId));

export function schedule(previous: Progress | undefined, correct: boolean, day: string): Progress {
  const box = correct ? Math.min(5, (previous?.box ?? 1) + 1) : 1;
  return { box, due: addDays(day, INTERVALS[box - 1]), reviews: (previous?.reviews ?? 0) + 1, lastReviewed: day };
}

export function initialState(verses: Verse[]): AppState {
  return {
    version: 1, onboarded: false,
    settings: { dailyGoal: 5, newPerDay: 5, mode: 'mixed', fontScale: 1, reminderTime: '08:00', reminderEnabled: false },
    enrolled: verses.slice(0, 12).map(v => v.id), favorites: [], progress: {}, history: [],
  };
}

/** One due direction per distinct verse; oldest due reviews before new verses. */
export function buildQueue(state: AppState, verses: Verse[], day = localDay()): QueueItem[] {
  const completed = reviewedToday(state, day);
  const remaining = Math.max(0, state.settings.dailyGoal - completed.size);
  const introducedToday = new Set(state.history.filter(h => h.day === day && h.newVerse).map(h => h.verseId)).size;
  const newSlots = Math.max(0, state.settings.newPerDay - introducedToday);
  const allowed: Direction[] = state.settings.mode === 'mixed' ? DIRECTIONS : [state.settings.mode];
  const due: (QueueItem & { due: string; box: number })[] = [];
  const fresh: QueueItem[] = [];
  const active = new Set(state.enrolled);
  for (const verse of verses) {
    if (!verse.text.trim() || !active.has(verse.id) || completed.has(verse.id)) continue;
    const candidates = allowed.map(direction => ({ direction, p: state.progress[progressKey(verse.id, direction)] }))
      .filter(({ p }) => !p || p.due <= day)
      .sort((a, b) => (a.p?.due ?? '0000').localeCompare(b.p?.due ?? '0000') || (a.p?.box ?? 1) - (b.p?.box ?? 1));
    if (!candidates.length) continue;
    const { direction, p } = candidates[0];
    const item = { verseId: verse.id, direction, isNew: !wasIntroduced(state, verse.id) };
    if (item.isNew) fresh.push(item);
    else due.push({ ...item, due: p?.due ?? '0000', box: p?.box ?? 1 });
  }
  due.sort((a, b) => a.due.localeCompare(b.due) || a.box - b.box || a.verseId.localeCompare(b.verseId));
  return [...due, ...fresh.slice(0, newSlots)].slice(0, remaining).map(({ verseId, direction, isNew }) => ({ verseId, direction, isNew }));
}

/** Guard against rapid double taps, stale session items, and a changed daily cap. */
export function recordReview(state: AppState, item: QueueItem, correct: boolean, day = localDay()): AppState {
  if (!state.enrolled.includes(item.verseId) || reviewedToday(state, day).has(item.verseId) || reviewedToday(state, day).size >= state.settings.dailyGoal) return state;
  const key = progressKey(item.verseId, item.direction);
  const previous = state.progress[key];
  if (previous && previous.due > day) return state;
  const isNew = !wasIntroduced(state, item.verseId);
  const newCount = new Set(state.history.filter(h => h.day === day && h.newVerse).map(h => h.verseId)).size;
  if (isNew && newCount >= state.settings.newPerDay) return state;
  return {
    ...state,
    progress: { ...state.progress, [key]: schedule(previous, correct, day) },
    history: [...state.history, { id: `${day}:${item.verseId}`, verseId: item.verseId, direction: item.direction, day, correct, newVerse: isNew }],
    goalDays: [...new Set([...(state.goalDays ?? []), ...(reviewedToday(state, day).size + 1 >= state.settings.dailyGoal ? [day] : [])])].sort(),
  };
}

export function boxCounts(state: AppState): number[] {
  const active = new Set(state.enrolled);
  const counts = [0, 0, 0, 0, 0];
  for (const [key, p] of Object.entries(state.progress)) if (active.has(key.slice(0, key.lastIndexOf(':')))) counts[p.box - 1]++;
  return counts;
}

/** Restore only the known schema and catalog. Untrusted imports cannot inject verse text. */
export function parseBackup(raw: string, verses: Verse[]): AppState {
  if (raw.length > 5_000_000) throw new Error('This backup is too large.');
  const x = JSON.parse(raw);
  const ids = new Set(verses.map(v => v.id));
  const validDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
  const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  const list = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string' && ids.has(id)) && new Set(v).size === v.length;
  if (!x || x.version !== 1 || typeof x.onboarded !== 'boolean' || !list(x.enrolled) || !list(x.favorites)) throw new Error('This is not a supported WordMemo backup.');
  const s = x.settings;
  if (!s || !integer(s.dailyGoal, 1, 30) || !integer(s.newPerDay, 0, s.dailyGoal) || !['mixed', ...DIRECTIONS].includes(s.mode) || ![1, 1.15, 1.3].includes(s.fontScale) || typeof s.reminderEnabled !== 'boolean' || typeof s.reminderTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminderTime)) throw new Error('The backup contains invalid settings.');
  const validKeys = new Set(verses.flatMap(v => DIRECTIONS.map(d => progressKey(v.id, d))));
  if (!x.progress || typeof x.progress !== 'object' || Array.isArray(x.progress)) throw new Error('The backup contains invalid progress.');
  const progress: Record<string, Progress> = {};
  for (const [key, p] of Object.entries(x.progress) as [string, any][]) {
    if (!validKeys.has(key) || !p || !integer(p.box, 1, 5) || !integer(p.reviews, 1, 1_000_000) || !validDay(p.due) || !validDay(p.lastReviewed) || p.due <= p.lastReviewed) throw new Error('The backup contains invalid review dates.');
    progress[key] = { box: p.box, due: p.due, reviews: p.reviews, lastReviewed: p.lastReviewed };
  }
  if (!Array.isArray(x.history) || x.history.length > 100_000) throw new Error('The backup contains invalid history.');
  const seen = new Set<string>();
  const history = x.history.map((h: any) => {
    if (!h || !ids.has(h.verseId) || !DIRECTIONS.includes(h.direction) || !validDay(h.day) || typeof h.correct !== 'boolean' || typeof h.newVerse !== 'boolean' || h.id !== `${h.day}:${h.verseId}` || seen.has(h.id)) throw new Error('The backup contains invalid review history.');
    seen.add(h.id);
    return { id: h.id, verseId: h.verseId, direction: h.direction, day: h.day, correct: h.correct, newVerse: h.newVerse };
  });
  const goalDays: string[] = x.goalDays ?? [];
  const practiceDays = new Set(history.map((h: { day: string }) => h.day));
  if (!Array.isArray(goalDays) || goalDays.length > 100_000 || new Set(goalDays).size !== goalDays.length || !goalDays.every(d => validDay(d) && practiceDays.has(d))) throw new Error('The backup contains invalid goal rewards.');
  if (s.celebrationsEnabled !== undefined && typeof s.celebrationsEnabled !== 'boolean') throw new Error('The backup contains an invalid celebration setting.');
  const stacks = x.stacks ?? [];
  if (!Array.isArray(stacks) || stacks.length > 50 || new Set(stacks.map((v: any) => v?.id)).size !== stacks.length || !stacks.every((v: any) => v && typeof v.id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(v.id) && typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 80 && list(v.verseIds) && v.verseIds.length > 0 && v.verseIds.length <= 200 && typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)))) throw new Error('The backup contains an invalid verse stack.');
  return { version: 1, onboarded: x.onboarded, enrolled: x.enrolled, favorites: x.favorites, progress, history,
    ...(x.stacks !== undefined ? { stacks: stacks.map((v: any) => ({ id: v.id, name: v.name.trim(), verseIds: v.verseIds, updatedAt: v.updatedAt })) } : {}),
    ...(x.goalDays !== undefined ? { goalDays: [...goalDays].sort() } : {}),
    settings: { dailyGoal: s.dailyGoal, newPerDay: s.newPerDay, mode: s.mode, fontScale: s.fontScale, reminderEnabled: s.reminderEnabled, reminderTime: s.reminderTime, ...(s.celebrationsEnabled !== undefined ? { celebrationsEnabled: s.celebrationsEnabled } : {}) } };
}
