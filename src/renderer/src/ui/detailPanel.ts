import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import { setAttachedFile, setColor, setNotes, setTags } from '../core/commands';
import { mountClaudeSection } from './claudeSection';

export class DetailPanel {
  private shownId: string | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private container: HTMLElement,
    private store: GraphStore,
    private selection: Selection,
    private getFallbackCwd: () => Promise<string>
  ) {
    selection.subscribe(() => this.render());
    store.subscribe((ev) => {
      const sel = this.selection.get();
      if (sel !== null && (ev.ids.includes(sel) || ev.kind === 'structure')) this.scheduleRender();
    });
    this.render();
  }

  // Defer a store-triggered rebuild by one macrotask so a native click already
  // in flight on a button inside the panel (e.g. mousedown on Run triggering
  // a synchronous blur -> store update) can still deliver its click event
  // before the DOM under it is torn down and rebuilt.
  private scheduleRender(): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 0);
  }

  // Flush an uncommitted edit of the previously-shown node before the panel
  // rebuilds for a different selection (e.g. a canvas click that doesn't
  // blur the notes/tags inputs). No-op if nothing was shown, or if that
  // node was deleted in the meantime.
  private flushPendingEdits(): void {
    const oldId = this.shownId;
    if (oldId === null) return;
    const oldNode = this.store.state.nodes.get(oldId);
    if (!oldNode) return;

    const notesEl = this.container.querySelector<HTMLTextAreaElement>('#dp-notes');
    if (notesEl && notesEl.value !== oldNode.notes) {
      this.store.apply(setNotes(oldId, notesEl.value));
    }

    const tagsEl = this.container.querySelector<HTMLInputElement>('#dp-tags');
    if (tagsEl) {
      const tags = tagsEl.value.split(',').map((t) => t.trim()).filter((t) => t !== '');
      const changed = tags.length !== oldNode.tags.length || tags.some((t, i) => t !== oldNode.tags[i]);
      if (changed) this.store.apply(setTags(oldId, tags));
    }
  }

  private render(): void {
    const scrollTop = this.container.scrollTop;
    const id = this.selection.get();
    const node = id !== null ? this.store.state.nodes.get(id) : undefined;

    if (id !== this.shownId) {
      this.flushPendingEdits();
    } else {
      const active = document.activeElement;
      if (this.container.contains(active) && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) {
        return; // don't clobber an in-progress edit of the same node
      }
    }

    if (id === null || !node) {
      this.shownId = null;
      this.container.innerHTML = '<div class="dp-empty">no node selected</div>';
      return;
    }
    this.container.innerHTML = `
      <h3 class="dp-label"></h3>
      <div class="dp-row">
        <input type="color" id="dp-color" />
        <button id="dp-color-clear">clear color</button>
      </div>
      <div class="dp-row"><input id="dp-tags" placeholder="tags, comma-separated" /></div>
      <h4>notes</h4>
      <textarea id="dp-notes" rows="8"></textarea>
      <div id="dp-notes-preview" class="markdown"></div>
      <h4>attached file</h4>
      <div class="dp-row dp-file-path" id="dp-file-path"></div>
      <div class="dp-row">
        <button id="dp-attach">Attach…</button>
        <button id="dp-file-clear">Clear</button>
        <button id="dp-obsidian">Open in Obsidian</button>
        <button id="dp-openfile">Open file</button>
      </div>
      <div id="dp-file-preview" class="markdown"></div>
      <div id="claude-section"></div>
    `;
    this.container.querySelector('.dp-label')!.textContent = node.label || '(unnamed)';

    const colorEl = this.container.querySelector<HTMLInputElement>('#dp-color')!;
    colorEl.value = node.color ?? '#dfe6ee';
    colorEl.addEventListener('change', () => this.store.apply(setColor(id, colorEl.value)));
    this.container.querySelector('#dp-color-clear')!.addEventListener('click', () =>
      this.store.apply(setColor(id, null))
    );

    const tagsEl = this.container.querySelector<HTMLInputElement>('#dp-tags')!;
    tagsEl.value = node.tags.join(', ');
    tagsEl.addEventListener('blur', () => {
      const tags = tagsEl.value.split(',').map((t) => t.trim()).filter((t) => t !== '');
      // Diff-check (mirrors the notes guard below): also prevents a stale
      // blur, fired by DOM teardown after flushPendingEdits already
      // committed this same value, or after the node was since deleted,
      // from re-applying an identical/invalid setTags.
      const changed = tags.length !== node.tags.length || tags.some((t, i) => t !== node.tags[i]);
      if (changed) this.store.apply(setTags(id, tags));
    });

    const notesEl = this.container.querySelector<HTMLTextAreaElement>('#dp-notes')!;
    notesEl.value = node.notes;
    notesEl.addEventListener('blur', () => {
      if (notesEl.value !== node.notes) this.store.apply(setNotes(id, notesEl.value));
    });
    this.renderMarkdown(this.container.querySelector('#dp-notes-preview')!, node.notes);

    const pathEl = this.container.querySelector('#dp-file-path')!;
    pathEl.textContent = node.attachedFile ?? '(none)';
    this.container.querySelector('#dp-attach')!.addEventListener('click', async () => {
      const p = await window.mind3d.pickAttachFile();
      if (p !== null) this.store.apply(setAttachedFile(id, p));
    });
    this.container.querySelector('#dp-file-clear')!.addEventListener('click', () =>
      this.store.apply(setAttachedFile(id, null))
    );
    this.container.querySelector('#dp-obsidian')!.addEventListener('click', () => {
      if (node.attachedFile === null) return;
      void window.mind3d.openExternal(`obsidian://open?path=${encodeURIComponent(node.attachedFile)}`);
    });
    this.container.querySelector('#dp-openfile')!.addEventListener('click', () => {
      if (node.attachedFile === null) return;
      void window.mind3d.openPath(node.attachedFile);
    });
    const filePreview = this.container.querySelector<HTMLElement>('#dp-file-preview')!;
    if (node.attachedFile !== null) {
      window.mind3d
        .readTextFile(node.attachedFile)
        .then((text) => this.renderMarkdown(filePreview, text))
        .catch((err: Error) => {
          filePreview.textContent = `cannot read file: ${err.message}`;
        });
    }
    mountClaudeSection(
      this.container.querySelector('#claude-section')!,
      id,
      this.store,
      this.getFallbackCwd
    );
    this.shownId = id;
    this.container.scrollTop = scrollTop;
  }

  private renderMarkdown(el: HTMLElement, md: string): void {
    const html = marked.parse(md, { async: false });
    el.innerHTML = DOMPurify.sanitize(html);
  }
}
