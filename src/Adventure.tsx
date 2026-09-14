import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import type { AppState } from './types';
import { addDays, reviewedToday } from './leitner';
import { rewardsFor } from './rewards';
import { Button, C, Icon, U } from './ui';

export function useMotion(enabled = true) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    const media = Platform.OS === 'web' && typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const change = () => { if (media) setReduced(media.matches); };
    if (media) { change(); media.addEventListener('change', change); }
    else void AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setReduced(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; sub.remove(); media?.removeEventListener('change', change); };
  }, []);
  return enabled && !reduced;
}
export function Sprout({ enabled = true }: { enabled?: boolean }) {
  const motion = useMotion(enabled);
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motion) { bob.setValue(0); return; }
    const a = Animated.loop(Animated.sequence([Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }), Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' })]), { iterations: 3 });
    a.start(); return () => a.stop();
  }, [motion, bob]);
  return <Animated.View accessible={false} style={{ alignSelf: 'center', transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }) }, { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) }] }}><Svg width={136} height={150} viewBox="0 0 136 150"><Ellipse cx="68" cy="140" rx="38" ry="7" fill="#C5D7A5" /><Path d="M63 106 L62 55 Q65 34 83 24 M65 74 Q47 62 32 41" stroke="#537D32" strokeWidth="8" strokeLinecap="round" fill="none" /><Ellipse cx="91" cy="32" rx="25" ry="14" rotation="-30" origin="91,32" fill="#8ABF49" /><Ellipse cx="35" cy="43" rx="24" ry="14" rotation="35" origin="35,43" fill="#B1D963" /><Path d="M29 87 Q68 75 107 87 L98 125 Q68 145 38 125 Z" fill="#EAB461" /><Path d="M29 87 Q68 77 107 87" stroke="#CA913B" strokeWidth="9" strokeLinecap="round" fill="none" /><Circle cx="54" cy="106" r="4" fill="#294C3C" /><Circle cx="81" cy="106" r="4" fill="#294C3C" /><Path d="M59 117 Q68 125 77 117" stroke="#294C3C" strokeWidth="3" fill="none" strokeLinecap="round" /></Svg></Animated.View>;
}
export function GrowBar({ value, label, enabled = true }: { value: number; label: string; enabled?: boolean }) {
  const motion = useMotion(enabled), amount = useRef(new Animated.Value(0)).current;
  const percent = Math.max(0, Math.min(100, value));
  useEffect(() => { const a = Animated.timing(amount, { toValue: percent, duration: motion ? 600 : 0, useNativeDriver: false }); a.start(); return () => a.stop(); }, [percent, motion, amount]);
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: percent }} style={A.track}><Animated.View style={[A.fill, { width: amount.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} /></View>;
}
export function Adventure({ state, day, remaining, onStart, onGames, onTogether, onJourney }: { state: AppState; day: string; remaining: number; onStart: () => void; onGames: () => void; onTogether: () => void; onJourney: () => void }) {
  const rewards = rewardsFor(state), done = reviewedToday(state, day).size, goal = state.settings.dailyGoal;
  const reviews = state.history.filter(r => r.day === day);
  const correct = new Set(reviews.filter(r => r.correct).map(r => r.verseId)).size;
  const enabled = state.settings.celebrationsEnabled !== false;
  const quests = [{ title: 'Plant a seed', detail: 'Practise your first verse today', value: Math.min(done, 1), target: 1, icon: 'sunrise' }, { title: 'Let it take root', detail: 'Remember verses without hints', value: Math.min(correct, Math.min(3, goal)), target: Math.min(3, goal), icon: 'zap' }, { title: 'Complete your daily goal', detail: 'Earn your daily 25 XP bonus', value: Math.min(done, goal), target: goal, icon: 'award' }];
  const visible = Math.min(goal, 7), offset = Math.min(Math.max(0, done - 3), Math.max(0, goal - visible));
  return <>
    <View style={A.stats}>{[['star', `${rewards.xp} XP`], ['award', `Level ${rewards.level}`], ['sun', `${rewards.practiceDays} Active days`]].map(([icon, label]) => <View key={icon} style={A.stat}><Icon name={icon} color={C.green} size={18} /><Text style={A.statText}>{label}</Text></View>)}</View>
    <View style={A.hero}><Text style={U.eyebrow}>Your daily adventure</Text><Text accessibilityRole="header" style={A.title}>{done >= goal ? 'Look how you’ve grown!' : 'A little practice.\nA deeper root.'}</Text><Sprout enabled={enabled} /><Text style={[U.body, { textAlign: 'center' }]}>{done >= goal ? 'Today’s goal is complete. Take a moment to enjoy it.' : 'Bring the Word to life, one small lesson at a time.'}</Text><Button icon={remaining ? 'play' : 'compass'} onPress={onStart}>{remaining ? done ? 'Continue my adventure' : 'Start my adventure' : 'Explore the Bible'}</Button></View>
    <View style={A.panel}><View style={U.between}><Text style={A.heading}>Today’s learning trail</Text><Text style={A.statText}>{done} / {goal}</Text></View><GrowBar label="Daily learning trail" value={done / goal * 100} enabled={enabled} /><Text style={U.small}>Each step is one verse. Due reviews come first.</Text><View style={{ alignItems: 'center', gap: 0 }}>{Array.from({ length: visible }, (_, i) => { const n = i + offset, complete = n < done, current = n === done && remaining > 0; return <View key={n} style={{ alignItems: 'center', marginLeft: [0, 82, 110, 40, -66, -92, -30][i] }}>
      {i > 0 && <View style={{ height: 20, width: 5, borderRadius: 3, backgroundColor: complete ? '#8ABF49' : '#DCE5D4' }} />}
      <Pressable accessibilityRole="button" accessibilityLabel={`Verse ${n + 1}. ${complete ? 'Completed' : current ? 'Start next review' : 'Upcoming'}`} disabled={!current} onPress={onStart} style={({ pressed }) => [A.node, { backgroundColor: complete ? '#E4F1CC' : current ? '#679C36' : '#EEF0E8', borderColor: current ? '#3D7025' : '#D4DDC7', transform: [{ translateY: pressed ? 4 : 0 }] }]}><Icon name={complete ? 'check' : current ? 'play' : 'book-open'} color={current ? '#FFFFFF' : complete ? '#467D27' : '#71806A'} size={28} /></Pressable><Text style={[A.statText, { marginTop: 6 }]}>{complete ? `Step ${n + 1} complete` : current ? 'Let’s go!' : `Step ${n + 1}`}</Text></View>; })}</View>{goal > visible && <Text style={U.small}>Showing steps {offset + 1}–{offset + visible} of {goal}.</Text>}</View>
    <View style={A.panel}><Text style={A.heading}>Daily quests</Text>{quests.map(q => <View key={q.title} style={{ gap: 9 }}><View style={U.row}><View style={A.questIcon}><Icon name={q.value === q.target ? 'check-circle' : q.icon} color="#6A50A1" /></View><View style={{ flex: 1 }}><Text style={A.statText}>{q.title}</Text><Text style={U.small}>{q.detail}</Text></View><Text style={A.statText}>{q.value}/{q.target}</Text></View><GrowBar value={q.value / q.target * 100} label={q.title} enabled={enabled} /></View>)}</View>
    <View style={[A.panel, { backgroundColor: '#EEE8FA', borderColor: '#D8CBEC' }]}><Icon name="grid" color="#6A50A1" size={30} /><Text style={A.heading}>Mix up your practice</Text><Text style={U.body}>Find the reference. Complete the verse. Try a quick round and learn from every answer.</Text><Button onPress={onGames} icon="zap">Play a practice round</Button><Text style={U.small}>Guided games are extra practice. Recall cards earn XP and update your boxes.</Text></View>
    <View style={A.panel}><Text style={A.heading}>Your week in bloom</Text><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{Array.from({ length: 7 }, (_, i) => addDays(day, i - 6)).map(d => { const active = reviewedToday(state, d).size > 0; return <View key={d} style={{ alignItems: 'center', gap: 8 }}><Text style={U.small}>{new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</Text><View accessibilityLabel={`${d}: ${active ? 'Practised' : 'No practice'}`} style={[A.day, active && { backgroundColor: '#DFEFC4' }]}><Icon name={active ? 'sun' : 'minus'} size={17} color={active ? '#467D27' : C.muted} /></View></View>; })}</View><Text style={U.small}>Every day you return is worth celebrating.</Text><Button variant="quiet" onPress={onJourney}>Visit my garden & milestones</Button></View>
    <View style={[A.panel, { backgroundColor: '#E2EEF5' }]}><Icon name="users" color="#356B8F" size={28} /><Text style={A.heading}>Grow together</Text><Text style={U.body}>Share a favorite verse stack, cheer on your life group, and join a practice room.</Text><Button variant="secondary" onPress={onTogether}>Visit my life group</Button></View>
  </>;
}
const A = StyleSheet.create({ stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, stat: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, backgroundColor: C.paper, padding: 12, borderWidth: 1, borderColor: C.line }, statText: { color: C.ink, fontSize: 14, fontWeight: '700', flexShrink: 1 }, hero: { backgroundColor: '#EAF3D9', borderRadius: 30, padding: 24, gap: 16, borderWidth: 2, borderColor: '#D3E5B7' }, title: { fontSize: 35, lineHeight: 41, fontWeight: '800', color: C.ink, textAlign: 'center' }, panel: { ...U.card, borderRadius: 26, borderBottomWidth: 4, gap: 20 }, heading: { fontSize: 23, lineHeight: 29, fontWeight: '800', color: C.ink }, track: { height: 12, borderRadius: 8, backgroundColor: '#DFE5D7', overflow: 'hidden' }, fill: { height: '100%', borderRadius: 8, backgroundColor: '#85B847', borderTopWidth: 3, borderColor: '#A8CF6E' }, node: { width: 74, height: 74, borderRadius: 28, borderWidth: 2, borderBottomWidth: 7, alignItems: 'center', justifyContent: 'center' }, questIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#EEE8FA', alignItems: 'center', justifyContent: 'center' }, day: { width: 32, height: 36, borderRadius: 12, backgroundColor: '#EEF0E8', alignItems: 'center', justifyContent: 'center' } });
