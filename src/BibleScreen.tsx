import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BOOKS, MEMORY_VERSE_COUNT, SEARCH, TOPICS, VERSE_BY_ID, topicVerses, topicName } from './catalog';
import { Button, C, Chip, Icon, U } from './ui';
import type { AppState, Verse } from './types';

type Props = {
  state: AppState;
  initialTopic: string;
  initialScope?: 'all' | 'learning' | 'saved';
  onTopicChange: (id: string) => void;
  addVerses: (verses: Verse[]) => void;
  openVerse: (id: string) => void;
  practiseTopic: (id: string) => void;
};
export function BibleScreen({ state, initialTopic, initialScope = 'all', onTopicChange, addVerses, openVerse, practiseTopic }: Props) {
  const [query, setQuery] = useState(''); const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState(initialScope);
  const topicId = initialTopic === 'all' ? '' : initialTopic;
  const setTopicId = (id: string) => onTopicChange(id || 'all');
  const [bookId, setBookId] = useState(''); const [chapter, setChapter] = useState<number | undefined>();
  const [curatedOnly, setCuratedOnly] = useState(false);
  const [picker, setPicker] = useState<'topics' | 'books' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const list = useRef<FlatList<Verse>>(null);

  const topic = TOPICS.find(t => t.id === topicId); const book = BOOKS.find(b => b.id === bookId);
  const matches = useMemo(() => {
    const ids = scope === 'learning' ? new Set(state.enrolled) : scope === 'saved' ? new Set(state.favorites) : undefined;
    const results = SEARCH.find({ query: deferredQuery, ids, topicId: topicId || undefined, bookId: bookId || undefined, chapter, curatedOnly });
    // Saved multi-verse starter cards retain their identity beside the full single-verse catalog.
    if (ids) for (const id of ids) {
      const v = VERSE_BY_ID.get(id);
      if (v && v.startVerse !== v.endVerse && (!topicId || v.tags.includes(topicId)) && (!bookId || v.bookId === bookId) && (!chapter || v.chapter === chapter) && (!deferredQuery.trim() || `${v.text} ${v.reference}`.toLowerCase().includes(deferredQuery.toLowerCase().trim()))) results.push(v);
    }
    return results;
  }, [deferredQuery, scope, state.enrolled, state.favorites, topicId, bookId, chapter, curatedOnly]);
  useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [scope, topicId, bookId, chapter, curatedOnly]);
  const enrolled = useMemo(() => new Set(state.enrolled), [state.enrolled]);
  const saved = useMemo(() => new Set(state.favorites), [state.favorites]);

  const header = <View style={{ gap: 18, paddingBottom: 18 }}>
    <View style={{ gap: 9 }}><Text style={U.eyebrow}>All 66 books, always with you</Text><Text accessibilityRole="header" style={U.title}>The whole Bible.{'\n'}Close to heart.</Text><Text style={U.small}>{MEMORY_VERSE_COUNT.toLocaleString()} verse cards · 42 topics · WEBP</Text></View>
    <TextInput accessibilityLabel="Search the whole Bible by words, topic, or reference" placeholder="Try perseverance, John 3:16, or a phrase" placeholderTextColor={C.muted} value={query} onChangeText={setQuery} style={U.input} clearButtonMode="while-editing" autoCorrect={false} />
    <View style={U.wrap}>{[['all','Whole Bible'],['learning','My verses'],['saved','Saved']].map(([id,label]) => <Chip key={id} text={label} selected={scope === id} onPress={() => setScope(id as 'all' | 'learning' | 'saved')} />)}</View>
    <View style={U.wrap}><Button variant="secondary" icon="grid" onPress={() => { setPickerSearch(''); setPicker('topics'); }}>{topic?.name ?? 'All topics'}</Button><Button variant="secondary" icon="book-open" onPress={() => { setPickerSearch(''); setPicker('books'); }}>{book?.name ?? 'All books'}</Button>{(topicId || bookId || query) && <Button variant="quiet" onPress={() => { setQuery(''); setTopicId(''); setBookId(''); setChapter(undefined); setCuratedOnly(false); }}>Clear filters</Button>}</View>
    {book && <View style={{ gap: 10 }}><Text style={U.small}>{book.testament} · {book.section}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}><Chip text="All chapters" selected={!chapter} onPress={() => setChapter(undefined)} />{Array.from({ length: book.chapters }, (_, i) => <Chip key={i} text={`${i + 1}`} selected={chapter === i + 1} onPress={() => setChapter(i + 1)} />)}</ScrollView></View>}
    {topic && <View style={U.card}><Text style={U.sectionTitle}>{topic.name}</Text><Text style={U.body}>{topic.subtitle}</Text><Text style={U.small}>{topic.counts.curated} curated verses · {topic.counts.suggested} keyword suggestions across the Bible</Text><View style={U.between}><Text style={[U.body, { flex: 1 }]}>Curated selections only</Text><Switch value={curatedOnly} onValueChange={setCuratedOnly} accessibilityLabel="Show only curated topic selections" trackColor={{ true: C.green, false: C.line }} /></View><Text style={U.small}>Keyword suggestions identify vocabulary. Read the chapter to understand the speaker and context.</Text><Button variant="secondary" icon="message-circle" onPress={() => practiseTopic(topic.id)}>Recall a verse about this</Button><Button icon="plus" disabled={topicVerses(topic.id, true).every(v => enrolled.has(v.id))} onPress={() => addVerses(topicVerses(topic.id, true))}>{topicVerses(topic.id, true).every(v => enrolled.has(v.id)) ? "Curated verses added to My verses" : "Add curated verses to My verses"}</Button><Text style={U.small}>Your daily practice limit still applies.</Text></View>}
    <Text accessibilityLiveRegion="polite" style={U.small}>{deferredQuery !== query ? 'Searching…' : `${matches.length.toLocaleString()} results`} · {scope === 'all' && !bookId && !query && !topicId ? 'Genesis to Revelation' : 'WEBP'}</Text>
  </View>;

  return <>
    <FlatList ref={list} data={matches} keyExtractor={v => v.id} style={{ flex: 1 }} contentContainerStyle={U.page}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header} ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      ListEmptyComponent={<View style={U.card}><Text style={U.sectionTitle}>Try another path</Text><Text style={U.body}>No verses match these filters. Try a shorter phrase, another topic, or clear the book filter.</Text><Text style={U.small}>Some verse numbers differ between Bible editions. This collection follows WEBP numbering.</Text></View>}
      renderItem={({ item: v }) => {
        const assignments = v.assignments ?? [];
        const curated = assignments.filter(a => a.basis === 'curated');
        const selectedAssignment = topicId ? assignments.find(a => a.topic === topicId) : undefined;
        const label = v.textNote ? 'Publisher’s textual note' : selectedAssignment ? selectedAssignment.basis === 'curated' ? 'Curated selection' : 'Keyword suggestion' : curated.length ? 'Curated themes' : assignments.length ? 'Keyword suggestions' : v.section;
        return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${v.reference}`} onPress={() => openVerse(v.id)} style={U.card}>
          <View style={U.between}><Text style={U.sectionTitle}>{v.reference}</Text><Icon name={saved.has(v.id) ? 'bookmark' : 'chevron-right'} size={18} /></View>
          <Text numberOfLines={3} style={U.body}>{v.text || 'This number has a textual note in WEBP rather than main verse text.'}</Text>
          <Text style={U.small}>{label}{v.tags.length ? ` · ${v.tags.slice(0, 3).map(topicName).join(' · ')}${v.tags.length > 3 ? ' …' : ''}` : ''}</Text>
          {enrolled.has(v.id) && <View style={U.row}><Icon name="check-circle" size={14} color={C.green} /><Text style={U.small}>In my verses</Text></View>}
        </Pressable>;
      }} />
    <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#15271FB3', padding: 18, justifyContent: 'center' }}>
        <View style={[U.card, { maxHeight: '90%', width: '100%', maxWidth: 620, alignSelf: 'center' }]}>
          <View style={U.between}><Text accessibilityRole="header" style={U.sectionTitle}>{picker === 'topics' ? 'Choose a topic' : 'Choose a book'}</Text><Button variant="quiet" icon="x" onPress={() => setPicker(null)} label="Close picker">Close</Button></View>
          <TextInput accessibilityLabel={picker === 'topics' ? 'Find a topic' : 'Find a book'} placeholder={picker === 'topics' ? 'Find a topic' : 'Find a book'} value={pickerSearch} onChangeText={setPickerSearch} style={U.input} />
          <Button variant="secondary" onPress={() => { if (picker === 'topics') setTopicId(''); else { setBookId(''); setChapter(undefined); } setPicker(null); }}>{picker === 'topics' ? 'All topics' : 'All books'}</Button>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
            {picker === 'topics' ? TOPICS.filter(t => `${t.name} ${t.aliases.join(' ')} ${t.group}`.toLowerCase().includes(pickerSearch.toLowerCase())).map(t => <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`Choose ${t.name}`} onPress={() => { setTopicId(t.id); setPicker(null); }} style={[U.between, { paddingVertical: 13, borderBottomWidth: 1, borderColor: C.line }]}><View style={{ flex: 1, gap: 4 }}><Text style={U.body}>{t.name}</Text><Text style={U.small}>{t.group} · {t.counts.curated} curated</Text></View><Icon name={topicId === t.id ? 'check' : 'chevron-right'} size={17} /></Pressable>) : BOOKS.filter(b => `${b.name} ${b.id} ${b.testament} ${b.section}`.toLowerCase().includes(pickerSearch.toLowerCase())).map(b => <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`Choose ${b.name}`} onPress={() => { setBookId(b.id); setChapter(1); setPicker(null); }} style={[U.between, { paddingVertical: 13, borderBottomWidth: 1, borderColor: C.line }]}><View style={{ flex: 1, gap: 4 }}><Text style={U.body}>{b.name}</Text><Text style={U.small}>{b.testament} · {b.chapters} chapters</Text></View><Icon name={bookId === b.id ? 'check' : 'chevron-right'} size={17} /></Pressable>)}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}
