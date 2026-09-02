// In-app modal utilities (F14).
//
// Two concerns live here:
//   1. `confirmModal` — a styled, non-blocking, Promise-based replacement for
//      the native `confirm()`. Native confirm/prompt/alert BLOCK the renderer
//      and can render invisibly under some window managers (and are invisible
//      to the E2E harness); this in-app modal fixes both.
//   2. A single-modal coordinator (`registerModal` / `closeOtherModals`). Many
//      overlays (the Ask input, Import modal, Voice confirm, snapshot/viewpoint
//      pickers, the command palette, and this confirm modal) all mount on
//      document.body at similar z-index. With no coordination two could overlap.
//      Each overlay registers an idempotent closer once and calls
//      `closeOtherModals(id)` at the top of its open path, so opening any one
//      closes every other — they become mutually exclusive.

// --- single-modal coordinator ---

type ModalCloser = () => void;

const openers = new Map<string, ModalCloser>();

// Register a body-mounted overlay's closer under a stable id. The closer MUST
// be idempotent (a no-op when the overlay is already hidden) — closeOtherModals
// calls every registered closer regardless of current visibility. Throws on a
// duplicate id (fail-fast: two overlays sharing an id would clobber each other).
export function registerModal(id: string, close: ModalCloser): void {
  if (openers.has(id)) throw new Error(`duplicate modal id "${id}"`);
  openers.set(id, close);
}

// Close every registered overlay except `except`. Call at the top of an
// overlay's open path so it becomes the only one on screen.
export function closeOtherModals(except: string): void {
  for (const [id, close] of openers) {
    if (id !== except) close();
  }
}

// --- confirm modal ---

const CONFIRM_MODAL_ID = 'app-modal';

export interface ConfirmModalOptions {
  okLabel?: string;
  cancelLabel?: string;
}

// A styled confirm dialog. Resolves true on OK (click, or Enter while OK is
// focused), false on Cancel / Escape / scrim click. Both current callers are
// DESTRUCTIVE (discard map, restore snapshot), so CANCEL is focused by default
// and Enter therefore does NOT confirm — the user must click OK or Tab to it
// first. Focus is trapped between the two buttons (Tab cycles); the overlay is
// removed from the DOM on settle. Only one is ever open at a time (it closes
// any other modal on open, and any later modal closes it).
export function confirmModal(message: string, opts?: ConfirmModalOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Re-entrancy guard: closeOtherModals below EXCLUDES this id, so a confirm
    // already on screen would survive and make the registerModal call throw
    // `duplicate modal id "app-modal"`. Settle the prior confirm (cancel →
    // false) and drop its registration first, so this call cleanly REPLACES it
    // rather than throwing (which, on the snapshot-restore await, would surface
    // as an unhandled rejection). Not reachable in the current wiring, but this
    // is a shared primitive future code will reuse.
    const prior = openers.get(CONFIRM_MODAL_ID);
    if (prior) prior();
    closeOtherModals(CONFIRM_MODAL_ID);

    const root = document.createElement('div');
    root.id = CONFIRM_MODAL_ID;

    const card = document.createElement('div');
    card.className = 'app-modal-card';

    const msg = document.createElement('div');
    msg.className = 'app-modal-message';
    msg.textContent = message; // dynamic text via textContent (no XSS surface)
    card.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'app-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'app-modal-cancel';
    cancelBtn.textContent = opts?.cancelLabel ?? 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'app-modal-ok';
    okBtn.textContent = opts?.okLabel ?? 'OK';
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(actions);
    root.appendChild(card);

    let settled = false;
    const settle = (result: boolean): void => {
      if (settled) return;
      settled = true;
      // Drop the coordinator registration BEFORE removing the node so a
      // closeOtherModals triggered by whatever opens next can't call a
      // resolve on an already-settled promise (settle guards that too).
      openers.delete(CONFIRM_MODAL_ID);
      root.remove();
      resolve(result);
    };

    // A later modal opening (or an explicit coordinator sweep) cancels this one.
    registerModal(CONFIRM_MODAL_ID, () => settle(false));

    cancelBtn.addEventListener('click', () => settle(false));
    okBtn.addEventListener('click', () => settle(true));
    root.addEventListener('click', (ev) => {
      if (ev.target === root) settle(false); // scrim click cancels
    });
    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        // Enter activates the FOCUSED button, not OK unconditionally — so a
        // destructive confirm (Cancel focused by default) is not confirmed by a
        // stray Enter. Tabbing to OK (or clicking it) is required to confirm.
        settle(document.activeElement === okBtn);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        settle(false);
      } else if (ev.key === 'Tab') {
        // Minimal focus trap: keep focus on the two buttons.
        ev.preventDefault();
        const active = document.activeElement;
        (active === okBtn ? cancelBtn : okBtn).focus();
      }
      // Don't let the keystroke reach global/top-bar handlers behind the modal.
      ev.stopPropagation();
    });

    document.body.appendChild(root);
    // Focus CANCEL by default: both callers are destructive, so the safe action
    // is the default and Enter (which activates the focused button) cancels.
    cancelBtn.focus();
  });
}
