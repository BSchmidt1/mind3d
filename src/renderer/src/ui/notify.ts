import { ToastStore, type ToastKind } from '../core/toasts';

export interface ProgressHandle {
  update(kind: ToastKind, message: string): void;
  done(kind: ToastKind, message: string): void;
  dismiss(): void;
}

const store = new ToastStore();

// Mounts the DOM host for the module-level toast store and starts the prune
// interval. Call once at boot.
export function initNotify(host: HTMLElement): void {
  store.subscribe(({ toasts }) => {
    host.innerHTML = '';
    for (const t of toasts) {
      const el = document.createElement('div');
      el.className = `toast toast-${t.kind}`;
      el.textContent = t.message;
      el.addEventListener('click', () => store.dismiss(t.id));
      host.appendChild(el);
    }
  });
  setInterval(() => store.prune(Date.now()), 500);
}

export const notify = {
  info(message: string): string {
    return store.add('info', message);
  },
  success(message: string): string {
    return store.add('success', message);
  },
  error(message: string): string {
    return store.add('error', message);
  },
  // A sticky toast (no auto-expiry) the caller can update in place and
  // finish with a re-armed ttl — for a multi-step async flow (voice/save/ask).
  progress(kind: ToastKind, message: string): ProgressHandle {
    const id = store.add(kind, message, null);
    return {
      update: (k, m) => store.update(id, k, m, null),
      done: (k, m) => store.update(id, k, m, 4000),
      dismiss: () => store.dismiss(id)
    };
  }
};
