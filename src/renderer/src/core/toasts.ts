// Pure, DOM-free toast state. `ui/notify.ts` renders it; tests drive it
// directly with an injected `now` via `prune`.
export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  expiresAt: number | null;
}

export interface ToastEvent {
  toasts: Toast[];
}

const DEFAULT_TTL_MS: Record<ToastKind, number> = { info: 4000, success: 4000, error: 8000 };

export class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<(ev: ToastEvent) => void>();

  add(kind: ToastKind, message: string, ttlMs?: number | null): string {
    const id = crypto.randomUUID();
    const expiresAt = this.resolveExpiresAt(kind, ttlMs);
    this.toasts.push({ id, kind, message, expiresAt });
    this.emit();
    return id;
  }

  update(id: string, kind: ToastKind, message: string, ttlMs?: number | null): void {
    const idx = this.toasts.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`no such toast "${id}"`);
    const expiresAt = this.resolveExpiresAt(kind, ttlMs);
    this.toasts[idx] = { id, kind, message, expiresAt };
    this.emit();
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  prune(now: number): string[] {
    const removed: string[] = [];
    const kept: Toast[] = [];
    for (const t of this.toasts) {
      if (t.expiresAt !== null && t.expiresAt <= now) removed.push(t.id);
      else kept.push(t);
    }
    if (removed.length > 0) {
      this.toasts = kept;
      this.emit();
    }
    return removed;
  }

  list(): Toast[] {
    return [...this.toasts];
  }

  subscribe(fn: (ev: ToastEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private resolveExpiresAt(kind: ToastKind, ttlMs?: number | null): number | null {
    if (ttlMs === null) return null;
    const ttl = ttlMs ?? DEFAULT_TTL_MS[kind];
    return Date.now() + ttl;
  }

  private emit(): void {
    const ev: ToastEvent = { toasts: [...this.toasts] };
    for (const fn of this.listeners) fn(ev);
  }
}
