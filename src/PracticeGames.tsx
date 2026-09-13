import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { Verse } from './types';
import { makeQuestions } from './practice-games';
import { Button, U } from './ui';
import { GrowBar } from './Adventure';
import { Celebration } from './Celebration';
export function PracticeGames({ verses, enabled, onClose }: { verses: Verse[]; enabled: boolean; onClose: () => void }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * Math.max(1, verses.length)));
  const questions = useMemo(() => makeQuestions(verses, seed), [verses, seed]);
  const [index, setIndex] = useState(0), [choice, setChoice] = useState<string | null>(null), [score, setScore] = useState(0);
  const q = questions[index];
  if (!q) return <><Celebration title="Round complete!" subtitle={`You found ${score} of ${questions.length} answers. Every round helps the words feel more familiar.`} xp={0} enabled={enabled} kind="complete" /><Text style={U.body}>Ready for recall? Your daily adventure lets you remember without hints and earn XP.</Text><Button onPress={onClose}>Back to my adventure</Button><Button variant="secondary" onPress={() => { setSeed(s => s + 5); setIndex(0); setChoice(null); setScore(0); }}>Play another round</Button></>;
  return <><View style={U.between}><Text style={U.eyebrow}>Practice playground</Text><Text style={U.small}>Question {index + 1} of {questions.length}</Text></View><GrowBar label="Practice round" value={index / questions.length * 100} enabled={enabled} /><Text accessibilityRole="header" style={U.title}>{q.title}</Text><Text style={U.small}>Guided practice · No XP or box changes</Text><View style={[U.card, { backgroundColor: '#EEE8FA', borderColor: '#D8CBEC' }]}><Text style={U.quote}>{q.prompt}</Text><Text style={U.small}>World English Bible · WEBP</Text></View><View style={{ gap: 12 }}>{q.options.map(option => <Button key={option} disabled={choice !== null} variant={choice === option ? 'primary' : 'secondary'} onPress={() => { setChoice(option); if (option === q.answer) setScore(s => s + 1); }}>{option}</Button>)}</View>{choice !== null && <><Celebration key={q.id} title={choice === q.answer ? 'You found it!' : 'Let’s learn this one.'} subtitle={`The answer is ${q.answer}.`} xp={0} enabled={enabled} kind={choice === q.answer ? 'correct' : 'practice'} /><View style={U.card}><Text style={U.sectionTitle}>{q.verse.reference}</Text><Text style={U.body}>{q.verse.text}</Text></View><Button onPress={() => { setIndex(i => i + 1); setChoice(null); }}>{index + 1 === questions.length ? 'See my results' : 'Next challenge'}</Button></>}<Button variant="quiet" onPress={onClose}>Close practice round</Button></>;
}
