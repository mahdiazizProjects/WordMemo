import type { Book, Topic, TopicAssignment, Verse } from './types';
export type BibleRow = [number, number, number, string];
export type AnnotationRow = [number[], number[], string[]];
export const verseId = (bookId: string, chapter: number, start: number, end = start) => `webp-${bookId.toLowerCase()}-${chapter}-${start}-${end}`;
export function makeBible(rows: BibleRow[], books: Book[], annotations: AnnotationRow[], topics: Topic[], notes: Record<string, string>, selections: Record<string, Record<string, string>>): Verse[] {
  return rows.map(([bi, chapter, number, text], i) => {
    const b = books[bi]; const [curated, suggested, keywords] = annotations[i];
    const id = verseId(b.id, chapter, number);
    const assignments: TopicAssignment[] = [
      ...curated.map(ti => ({ topic: topics[ti].id, basis: 'curated' as const, sourceRange: selections[topics[ti].id]?.[String(i)] })),
      ...suggested.map(ti => ({ topic: topics[ti].id, basis: 'keyword' as const })),
    ];
    return { id, bookId: b.id, book: b.name, chapter, startVerse: number, endVerse: number,
      reference: `${b.name} ${chapter}:${number}`, text, translation: 'WEBP',
      tags: assignments.map(a => a.topic), assignments, keywords, testament: b.testament,
      section: b.section, sourceIndex: i, textNote: notes[id],
      sourceUrl: `https://ebible.org/engwebp/${b.id}${String(chapter).padStart(b.id === 'PSA' ? 3 : 2, '0')}.htm#V${number}` };
  });
}

/** Keep existing starter range IDs so previously saved reviews still restore. */
export function combineCatalog(bible: Verse[], starter: Verse[]): Verse[] {
  const byId = new Map(bible.map(v => [v.id, v]));
  const prepared = starter.map(v => {
    if (byId.has(v.id)) return byId.get(v.id)!;
    const constituents = bible.filter(b => b.book === v.book && b.chapter === v.chapter && b.startVerse >= v.startVerse && b.startVerse <= v.endVerse);
    if (constituents.length !== v.endVerse - v.startVerse + 1 || constituents.some(v => !v.text)) throw new Error(`Invalid starter range: ${v.reference}`);
    return { ...constituents[0], ...v, text: constituents.map(v => v.text).join(' '),
      assignments: v.tags.map(topic => ({ topic, basis: 'curated' as const, sourceRange: v.reference })),
      keywords: [...new Set(constituents.flatMap(v => v.keywords ?? []))].slice(0, 8), sourceIndex: undefined };
  });
  const starterIds = new Set(starter.map(v => v.id));
  return [...prepared, ...bible.filter(v => !starterIds.has(v.id))];
}
