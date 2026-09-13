import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { C, Icon, U } from './ui';

export function Celebration({ title, subtitle, xp, enabled = true, kind = 'correct' }: {
  title: string; subtitle: string; xp: number; enabled?: boolean; kind?: 'correct' | 'practice' | 'complete';
}) {
  const [reduced, setReduced] = useState(true);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && Platform.OS !== 'web') setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    // React Native Web versions differ in how this preference is surfaced.
    const media = Platform.OS === 'web' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onChange = () => { if (media) setReduced(media.matches); };
    if (media) { onChange(); media.addEventListener('change', onChange); }
    return () => { mounted = false; subscription.remove(); media?.removeEventListener('change', onChange); };
  }, []);
  useEffect(() => {
    progress.setValue(0);
    if (!enabled || reduced) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: 1350, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [enabled, reduced, progress, title]);
  const animate = enabled && !reduced;
  return <View style={styles.card} accessibilityLiveRegion="polite">
    <View style={styles.art} accessible={false}>
      {animate && kind !== 'practice' && Array.from({ length: kind === 'complete' ? 30 : 18 }, (_, index) => {
        const angle = index * Math.PI * 2 / (kind === 'complete' ? 30 : 18);
        return <Animated.View key={index} style={[styles.spark, { backgroundColor: ['#8ABF49', '#B698D8', '#EAB461', '#70B8D2'][index % 4],
          opacity: progress.interpolate({ inputRange: [0, .55, 1], outputRange: [0, 1, 0] }),
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 120] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 85] }) }, { rotate: `${index * 37}deg` }] }]} />;
      })}
      <Animated.View style={[styles.medal, animate && { transform: [{ scale: progress.interpolate({ inputRange: [0, .55, 1], outputRange: [.7, 1.12, 1] }) }] }]}>
        <Icon name={kind === 'complete' ? 'award' : kind === 'correct' ? 'check' : 'heart'} color={C.green} size={34} />
      </Animated.View>
    </View>
    <Text style={[U.sectionTitle, { textAlign: 'center', fontSize: 29, lineHeight: 35 }]}>{title}</Text>
    <Text style={[U.body, { textAlign: 'center' }]}>{subtitle}</Text>
    {xp > 0 && <View style={styles.xp}><Icon name="star" size={17} color={C.gold} /><Text style={styles.xpText}>+{xp} XP</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  card: { ...U.card, alignItems: 'center', paddingVertical: 22, gap: 12, overflow: 'hidden' },
  art: { width: 270, height: 155, justifyContent: 'center', alignItems: 'center' },
  medal: { width: 96, height: 96, borderRadius: 34, backgroundColor: C.pale, borderWidth: 1, borderColor: '#CFDAC7', alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', width: 9, height: 14, borderRadius: 2 },
  xp: { backgroundColor: C.goldPale, borderRadius: 24, paddingHorizontal: 17, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  xpText: { fontSize: 18, fontWeight: '700', color: C.gold },
});
