import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ToastStore, type ToastEvent } from '../src/renderer/src/core/toasts';

// `add`'s expiresAt is Date.now() + ttl (so a toast survives real wall-clock
// time in production, per ui/notify.ts's `setInterval(() => store.prune(Date.now()))`).
// The plan's test values (ttl 100/50, prune(60)) only make sense against a
// deterministic clock, so time is pinned here rather than left to the real
// epoch — the assertions below are otherwise exactly as specified.
describe('ToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('add appends, list preserves order, subscribe fires', () => {
    const s = new ToastStore();
    const events: ToastEvent[] = [];
    s.subscribe((e) => events.push(e));
    const a = s.add('info', 'a', 100);
    const b = s.add('error', 'b', null);
    expect(s.list().map((t) => t.message)).toEqual(['a', 'b']);
    expect(s.list()[1]!.expiresAt).toBeNull();
    expect(events.at(-1)!.toasts).toHaveLength(2);
    expect(typeof a).toBe('string'); expect(a).not.toBe(b);
  });
  test('add with default ttl per kind', () => {
    const s = new ToastStore();
    s.add('info', 'x');            // expiresAt set (finite)
    s.add('error', 'y');
    const [i, e] = s.list();
    expect(i!.expiresAt).not.toBeNull();
    expect(e!.expiresAt).not.toBeNull();
  });
  test('update mutates in place; missing id throws', () => {
    const s = new ToastStore();
    const id = s.add('info', 'working', null);
    s.update(id, 'success', 'done', 10);
    expect(s.list()[0]!.kind).toBe('success');
    expect(s.list()[0]!.message).toBe('done');
    expect(() => s.update('nope', 'info', 'x')).toThrow(/no such toast "nope"/);
  });
  test('dismiss removes; prune removes only expired', () => {
    const s = new ToastStore();
    const a = s.add('info', 'a', 100);
    s.add('info', 'b', null);
    s.add('info', 'c', 50);
    expect(s.prune(60)).toEqual([expect.any(String)]);   // only c expired
    expect(s.list().map((t) => t.message)).toEqual(['a', 'b']);
    s.dismiss(a);
    expect(s.list().map((t) => t.message)).toEqual(['b']);
  });
});
