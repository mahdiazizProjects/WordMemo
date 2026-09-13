import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { login, logout } from './auth-api';
import { learningStore } from './storage';
import type { StoredState } from './storage';
import { Button, C, Icon, U } from './ui';

export function SaveStatus({ store }: { store: StoredState }) {
  const label = !store.auth.account ? 'Saved on this device' : store.status === 'saved' ? 'Saved to your account' : store.status === 'saving' ? 'Saving…' : 'Changes waiting to save';
  return <View style={U.row}><Icon name={!store.auth.account ? 'smartphone' : store.status === 'saved' ? 'cloud' : 'refresh-cw'} size={16} color={C.muted} /><Text accessibilityLiveRegion="polite" style={U.small}>{label}</Text></View>;
}
export function AccountPanel({ store, compact = false }: { store: StoredState; compact?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function action(f: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await learningStore.flush(); await f(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  const account = store.auth.account;
  return <View style={U.card}>
    <Text style={U.sectionTitle}>{account ? 'Your WordMemo account' : 'Carry your progress with you'}</Text>
    {account ? <><Text style={U.body}>{account.email}</Text><SaveStatus store={store} />
      {!!store.error && <Text accessibilityRole="alert" style={[U.small, { color: C.error }]}>{store.error}</Text>}
      {!compact && <><Text style={U.small}>Your reviews, rewards, favourites, and verse stacks are saved privately to your account. Sign in with the same method on another device to pick up where you left off.</Text><Button variant="secondary" disabled={busy} onPress={() => { void action(() => learningStore.sync()); }}>Save now</Button><Button variant="quiet" disabled={busy} onPress={() => { void action(async () => { await learningStore.sync(); await logout(); }); }}>Sign out</Button></>}
    </> : <><Text style={U.small}>Sign in to restore your learning on another phone or browser, and practise with your life group.</Text>
      {store.auth.config?.enabled ? <>{store.auth.config.googleEnabled && <Button disabled={busy} onPress={() => { void action(() => login(true)); }}>Continue with Google</Button>}<Button disabled={busy} variant={store.auth.config.googleEnabled ? 'secondary' : 'primary'} icon="mail" onPress={() => { void action(() => login()); }}>Continue with email</Button></> : <Text style={U.small}>Account saving and group practice will be available when this upgrade is connected to AWS. You can keep practising on this device.</Text>}
      <Text style={U.small}>You can also use WordMemo without an account. Guest progress stays on this device.</Text>
    </>}
    {!!store.guest && <View style={{ gap: 10, borderTopWidth: 1, borderColor: C.line, paddingTop: 14 }}><Text style={U.body}>There’s guest progress in this browser: {store.guest.history.length} reviews and {store.guest.enrolled.length} active verses. Is it yours?</Text><Text style={U.small}>Add it to this account only if it belongs to you. The original guest copy stays on this device.</Text><Button disabled={busy} onPress={() => { void action(() => learningStore.importGuest()); }}>Add my guest progress</Button><Button variant="quiet" onPress={() => learningStore.keepGuestSeparate()}>Keep it separate</Button></View>}
    {!!(message || store.auth.error) && <Text accessibilityRole="alert" style={[U.small, { color: C.error }]}>{message || store.auth.error}</Text>}
  </View>;
}
