import type { GraphStore } from './core/store';
import { deserializeGraph, serializeGraph, type MapMeta } from './core/serialize';
import { emptyState } from './core/model';

export class MapSession {
  private path: string | null = null;
  private meta: MapMeta;
  private dirty = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

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
              const json = serializeGraph(this.store.state, this.meta);
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
          if (this.path !== null && this.dirty) {
            await this.save();
          } else if (this.path === null && this.dirty) {
            const json = serializeGraph(this.store.state, this.meta);
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

  newMap(): void {
    if (this.store.state.nodes.size > 0 && !confirm('Discard current map?')) return;
    this.path = null;
    this.meta = this.freshMeta();
    this.store.loadState(emptyState());
    this.dirty = false;
    this.report();
  }

  async open(): Promise<void> {
    const res = await window.mind3d.openMap();
    if (res === null) return;
    const { state, meta } = deserializeGraph(res.json); // throws with precise message on bad file
    this.path = res.path;
    this.meta = meta;
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
    const json = serializeGraph(this.store.state, this.meta);
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
}
