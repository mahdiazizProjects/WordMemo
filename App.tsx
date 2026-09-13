import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState as NativeAppState, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import Feather from '@expo/vector-icons/Feather';
import * as Speech from 'expo-speech';
import { VERSES, TOPICS, VERSE_BY_ID, TOPIC_BY_ID, topicVerses, topicName } from './src/catalog';
import { BibleScreen } from './src/BibleScreen';
import { ChapterScreen } from './src/ChapterScreen';
import { addDays, boxCounts, buildQueue, INTERVALS, localDay, progressKey, recordReview, reviewedToday, wasIntroduced } from './src/leitner';
import { useStoredState } from './src/storage';
import type { StoredState } from './src/storage';
import { AccountPanel, SaveStatus } from './src/AccountPanel';
import { GroupsScreen } from './src/GroupsScreen';
import { Celebration } from './src/Celebration';
import { rewardsFor } from './src/rewards';
import { pendingInvite } from './src/auth-api';
import { SettingsScreen } from './src/SettingsScreen';
import { useWebAppStatus } from './src/web-app';
import { Button, C, Chip, Cross, Icon, SectionTitle, Stepper, U, serif } from './src/ui';
import type { QueueItem, Settings, TopicId, Verse } from './src/types';

type Tab = 'today' | 'topics' | 'journey' | 'groups' | 'settings';
type Session = { queue: QueueItem[]; index: number; day: string; xp: number };

function WordMemo({ store }: { store: StoredState }) {
  const { state, setState, ready, error, retry } = store;
  const webAppStatus = useWebAppStatus();
  const [fontReady, fontError] = useFonts(Feather.font);
  const [tab, setTab] = useState<Tab>(pendingInvite() ? 'groups' : 'today');
  const [day, setDay] = useState(localDay());
  const [filter, setFilter] = useState<string>('all');
  const [chapterView, setChapterView] = useState<{ bookId: string; chapter: number; highlight?: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; xp: number } | null>(null);
  const rewards = useMemo(() => rewardsFor(state, VERSES), [state]);
  const [challenge, setChallenge] = useState<TopicId | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [notice, setNotice] = useState('');
  const gradeLock = useRef(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    const refresh = () => setDay(localDay());
    const timer = setInterval(refresh, 30_000);
    const sub = NativeAppState.addEventListener('change', s => { if (s === 'active') refresh(); else void Speech.stop(); });
    return () => { clearInterval(timer); sub.remove(); void Speech.stop(); };
  }, []);
  useEffect(() => { gradeLock.current = false; setRevealed(false); setFeedback(null); void Speech.stop(); scroll.current?.scrollTo({ y: 0, animated: false }); }, [session?.index, session?.day]);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); setNotice(''); void Speech.stop(); }, [tab, detail, challenge, chapterView?.bookId, chapterView?.chapter]);
  useEffect(() => { if (notice) scroll.current?.scrollTo({ y: 0, animated: true }); }, [notice]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (chapterView) { setChapterView(null); return true; }
      if (session) { setSession(null); return true; }
      if (challenge) { setChallenge(null); return true; }
      if (detail) { setDetail(null); return true; }
      if (tab !== 'today') { setTab('today'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [session, challenge, detail, tab, chapterView]);
  useEffect(() => { if (notice) scroll.current?.scrollTo({ y: 0, animated: true }); }, [notice]);

  const updateSettings = (patch: Partial<Settings>) => setState(s => ({ ...s, settings: { ...s.settings, ...patch } }));
  const enrolled = useMemo(() => state.enrolled.map(id => VERSE_BY_ID.get(id)).filter((v): v is Verse => !!v), [state.enrolled]);
  const queue = buildQueue(state, enrolled, day);
  const completed = reviewedToday(state, day).size;
  const current = session ? session.queue[session.index] : undefined;
  const currentVerse = current ? VERSE_BY_ID.get(current.verseId)! : undefined;
  const selectedVerse = detail ? VERSE_BY_ID.get(detail) : undefined;
  const allDone = completed >= state.settings.dailyGoal;
  const boxes = boxCounts(state);
  const isFocused = !!session || !!detail || !!challenge || !!chapterView;
  const isBibleBrowse = state.onboarded && tab === 'topics' && !isFocused;

  function toggleFavorite(id: string) { setState(s => ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter(x => x !== id) : [...s.favorites, id] })); }
  function toggleLearning(id: string) { setState(s => ({ ...s, enrolled: s.enrolled.includes(id) ? s.enrolled.filter(x => x !== id) : [...s.enrolled, id] })); }
  function navigate(next: Tab) { setTab(next); setDetail(null); setChallenge(null); setSession(null); setChapterView(null); }
  function grade(correct: boolean) {
    if (!current || !session || !revealed || gradeLock.current) return;
    gradeLock.current = true;
    if (localDay() !== session.day) { setSession(null); setDay(localDay()); setNotice('A new day has started. Your completed reviews are saved. Start today’s practice when you are ready.'); return; }
    let earned = 0, accepted = false;
    setState(s => {
      const next = recordReview(s, current, correct, session.day);
      accepted = next !== s; earned = rewardsFor(next).xp - rewardsFor(s).xp;
      return next;
    });
    if (!accepted) { setNotice('This card is already saved or is no longer due. Your progress is intact.'); setSession(s => s ? { ...s, index: s.index + 1 } : null); return; }
    setFeedback({ correct, xp: earned });
    setSession(s => s ? { ...s, xp: s.xp + earned } : null);
  }
  async function listen(verse: Verse) {
    try { await Speech.stop(); Speech.speak(`${verse.reference}. ${verse.text}`, { language: 'en-US', rate: .85, onError: () => setNotice('Read-aloud is unavailable. Check that your device has an English voice installed.') }); }
    catch { setNotice('Read-aloud is unavailable on this device.'); }
  }
  function verseActions(verse: Verse) {
    return <View style={U.wrap}><Button disabled={!verse.text} variant="secondary" icon="volume-2" onPress={() => { void listen(verse); }}>Listen</Button><Button variant="secondary" icon="book-open" onPress={() => { if (verse.bookId) setChapterView({ bookId: verse.bookId, chapter: verse.chapter, highlight: verse.id }); }}>Read chapter</Button><Button variant="quiet" icon="external-link" onPress={() => { void Linking.openURL(verse.sourceUrl).catch(() => setNotice('The publisher page could not be opened. Please check your connection.')); }}>Publisher</Button><Button variant="quiet" icon="square" onPress={() => { void Speech.stop(); }}>Stop audio</Button></View>;
  }
  function topicCard(id: TopicId) {
    const t = TOPICS.find(t => t.id === id)!;
    return <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`${t.name}, ${(t.counts.curated + t.counts.suggested)} passages`} onPress={() => { navigate('topics'); setFilter(t.id); }} style={S.topicCard}><View style={S.topicSymbol}><Icon name={t.icon} size={22} color={C.green} /></View><Text style={U.sectionTitle}>{t.name}</Text><Text style={U.small}>{(t.counts.curated + t.counts.suggested)} passages</Text></Pressable>;
  }
  function progressLabel(verse: Verse, direction: 'verse' | 'reference') {
    const p = state.progress[progressKey(verse.id, direction)];
    return <View style={U.between}><Text style={[U.body, { flex: 1 }]}>{direction === 'verse' ? 'Verse recall' : 'Reference recall'}</Text><Text style={[U.small, { flexShrink: 1, textAlign: 'right' }]}>{p ? `Box ${p.box} · ${p.due <= day ? 'due now' : p.due}` : 'Not practised yet'}</Text></View>;
  }

  if (!ready || (!fontReady && !fontError)) return <SafeAreaView style={[U.shell, { justifyContent: 'center', alignItems: 'center', padding: 30, gap: 20 }]}><Cross size={52} /><Text style={U.sectionTitle}>WordMemo</Text>{error ? <><Text style={U.body}>{error}</Text><Button onPress={retry}>Try again</Button></> : <ActivityIndicator color={C.green} />}</SafeAreaView>;

  return <SafeAreaView style={U.shell} edges={['top', 'bottom']}><StatusBar style="dark" />
    <View style={S.header}><View style={U.row}><Cross size={26} /><Text style={S.wordmark}>WordMemo</Text></View>{state.onboarded && <Button variant="quiet" icon={isFocused ? 'x' : tab === 'settings' ? 'arrow-left' : 'sliders'} label={isFocused ? 'Close and save progress' : tab === 'settings' ? 'Back to today' : 'Open settings'} onPress={() => { if (chapterView) setChapterView(null); else if (isFocused) { setSession(null); setDetail(null); setChallenge(null); } else navigate(tab === 'settings' ? 'today' : 'settings'); }}>{isFocused ? 'Close' : tab === 'settings' ? 'Back' : ''}</Button>}</View>
    {state.onboarded && tab === 'topics' && <View style={{ flex: 1, display: isBibleBrowse ? 'flex' : 'none' }} accessibilityElementsHidden={!isBibleBrowse} importantForAccessibility={isBibleBrowse ? 'auto' : 'no-hide-descendants'}><BibleScreen state={state} initialTopic={filter} onTopicChange={setFilter} addVerses={verses => setState(s => ({ ...s, enrolled: [...new Set([...s.enrolled, ...verses.map(v => v.id)])] }))} openVerse={id => setDetail(id)} practiseTopic={id => { setChallenge(id); setShowExamples(false); }} /></View>}
    {!isBibleBrowse && <ScrollView ref={scroll} contentContainerStyle={U.page} keyboardShouldPersistTaps="handled">
      {!!error && <Text accessibilityRole="alert" style={[U.body, { color: C.error }]}>{error}</Text>}
      {!!notice && <View style={[U.card, { backgroundColor: C.goldPale }]}><Text accessibilityLiveRegion="polite" style={U.body}>{notice}</Text><Button variant="quiet" onPress={() => setNotice('')}>Dismiss</Button></View>}
      {!state.onboarded ? <>
        <View style={{ paddingTop: 28, gap: 18 }}><Text style={U.eyebrow}>Scripture, carried with you</Text><Text accessibilityRole="header" style={[U.title, { fontSize: 46, lineHeight: 51 }]}>Rooted in{'\n'}the Word.</Text><Text style={[U.body, { color: C.muted }]}>A few verses. A quiet moment. A little more of God’s Word held in your heart.</Text></View>
        <View style={U.card}><Text style={U.sectionTitle}>Make room for a daily rhythm</Text><Stepper label="Verses per day" value={state.settings.dailyGoal} min={1} max={30} onChange={n => updateSettings({ dailyGoal: n, newPerDay: n })} /><Text style={U.small}>Your goal includes due reviews and new verses. You can change it at any time.</Text><View style={U.wrap}>{[3, 5, 10, 15].map(n => <Chip key={n} text={`${n} verses`} selected={state.settings.dailyGoal === n} onPress={() => updateSettings({ dailyGoal: n, newPerDay: n })} />)}</View></View>
        <View style={{ gap: 14 }}><Text style={U.sectionTitle}>A simple way to remember</Text>{[['layers', 'Read one side. Recall the other.'], ['repeat', 'Remembered cards return less often.'], ['heart', 'Come back at your own pace.']].map(([icon, title]) => <View key={title} style={U.row}><Icon name={icon} size={18} /><Text style={[U.body, { flex: 1 }]}>{title}</Text></View>)}</View>
        <Button icon="arrow-right" onPress={() => setState(s => ({ ...s, onboarded: true }))}>Begin with the Word</Button><AccountPanel store={store} compact /><Text style={[U.small, { textAlign: 'center' }]}>Guest practice works offline · Sign in to save across devices{'\n'}World English Bible · WEBP</Text>
      </> : chapterView ? <ChapterScreen {...chapterView} fontScale={state.settings.fontScale} onNavigate={(bookId, chapter) => setChapterView({ bookId, chapter })} openVerse={id => { setChapterView(null); setSession(null); setDetail(id); }} addChapter={verses => { setState(s => ({ ...s, enrolled: [...new Set([...s.enrolled, ...verses.map(v => v.id)])] })); setNotice('Chapter added to My verses. Your daily goal still applies.'); }} /> : session ? <>
        {current && currentVerse ? <>
          <View style={U.between}><Text style={U.eyebrow}>Today’s practice</Text><Text style={U.small}>{session.index + 1} of {session.queue.length}</Text></View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: session.queue.length, now: session.index }} accessibilityLabel="Session progress" style={S.track}><View style={[S.fill, { width: `${session.index / session.queue.length * 100}%` }]} /></View>
          <Text accessibilityRole="header" style={U.sectionTitle}>{current.direction === 'reference' ? 'Where is this written?' : 'What does this verse say?'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${revealed ? 'Answer' : 'Recall prompt'}: ${revealed ? current.direction === 'reference' ? currentVerse.reference : currentVerse.text : current.direction === 'reference' ? currentVerse.text : currentVerse.reference}`} accessibilityHint={revealed ? 'Grade your recall with the buttons below' : 'Recall the answer, then activate to reveal the other side'} disabled={revealed} onPress={() => setRevealed(true)} style={[U.card, S.flashcard]}>
            <Text style={U.eyebrow}>{revealed ? 'The other side' : current.direction === 'reference' ? 'Recall the reference' : 'Recall the verse'} · WEBP</Text>
            <Text accessibilityLiveRegion="polite" style={[U.quote, { fontSize: (current.direction === 'reference' && !revealed || current.direction === 'verse' && revealed ? 26 : 34) * state.settings.fontScale, lineHeight: 40 * state.settings.fontScale, textAlign: 'center' }]}>{revealed ? current.direction === 'reference' ? currentVerse.reference : currentVerse.text : current.direction === 'reference' ? currentVerse.text : currentVerse.reference}</Text><Cross size={28} />
          </Pressable>
          {feedback ? <><Celebration key={`${current.verseId}-${session.index}`} title={feedback.correct ? 'Well remembered!' : 'A little practice helps.'} subtitle={feedback.correct ? 'This card moves up a box. Keep the Word close.' : 'This verse will return tomorrow. Every practice counts.'} xp={feedback.xp} enabled={state.settings.celebrationsEnabled !== false} kind={feedback.correct ? 'correct' : 'practice'} /><Button icon="arrow-right" onPress={() => setSession(s => s ? { ...s, index: s.index + 1 } : null)}>{session.index === session.queue.length - 1 ? 'Finish practice' : 'Next verse'}</Button></> : !revealed ? <><Text style={[U.small, { textAlign: 'center' }]}>Say it aloud, or recall it quietly.</Text><Button icon="rotate-cw" onPress={() => setRevealed(true)}>Reveal answer</Button></> : <>
            <Text style={U.small}>{current.direction === 'reference' ? currentVerse.text : currentVerse.reference}</Text><Text style={U.body}>Did you recall {current.direction === 'reference' ? 'the book, chapter, and verse number' : 'the complete wording'} correctly?</Text>
            <View style={U.row}><Button variant="secondary" style={{ flex: 1 }} icon="rotate-ccw" onPress={() => grade(false)}>Still learning</Button><Button style={{ flex: 1 }} icon="check" onPress={() => grade(true)}>Remembered</Button></View><Text style={[U.small, { textAlign: 'center' }]}>Still learning returns tomorrow. Remembered moves up one box.</Text>{verseActions(currentVerse)}
          </>}
        </> : <View style={[U.card, { alignItems: 'center', paddingVertical: 42 }]}><Celebration title="A little more rooted." subtitle="A moment well spent in the Word." xp={session.xp} enabled={state.settings.celebrationsEnabled !== false} kind="complete" /><Text style={[U.body, { textAlign: 'center' }]}>{session.index} {session.index === 1 ? 'verse' : 'verses'} practised. Your next reviews are scheduled.</Text><Text style={[U.small, { textAlign: 'center' }]}>You can stop here, or explore a topic.</Text><Button onPress={() => navigate('today')}>Back to today</Button><Button variant="quiet" onPress={() => navigate('topics')}>Explore topics</Button></View>}
      </> : challenge ? <>
        <Text style={U.eyebrow}>Recall by topic · extra practice</Text><Text accessibilityRole="header" style={U.title}>A word for{'\n'}{topicName(challenge).toLowerCase()}.</Text><Text style={U.body}>Which passage comes to mind? Try to recall its words and its reference before looking.</Text><View style={[U.card, { alignItems: 'center', paddingVertical: 40 }]}><Icon name={TOPICS.find(t => t.id === challenge)!.icon} size={32} color={C.gold} /><Text style={U.quote}>{topicName(challenge)}</Text><Text style={[U.small, { textAlign: 'center' }]}>There may be several fitting passages.</Text></View>
        {!showExamples ? <Button onPress={() => setShowExamples(true)}>Show passages on this topic</Button> : topicVerses(challenge, true).slice(0, 12).map(v => <View key={v.id} style={U.card}><Text style={U.sectionTitle}>{v.reference}</Text><Text style={U.body}>{v.text}</Text><Text style={U.small}>WEBP</Text></View>)}<Button variant="secondary" onPress={() => { const id = challenge; navigate('topics'); setFilter(id); }}>Browse all verses on this topic</Button><Text style={U.small}>Examples come from curated selections. Extra practice leaves your Leitner boxes and daily goal unchanged.</Text>
      </> : selectedVerse ? <>
        <Text style={U.eyebrow}>World English Bible · WEBP</Text><Text accessibilityRole="header" style={U.title}>{selectedVerse.reference}</Text><Text style={U.small}>{selectedVerse.testament} · {selectedVerse.section}</Text><View style={U.wrap}>{selectedVerse.tags.map(t => <Chip key={t} text={topicName(t)} onPress={() => { setDetail(null); setFilter(t); setTab('topics'); }} />)}</View><View style={U.card}><Text style={[U.quote, { fontSize: 27 * state.settings.fontScale, lineHeight: 40 * state.settings.fontScale }]}>{selectedVerse.text || 'This verse number has a textual note rather than main verse text in WEBP.'}</Text><Cross size={28} /></View>{!!selectedVerse.textNote && <View style={U.card}><Text style={U.sectionTitle}>Publisher’s textual note</Text><Text style={U.body}>{selectedVerse.textNote}</Text><Text style={U.small}>This note is kept separate from Scripture text and is not used as a memory card.</Text></View>}
        <Button disabled={!selectedVerse.text} icon={state.enrolled.includes(selectedVerse.id) ? 'pause' : 'plus'} onPress={() => toggleLearning(selectedVerse.id)}>{state.enrolled.includes(selectedVerse.id) ? 'Pause this verse' : 'Add to my verses'}</Button><Button variant="secondary" icon="bookmark" onPress={() => toggleFavorite(selectedVerse.id)}>{state.favorites.includes(selectedVerse.id) ? 'Remove from saved' : 'Save for later'}</Button>{verseActions(selectedVerse)}
        <View style={U.card}><Text style={U.sectionTitle}>Your recall</Text>{progressLabel(selectedVerse, 'reference')}{progressLabel(selectedVerse, 'verse')}</View><View style={U.card}><Text style={U.sectionTitle}>Topics & keywords</Text>{selectedVerse.assignments?.length ? selectedVerse.assignments.map(a => <View key={a.topic} style={{ gap: 4 }}><Text style={U.body}>{topicName(a.topic)}</Text><Text style={U.small}>{a.basis === 'curated' ? `Curated passage selection · ${a.sourceRange ?? selectedVerse.reference}` : 'Keyword suggestion · matching vocabulary, not a claim about the speaker’s teaching'}</Text></View>) : <Text style={U.small}>Organized by book and literary section. No devotional topic has been assigned to this verse.</Text>}<Text style={U.small}>Keywords: {selectedVerse.keywords?.join(' · ') || 'No keywords in this textual note.'}</Text></View><Text style={U.small}>Pausing a verse preserves its progress. Curated selections are editorial choices; keyword suggestions need context.</Text>
      </> : tab === 'today' ? <>
        <View style={{ gap: 9 }}><Text style={U.eyebrow}>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text><Text accessibilityRole="header" style={U.title}>Make room{'\n'}for the Word.</Text><Text style={[U.body, { color: C.muted }]}>A quiet moment to remember what matters.</Text></View>
        <View style={[U.card, { borderColor: '#CDD6C7', backgroundColor: '#F0F2EA' }]}><View style={U.between}><Text style={U.eyebrow}>Your daily rhythm</Text><Icon name={allDone ? 'check-circle' : 'sunrise'} color={C.green} /></View><View style={[U.row, { alignItems: 'baseline' }]}><Text style={[U.title, { fontSize: 48, lineHeight: 56 }]}>{completed}<Text style={{ fontSize: 28, color: C.muted }}> / {state.settings.dailyGoal}</Text></Text><Text style={U.small}>verses practised</Text></View><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: state.settings.dailyGoal, now: Math.min(completed, state.settings.dailyGoal) }} accessibilityLabel="Daily verse goal" style={S.track}><View style={[S.fill, { width: `${Math.min(1, completed / state.settings.dailyGoal) * 100}%` }]} /></View>
          <Text style={U.small}>{queue.length ? `${queue.filter(i => !i.isNew).length} due reviews · ${queue.filter(i => i.isNew).length} new verses in this session` : allDone ? 'Your daily goal is complete. Rest, or explore a topic.' : 'Nothing else is scheduled within your limits today. Add verses or return tomorrow.'}</Text><SaveStatus store={store} />{queue.length > 0 ? <Button icon="arrow-right" onPress={() => { setRevealed(false); setFeedback(null); setSession({ queue, index: 0, day, xp: 0 }); }}>Begin practice</Button> : <Button variant="secondary" icon="book-open" onPress={() => navigate('topics')}>Explore the Word</Button>}
        </View>
        <View style={U.card}><View style={U.between}><Text style={U.sectionTitle}>Level {rewards.level} · {rewards.levelName}</Text><Icon name="award" color={C.gold} /></View><Text style={U.small}>{rewards.xp} points · {rewards.toNextLevel} to your next level</Text><Button variant="quiet" onPress={() => navigate('journey')}>See my milestones</Button></View>{(!store.auth.account || store.guest) && <AccountPanel store={store} compact />}<Button variant="secondary" icon="users" onPress={() => navigate('groups')}>Practise with my life group</Button><View><SectionTitle title="A word for every season" action="See all" onPress={() => { navigate('topics'); setFilter('all'); }} /><View style={[U.wrap, { marginTop: 10 }]}>{topicCard('perseverance')}{topicCard('peace')}</View></View><View style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 20, gap: 10 }}><Text style={U.eyebrow}>Carry it in your heart</Text><Text style={[U.quote, { fontSize: 21, lineHeight: 31 }]}>{VERSES.find(v => v.id === 'webp-psa-119-11-11')?.text}</Text><Text style={U.small}>Psalms 119:11 · WEBP</Text></View>
      </> : tab === 'journey' ? <>
        <Text style={U.eyebrow}>Small moments, lasting roots</Text><Text accessibilityRole="header" style={U.title}>Your journey{'\n'}in the Word.</Text><Text style={U.body}>Progress grows through returning. A missed day leaves your learning intact.</Text>
        <View style={U.card}><Text style={U.eyebrow}>{rewards.levelName}</Text><Text style={U.title}>Level {rewards.level}</Text><Text style={U.body}>{rewards.xp} points · {rewards.toNextLevel} to the next level</Text><View style={S.track}><View style={[S.fill, { width: `${rewards.levelProgress}%` }]} /></View><Text style={U.small}>10 points for a remembered verse, 3 for practising, and 25 for completing your daily goal. Each verse earns points once a day. There is no penalty for missed days.</Text></View>
        <Text style={U.sectionTitle}>Your milestones</Text>{rewards.badges.map(b => <View key={b.id} style={[U.card, { backgroundColor: b.earned ? C.goldPale : C.paper }]}><View style={U.row}><Icon name={b.earned ? 'award' : 'circle'} color={b.earned ? C.gold : C.muted} /><Text style={U.sectionTitle}>{b.name}</Text></View><Text style={U.small}>{b.description}{b.earned ? ' · Earned' : ''}</Text></View>)}
        <View style={U.card}><Text style={U.sectionTitle}>This week</Text><View style={[U.row, { justifyContent: 'space-between', gap: 4 }]}>{Array.from({ length: 7 }, (_, i) => addDays(day, i - 6)).map(d => { const count = reviewedToday(state, d).size; return <View key={d} style={{ alignItems: 'center', gap: 9, flex: 1 }}><Text style={U.small}>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1)}</Text><View accessibilityLabel={`${d}: ${count} verses practised`} style={[S.dayDot, count > 0 && { backgroundColor: C.green }]}><Text style={{ color: count > 0 ? C.paper : C.muted, fontSize: 13 }}>{count || '·'}</Text></View></View>; })}</View><Text style={U.small}>Each number is the distinct verses you practised that day.</Text></View>
        <View style={U.card}><Text style={U.sectionTitle}>Your five Leitner boxes</Text><Text style={U.small}>Verse recall and reference recall each have their own card. These counts include practised cards in your active collection.</Text>{INTERVALS.map((days, i) => <View key={days} style={U.between}><View style={U.row}><View style={S.boxBadge}><Text style={{ color: C.green, fontWeight: '600' }}>{i + 1}</Text></View><View><Text style={U.body}>Box {i + 1}</Text><Text style={U.small}>{days === 1 ? 'Every day' : `Every ${days} days`}</Text></View></View><Text style={U.sectionTitle}>{boxes[i]}</Text></View>)}</View><Text style={U.body}>{enrolled.filter(v => wasIntroduced(state, v.id)).length} of {enrolled.length} active verses introduced. A correct answer moves its recall card up one box; an incorrect answer returns it to Box 1.</Text><Text style={U.small}>Box 5 cards continue returning every 30 days. Your progress is a learning aid, never a measure of faith.</Text>
      </> : tab === 'groups' ? <GroupsScreen store={store} /> : <SettingsScreen state={state} setState={setState} notify={setNotice} webAppStatus={webAppStatus} store={store} />}
    </ScrollView>}
    {state.onboarded && !isFocused && <View style={S.nav}>{([['today', 'sunrise', 'Today'], ['topics', 'book-open', 'Bible'], ['journey', 'bar-chart-2', 'Journey'], ['groups', 'users', 'Together']] as const).map(([id, icon, label]) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: tab === id }} onPress={() => navigate(id)} style={S.navItem}><Icon name={icon} color={tab === id ? C.green : C.muted} /><Text style={{ fontSize: 12, color: tab === id ? C.green : C.muted, fontWeight: tab === id ? '600' : '400' }}>{label}</Text><View style={{ height: 3, width: 15, borderRadius: 2, backgroundColor: tab === id ? C.gold : 'transparent' }} /></Pressable>)}</View>}
  </SafeAreaView>;
}
const S = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 68, gap: 12, width: '100%', maxWidth: 660, alignSelf: 'center' }, wordmark: { fontFamily: serif, fontSize: 25, color: C.ink, letterSpacing: -.5 },
  nav: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 12, paddingBottom: 8 }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, gap: 6 },
  track: { height: 5, borderRadius: 6, backgroundColor: '#D9E0D2', overflow: 'hidden' }, fill: { height: '100%', backgroundColor: C.green, borderRadius: 6 },
  topicCard: { flexGrow: 1, flexBasis: '45%', minWidth: 130, padding: 19, borderRadius: 18, borderColor: C.line, borderWidth: 1, backgroundColor: C.paper, gap: 8 }, topicSymbol: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.pale, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  flashcard: { minHeight: 310, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 30, gap: 28 }, doneSymbol: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' },
  dayDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' }, boxBadge: { width: 35, height: 38, backgroundColor: C.pale, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
export default function App() { const store = useStoredState(); return <SafeAreaProvider><WordMemo key={`${store.scope}:${store.ready}`} store={store} /></SafeAreaProvider>; }
