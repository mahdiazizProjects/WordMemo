import { cloudState, mergeStates, stableJson } from './sync-merge.ts';
import type { AppState } from './types';

export type Disk = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export type RemoteSnapshot = { state: AppState | null; revision: number; updatedAt?: string };
export type Cloud = { get(): Promise<RemoteSnapshot>; put(state: AppState, revision: number): Promise<RemoteSnapshot> };
type RecordData = { state: AppState; base: AppState; revision: number; imported?: string; pendingImport?: string };
export type StoreView = { state: AppState; scope: string; ready: boolean; status: 'device' | 'saving' | 'saved' | 'waiting' | 'error'; error: string; updatedAt?: string; guest?: AppState };
const equal = (a: AppState, b: AppState) => stableJson(cloudState(a)) === stableJson(cloudState(b));
const keyFor = (scope: string) => `wordmemo.v2.${scope}`;

/** State and write queues are always bound to a scope, including in-flight I/O. */
export class LearningStore {
  private disk: Disk;
  private fresh: () => AppState;
  private parse: (raw: string) => AppState;
  private record: RecordData;
  private cloud?: Cloud;
  private epoch = 0;
  private running?: { epoch: number; promise: Promise<void> };
  private writes = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private view: StoreView;
  constructor(disk: Disk, fresh: () => AppState, parse: (raw: string) => AppState) {
    this.disk = disk; this.fresh = fresh; this.parse = parse;
    this.record = { state: fresh(), base: fresh(), revision: 0 };
    this.view = { state: this.record.state, scope: 'guest', ready: false, status: 'device', error: '' };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.view;
  private emit(patch: Partial<StoreView> = {}) { this.view = { ...this.view, state: this.record.state, ...patch }; for (const f of this.listeners) f(); }
  private async read(scope: string): Promise<RecordData> {
    const raw = await this.disk.getItem(keyFor(scope));
    if (raw) {
      const x = JSON.parse(raw);
      if (!Number.isSafeInteger(x.revision) || x.revision < 0) throw new Error('Invalid saved revision');
      return { state: this.parse(JSON.stringify(x.state)), base: this.parse(JSON.stringify(x.base)), revision: x.revision,
        ...(typeof x.imported === 'string' ? { imported: x.imported } : {}), ...(typeof x.pendingImport === 'string' ? { pendingImport: x.pendingImport } : {}) };
    }
    const legacy = scope === 'guest' ? await this.disk.getItem('wordmemo.v1') : null;
    return { state: legacy ? this.parse(legacy) : this.fresh(), base: this.fresh(), revision: 0 };
  }
  async open(scope: string, cloud?: Cloud) {
    const epoch = ++this.epoch;
    clearTimeout(this.timer); this.cloud = cloud;
    this.record = { state: this.fresh(), base: this.fresh(), revision: 0 };
    this.emit({ scope, ready: false, error: '', guest: undefined, updatedAt: undefined, status: cloud ? 'saving' : 'device' });
    try {
      await this.writes.catch(() => {});
      const record = await this.read(scope);
      let guest: AppState | undefined;
      if (cloud) {
        try { const g = (await this.read('guest')).state; if (!equal(g, this.fresh()) && record.imported !== stableJson(g) && record.pendingImport !== stableJson(g)) guest = g; }
        catch { /* A damaged guest copy never prevents opening an account. */ }
      }
      if (epoch !== this.epoch) return;
      this.record = record; this.emit({ ready: true, guest });
      if (cloud) await this.sync();
    } catch {
      if (epoch === this.epoch) this.emit({ error: 'Saved progress could not be opened. The saved copy is untouched. Try again.', status: 'error' });
    }
  }
  private persist() {
    const key = keyFor(this.view.scope), value = JSON.stringify(this.record), epoch = this.epoch;
    this.writes = this.writes.catch(() => {}).then(() => this.disk.setItem(key, value));
    void this.writes.catch(() => { if (epoch === this.epoch) this.emit({ error: 'This browser could not save changes. Keep the app open until cloud saving succeeds, or export a backup.', status: 'error' }); });
    return this.writes;
  }
  update = (action: AppState | ((state: AppState) => AppState)): AppState => {
    if (!this.view.ready) return this.record.state;
    const state = typeof action === 'function' ? action(this.record.state) : action;
    if (state === this.record.state) return state;
    this.record = { ...this.record, state };
    this.emit({ status: this.cloud ? 'saving' : 'device' }); void this.persist();
    if (this.cloud) { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.sync(); }, 600); }
    return state;
  };
  async importGuest() {
    const guest = this.view.guest;
    if (!guest || !this.cloud) return;
    this.record.pendingImport = stableJson(guest);
    // Retain account preferences; add only the guest's learning and collections.
    const imported = mergeStates(this.fresh(), guest, this.record.state);
    this.update({ ...imported, settings: this.record.state.settings });
    this.emit({ guest: undefined });
    await this.sync();
  }
  keepGuestSeparate() { if (this.view.guest) this.record.imported = stableJson(this.view.guest); this.emit({ guest: undefined }); void this.persist(); }
  flush = () => this.writes;
  sync = (): Promise<void> => {
    if (!this.cloud || !this.view.ready) return Promise.resolve();
    clearTimeout(this.timer);
    const epoch = this.epoch, cloud = this.cloud;
    if (this.running?.epoch === epoch) return this.running.promise;
    const promise = this.performSync(epoch, cloud).finally(() => { if (this.running?.epoch === epoch) this.running = undefined; });
    this.running = { epoch, promise }; return promise;
  };
  private async performSync(epoch: number, cloud: Cloud) {
    try {
      for (let attempt = 0; attempt < 5 && epoch === this.epoch; attempt++) {
        const remote = await cloud.get();
        if (epoch !== this.epoch) return;
        const remoteState = remote.state ?? this.fresh();
        // Validate data read from the API before ever replacing local state.
        const checked = this.parse(JSON.stringify(remoteState));
        const merged = mergeStates(this.record.base, this.record.state, checked);
        this.record = { ...this.record, state: merged, base: checked, revision: remote.revision };
        this.emit(); await this.persist();
        if (epoch !== this.epoch) return;
        if (remote.state && equal(merged, checked)) {
          this.confirmImport(); this.emit({ status: 'saved', error: '', updatedAt: remote.updatedAt }); await this.persist(); return;
        }
        this.emit({ status: 'saving', error: '' });
        const sent = cloudState(this.record.state), pendingImport = this.record.pendingImport;
        let saved: RemoteSnapshot;
        try { saved = await cloud.put(sent, remote.revision); }
        catch (e) { if ((e as { status?: number }).status === 409) continue; throw e; }
        if (epoch !== this.epoch) return;
        this.record = { ...this.record, base: sent, revision: saved.revision };
        if (pendingImport && this.record.pendingImport === pendingImport) this.confirmImport();
        const dirty = !equal(this.record.state, sent);
        this.emit({ status: dirty ? 'saving' : 'saved', error: '', updatedAt: saved.updatedAt }); await this.persist();
        if (!dirty) return;
      }
      if (epoch === this.epoch) this.emit({ status: 'waiting', error: 'Changes are queued. Tap Save now to retry.' });
    } catch (e) {
      if (epoch === this.epoch) this.emit({ status: 'waiting', error: (e as { status?: number }).status === 401 ? 'Sign in again to save your queued progress.' : e instanceof Error ? e.message : 'Cloud saving is waiting for a connection. Your changes are queued.' });
    }
  }
  private confirmImport() { if (this.record.pendingImport) { this.record.imported = this.record.pendingImport; delete this.record.pendingImport; } }
}
