import type { Book, Topic, Verse } from './types';
export type SearchFilters = { query?: string; bookId?: string; chapter?: number; topicId?: string; curatedOnly?: boolean; ids?: Set<string>; section?: string; testament?: string };
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const aliasKey = (s: string) => norm(s).replace(/[.\s]/g, '');

export function makeSearchIndex(verses: Verse[], books: Book[], topics: Topic[]) {
  const names = new Map<string, string>();
  for (const b of books) for (const alias of [b.name, b.id, ...b.aliases, ...(b.id === 'PSA' ? ['Psalm', 'Ps', 'Psa'] : [])]) names.set(aliasKey(alias), b.id);
  const extras: Record<string, string> = { 'jn': 'JHN', 'john': 'JHN', 'mt': 'MAT', 'mk': 'MRK', 'lk': 'LUK', 'phil': 'PHP', 'philippians': 'PHP', 'psalm': 'PSA', '1john': '1JN', '2john': '2JN', '3john': '3JN', 'songofsongs':'SNG' };
  for (const [key, value] of Object.entries(extras)) names.set(key, value);
  const topicWords = topics.map(t => ({ id: t.id, words: [t.id, t.name, ...t.aliases].map(norm) }));
  const normalizedText = verses.map(v => norm(v.text));
  const byId = new Map(verses.map(v => [v.id, v]));

  function parseReference(query: string) {
    const q = norm(query);
    const match = /^(.*?)\s*(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/.exec(q);
    if (!match) return undefined;
    const bookId = names.get(aliasKey(match[1])); if (!bookId) return undefined;
    return { bookId, chapter: Number(match[2]), first: match[3] ? Number(match[3]) : undefined, last: match[4] ? Number(match[4]) : undefined };
  }
  function find(filters: SearchFilters): Verse[] {
    const query = norm(filters.query ?? ''); const ref = parseReference(query);
    const bookQuery = !ref && names.get(aliasKey(query));
    const topicMatches = query ? new Set(topicWords.filter(t => t.words.includes(query)).map(t => t.id)) : new Set<string>();
    const terms = query.replace(/["“”]/g, '').split(/\s+/).filter(Boolean);
    const ranked: { v: Verse; rank: number; order: number }[] = [];
    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      if (filters.ids && !filters.ids.has(v.id) || filters.bookId && v.bookId !== filters.bookId || filters.chapter && v.chapter !== filters.chapter || filters.section && v.section !== filters.section || filters.testament && v.testament !== filters.testament) continue;
      if (filters.topicId && !v.assignments?.some(a => a.topic === filters.topicId && (!filters.curatedOnly || a.basis === 'curated'))) continue;
      let rank = filters.topicId && v.assignments?.some(a => a.topic === filters.topicId && a.basis === 'curated') ? 0 : 1;
      if (query) {
        if (ref) { if (v.bookId !== ref.bookId || v.chapter !== ref.chapter || ref.first && (v.startVerse < ref.first || v.startVerse > (ref.last ?? ref.first))) continue; }
        else if (bookQuery) { if (v.bookId !== bookQuery) continue; }
        else {
          const topicMatch = v.assignments?.filter(a => topicMatches.has(a.topic)) ?? [];
          const textMatch = terms.every(t => normalizedText[i].includes(t));
          if (!textMatch && !topicMatch.length) continue;
          rank += topicMatch.some(a => a.basis === 'curated') ? 0 : textMatch ? 2 : 3;
        }
      }
      ranked.push({ v, rank, order: i });
    }
    // Reading order stays canonical for book/reference queries. Topic queries show editorial picks first.
    if (filters.topicId || topicMatches.size) ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
    return ranked.map(r => r.v);
  }
  return { find, parseReference, byId };
}
