import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { View3D } from './view3d';
import type { MapSession } from '../mapSession';
import type { CommandRegistry } from '../core/commandRegistry';
import type { ProposalPanel } from './proposalPanel';
import { serializeGraphContext, type AskScope } from '../core/askContext';
import { ASK_PRESETS, buildAskPrompt } from '../core/askPrompts';
import { parseProposal, planProposal } from '../core/proposal';
import { notify } from './notify';
import { closeOtherModals, registerModal } from './modal';

// "Ask the map" (F4): send the whole graph (or the selected node's N-hop
// neighborhood) to Claude and surface the result through the F3b proposal
// preview (proposed adds/links, accept/reject) and/or a text answer. Every
// ask registers as a Ctrl+K palette command; the single #btn-ask primary
// opens a free-text entry. Nothing is created unless the user Accepts —
// only proposalPanel.accept() mutates the store, as one composite (one undo).

export interface AskDeps {
  store: GraphStore;
  selection: Selection;
  view3d: View3D;
  proposalPanel: ProposalPanel;
  registry: CommandRegistry;
  session: MapSession;
}

export function installAsk(deps: AskDeps): void {
  const { store, selection, proposalPanel, registry, session } = deps;

  async function runAsk(instruction: string): Promise<void> {
    // Create the progress handle before any work so an early throw (context
    // serialization, prompt build, getMapDir) still resolves it via the catch
    // rather than becoming a silent unhandled rejection — the caller is a
    // fire-and-forget `void runAsk(...)`.
    const p = notify.progress('info', '🧠 asking the map…');
    // Fetch the raw reply, then parse it separately (not in one call) so a
    // malformed reply can be logged verbatim for debugging — same pattern as
    // the voice flow.
    let raw: string | undefined;
    try {
      const focusId = selection.get();
      // With a node selected we scope to its neighborhood (2 hops); otherwise
      // the whole graph is fair game.
      const scope: AskScope = focusId !== null ? 'neighborhood' : 'all';
      const context = serializeGraphContext(store.state, { scope, focusId, hops: 2 });
      const prompt = buildAskPrompt({ instruction, context });
      const cwd = await session.getMapDir();

      raw = await window.mind3d.askClaude(prompt, cwd);
      const opSet = parseProposal(raw);
      if (opSet.ops.length === 0) {
        // Pure answer, no structural change — dismiss the progress toast and
        // show the text reply.
        p.dismiss();
        proposalPanel.showAnswer(opSet.answer ?? '(no answer)');
        return;
      }
      // Plan (and render) BEFORE the success toast, so a planProposal throw
      // surfaces as an error rather than a success emitted for a failed plan.
      const proposal = planProposal(
        opSet,
        new Set(store.state.nodes.keys()),
        (id) => store.state.nodes.get(id)?.label ?? id
      );
      proposalPanel.show(proposal, { answer: opSet.answer });
      p.done('success', opSet.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.done('error', `ask ERROR: ${msg}`);
      if (raw !== undefined) console.error('ask: raw claude output that failed to parse:\n', raw);
      else console.error('ask: failed', err);
    }
  }

  const askInput = new AskInput((text) => {
    void runAsk(text);
  });

  // Free-text ask: a primary #btn-ask button and a palette command both open
  // the same small entry box.
  registry.register({
    id: 'ask-map',
    title: 'Ask the map…',
    hint: 'free text',
    run: () => askInput.open()
  });
  const btn = document.getElementById('btn-ask');
  if (btn !== null) btn.addEventListener('click', () => askInput.open());

  // One palette command per preset (registered under a stable `ask-<id>`).
  for (const preset of ASK_PRESETS) {
    registry.register({
      id: `ask-${preset.id}`,
      title: `Ask: ${preset.title}`,
      run: () => runAsk(preset.instruction)
    });
  }
}

// A minimal free-text entry overlay (mounted on document.body). A small,
// self-contained input box for the ask prompt (registered with the modal
// coordinator like the other overlays): Ctrl/Cmd+Enter or the Ask button
// submits, Escape / backdrop click cancels.
class AskInput {
  private readonly root: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;

  constructor(private readonly onSubmit: (text: string) => void) {
    this.root = document.createElement('div');
    this.root.id = 'ask-input';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="ask-card">
        <div class="ask-label">Ask the map</div>
        <textarea class="ask-textarea" placeholder="e.g. what connections am I missing?" rows="3"></textarea>
        <div class="ask-actions">
          <button class="ask-cancel">Cancel</button>
          <button class="ask-go">Ask</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    registerModal('ask-input', () => this.close());
    this.textarea = this.root.querySelector('.ask-textarea')!;

    this.root.querySelector('.ask-cancel')!.addEventListener('click', () => this.close());
    this.root.querySelector('.ask-go')!.addEventListener('click', () => this.submit());
    this.textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      // Keep the top-bar/global handlers from reacting to typing here.
      ev.stopPropagation();
    });
    // Click on the backdrop (outside the card) closes.
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
  }

  open(): void {
    closeOtherModals('ask-input');
    this.textarea.value = '';
    this.root.hidden = false;
    this.textarea.focus();
  }

  private close(): void {
    this.root.hidden = true;
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (text === '') {
      notify.info('ask: nothing to ask');
      return;
    }
    this.close();
    this.onSubmit(text);
  }
}
