import { describe, expect, test } from 'vitest';
import { CommandRegistry } from '../src/renderer/src/core/commandRegistry';

const cmd = (id: string, title: string, when?: () => boolean) =>
  ({ id, title, run: () => {}, when });

describe('CommandRegistry', () => {
  test('register + list; duplicate id throws; unregister removes', () => {
    const r = new CommandRegistry();
    const off = r.register(cmd('a', 'Add node'));
    r.register(cmd('b', 'Open map'));
    expect(r.list().map((c) => c.id)).toEqual(['a', 'b']);
    expect(() => r.register(cmd('a', 'dup'))).toThrow(/duplicate command id "a"/);
    off();
    expect(r.list().map((c) => c.id)).toEqual(['b']);
  });
  test('when() gates list and filter', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha', () => false));
    r.register(cmd('b', 'Beta', () => true));
    expect(r.list().map((c) => c.id)).toEqual(['b']);
    expect(r.filter('a').map((c) => c.id)).toEqual([]);  // Alpha gated out even though it fuzzy-matches
  });
  test('filter ranks by fuzzy; empty query returns all enabled', () => {
    const r = new CommandRegistry();
    r.register(cmd('open', 'Open map'));
    r.register(cmd('opacity', 'Toggle opacity'));
    const hits = r.filter('opm');   // "OpenMap" contiguous-ish beats "Toggle opacity"
    expect(hits[0]!.id).toBe('open');
    expect(r.filter('').map((c) => c.id)).toEqual(['open', 'opacity']);
  });
});
