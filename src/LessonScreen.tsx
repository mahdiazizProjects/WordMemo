import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { VERSE_BY_ID, VERSES } from './catalog';
import { Button, Chip, U } from './ui';
import { GrowBar } from './Adventure';
import { Celebration } from './Celebration';
import { SaveStatus } from './AccountPanel';
import { currentExercise, gapFor, gradeLesson, lessonId, newLesson, nextExercise, normalizeAnswer, phraseFor, putLesson, totalSteps } from './lessons';
import type { Lesson } from './lessons';
import type { StoredState } from './storage';
import type { VerseStack } from './types';

export function CourseScreen({ stack, store, onOpen, onClose }: { stack: VerseStack; store: StoredState; onOpen: (id: string) => void; onClose: () => void }) {
  const { state, setState } = store;
  function start(unit: number) {
    const id = lessonId(stack.id, unit), existing = state.lessons?.find(l => l.id === id);
    if (!existing) setState(s => putLesson(s, newLesson(stack, unit)));
    onOpen(id);
  }
  const difficult = [...new Set([...(state.lessons ?? []).filter(l => l.stackId === stack.id).flatMap(l => l.mistakes), ...state.history.filter(r => !r.correct && stack.verseIds.includes(r.verseId)).map(r => r.verseId)])].filter(id => stack.verseIds.includes(id));
  return <><Button variant="quiet" icon="arrow-left" onPress={onClose}>Back to Cards</Button><Text style={U.eyebrow}>Your stack course</Text><Text accessibilityRole="header" style={U.title}>{stack.name}</Text><Text style={U.body}>Learn three verses at a time. Each lesson moves from helpful cues to recall, then revisits mistakes.</Text><SaveStatus store={store} />
    <View style={U.card}><Text style={U.sectionTitle}>How this course works</Text><Text style={U.body}>Choose a reference → Arrange a phrase → Complete a verse → Recall without hints.</Text><Text style={U.small}>Started lessons keep their original cards if you edit the stack. Course practice saves lesson progress. It does not award daily-review XP or move Leitner boxes; use daily reviews later to test lasting recall.</Text><Button variant="secondary" onPress={() => setState(s => ({ ...s, enrolled: [...new Set([...s.enrolled, ...stack.verseIds])] }))}>Include these cards in daily reviews</Button></View>
    {difficult.length > 0 && <Button variant="secondary" onPress={() => { const review = newLesson({ ...stack, id: stack.id.slice(0, 60) + '-review', name: ('Review: ' + stack.name).slice(0, 80), verseIds: difficult.slice(0, 3) }, 0); setState(s => putLesson(s, review)); onOpen(review.id); }}>Review difficult cards ({Math.min(3, difficult.length)})</Button>}
    {Array.from({ length: Math.ceil(stack.verseIds.length / 3) }, (_, unit) => {
      const lesson = state.lessons?.find(l => l.id === lessonId(stack.id, unit));
      const complete = !!lesson && lesson.step >= totalSteps(lesson);
      const previous = state.lessons?.find(l => l.id === lessonId(stack.id, unit - 1));
      const unlocked = unit === 0 || !!lesson || !!previous && previous.step >= totalSteps(previous);
      return <View key={unit} style={U.card}><Text style={U.sectionTitle}>Lesson {unit + 1}{complete ? ' · Complete' : ''}</Text><Text style={U.small}>{(lesson?.verseIds ?? stack.verseIds.slice(unit * 3, unit * 3 + 3)).map(id => VERSE_BY_ID.get(id)?.reference).join(' · ')}</Text>{lesson && <GrowBar value={lesson.step / totalSteps(lesson) * 100} label={`Lesson ${unit + 1} progress`} enabled={state.settings.celebrationsEnabled !== false} />}<Button disabled={!unlocked} onPress={() => start(unit)}>{complete ? 'View results' : lesson ? 'Resume lesson' : unlocked ? 'Start lesson' : 'Complete the previous lesson first'}</Button></View>;
    })}</>;
}

export function LessonScreen({ lesson, store, onClose, onStep }: { lesson: Lesson; store: StoredState; onClose: () => void; onStep: () => void }) {
  const { state, setState } = store;
  const current = currentExercise(lesson), verse = VERSE_BY_ID.get(current.verseId);
  const update = (action: (l: Lesson) => Lesson) => setState(s => { const live = s.lessons?.find(l => l.id === lesson.id); return live ? putLesson(s, action(live)) : s; });
  const patch = (value: Partial<Lesson>) => update(l => ({ ...l, ...value, updatedAt: new Date().toISOString() }));
  const answer = (correct: boolean) => update(l => gradeLesson(l, correct));
  const next = () => { update(nextExercise); onStep(); };
  if (lesson.step >= totalSteps(lesson) || !verse) return <><Celebration title="Lesson complete!" subtitle={`${lesson.correct} of ${totalSteps(lesson)} exercises completed correctly without hints.`} xp={0} kind="complete" enabled={state.settings.celebrationsEnabled !== false} /><SaveStatus store={store} /><Text style={U.sectionTitle}>What to revisit</Text>{lesson.mistakes.length ? lesson.mistakes.map(id => <View key={id} style={U.card}><Text style={U.sectionTitle}>{VERSE_BY_ID.get(id)?.reference}</Text><Text style={U.body}>{VERSE_BY_ID.get(id)?.text}</Text><Text style={U.small}>This verse needed extra practice during the lesson.</Text></View>) : <Text style={U.body}>You completed this lesson without needing a retry. Revisit these verses in your daily reviews to check what stays with you.</Text>}<Button onPress={onClose}>Back to my course</Button></>;
  const phrase = phraseFor(verse), tileOrder = phrase.map((_, i) => i).reverse();
  const gap = gapFor(verse);
  const options = [verse.reference, ...VERSES.filter(v => v.reference !== verse.reference && v.text).slice(0, 3).map(v => v.reference)].sort();
  const titles = ['Find the reference', 'Build the opening phrase', 'Complete the verse', 'Recall the verse'];
  const expected = current.phase === 0 ? verse.reference : current.phase === 1 ? phrase.join(' ') : current.phase === 2 ? gap.answer : verse.text;
  const typed = current.phase === 1 ? lesson.tiles.map(i => phrase[i]).join(' ') : lesson.input;
  const missing = expected.split(/\s+/).filter(w => !normalizeAnswer(typed).split(' ').includes(normalizeAnswer(w)));
  return <><Button variant="quiet" icon="arrow-left" onPress={onClose}>Save & return to course</Button><Text style={U.eyebrow}>{lesson.name} · Lesson {lesson.unit + 1}</Text><SaveStatus store={store} /><GrowBar value={lesson.step / totalSteps(lesson) * 100} label="Lesson progress" enabled={state.settings.celebrationsEnabled !== false} /><Text style={U.small}>Exercise {lesson.step + 1} of {totalSteps(lesson)}{current.retry ? ' · Mistake review' : ''}</Text><Text accessibilityRole="header" style={U.title}>{titles[current.phase]}</Text>
    <View style={U.card}><Text style={U.quote}>{current.phase === 0 ? verse.text : current.phase === 1 ? verse.reference : current.phase === 2 ? gap.prompt : verse.reference}</Text><Text style={U.small}>World English Bible · WEBP</Text></View>
    {lesson.result === null ? <>
      {current.phase === 0 ? options.map(option => <Button key={option} variant="secondary" onPress={() => { update(l => gradeLesson({ ...l, input: option }, option === expected)); }}>{option}</Button>) : current.phase === 1 ? <><Text style={U.small}>Arrange the first {phrase.length} words. Tap a selected tile to remove it.</Text><View style={U.card}><View style={U.wrap}>{lesson.tiles.length ? lesson.tiles.map(i => <Chip key={i} selected text={phrase[i]} onPress={() => patch({ tiles: lesson.tiles.filter(x => x !== i) })} />) : <Text style={U.small}>Your phrase goes here.</Text>}</View></View><View style={U.wrap}>{tileOrder.filter(i => !lesson.tiles.includes(i)).map(i => <Chip key={i} text={phrase[i]} onPress={() => patch({ tiles: [...lesson.tiles, i] })} />)}</View></> : <TextInput accessibilityLabel={current.phase === 2 ? 'Missing word' : 'Your recalled verse'} placeholder={current.phase === 2 ? 'Type the missing word' : 'Type the verse as you remember it'} multiline={current.phase === 3} maxLength={4000} value={lesson.input} onChangeText={input => patch({ input })} style={[U.input, current.phase === 3 && { minHeight: 140 }]} />}
      {current.phase > 0 && <Button disabled={!typed.trim()} onPress={() => answer(normalizeAnswer(typed) === normalizeAnswer(expected))}>Check my answer</Button>}
      <Button variant="quiet" onPress={() => patch({ hinted: true })}>Show a hint</Button>{lesson.hinted && <View style={U.card}><Text style={U.body}>{expected}</Text><Text style={U.small}>Hint used. This verse will return for a recall attempt later.</Text></View>}
      <Button variant="quiet" onPress={() => answer(false)}>I’m still learning this</Button>
    </> : <><Celebration title={lesson.result ? 'Well done!' : 'Let’s strengthen this one.'} subtitle={lesson.result ? 'Ready for the next step.' : current.retry ? 'Keep this verse in your next daily review.' : 'You’ll see this verse again after the other exercises.'} xp={0} enabled={state.settings.celebrationsEnabled !== false} kind={lesson.result ? 'correct' : 'practice'} /><View style={U.card}><Text style={U.sectionTitle}>The answer</Text><Text style={U.body}>{expected}</Text>{!lesson.result && !!typed && <><Text style={U.small}>Your answer: {typed}</Text><Text style={U.small}>{missing.length ? `Words to notice: ${missing.join(' ')}` : 'Check the word order, extra words, or whether a hint was used.'}</Text></>}<Text style={U.small}>Capitalization and punctuation do not affect checking.</Text></View><Button onPress={next}>{lesson.step + 1 >= totalSteps(lesson) ? 'See my lesson results' : 'Continue lesson'}</Button></>}
  </>;
}
