import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { View3D } from './view3d';
import type { MapSession } from '../mapSession';
import type { CommandRegistry } from '../core/commandRegistry';
import type { ProposalPanel } from './proposalPanel';
import { buildImportPrompt } from '../core/importPrompt';
import { parseProposal, planProposal } from '../core/proposal';
import { notify, type ProgressHandle } from './notify';
import { closeOtherModals, registerModal } from './modal';

// Import text / file / URL → map (F5): paste text, load a file, or fetch a
// URL, then let Claude extract a node/edge structure, surfaced through the
// shared F3b proposal preview (accept/reject) or a text answer. Palette-only
// (`import-map`), no new top-bar button. Nothing mutates the store until the
// user Accepts — only proposalPanel.accept() applies, as one composite (one
// undo). All pre-Claude work (prompt build incl. the IMPORT_TRUNCATE cap,
// getMapDir) runs inside the try so a throw surfaces as an error toast.

export interface ImportDeps {
  store: GraphStore;
  selection: Selection;
  view3d: View3D;
  proposalPanel: ProposalPanel;
  registry: CommandRegistry;
  session: MapSession;
}

export function installImport(deps: ImportDeps): void {
  const { store, proposalPanel, registry, session } = deps;

  async function runImport(sourceText: string): Promise<void> {
    // The progress handle is created as the first step INSIDE the try so even
    // its creation (and every pre-Claude step) is covered by the catch — the
    // caller is a fire-and-forget `void runImport(...)`, so an uncaught throw
    // would become a silent unhandled rejection. The catch guards on `p` being
    // set before reporting on it, falling back to a plain error toast.
    let p: ProgressHandle | undefined;
    // Fetch raw then parse (rather than the askClaudeForOps one-liner) so a
    // malformed reply can be logged verbatim — same pattern as Ask/Voice.
    let raw: string | undefined;
    try {
      p = notify.progress('info', '📥 extracting a map…');
      const prompt = buildImportPrompt(sourceText);
      const cwd = await session.getMapDir();
      raw = await window.mind3d.askClaude(prompt, cwd);
      const opSet = parseProposal(raw);
      if (opSet.ops.length === 0) {
        // The source could not be turned into a map — show Claude's reason.
        p.dismiss();
        proposalPanel.showAnswer(opSet.answer ?? '(no structure extracted)');
        return;
      }
      // Read existing ids fresh, AFTER the await, so a concurrent edit while
      // Claude was thinking is reflected. Plan/render before the success toast
      // so a planProposal throw surfaces as an error, not a false success.
      const proposal = planProposal(
        opSet,
        new Set(store.state.nodes.keys()),
        (id) => store.state.nodes.get(id)?.label ?? id
      );
      proposalPanel.show(proposal, { answer: opSet.answer });
      p.done('success', opSet.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // p may be undefined only if notify.progress itself threw (near-never).
      if (p !== undefined) p.done('error', `import ERROR: ${msg}`);
      else notify.error(`import ERROR: ${msg}`);
      if (raw !== undefined) console.error('import: raw claude output that failed to parse:\n', raw);
      else console.error('import: failed', err);
    }
  }

  const modal = new ImportModal((text) => {
    void runImport(text);
  });

  registry.register({
    id: 'import-map',
    title: 'Import text / file / URL…',
    hint: 'extract a map',
    run: () => modal.open()
  });
}

// The import modal (mounted on document.body): a paste textarea plus two
// loaders — "From file…" (native picker → readTextFile) and "From URL…"
// (main-process scheme-allowlisted fetch) — both of which fill the textarea so
// the user can review/edit before Import. Import submits the textarea content.
// Ctrl/Cmd+Enter or the Import button submits; Escape / backdrop cancels.
class ImportModal {
  private readonly root: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly urlInput: HTMLInputElement;

  constructor(private readonly onImport: (text: string) => void) {
    this.root = document.createElement('div');
    this.root.id = 'import-modal';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="import-card">
        <div class="import-label">Import → map</div>
        <textarea class="import-textarea" placeholder="Paste text to turn into a mind map, or load a file / URL below…" rows="8"></textarea>
        <div class="import-source-row">
          <button class="import-file">From file…</button>
          <input class="import-url" type="text" placeholder="https://example.com/article" />
          <button class="import-fetch">Fetch URL</button>
        </div>
        <div class="import-actions">
          <button class="import-cancel">Cancel</button>
          <button class="import-go">Import</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    registerModal('import-modal', () => this.close());
    this.textarea = this.root.querySelector('.import-textarea')!;
    this.urlInput = this.root.querySelector('.import-url')!;

    this.root.querySelector('.import-cancel')!.addEventListener('click', () => this.close());
    this.root.querySelector('.import-go')!.addEventListener('click', () => this.submit());
    this.root.querySelector('.import-file')!.addEventListener('click', () => {
      void this.loadFromFile();
    });
    this.root.querySelector('.import-fetch')!.addEventListener('click', () => {
      void this.loadFromUrl();
    });

    this.textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
    this.urlInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void this.loadFromUrl();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
    // Click on the backdrop (outside the card) closes.
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
  }

  open(): void {
    closeOtherModals('import-modal');
    this.textarea.value = '';
    this.urlInput.value = '';
    this.root.hidden = false;
    this.textarea.focus();
  }

  private close(): void {
    this.root.hidden = true;
  }

  private async loadFromFile(): Promise<void> {
    try {
      const path = await window.mind3d.pickAttachFile();
      if (path === null) return; // picker cancelled
      const text = await window.mind3d.readTextFile(path);
      this.textarea.value = text;
      notify.info(`loaded ${text.length} chars from file`);
      this.textarea.focus();
    } catch (err) {
      notify.error(`import: could not read file — ${(err as Error).message}`);
    }
  }

  private async loadFromUrl(): Promise<void> {
    const url = this.urlInput.value.trim();
    if (url === '') {
      notify.info('import: enter a URL to fetch');
      return;
    }
    const p = notify.progress('info', `🌐 fetching ${url}…`);
    try {
      const text = await window.mind3d.fetchUrl(url);
      this.textarea.value = text;
      p.done('success', `fetched ${text.length} chars`);
      this.textarea.focus();
    } catch (err) {
      p.done('error', `import: fetch failed — ${(err as Error).message}`);
    }
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (text === '') {
      notify.error('import: nothing to import');
      return;
    }
    this.close();
    this.onImport(text);
  }
}
