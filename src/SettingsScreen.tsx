import React, { useState } from 'react';
import { Linking, Platform, Share, Switch, Text, TextInput, View } from 'react-native';
import { Button, C, Chip, Cross, Stepper, U } from './ui';
import { VERSES, MEMORY_VERSE_COUNT, TOPICS } from './catalog';
import { initialState, localDay, parseBackup } from './leitner';
import { mergeStates } from './sync-merge';
import { AccountPanel } from './AccountPanel';
import type { StoredState } from './storage';
import { configureReminder } from './reminders';
import type { AppState, RecallMode, Settings } from './types';
import type { WebAppStatus } from './web-app';

export function SettingsScreen({ state, setState, notify, webAppStatus, store }: { store: StoredState; state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; notify: (text: string) => void; webAppStatus: WebAppStatus }) {
  const [reminderTime, setReminderTime] = useState(state.settings.reminderTime);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupText, setBackupText] = useState('');
  const [pending, setPending] = useState<AppState | null>(null);
  const update = (patch: Partial<Settings>) => setState(s => ({ ...s, settings: { ...s.settings, ...patch } }));

  async function reminder(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try { await configureReminder(enabled, reminderTime); update({ reminderEnabled: enabled, reminderTime: enabled ? reminderTime : state.settings.reminderTime }); notify(enabled ? 'Your daily reminder is set.' : 'Your reminder is off.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'The reminder could not be saved.'); }
    finally { setBusy(false); }
  }
  async function exportBackup() {
    const content = JSON.stringify(state, null, 2);
    if (Platform.OS === 'web') {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `wordmemo-backup-${localDay()}.json`; a.click(); URL.revokeObjectURL(url);
    } else {
      try { await Share.share({ message: content, title: 'WordMemo backup' }); }
      catch { notify('The backup could not be shared. Please try again.'); }
    }
  }
  function prepareImport() {
    try { setPending(parseBackup(backupText, VERSES)); notify(''); }
    catch (e) { notify(e instanceof Error ? e.message : 'The backup could not be read.'); }
  }
  async function restoreBackup() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await configureReminder(false, state.settings.reminderTime);
      setState(s => ({ ...mergeStates(initialState(VERSES), pending, s), settings: { ...pending.settings, reminderEnabled: false } }));
      setReminderTime(pending.settings.reminderTime); setPending(null); setBackupText(''); setImporting(false);
      notify('Backup combined with your progress. You can enable a reminder for this device in Settings.');
    } catch { notify('Restore was paused because the existing reminder could not be cleared. Please try again.'); }
    finally { setBusy(false); }
  }

  return <>
    <Text style={U.eyebrow}>At your own pace</Text><Text accessibilityRole="header" style={U.title}>Your rhythm.</Text><AccountPanel store={store} />
    {Platform.OS === 'web' && <View style={U.card}><Text style={U.sectionTitle}>Keep the Word close</Text><Text style={U.body}>Add WordMemo to your home screen for an app you can open with one tap.</Text><Text style={U.small}>On an iPhone or iPad: Open in Safari, tap Share, then Add to Home Screen. On Android: Open the browser menu and choose Install app or Add to Home screen.</Text><Text accessibilityLiveRegion="polite" style={U.small}>{webAppStatus.offline === 'ready' ? 'Offline Bible ready. Reading, search, and practice are available without a connection while this browser keeps the downloaded files.' : webAppStatus.offline === 'preparing' ? 'Preparing the full Bible for offline use. Keep this page open with an internet connection until it is ready.' : 'Offline loading is unavailable right now. Keep an internet connection to reopen the app.'}</Text>{webAppStatus.updateAvailable && <Text style={U.small}>An update is ready. After finishing practice, close every WordMemo tab and app window, then reopen it to use the update.</Text>}</View>}
    <View style={U.card}><Text style={U.sectionTitle}>Daily practice</Text><Stepper label="Verses per day" value={state.settings.dailyGoal} min={1} max={30} onChange={n => setState(s => ({ ...s, settings: { ...s.settings, dailyGoal: n, newPerDay: Math.min(s.settings.newPerDay, n) } }))} /><Stepper label="New verses at most" value={state.settings.newPerDay} min={0} max={state.settings.dailyGoal} onChange={n => update({ newPerDay: n })} /><Text style={U.small}>Due reviews come first. Each verse counts once per day. The goal is a cap; some days have fewer eligible verses.</Text></View>
    <View style={U.card}><Text style={U.sectionTitle}>What would you like to recall?</Text><View style={U.wrap}>{([['mixed', 'Both ways'], ['reference', 'References'], ['verse', 'Verse words']] as [RecallMode, string][]).map(([mode, title]) => <Chip key={mode} selected={state.settings.mode === mode} text={title} onPress={() => update({ mode })} />)}</View><Text style={U.small}>Both ways selects a due recall direction for each verse. Each direction progresses independently.</Text></View>
    <View style={U.card}><Text style={U.sectionTitle}>A gentle reminder</Text><View style={U.between}><Text style={[U.body, { flex: 1 }]}>Daily notification</Text><Switch accessibilityLabel="Daily notification" value={state.settings.reminderEnabled} disabled={busy || Platform.OS === 'web'} trackColor={{ true: C.green, false: C.line }} onValueChange={enabled => { void reminder(enabled); }} /></View>{Platform.OS === 'web' ? <Text style={U.small}>Available in the Android and iPhone app.</Text> : <><TextInput accessibilityLabel="Reminder time in 24 hour format" value={reminderTime} onChangeText={setReminderTime} placeholder="08:00" maxLength={5} style={U.input} /><Text style={U.small}>24-hour time, on this device. Delivery can vary with your phone’s notification and battery settings.</Text>{state.settings.reminderEnabled && <Button variant="secondary" disabled={busy} onPress={() => { void reminder(true); }}>Update reminder time</Button>}</>}</View>
    <View style={U.card}><Text style={U.sectionTitle}>Celebrate small steps</Text><View style={U.between}><Text style={[U.body, { flex: 1 }]}>Celebration animations</Text><Switch accessibilityLabel="Celebration animations" value={state.settings.celebrationsEnabled !== false} onValueChange={celebrationsEnabled => update({ celebrationsEnabled })} trackColor={{ true: C.green, false: C.line }} /></View><Text style={U.small}>Points and milestones remain visible with animations off. WordMemo also respects your device’s reduced motion setting.</Text></View><View style={U.card}><Text style={U.sectionTitle}>Scripture text size</Text><View style={U.wrap}>{[[1, 'Regular'], [1.15, 'Larger'], [1.3, 'Largest']].map(([scale, title]) => <Chip key={scale} text={String(title)} selected={state.settings.fontScale === scale} onPress={() => update({ fontScale: Number(scale) })} />)}</View></View>
    <View style={U.card}><Text style={U.sectionTitle}>Keep your progress</Text><Text style={U.small}>Your account saves automatically when you are signed in and connected. You can also export a personal backup. Guest progress stays on this device.</Text><Button variant="secondary" icon="download" onPress={() => { void exportBackup(); }}>Export backup</Button><Button variant="quiet" icon="upload" onPress={() => setImporting(x => !x)}>Restore a backup</Button>{importing && <><TextInput accessibilityLabel="Paste WordMemo backup JSON" multiline style={[U.input, { minHeight: 140, textAlignVertical: 'top' }]} value={backupText} onChangeText={text => { setBackupText(text); setPending(null); }} placeholder="Paste your WordMemo backup here" /><Button variant="secondary" onPress={prepareImport}>Review backup</Button>{pending && <><Text style={U.body}>Combine {pending.history.length} reviews and {pending.enrolled.length} active verses from this backup with your current learning? Duplicate reviews count once. Settings will come from the backup, and reminders will be turned off.</Text><Button disabled={busy} onPress={() => { void restoreBackup(); }}>Combine with my progress</Button><Button variant="quiet" onPress={() => setPending(null)}>Cancel</Button></>}</>}</View>
    <View style={{ gap: 10 }}><Cross size={32} /><Text style={U.sectionTitle}>WordMemo</Text><Text style={U.small}>{MEMORY_VERSE_COUNT.toLocaleString()} verse cards · 66 books · {TOPICS.length} topics · WEBP{'\n'}World English Bible Protestant Edition. Public-domain Scripture, sourced from eBible.org. Topics are editorial labels.</Text><Button variant="quiet" icon="external-link" onPress={() => { void Linking.openURL('https://ebible.org/engwebp/copyright.htm').catch(() => notify('The source page could not be opened.')); }}>Translation & source</Button><Button variant="quiet" onPress={() => { void Linking.openURL('https://production.d3p8fj75zj86rx.amplifyapp.com/privacy.html'); }}>Privacy & saved data</Button><Text style={U.small}>No ads or app analytics. Signed-in progress is saved privately in AWS. Group members see only the name and content you choose to share. Google sign-in requests basic profile and email access. {Platform.OS === 'web' ? 'Offline reopening requires a completed download and browser support. ' : 'Chapter reading works offline. '}Publisher links open eBible.org and need an internet connection.</Text></View>
  </>;
}
