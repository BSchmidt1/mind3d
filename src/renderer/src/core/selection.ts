export class Selection {
  private id: string | null = null;
  private listeners = new Set<(id: string | null) => void>();

  get(): string | null {
    return this.id;
  }

  set(id: string | null): void {
    if (id === this.id) return;
    this.id = id;
    for (const fn of this.listeners) fn(id);
  }

  subscribe(fn: (id: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
