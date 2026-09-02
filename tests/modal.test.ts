import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { confirmModal, closeOtherModals } from '../src/renderer/src/ui/modal';

// confirmModal builds/removes a few elements and focuses a button; it never
// reads layout. vitest runs in the node environment (no jsdom dependency), so
// we install just enough of `document` to exercise the real code path — in
// particular the re-entrancy guard (Minor 1). modal.ts touches `document` only
// at call time, so importing it in node is fine.
class FakeEl {
  className = '';
  id = '';
  textContent = '';
  private readonly kids: FakeEl[] = [];
  appendChild(c: FakeEl): FakeEl { this.kids.push(c); return c; }
  addEventListener(): void {}
  removeEventListener(): void {}
  focus(): void {}
  remove(): void {}
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    body: new FakeEl(),
    createElement: (): FakeEl => new FakeEl(),
    get activeElement(): null { return null; }
  };
});

afterEach(() => {
  // Drop any modal still registered so a leak can't bleed into the next test.
  closeOtherModals('__sweep__');
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe('confirmModal', () => {
  test('a second confirmModal while one is open replaces the first: the first resolves false, neither rejects (Minor 1)', async () => {
    const first = confirmModal('first');
    // Under the old code this rejected with `duplicate modal id "app-modal"`
    // (and left `first` pending forever); the guard must make it clean.
    const second = confirmModal('second');

    // Opening the second cancels the first.
    await expect(first).resolves.toBe(false);

    // The second is still open; sweep it so nothing leaks, then confirm it too
    // settles cleanly (false), i.e. it never rejected.
    closeOtherModals('__sweep__');
    await expect(second).resolves.toBe(false);
  });

  test('confirmModal resolves once and stays registered until settled', async () => {
    const p = confirmModal('lone', { okLabel: 'Yes', cancelLabel: 'No' });
    // A coordinator sweep (e.g. another modal opening) cancels it → false.
    closeOtherModals('__sweep__');
    await expect(p).resolves.toBe(false);
  });
});
