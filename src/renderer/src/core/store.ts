import type { GraphState } from './model';
import { emptyState } from './model';
import type { ChangeKind, Command } from './commands';

export interface ChangeEvent {
  kind: ChangeKind;
  ids: string[];
  // The command's `name` (F14) so undo/redo can toast "Undid: <name>". For a
  // `loadState` (Open/snapshot restore) this is the literal 'loadState'.
  name: string;
  // How this change was produced. 'apply' covers a fresh command AND loadState
  // (both are non-reversal changes); 'undo'/'redo' drive the change toasts.
  // Additive fields: existing subscribers read only .kind/.ids and are
  // unaffected (verified across view3d, main, detailPanel, mapSession).
  source: 'apply' | 'undo' | 'redo';
}

export class GraphStore {
  state: GraphState = emptyState();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<(ev: ChangeEvent) => void>();

  subscribe(fn: (ev: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: ChangeEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  apply(cmd: Command): void {
    cmd.execute(this.state);
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.emit({ kind: cmd.kind, ids: cmd.ids, name: cmd.name, source: 'apply' });
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(this.state);
    this.redoStack.push(cmd);
    this.emit({ kind: cmd.kind, ids: cmd.ids, name: cmd.name, source: 'undo' });
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute(this.state);
    this.undoStack.push(cmd);
    this.emit({ kind: cmd.kind, ids: cmd.ids, name: cmd.name, source: 'redo' });
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  loadState(state: GraphState): void {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ kind: 'structure', ids: [], name: 'loadState', source: 'apply' });
  }
}
