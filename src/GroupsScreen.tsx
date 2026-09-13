import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Switch, Text, TextInput, View } from 'react-native';
import { VERSES, VERSE_BY_ID, TOPICS, topicVerses } from './catalog';
import { AccountPanel } from './AccountPanel';
import { Celebration } from './Celebration';
import { clearInvite, pendingInvite } from './auth-api';
import { request } from './cloud-api';
import { Button, C, Chip, Icon, U } from './ui';
import { learningStore } from './storage';
import type { StoredState } from './storage';
import type { VerseStack } from './types';

type Member = { userId: string; displayName: string; role: string; shareProgress: boolean; summary?: { verses: number; practiceDays: number; xp: number; level: number } };
type SharedStack = { id: string; name: string; verseIds: string[]; authorId: string; createdAt: string };
type Group = { id: string; name: string; ownerId: string; me: Member; members: Member[]; stacks: SharedStack[]; roomId?: string };
type GroupLink = { id: string; name: string; members: number; owner: boolean };
type Room = { id: string; name: string; hostId: string; verseIds: string[]; index: number; direction: 'verse' | 'reference'; revealed: boolean; ended: boolean; revision: number; responses: number; remembered: number; myAnswer: boolean | null; expiresAt: number };
const newId = () => Platform.OS === 'web' && typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `stack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const stackRefs = (ids: string[]) => ids.slice(0, 5).map(id => VERSE_BY_ID.get(id)?.reference ?? '').join(' · ') + (ids.length > 5 ? ` · +${ids.length - 5} more` : '');

export function GroupsScreen({ store }: { store: StoredState }) {
  const { state, setState } = store, account = store.auth.account;
  const [groups, setGroups] = useState<GroupLink[]>([]), [groupId, setGroupId] = useState(''), [group, setGroup] = useState<Group>();
  const [roomId, setRoomId] = useState(''), [room, setRoom] = useState<Room>();
  const [roomError, setRoomError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState(''), [groupName, setGroupName] = useState(''), [invitation, setInvitation] = useState(pendingInvite);
  const [inviteLink, setInviteLink] = useState(''), [confirm, setConfirm] = useState<{ text: string; action: () => Promise<unknown> }>();
  const [editor, setEditor] = useState<VerseStack>(), [search, setSearch] = useState(''), [showTopics, setShowTopics] = useState(false);
  const busyRef = useRef(false), groupRef = useRef(groupId);
  groupRef.current = groupId;
  const stacks = state.stacks ?? [];
  const searchResults = useMemo(() => {
    if (search.trim().length < 2) return [];
    const words = search.toLowerCase().trim().split(/\s+/);
    return VERSES.filter(v => v.text && words.every(word => `${v.reference} ${v.text}`.toLowerCase().includes(word))).slice(0, 15);
  }, [search]);
  const api = <T,>(path: string, body?: unknown, method?: string) => {
    if (!account) return Promise.reject(new Error('Sign in first to use groups.'));
    return request<T>(account, path, body, method);
  };
  async function run(action: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Please try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function loadGroups() { if (account) setGroups((await api<{ groups: GroupLink[] }>('/groups')).groups); }
  async function loadGroup(id = groupRef.current) {
    const value = await api<Group>(`/groups/${id}`);
    if (groupRef.current === id) { setGroup(value); setDisplayName(value.me.displayName); }
  }
  useEffect(() => { if (account) void run(loadGroups); }, [account?.id]);
  useEffect(() => {
    setGroup(undefined); setInviteLink(''); setRoomId(''); setRoom(undefined); setMessage('');
    if (!groupId) return;
    void run(() => loadGroup(groupId));
  }, [groupId]);
  useEffect(() => {
    if (!account || !groupId || !roomId) { setRoom(undefined); return; }
    let active = true, fetching = false;
    const refresh = async () => {
      if (fetching || (Platform.OS === 'web' && document.visibilityState === 'hidden')) return;
      fetching = true;
      try { const next = await request<Room>(account, `/groups/${groupId}/rooms/${roomId}`); if (active) { setRoom(next); setRoomError(''); } }
      catch (e) { if (active) setRoomError(e instanceof Error ? e.message : 'Connection paused.'); }
      finally { fetching = false; }
    };
    setRoom(undefined); setRoomError(''); void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [groupId, roomId, account?.id]);
  const addPractice = (ids: string[]) => { setState(s => ({ ...s, enrolled: [...new Set([...s.enrolled, ...ids])] })); setMessage('Added to your daily practice. Your daily goal still applies.'); };
  function toggleCard(id: string) {
    setEditor(s => s ? { ...s, verseIds: s.verseIds.includes(id) ? s.verseIds.filter(v => v !== id) : s.verseIds.length < 200 ? [...s.verseIds, id] : s.verseIds } : s);
  }
  function saveStack() {
    if (!editor || !editor.name.trim() || !editor.verseIds.length) return;
    const updated = { ...editor, name: editor.name.trim(), updatedAt: new Date().toISOString() };
    setState(s => ({ ...s, stacks: [...(s.stacks ?? []).filter(v => v.id !== updated.id), updated] }));
    setEditor(undefined); setSearch(''); setMessage('Your stack is saved. You can share a copy with a group.');
  }
  async function roomAction(action: string) {
    if (!room) return;
    await api(`/groups/${groupId}/rooms/${room.id}`, { action, revision: room.revision }, 'PUT');
    setRoom(await api<Room>(`/groups/${groupId}/rooms/${room.id}`)); setRoomError('');
  }
  async function answer(correct: boolean) {
    if (!room) return;
    await api(`/groups/${groupId}/rooms/${room.id}/answer`, { index: room.index, correct });
    setRoom(await api<Room>(`/groups/${groupId}/rooms/${room.id}`)); setRoomError('');
  }
  const notice = <>{!!message && <View style={[U.card, { backgroundColor: C.goldPale }]}><Text accessibilityLiveRegion="polite" style={U.body}>{message}</Text><Button variant="quiet" onPress={() => setMessage('')}>Dismiss</Button></View>}{confirm && <View style={U.card}><Text style={U.body}>{confirm.text}</Text><Button disabled={busy} onPress={() => { const action = confirm.action; setConfirm(undefined); void run(action); }}>Confirm</Button><Button variant="quiet" onPress={() => setConfirm(undefined)}>Cancel</Button></View>}</>;

  if (editor) return <>
    <Button variant="quiet" icon="arrow-left" onPress={() => setEditor(undefined)}>Back to Together</Button>
    <Text style={U.eyebrow}>Your verse stack</Text><Text style={U.title}>Words to carry.</Text>
    <TextInput accessibilityLabel="Stack name" placeholder="e.g. Peace in a busy week" maxLength={80} value={editor.name} onChangeText={name => setEditor({ ...editor, name })} style={U.input} />
    <Text style={U.small}>{editor.verseIds.length} / 200 cards · Saved privately until you share a copy.</Text>
    <View style={U.wrap}><Button variant="secondary" onPress={() => setEditor({ ...editor, verseIds: [...new Set([...editor.verseIds, ...state.favorites])].filter(id => !!VERSE_BY_ID.get(id)?.text).slice(0, 200) })}>Add favourites</Button><Button variant="secondary" onPress={() => setEditor({ ...editor, verseIds: [...new Set([...editor.verseIds, ...state.enrolled])].filter(id => !!VERSE_BY_ID.get(id)?.text).slice(0, 200) })}>Add My verses</Button><Button variant="quiet" onPress={() => setShowTopics(s => !s)}>Add a topic</Button></View>
    {showTopics && <View style={U.wrap}>{TOPICS.map(t => <Chip key={t.id} text={t.name} onPress={() => { setEditor({ ...editor, verseIds: [...new Set([...editor.verseIds, ...topicVerses(t.id, true).map(v => v.id)])].slice(0, 200) }); setShowTopics(false); }} />)}</View>}
    <Text style={U.small}>Quick additions fill the remaining spaces, up to 200 cards.</Text>
    <TextInput accessibilityLabel="Find a verse for this stack" placeholder="Search a reference or keyword" value={search} onChangeText={setSearch} style={U.input} />
    {searchResults.map(v => <View key={v.id} style={U.card}><Text style={U.sectionTitle}>{v.reference}</Text><Text numberOfLines={3} style={U.body}>{v.text}</Text><Button disabled={!editor.verseIds.includes(v.id) && editor.verseIds.length >= 200} variant="secondary" onPress={() => toggleCard(v.id)}>{editor.verseIds.includes(v.id) ? 'Remove card' : 'Add card'}</Button></View>)}
    {!search && <View style={U.wrap}>{editor.verseIds.map(id => <Chip key={id} text={`${VERSE_BY_ID.get(id)?.reference} ×`} selected onPress={() => toggleCard(id)} />)}</View>}
    <Button disabled={!editor.name.trim() || !editor.verseIds.length} onPress={saveStack}>Save my stack</Button>
  </>;

  if (roomId && groupId) {
    const verse = room ? VERSE_BY_ID.get(room.verseIds[room.index]) : undefined;
    const isHost = room?.hostId === account?.id;
    return <><Button variant="quiet" icon="arrow-left" onPress={() => { setRoomId(''); void run(() => loadGroup()); }}>Back to group</Button>{notice}
      <Text style={U.eyebrow}>Practise together</Text><Text style={U.title}>{room?.name ?? 'Opening the room…'}</Text>
      <Text style={U.small}>Everyone sees the same card. The host reveals and advances it. Updates arrive every few seconds.</Text>
      {!!roomError && <Text accessibilityRole="alert" style={[U.body, { color: C.error }]}>{roomError}</Text>}
      {room?.ended ? <><Celebration title="A moment shared." subtitle="You made time for the Word together." xp={0} enabled={state.settings.celebrationsEnabled !== false} kind="complete" /><Button onPress={() => addPractice(room.verseIds)}>Keep this stack in my daily practice</Button></> : room && verse ? <>
        <Text style={U.eyebrow}>Card {room.index + 1} of {room.verseIds.length} · {isHost ? 'You are hosting' : 'Follow the host'}</Text>
        <View style={[U.card, { minHeight: 260, justifyContent: 'center' }]}><Text style={U.eyebrow}>{room.revealed ? 'The answer' : room.direction === 'reference' ? 'Where is this written?' : 'What does this verse say?'}</Text><Text style={U.quote}>{room.revealed ? room.direction === 'reference' ? verse.reference : verse.text : room.direction === 'reference' ? verse.text : verse.reference}</Text><Text style={U.small}>WEBP</Text></View>
        {room.revealed && <Text style={U.small}>{room.direction === 'reference' ? verse.text : verse.reference}</Text>}
        {room.revealed && room.myAnswer === null && <View style={U.row}><Button style={{ flex: 1 }} disabled={busy || !!roomError} variant="secondary" onPress={() => { void run(() => answer(false)); }}>Still learning</Button><Button style={{ flex: 1 }} disabled={busy || !!roomError} onPress={() => { void run(() => answer(true)); }}>Remembered</Button></View>}
        {room.myAnswer !== null && <Celebration key={`${room.id}-${room.index}`} title={room.myAnswer ? 'Well remembered!' : 'Keep growing.'} subtitle="Your response is with the group. Ready for the next card?" xp={0} enabled={state.settings.celebrationsEnabled !== false} kind={room.myAnswer ? 'correct' : 'practice'} />}
        <Text accessibilityLiveRegion="polite" style={U.body}>{room.responses} {room.responses === 1 ? 'person has' : 'people have'} responded{room.revealed ? ` · ${room.remembered} remembered` : ''}.</Text>
        {isHost ? <Button disabled={busy || !!roomError} onPress={() => { void run(() => roomAction(room.revealed ? 'next' : 'reveal')); }}>{room.revealed ? room.index === room.verseIds.length - 1 ? 'Finish together' : 'Next card for everyone' : 'Reveal for everyone'}</Button> : <Text style={U.small}>Wait for the host to {room.revealed ? 'advance the card' : 'reveal the answer'}.</Text>}
        {(isHost || group?.ownerId === account?.id) && <Button variant="quiet" disabled={busy} onPress={() => setConfirm({ text: 'End this practice room for everyone?', action: () => roomAction('end') })}>End the room</Button>}
        <Text style={U.small}>This is extra practice. It leaves your personal daily goal and Leitner boxes unchanged. Responses are temporary and shown as group totals.</Text>
      </> : null}
    </>;
  }

  if (groupId) return <>
    <Button variant="quiet" icon="arrow-left" onPress={() => { setGroupId(''); void run(loadGroups); }}>All groups & stacks</Button>{notice}
    {!group ? <><Text style={U.body}>Opening your group…</Text><Button variant="secondary" disabled={busy} onPress={() => { void run(() => loadGroup()); }}>Try again</Button></> : <>
      <Text style={U.eyebrow}>Your life group</Text><Text style={U.title}>{group.name}</Text><Text style={U.small}>{group.members.length} members · Private invitation</Text>
      <Button variant="quiet" icon="refresh-cw" disabled={busy} onPress={() => { void run(() => loadGroup()); }}>Refresh group</Button>
      {group.roomId && <Button icon="users" onPress={() => setRoomId(group.roomId!)}>Open practice room</Button>}
      {group.ownerId === account?.id && <View style={U.card}><Text style={U.sectionTitle}>Bring your group together</Text><Text style={U.small}>Anyone with an invitation can join after signing in. Links expire in 7 days. A new link replaces the previous one.</Text><Button variant="secondary" disabled={busy} onPress={() => { void run(async () => { const invite = await api<{ token: string }>(`/groups/${groupId}/invite`, {}); setInviteLink(`${account!.config.appUrl}#join=${invite.token}`); }); }}>Create invitation link</Button>{!!inviteLink && <><Text selectable style={U.small}>{inviteLink}</Text><Button variant="quiet" onPress={() => { void run(async () => { if (Platform.OS === 'web' && navigator.clipboard) { await navigator.clipboard.writeText(inviteLink); setMessage('Invitation copied. Send it to the people you want to join.'); } else setMessage('Select the invitation above to copy it.'); }); }}>Copy invitation</Button></>}</View>}
      <View style={U.card}><Text style={U.sectionTitle}>How you appear</Text><TextInput accessibilityLabel="Your name in this group" maxLength={40} value={displayName} onChangeText={setDisplayName} style={U.input} /><Button variant="secondary" disabled={busy || !displayName.trim()} onPress={() => { void run(async () => { await api(`/groups/${groupId}/membership`, { displayName, shareProgress: group.me.shareProgress }, 'PUT'); await loadGroup(); }); }}>Save name</Button><View style={U.between}><Text style={[U.body, { flex: 1 }]}>Share my progress summary</Text><Switch accessibilityLabel="Share my progress summary with this group" value={group.me.shareProgress} disabled={busy} onValueChange={value => { void run(async () => { await learningStore.sync(); await api(`/groups/${groupId}/membership`, { displayName: group.me.displayName, shareProgress: value }, 'PUT'); await loadGroup(); }); }} trackColor={{ true: C.green, false: C.line }} /></View><Text style={U.small}>Members can see your level, points, practice days, and the number of verses remembered. Your email, specific answers, and personal review history stay private. Turn this off at any time.</Text></View>
      <Text style={U.sectionTitle}>Shared verse stacks</Text><Text style={U.small}>Copy a stack to make it your own, or add it straight to daily practice.</Text>
      {!group.stacks.length && <Text style={U.body}>Share the first stack for your group.</Text>}
      {group.stacks.map(stack => <View key={stack.id} style={U.card}><View style={U.row}><Icon name="layers" color={C.gold} /><Text style={[U.sectionTitle, { flex: 1 }]}>{stack.name}</Text></View><Text style={U.small}>{stack.verseIds.length} cards · {stackRefs(stack.verseIds)}</Text><Button variant="secondary" onPress={() => addPractice(stack.verseIds)}>Add to daily practice</Button><Button variant="quiet" disabled={stacks.length >= 50} onPress={() => { setState(s => ({ ...s, stacks: [...(s.stacks ?? []), { id: newId(), name: stack.name, verseIds: stack.verseIds, updatedAt: new Date().toISOString() }] })); setMessage('A private copy is saved in My stacks.'); }}>Copy to My stacks</Button><View style={U.wrap}>{(['reference', 'verse'] as const).map(direction => <Button key={direction} variant="secondary" disabled={busy} onPress={() => { void run(async () => { const result = await api<{ id: string }>(`/groups/${groupId}/rooms`, { id: newId(), stackId: stack.id, direction }); setRoomId(result.id); }); }}>{direction === 'reference' ? 'Host reference recall' : 'Host verse recall'}</Button>)}</View><Text style={U.small}>A room uses the first 30 cards and stays open for up to 6 hours. Only one room is active at a time.</Text>{(stack.authorId === account?.id || group.ownerId === account?.id) && <Button variant="quiet" disabled={busy} onPress={() => setConfirm({ text: `Remove “${stack.name}” from this group? Copies members already saved remain theirs.`, action: async () => { await api(`/groups/${groupId}/stacks/${stack.id}`, undefined, 'DELETE'); await loadGroup(); } })}>Remove shared stack</Button>}</View>)}
      <View style={U.card}><Text style={U.sectionTitle}>Share one of your stacks</Text>{stacks.length ? stacks.map(stack => <Button key={stack.id} variant="secondary" disabled={busy} onPress={() => { void run(async () => { await api(`/groups/${groupId}/stacks`, { id: newId(), name: stack.name, verseIds: stack.verseIds }); await loadGroup(); setMessage('Your stack is shared with this group.'); }); }}>Share {stack.name}</Button>) : <Text style={U.small}>Create a stack from the Together page first.</Text>}<Text style={U.small}>Sharing adds a copy. Later edits to your private stack leave the shared copy unchanged.</Text></View>
      <Text style={U.sectionTitle}>Growing together</Text>{group.members.map(m => <View key={m.userId} style={U.card}><Text style={U.sectionTitle}>{m.displayName}{m.role === 'owner' ? ' · host' : ''}</Text>{m.summary ? <Text style={U.body}>Level {m.summary.level || 1} · {m.summary.xp} points{'\n'}{m.summary.verses} verses remembered · {m.summary.practiceDays} practice days</Text> : <Text style={U.small}>Practising at their own pace.</Text>}{group.ownerId === account?.id && m.userId !== account.id && <Button variant="quiet" onPress={() => setConfirm({ text: `Remove ${m.displayName} from this group? Create a new invitation link too if the old one should no longer be used.`, action: async () => { await api(`/groups/${groupId}/members/${m.userId}`, undefined, 'DELETE'); await loadGroup(); } })}>Remove member</Button>}</View>)}
      <Button variant="quiet" disabled={busy} onPress={() => setConfirm({ text: group.ownerId === account?.id ? 'Close this group? Invitations, shared stacks, and rooms will become unavailable to all members. Personal progress and copied stacks remain saved.' : 'Leave this group? Your personal learning stays with you.', action: async () => { await api(group.ownerId === account?.id ? `/groups/${groupId}` : `/groups/${groupId}/members/${account?.id}`, undefined, 'DELETE'); setGroupId(''); await loadGroups(); } })}>{group.ownerId === account?.id ? 'Close group' : 'Leave group'}</Button>
    </>}
  </>;

  return <>
    <Text style={U.eyebrow}>A word shared</Text><Text style={U.title}>Grow together.</Text><Text style={U.body}>Gather your favourite verses. Share them with your life group. Make time to remember together.</Text>{notice}
    {(!account || store.guest) && <AccountPanel store={store} />}
    <View style={U.between}><Text style={U.sectionTitle}>My stacks</Text><Button variant="quiet" icon="plus" disabled={stacks.length >= 50} onPress={() => { setEditor({ id: newId(), name: '', verseIds: [], updatedAt: new Date().toISOString() }); setSearch(''); }}>Create stack</Button></View>
    {!stacks.length && <View style={U.card}><Icon name="layers" color={C.gold} /><Text style={U.body}>A stack can hold verses for the season you’re in: peace, perseverance, gratitude, or whatever your group is exploring.</Text></View>}
    {stacks.map(stack => <View key={stack.id} style={U.card}><Text style={U.sectionTitle}>{stack.name}</Text><Text style={U.small}>{stack.verseIds.length} cards · {stackRefs(stack.verseIds)}</Text><View style={U.wrap}><Button variant="secondary" onPress={() => addPractice(stack.verseIds)}>Practise daily</Button><Button variant="quiet" onPress={() => { setEditor(stack); setSearch(''); }}>Edit stack</Button><Button variant="quiet" onPress={() => setConfirm({ text: `Delete your private stack “${stack.name}”? Your learning and any copies shared with groups will stay saved.`, action: async () => { setState(s => ({ ...s, stacks: (s.stacks ?? []).filter(v => v.id !== stack.id) })); } })}>Delete</Button></View><Text style={U.small}>Open a group below to share this stack.</Text></View>)}
    {account && <><Text style={U.sectionTitle}>My life groups</Text>{groups.map(g => <Button key={g.id} icon="users" variant="secondary" onPress={() => setGroupId(g.id)}>{g.name} · {g.members}</Button>)}<Button variant="quiet" disabled={busy} onPress={() => { void run(loadGroups); }}>Refresh groups</Button>
      <View style={U.card}><Text style={U.sectionTitle}>Join or start a group</Text><TextInput accessibilityLabel="Your group display name" placeholder="Your name in the group" maxLength={40} value={displayName} onChangeText={setDisplayName} style={U.input} /><Text style={U.small}>Only the name you choose is shown. Progress sharing starts off.</Text><TextInput accessibilityLabel="Invitation link or code" autoCapitalize="none" placeholder="Paste your invitation link" value={invitation} onChangeText={setInvitation} style={U.input} /><Button disabled={busy || !displayName.trim() || !invitation.trim()} variant="secondary" onPress={() => { void run(async () => { const token = invitation.includes('#join=') ? invitation.split('#join=')[1] : invitation.trim(); const result = await api<{ id: string }>('/groups/join', { token, displayName }); clearInvite(); setInvitation(''); setGroupId(result.id); }); }}>Join with invitation</Button><TextInput accessibilityLabel="New group name" placeholder="e.g. Tuesday life group" maxLength={80} value={groupName} onChangeText={setGroupName} style={U.input} /><Button disabled={busy || !displayName.trim() || !groupName.trim() || groups.length >= 20} onPress={() => { void run(async () => { const result = await api<{ id: string }>('/groups', { id: newId(), name: groupName, displayName }); setGroupName(''); setGroupId(result.id); }); }}>Create a private group</Button><Text style={U.small}>Up to 50 members per group. Share the invitation yourself with people you want to practise with.</Text></View>
    </>}
  </>;
}
