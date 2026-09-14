import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { GrowBar, useMotion } from './Adventure';
import { gardenFor } from './garden';
import type { AppState } from './types';
import { C, U } from './ui';
export function GardenPlant({ grown, bloom, enabled = true }: { grown: boolean; bloom: boolean; enabled?: boolean }) {
  const motion = useMotion(enabled), scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!motion || !grown) { scale.setValue(1); return; }
    scale.setValue(.75);
    const animation = Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: Platform.OS !== 'web' });
    animation.start(); return () => animation.stop();
  }, [grown, bloom, motion]);
  return <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}><Svg width={100} height={105} viewBox="0 0 100 105" accessibilityElementsHidden>
    <Ellipse cx="50" cy="93" rx="35" ry="6" fill="#E5DFC9" />
    {grown ? <><Path d="M50 91 Q43 65 50 32" stroke={C.green} strokeWidth="4" fill="none" /><Path d="M48 72 Q14 72 22 48 Q45 46 48 72 M49 57 Q78 61 82 35 Q55 33 49 57" fill="#819D59" />{bloom ? <>{[0,1,2,3,4].map(i => <Ellipse key={i} cx="50" cy="20" rx="8" ry="14" fill="#DCC47B" transform={`rotate(${i * 72} 50 32)`} />)}<Circle cx="50" cy="32" r="7" fill={C.gold} /></> : <Ellipse cx="50" cy="32" rx="5" ry="9" fill={C.green} />}</> : <Ellipse cx="50" cy="87" rx="7" ry="4" fill="#BFA985" />}
  </Svg></Animated.View>;
}
export function Garden({ state }: { state: AppState }) {
  const g = gardenFor(state), enabled = state.settings.celebrationsEnabled !== false;
  return <View style={U.card}><Text style={U.eyebrow}>Your living garden</Text><Text style={U.sectionTitle}>{g.growth ? 'Look how far you’ve grown.' : 'Every beginning holds promise.'}</Text><Text style={U.body}>Each daily review and each newly completed stack lesson adds one growth point. Repeating a difficult-card lesson adds no extra points. Your garden stays with your saved progress.</Text><View style={U.wrap}>{g.plants.map(p => <View key={p.target} style={{ width: '30%', minWidth: 95, alignItems: 'center', marginBottom: 12 }}><GardenPlant grown={p.earned} bloom={p.earned && p.target >= 10} enabled={enabled} /><Text style={[U.small, { textAlign: 'center', color: p.earned ? C.green : C.muted }]}>{p.name}</Text><Text style={U.small}>{p.earned ? 'Grown' : `${p.target} growth points`}</Text></View>)}</View><Text style={U.body}>{g.growth} Growth points · {g.reviews} Reviews · {g.lessons} Lessons</Text>{g.next ? <><GrowBar value={Math.min(100, g.growth / g.next.target * 100)} label={`Progress toward ${g.next.name}`} enabled={enabled} /><Text style={U.small}>{g.next.target - g.growth} More growth points to {g.next.name.toLowerCase()}.</Text></> : <Text style={U.body}>Your garden is in full bloom. Keep tending the words you’ve learned.</Text>}<Text style={U.small}>Missed days never wilt your garden. Growth celebrates practice, not a measure of faith or mastery.</Text></View>;
}
