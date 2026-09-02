import { fuzzyScore } from './fuzzy';

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  run: () => void | Promise<void>;
  when?: () => boolean; // omitted => always enabled
}

export class CommandRegistry {
  private commands = new Map<string, PaletteCommand>();

  register(cmd: PaletteCommand): () => void {
    if (this.commands.has(cmd.id)) throw new Error(`duplicate command id "${cmd.id}"`);
    this.commands.set(cmd.id, cmd);
    return () => this.unregister(cmd.id);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  list(): PaletteCommand[] {
    return [...this.commands.values()].filter((c) => c.when?.() !== false);
  }

  filter(query: string): PaletteCommand[] {
    if (query === '') return this.list();
    // A negative fuzzyScore means the query only matched as a scattered,
    // heavily-penalized subsequence (e.g. "a" inside "Beta") — too weak a
    // signal for a command palette. Only non-negative scores count as a hit.
    return this.list()
      .map((c) => ({ c, s: fuzzyScore(query, `${c.title} ${c.hint ?? ''}`) }))
      .filter((r): r is { c: PaletteCommand; s: number } => r.s !== null && r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
  }
}
