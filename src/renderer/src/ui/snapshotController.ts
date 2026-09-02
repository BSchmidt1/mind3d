import type { GraphStore } from '../core/store';
import type { View3D } from './view3d';
import type { MapSession } from '../mapSession';
import type { CommandRegistry } from '../core/commandRegistry';
import { diffStates, snapshotToState, type GraphDiff, type Snapshot } from '../core/snapshot';
import { notify } from './notify';

// Snapshots + visual diff (F8). Registers Ctrl+K palette commands (the
// anti-top-bar-bloat mechanism) rather than adding buttons:
//   snapshot-save     — name a checkpoint of the current graph
//   snapshot-compare  — pick a checkpoint → color the diff vs current in 3D
//   snapshot-restore  — pick a checkpoint → replace the current map (clears history)
//   diff-clear        — leave the diff view
// Checkpoints live on the MapSession (serialized with the file); the diff view
// lives in View3D (a method, never DOM inside #view3d).

export interface SnapshotDeps {
  store: GraphStore;
  view3d: View3D;
  registry: CommandRegistry;
  session: MapSession;
}

function summarizeDiff(name: string, d: GraphDiff): string {
  return (
    `diff vs "${name}": nodes +${d.nodesAdded.length} ~${d.nodesChanged.length} -${d.nodesRemoved.length}` +
    ` · edges +${d.edgesAdded.length} ~${d.edgesChanged.length} -${d.edgesRemoved.length}`
  );
}

export function installSnapshots(deps: SnapshotDeps): void {
  const { store, view3d, registry, session } = deps;
  const picker = new SnapshotPicker();
  const namePrompt = new NamePrompt();

  registry.register({
    id: 'snapshot-save',
    title: 'Snapshot: save checkpoint…',
    hint: 'named checkpoint',
    run: () =>
      namePrompt.open('Name this snapshot', (name) => {
        try {
          const snap = session.addSnapshot(name);
          notify.success(`snapshot "${snap.name}" saved`);
        } catch (err) {
          notify.error(`snapshot: ${(err as Error).message}`);
        }
      })
  });

  registry.register({
    id: 'snapshot-compare',
    title: 'Snapshot: compare with current…',
    hint: 'visual diff',
    run: () => {
      const snaps = session.listSnapshots();
      if (snaps.length === 0) {
        notify.info('no snapshots yet — save one first');
        return;
      }
      picker.open('Compare snapshot → current', snaps, (snap) => {
        const before = snapshotToState(snap);
        const diff = diffStates(before, store.state);
        view3d.showDiff(diff, before);
        notify.info(summarizeDiff(snap.name, diff));
      });
    },
    when: () => session.listSnapshots().length > 0
  });

  registry.register({
    id: 'snapshot-restore',
    title: 'Snapshot: restore…',
    hint: 'replace current map',
    run: () => {
      const snaps = session.listSnapshots();
      if (snaps.length === 0) {
        notify.info('no snapshots yet — save one first');
        return;
      }
      picker.open('Restore snapshot (replaces current map)', snaps, (snap) => {
        if (!confirm(`Restore "${snap.name}"? This replaces the current map and clears undo history.`)) return;
        try {
          view3d.clearDiff();
          session.restoreSnapshot(snap.id);
          notify.success(`restored snapshot "${snap.name}"`);
        } catch (err) {
          notify.error(`snapshot: ${(err as Error).message}`);
        }
      });
    },
    when: () => session.listSnapshots().length > 0
  });

  registry.register({
    id: 'diff-clear',
    title: 'Snapshot: clear diff view',
    run: () => view3d.clearDiff(),
    when: () => view3d.diffActive()
  });
}

// A single-line name entry overlay (mounted on document.body). The full F14
// modal does not exist yet; this self-contained box is the inline prompt the
// plan calls for. Enter or Save submits, Escape / backdrop cancels.
class NamePrompt {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly label: HTMLDivElement;
  private onSubmit: ((name: string) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'name-prompt';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="name-card">
        <div class="name-label"></div>
        <input class="name-input" type="text" placeholder="e.g. before big refactor" />
        <div class="name-actions">
          <button class="name-cancel">Cancel</button>
          <button class="name-go">Save</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.input = this.root.querySelector('.name-input')!;
    this.label = this.root.querySelector('.name-label')!;

    this.root.querySelector('.name-cancel')!.addEventListener('click', () => this.close());
    this.root.querySelector('.name-go')!.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      // Keep global/top-bar handlers from reacting to typing here.
      ev.stopPropagation();
    });
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
  }

  open(label: string, onSubmit: (name: string) => void): void {
    this.label.textContent = label;
    this.onSubmit = onSubmit;
    this.input.value = '';
    this.root.hidden = false;
    this.input.focus();
  }

  private close(): void {
    this.root.hidden = true;
    this.onSubmit = null;
  }

  private submit(): void {
    const name = this.input.value.trim();
    if (name === '') {
      notify.info('snapshot: enter a name');
      return;
    }
    const cb = this.onSubmit;
    this.close();
    cb?.(name);
  }
}

// A pick-one-snapshot overlay (mounted on document.body): a titled list of
// checkpoints (name + timestamp), each row clickable. Escape / backdrop cancels.
class SnapshotPicker {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'snapshot-picker';
    this.root.hidden = true;
    this.root.tabIndex = -1; // focusable so the overlay captures Escape
    this.root.innerHTML = `
      <div class="snapshot-card">
        <div class="snapshot-title"></div>
        <div class="snapshot-list"></div>
        <div class="snapshot-actions"><button class="snapshot-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(this.root);
    this.titleEl = this.root.querySelector('.snapshot-title')!;
    this.listEl = this.root.querySelector('.snapshot-list')!;

    this.root.querySelector('.snapshot-cancel')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
  }

  open(title: string, snaps: Snapshot[], onPick: (snap: Snapshot) => void): void {
    this.titleEl.textContent = title;
    this.listEl.innerHTML = '';
    // Newest first so the most recent checkpoint is at the top.
    for (const snap of [...snaps].reverse()) {
      const row = document.createElement('div');
      row.className = 'snapshot-row';
      const name = document.createElement('span');
      name.className = 'snapshot-name';
      name.textContent = snap.name;
      const when = document.createElement('span');
      when.className = 'snapshot-when';
      when.textContent = `${snap.nodes.length} nodes · ${formatWhen(snap.createdAt)}`;
      row.appendChild(name);
      row.appendChild(when);
      row.addEventListener('click', () => {
        this.close();
        onPick(snap);
      });
      this.listEl.appendChild(row);
    }
    this.root.hidden = false;
    this.root.focus();
  }

  private close(): void {
    this.root.hidden = true;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
