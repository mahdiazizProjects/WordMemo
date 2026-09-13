import rows from './data/bible.json';
import books from './data/books.json';
import annotations from './data/annotations.json';
import topics from './data/topics.json';
import notes from './data/verse-notes.json';
import selections from './data/curated-sources.json';
import starter from './data/verses.json';
import introductions from './data/chapter-introductions.json';
import { combineCatalog, makeBible, type AnnotationRow, type BibleRow } from './bible-model';
import { makeSearchIndex } from './search';
import type { Book, Topic, Verse } from './types';

export const BOOKS = books as Book[];
export const TOPICS = topics as Topic[];
export const BIBLE_VERSES = makeBible(rows as BibleRow[], BOOKS, annotations as AnnotationRow[], TOPICS, notes, selections);
export const VERSES = combineCatalog(BIBLE_VERSES, starter as Verse[]);
export const VERSE_BY_ID = new Map(VERSES.map(v => [v.id, v]));
export const TOPIC_BY_ID = new Map(TOPICS.map(t => [t.id, t]));
export const topicName = (id: string) => TOPIC_BY_ID.get(id)?.name ?? id;
export const CHAPTERS = new Map<string, Verse[]>();
for (const verse of BIBLE_VERSES) {
  const key = `${verse.bookId}:${verse.chapter}`;
  const list = CHAPTERS.get(key) ?? []; list.push(verse); CHAPTERS.set(key, list);
}
export const CHAPTER_INTRODUCTIONS: Record<string, string> = introductions;
export const SEARCH = makeSearchIndex(BIBLE_VERSES, BOOKS, TOPICS);
export const MEMORY_VERSE_COUNT = BIBLE_VERSES.filter(v => !!v.text).length;
export const topicVerses = (id: string, curatedOnly = false) => BIBLE_VERSES.filter(v => v.assignments?.some(a => a.topic === id && (!curatedOnly || a.basis === 'curated')));
