import type { GraphStore } from './core/store';
import { deserializeGraph, serializeGraph, type MapMeta } from './core/serialize';
import { emptyState } from './core/model';
import { createSnapshot, snapshotToState, type Snapshot } from './core/snapshot';

export class MapSession {
  private path: string | null = null;
  private meta: MapMeta;
  private dirty = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  // Named checkpoints (F8), map metadata like MapMeta: held here, serialized
  // with the file, NOT command-tracked. Restoring one clears history (like Open).
  private snapshots: Snapshot[] = [];

  constructor(
    private store: GraphStore,
    private onState: (label: string) => void
  ) {
    this.meta = this.freshMeta();
    store.subscribe(() => {
      this.dirty = true;
      this.report();
      if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
      this.autosaveTimer = setTimeout(() => {
        void (async (): Promise<void> => {
          try {
            if (this.path !== null && this.dirty) {
              await this.save();
            } else if (this.path === null && this.dirty) {
              const json = serializeGraph(this.store.state, this.meta, { snapshots: this.snapshots });
              await window.mind3d.saveRecovery(json);
              this.onState('(unsaved — recovery written)');
            }
          } catch (err) {
            this.onState(`ERROR: autosave failed: ${(err as Error).message}`);
          }
        })();
      }, 2000);
    });
    window.mind3d.onSaveRequested(() => {
      void (async (): Promise<void> => {
        try {
          // Commit a typed-but-unblurred edit (notes/tags/claude prompt)
          // into the store before checking dirty/serializing, same as
          // main.ts's Ctrl+S — otherwise closing the window mid-edit loses it.
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          if (this.path !== null && this.dirty) {
            await this.save();
          } else if (this.path === null && this.dirty) {
            const json = serializeGraph(this.store.state, this.meta, { snapshots: this.snapshots });
            await window.mind3d.saveRecovery(json);
          }
        } catch (err) {
          this.onState(`ERROR: quit-save failed: ${(err as Error).message}`);
        } finally {
          window.mind3d.saveDone();
        }
      })();
    });
    this.report();
  }

  private freshMeta(): MapMeta {
    const now = new Date().toISOString();
    return { name: 'untitled', createdAt: now, modifiedAt: now };
  }

  private report(): void {
    const file = this.path ?? '(unsaved)';
    this.onState(`${file}${this.dirty ? ' *' : ''}`);
  }

  newMap(): boolean {
    if (this.store.state.nodes.size > 0 && !confirm('Discard current map?')) return false;
    this.path = null;
    this.meta = this.freshMeta();
    this.snapshots = [];
    this.store.loadState(emptyState());
    this.dirty = false;
    this.report();
    return true;
  }

  async open(): Promise<void> {
    const res = await window.mind3d.openMap();
    if (res === null) return;
    // deserializeGraph accepts v1 or v2 and throws with a precise message on a
    // bad file; a v1 file (no snapshots) upgrades in memory to snapshots: [].
    const { state, meta, snapshots } = deserializeGraph(res.json);
    this.path = res.path;
    this.meta = meta;
    this.snapshots = snapshots;
    this.store.loadState(state);
    this.dirty = false;
    this.report();
  }

  async save(): Promise<void> {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.meta.modifiedAt = new Date().toISOString();
    if (this.path !== null) this.meta.name = this.path.replace(/^.*\//, '').replace(/\.json$/, '');
    const json = serializeGraph(this.store.state, this.meta, { snapshots: this.snapshots });
    const saved = await window.mind3d.saveMap(this.path, json);
    if (saved === null) return; // user cancelled save-as
    this.path = saved;
    this.dirty = false;
    this.report();
  }

  async getMapDir(): Promise<string> {
    if (this.path === null) return '/tmp';
    return window.mind3d.dirname(this.path);
  }

  // --- snapshots (F8) ---
  // Named checkpoints of the whole graph, persisted with the map. Adding or
  // restoring marks the session dirty so the change is written by the next
  // save (manual, autosave, or quit-save); a manual save writes regardless.

  addSnapshot(name: string): Snapshot {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('snapshot name must not be empty');
    const snap = createSnapshot(trimmed, this.store.state);
    this.snapshots.push(snap);
    this.dirty = true;
    this.report();
    return snap;
  }

  listSnapshots(): Snapshot[] {
    return [...this.snapshots];
  }

  restoreSnapshot(id: string): void {
    const snap = this.snapshots.find((s) => s.id === id);
    if (!snap) throw new Error(`restoreSnapshot: no such snapshot "${id}"`);
    // Like Open: replaces live state and clears undo/redo history. loadState's
    // structure event drives the dirty flag + autosave via the store subscriber.
    this.store.loadState(snapshotToState(snap));
    this.report();
  }
}
