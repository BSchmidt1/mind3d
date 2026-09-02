import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { Proposal } from '../core/proposal';
import type { View3D } from './view3d';
import { notify } from './notify';

// The UI half of the shared proposal engine (F3b): a floating card showing a
// proposal's summary + human-readable op list + Accept/Reject, with the
// proposed adds ghosted (translucent) in the 3D view. Ask (F4), Import (F5),
// and Voice (F6) all reuse this. The ghost is a pure preview — only Accept
// mutates the store, and it does so via the proposal's single composite
// command, so the whole batch is one undo.
export class ProposalPanel {
  private current: Proposal | null = null;
  private anchorId: string | null = null;

  constructor(
    private container: HTMLElement,
    private store: GraphStore,
    private selection: Selection,
    private view3d: View3D
  ) {
    // Route markdown links (in an `answer` block) through the allowlisted
    // openExternal IPC, mirroring DetailPanel — a bare <a> click would
    // otherwise be a dead link (window navigation is blocked in main).
    this.container.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const a = target.closest('a');
      if (!a || !this.container.contains(a)) return;
      ev.preventDefault();
      const href = a.getAttribute('href');
      if (href === null) return;
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return;
      }
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        void window.mind3d.openExternal(href);
      }
    });
  }

  get hidden(): boolean {
    return this.container.hidden;
  }

  show(proposal: Proposal, opts?: { answer?: string | null }): void {
    // Replace, don't stack: if a proposal preview is already open, clear its
    // ghost first so the prior ghost's pendingSpawn seeds don't leak. Ask (F4)
    // and Import (F5) may show a second proposal without an accept/reject
    // between them.
    if (this.current !== null) this.view3d.clearGhost();
    const anchor = this.selection.get();
    this.current = proposal;
    this.anchorId = anchor;
    this.view3d.showGhost({
      nodes: proposal.newNodes,
      links: proposal.newEdges.map((e) => ({ source: e.source, target: e.target })),
      anchorId: anchor
    });

    this.container.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'proposal-summary';
    summary.textContent = proposal.summary;
    this.container.appendChild(summary);

    const answer = opts?.answer;
    if (answer !== undefined && answer !== null && answer !== '') {
      this.container.appendChild(this.markdownBlock(answer));
    }

    const ul = document.createElement('ul');
    ul.className = 'proposal-ops';
    for (const line of proposal.humanOps) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    this.container.appendChild(ul);

    this.container.appendChild(
      this.actionBar([
        { label: 'Accept', className: 'proposal-accept', run: () => this.accept() },
        { label: 'Reject', className: 'proposal-reject', run: () => this.reject() }
      ])
    );
    this.container.hidden = false;
  }

  // Text-only reply (no structural change): sanitized markdown + a single OK.
  showAnswer(text: string): void {
    this.current = null;
    this.anchorId = null;
    this.view3d.clearGhost();
    this.container.innerHTML = '';
    this.container.appendChild(this.markdownBlock(text === '' ? '(no answer)' : text));
    this.container.appendChild(
      this.actionBar([{ label: 'OK', className: 'proposal-accept', run: () => this.hide() }])
    );
    this.container.hidden = false;
  }

  hide(): void {
    this.container.hidden = true;
    this.container.innerHTML = '';
    this.current = null;
    this.anchorId = null;
    this.view3d.clearGhost();
  }

  // Palette "dismiss-proposal": reject a live proposal, else just hide.
  dismiss(): void {
    if (this.current) this.reject();
    else this.hide();
  }

  private accept(): void {
    const proposal = this.current;
    if (proposal === null) return;
    const anchor = this.anchorId;
    // Turn the preview off before mutating so the real nodes (same ids) get a
    // clean placement from spawnNear rather than colliding with ghost sims.
    this.view3d.clearGhost();
    this.view3d.spawnNear(proposal.newNodeIds, anchor);
    try {
      this.store.apply(proposal.command);
    } catch (e) {
      // A referenced existing node may have been deleted while the card was
      // open; the composite rolls back atomically so the store stays
      // consistent — surface the error and close the card cleanly.
      notify.error(`proposal: could not apply — ${(e as Error).message}`);
      this.hide();
      return;
    }
    if (proposal.rootId !== null) {
      this.selection.set(proposal.rootId);
      this.view3d.flyTo(proposal.rootId);
    }
    notify.success(proposal.summary);
    this.hide();
  }

  private reject(): void {
    this.view3d.clearGhost();
    notify.info('proposal discarded');
    this.hide();
  }

  private markdownBlock(md: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'proposal-answer markdown';
    el.innerHTML = DOMPurify.sanitize(marked.parse(md, { async: false }));
    return el;
  }

  private actionBar(
    buttons: { label: string; className: string; run: () => void }[]
  ): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'proposal-actions';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.className;
      btn.textContent = b.label;
      btn.addEventListener('click', b.run);
      bar.appendChild(btn);
    }
    return bar;
  }
}
