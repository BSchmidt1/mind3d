import { describe, expect, test } from 'vitest';
import { registerModal, closeOtherModals } from '../src/renderer/src/ui/modal';

// The single-modal coordinator (F14). Pure registry logic — no DOM needed
// (confirmModal, which does touch the DOM, is not exercised here). Each test
// file gets a fresh module instance under vitest isolation, so the module-level
// registry starts empty.
describe('single-modal coordinator', () => {
  test('closeOtherModals closes every registered modal except the named one', () => {
    const closed: string[] = [];
    registerModal('coord-a', () => closed.push('a'));
    registerModal('coord-b', () => closed.push('b'));
    registerModal('coord-c', () => closed.push('c'));

    closeOtherModals('coord-b');
    expect([...closed].sort()).toEqual(['a', 'c']);

    // Idempotent closers: a second sweep re-invokes them (they no-op on hidden
    // overlays in real use) — here we just confirm the "except" filter holds.
    closed.length = 0;
    closeOtherModals('coord-a');
    expect([...closed].sort()).toEqual(['b', 'c']);
  });

  test('duplicate modal id throws (fail-fast)', () => {
    registerModal('coord-dup', () => {});
    expect(() => registerModal('coord-dup', () => {})).toThrow(/duplicate modal id "coord-dup"/);
  });
});
