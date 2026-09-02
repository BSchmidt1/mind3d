import type { GraphStore } from './core/store';
import { deserializeGraph, serializeGraph, type MapMeta, type ViewMode } from './core/serialize';
import { emptyState } from './core/model';
import { createSnapshot, snapshotToState, type Snapshot } from './core/snapshot';
import type { Tour, Viewpoint } from './core/viewpoint';

export class MapSession {
  private path: string | null = null;
  private meta: MapMeta;
  private dirty = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  // Named checkpoints (F8), map metadata like MapMeta: held here, serialized
  // with the file, NOT command-tracked. Restoring one clears history (like Open).
  private snapshots: Snapshot[] = [];
  // Named camera poses + ordered tours (F9). Same status as snapshots: map
  // metadata, serialized with the file, not command-tracked.
  private viewpoints: Viewpoint[] = [];
  private tours: Tour[] = [];
  // 2D/3D layout mode (F12). Map metadata like the above: serialized with the
  // file, not command-tracked. Applying it to the view (View3D.setDims) is the
  // caller's job (main.ts orchestrates on open/new/toggle); the session only
  // holds and persists the value. Defaults to '3d' for any file that predates it.
  private mode: ViewMode = '3d';

  // The extras block written on every save/recovery. Centralized so the three
  // serialize call sites (autosave, quit-save, manual save) stay in sync as the
  // optional set grows.
  private extras(): { snapshots: Snapshot[]; viewpoints: Viewpoint[]; tours: Tour[]; mode: ViewMode } {
    return {
      snapshots: this.snapshots,
      viewpoints: this.viewpoints,
      tours: this.tours,
      mode: this.mode
    };
  }

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
              const json = serializeGraph(this.store.state, this.meta, this.extras());
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
            const json = serializeGraph(this.store.state, this.meta, this.extras());
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
    this.viewpoints = [];
    this.tours = [];
    this.mode = '3d';
    this.store.loadState(emptyState());
    this.dirty = false;
    this.report();
    return true;
  }

  async open(): Promise<void> {
    const res = await window.mind3d.openMap();
    if (res === null) return;
    // deserializeGraph accepts v1 or v2 and throws with a precise message on a
    // bad file. Missing optional sections upgrade in memory to []: a v1 file has
    // none of them; an F8-era v2 file has snapshots but no viewpoints/tours.
    const { state, meta, snapshots, viewpoints, tours, mode } = deserializeGraph(res.json);
    this.path = res.path;
    this.meta = meta;
    this.snapshots = snapshots;
    this.viewpoints = viewpoints;
    this.tours = tours;
    this.mode = mode;
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
    const json = serializeGraph(this.store.state, this.meta, this.extras());
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

  // --- 2D/3D mode (F12) ---
  // The persisted layout mode. `getMode` is read by main.ts on open/new to
  // apply it to View3D; `setMode` is the user toggle, which marks the map dirty
  // so the change is written by the next save (manual/autosave/quit).

  getMode(): ViewMode {
    return this.mode;
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.dirty = true;
    this.report();
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

  // --- viewpoints + tours (F9) ---
  // Named camera poses and ordered tours, persisted with the map. Adding one
  // marks the session dirty so the next save (manual, autosave, quit) writes it.
  // The controller builds the Viewpoint/Tour (it owns View3D + selection); the
  // session validates the shape and holds the list. Neither is command-tracked.

  addViewpoint(vp: Viewpoint): void {
    if (vp.name.trim() === '') throw new Error('viewpoint name must not be empty');
    this.viewpoints.push(vp);
    this.dirty = true;
    this.report();
  }

  listViewpoints(): Viewpoint[] {
    return [...this.viewpoints];
  }

  getViewpoint(id: string): Viewpoint {
    const vp = this.viewpoints.find((v) => v.id === id);
    if (!vp) throw new Error(`getViewpoint: no such viewpoint "${id}"`);
    return vp;
  }

  addTour(tour: Tour): void {
    if (tour.name.trim() === '') throw new Error('tour name must not be empty');
    if (tour.stops.length === 0) throw new Error('tour must have at least one stop');
    this.tours.push(tour);
    this.dirty = true;
    this.report();
  }

  listTours(): Tour[] {
    return [...this.tours];
  }
}
