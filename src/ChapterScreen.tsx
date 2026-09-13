import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { BOOKS, CHAPTERS, CHAPTER_INTRODUCTIONS } from './catalog';
import { Button, C, U } from './ui';
import type { Verse } from './types';

export function ChapterScreen({ bookId, chapter, highlight, fontScale, onNavigate, openVerse, addChapter }: { bookId: string; chapter: number; highlight?: string; fontScale: number; onNavigate: (book: string, chapter: number) => void; openVerse: (id: string) => void; addChapter: (verses: Verse[]) => void }) {
  const b = BOOKS.find(b => b.id === bookId)!;
  const verses = CHAPTERS.get(`${bookId}:${chapter}`) ?? [];
  const index = BOOKS.indexOf(b);
  const previous = chapter > 1 ? [bookId, chapter - 1] as const : index > 0 ? [BOOKS[index - 1].id, BOOKS[index - 1].chapters] as const : null;
  const next = chapter < b.chapters ? [bookId, chapter + 1] as const : index < BOOKS.length - 1 ? [BOOKS[index + 1].id, 1] as const : null;
  const intro = CHAPTER_INTRODUCTIONS[`${bookId}:${chapter}`];
  return <>
    <Text style={U.eyebrow}>{b.testament} · WEBP</Text><Text accessibilityRole="header" style={U.title}>{b.name} {chapter}</Text><Text style={U.small}>Tap any verse to open its memory card. Chapter text is available offline.</Text>
    <View style={U.between}><Button variant="secondary" icon="arrow-left" disabled={!previous} onPress={() => previous && onNavigate(...previous)}>Previous</Button><Button variant="secondary" icon="arrow-right" disabled={!next} onPress={() => next && onNavigate(...next)}>Next</Button></View>
    {!!intro && <Text style={[U.body, { fontStyle: 'italic' }]}>{intro}</Text>}
    <View>{verses.map(v => <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.reference}. ${v.text || 'Publisher’s textual note.'} Open memory card.`} onPress={() => openVerse(v.id)} style={{ paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12, backgroundColor: highlight === v.id ? C.pale : 'transparent' }}><Text style={[U.body, { fontSize: 18 * fontScale, lineHeight: 29 * fontScale }]}><Text style={{ color: C.gold }}>{v.startVerse}  </Text>{v.text || 'This number has a textual note rather than main verse text in WEBP.'}</Text></Pressable>)}</View>
    <Button icon="plus" onPress={() => addChapter(verses.filter(v => !!v.text))}>Add this chapter to my verses</Button><Text style={U.small}>Your daily goal still limits how many verses are introduced or reviewed.</Text>
  </>;
}
