import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState as NativeAppState, Platform } from 'react-native';
import { initialState, parseBackup } from './leitner';
import { VERSES } from './catalog';
import { LearningStore } from './learning-store';
import { authSnapshot, startAuth, subscribeAuth } from './auth-api';
import { accountCloud } from './cloud-api';

export const learningStore = new LearningStore(AsyncStorage, () => initialState(VERSES), raw => parseBackup(raw, VERSES));
export function useStoredState() {
  const view = useSyncExternalStore(learningStore.subscribe, learningStore.snapshot);
  const auth = useSyncExternalStore(subscribeAuth, authSnapshot);
  useEffect(() => { void startAuth(); }, []);
  useEffect(() => {
    if (!auth.ready) return;
    void learningStore.open(auth.account ? `user:${auth.account.config.userPoolId}:${auth.account.id}` : 'guest', auth.account ? accountCloud(auth.account) : undefined);
  }, [auth.ready, auth.account?.id]);
  useEffect(() => {
    const sync = () => { void learningStore.sync(); };
    const timer = setInterval(sync, 45_000);
    const sub = NativeAppState.addEventListener('change', s => { if (s === 'active') sync(); });
    if (Platform.OS === 'web') window.addEventListener('online', sync);
    return () => { clearInterval(timer); sub.remove(); if (Platform.OS === 'web') window.removeEventListener('online', sync); };
  }, []);
  return { ...view, ready: view.ready && auth.ready, auth, setState: learningStore.update,
    retry: () => { if (view.ready) void learningStore.sync(); else void learningStore.open(view.scope, auth.account ? accountCloud(auth.account) : undefined); } };
}
export type StoredState = ReturnType<typeof useStoredState>;
