import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { View3D } from './view3d';
import type { MapSession } from '../mapSession';
import { parseProposal, planProposal } from '../core/proposal';
import { buildVoicePrompt } from '../core/voicePrompt';
import { notify, type ProgressHandle } from './notify';
import { closeOtherModals, registerModal } from './modal';

const DOC_TRUNCATE = 6000;

// Drives the push-to-talk voice flow. begin/end wrap the main-process
// nerd-dictation session; the transcript is shown in an EDITABLE confirm step
// (so the user can correct a Vosk mis-hear before anything runs), then — on
// Run — turned into a `claude -p` prompt via the shared proposal engine and
// direct-applied as one composite (one undo). Voice DIRECT-APPLIES with an
// undo hint rather than routing through the F3b accept/reject preview: for a
// hold-to-speak gesture the editable confirm is the review gate, and Ask (F4)
// / Import (F5) own the ghost-preview flow. See the F6 plan, Step 3.
//
// Interim/live partial transcripts are DEFERRED: nerd-dictation's
// `begin --output=STDOUT` only flushes its buffer to stdout when the session
// ends (voiceRunner buffers `stdout.on('data')` and emits one `voice-transcript`
// on the begin child's 'close'), so there is no safe incremental partial stream
// to surface. The editable confirm step is the review gate instead.
export class VoicePanel {
  // Spans the whole cycle — listening AND the subsequent confirm + claude
  // "thinking" steps — so a second mousedown can't begin a new session while a
  // prior transcript is still awaiting confirmation or being processed.
  private inFlight = false;
  // True only while a nerd-dictation session is physically open, i.e.
  // between voiceBegin() and the transcript (or a voice-error) arriving.
  // Kept distinct from inFlight so end() and handleVoiceError don't act on
  // a session that has already closed but whose confirm/"thinking" step is
  // still running — see begin()/end()/handleVoiceError below.
  private listening = false;

  private readonly confirmRoot: HTMLDivElement;
  private readonly confirmTextarea: HTMLTextAreaElement;

  constructor(
    private store: GraphStore,
    private selection: Selection,
    private view3d: View3D,
    private session: MapSession
  ) {
    this.confirmRoot = document.createElement('div');
    this.confirmRoot.id = 'voice-confirm';
    this.confirmRoot.hidden = true;
    this.confirmRoot.innerHTML = `
      <div class="vc-card">
        <div class="vc-label">Heard — edit &amp; run</div>
        <textarea class="vc-textarea" rows="3"></textarea>
        <div class="vc-actions">
          <button class="vc-cancel">Cancel</button>
          <button class="vc-run">Run</button>
        </div>
      </div>`;
    document.body.appendChild(this.confirmRoot);
    // Register with the single-modal coordinator (F14): if another overlay opens
    // while the confirm box is up, cancelConfirm runs (it clears inFlight and
    // toasts "voice: cancelled"); it is a no-op when the box is already hidden.
    registerModal('voice-confirm', () => this.cancelConfirm());
    this.confirmTextarea = this.confirmRoot.querySelector('.vc-textarea')!;

    this.confirmRoot.querySelector('.vc-cancel')!.addEventListener('click', () => this.cancelConfirm());
    this.confirmRoot.querySelector('.vc-run')!.addEventListener('click', () => this.runConfirm());
    this.confirmTextarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        this.runConfirm();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.cancelConfirm();
      }
      // Keep global shortcuts (undo, delete, help, palette) from firing while
      // the user edits the heard text.
      ev.stopPropagation();
    });
    // Backdrop click (outside the card) cancels.
    this.confirmRoot.addEventListener('click', (ev) => {
      if (ev.target === this.confirmRoot) this.cancelConfirm();
    });

    window.mind3d.onVoiceTranscript((t) => {
      // The session is no longer physically open once its transcript arrives;
      // inFlight stays true through the confirm + Claude/parse/plan/apply steps
      // and is cleared either in onTranscript (empty/nothing heard), in
      // cancelConfirm, or in runClaude's finally.
      this.listening = false;
      this.onTranscript(t.text);
    });
    window.mind3d.onVoiceError((e) => this.handleVoiceError(e.message));
  }

  // Returns true iff a new listening session actually started (so callers
  // can gate visual "active" feedback on a real begin, not a no-op).
  begin(): boolean {
    if (this.inFlight) {
      notify.info('voice: still processing previous request…');
      return false;
    }
    this.inFlight = true;
    this.listening = true;
    window.mind3d.voiceBegin();
    notify.info('🎤 listening…');
    return true;
  }

  end(): void {
    // No session physically open (already delivered its transcript/error,
    // or begin() no-op'd) — sending voice-end here would be spurious: main
    // replies with "no voice session in progress", and that error must not
    // be allowed to clobber a cycle that's still confirming/thinking or done.
    if (!this.listening) return;
    this.listening = false;
    window.mind3d.voiceEnd();
  }

  // A voice-error can arrive after the listening session already closed
  // (e.g. a duplicate voice-end sent on mouseleave+mouseup racing the real
  // one, whose failed handshake reports late, or once a transcript already
  // succeeded and the confirm box is open) — ignore it then, since it would
  // otherwise clobber a good result / an open confirm. While a session is
  // genuinely open (e.g. nerd-dictation failed to start), surface it and reset.
  private handleVoiceError(message: string): void {
    if (!this.listening) {
      console.error(`voice: stale/spurious voice-error ignored: ${message}`);
      return;
    }
    this.listening = false;
    this.inFlight = false;
    notify.error(`voice ERROR: ${message}`);
  }

  // A transcript arrived: an empty one ends the cycle idle; otherwise open the
  // editable confirm gate (inFlight stays true until the user Runs or Cancels).
  private onTranscript(transcript: string): void {
    // Hold inFlight for the whole confirm→think→apply span regardless of how we
    // got here: begin() sets it, but an out-of-band voice-transcript would
    // otherwise open the confirm box with inFlight=false and leave the "mic
    // blocked during confirm" guard unenforced. runClaude's finally / the
    // empty + cancel paths still clear it, so this is strictly safer.
    this.inFlight = true;
    if (transcript.trim() === '') {
      notify.info('voice: nothing heard');
      this.inFlight = false;
      return;
    }
    closeOtherModals('voice-confirm');
    this.confirmTextarea.value = transcript;
    this.confirmRoot.hidden = false;
    this.confirmTextarea.focus();
  }

  private cancelConfirm(): void {
    if (this.confirmRoot.hidden) return;
    this.confirmRoot.hidden = true;
    this.inFlight = false;
    notify.info('voice: cancelled');
  }

  private runConfirm(): void {
    if (this.confirmRoot.hidden) return;
    const text = this.confirmTextarea.value.trim();
    if (text === '') {
      notify.info('voice: nothing to run');
      this.confirmRoot.hidden = true;
      this.inFlight = false;
      return;
    }
    // Hide before dispatching so the box can't be Run twice; inFlight stays
    // true across the async claude step and clears in runClaude's finally.
    this.confirmRoot.hidden = true;
    void this.runClaude(text);
  }

  private async runClaude(transcript: string): Promise<void> {
    let p: ProgressHandle | undefined;
    let raw: string | undefined;
    try {
      p = notify.progress('info', '🧠 thinking…');

      const nodes = [...this.store.state.nodes.values()].map((n) => ({ id: n.id, label: n.label }));
      const selectedId = this.selection.get();
      const selectedNode = selectedId !== null ? this.store.state.nodes.get(selectedId) : undefined;

      let docText: string | null = null;
      if (selectedNode?.attachedFile) {
        try {
          const full = await window.mind3d.readTextFile(selectedNode.attachedFile);
          docText = full.length > DOC_TRUNCATE ? full.slice(0, DOC_TRUNCATE) : full;
        } catch (err) {
          docText = null;
          console.error(
            `voice: could not read attached file "${selectedNode.attachedFile}", continuing without it:`,
            err
          );
        }
      }

      const prompt = buildVoicePrompt({ transcript, nodes, selectedId, docText });
      const cwd = selectedNode?.attachedFile
        ? await window.mind3d.dirname(selectedNode.attachedFile)
        : await this.session.getMapDir();

      raw = await window.mind3d.askClaude(prompt, cwd);
      const opSet = parseProposal(raw);
      // Read existing ids fresh, AFTER the await, so a concurrent edit while
      // Claude was thinking is reflected. planProposal throws on an empty
      // op-set ("nothing to create") — voice keeps its create-only contract,
      // so an answer-only reply surfaces as an error, same as before.
      const plan = planProposal(
        opSet,
        new Set(this.store.state.nodes.keys()),
        (id) => this.store.state.nodes.get(id)?.label ?? id
      );

      this.view3d.spawnNear(plan.newNodeIds, selectedId);
      this.store.apply(plan.command);
      if (plan.rootId !== null) {
        this.selection.set(plan.rootId);
        this.view3d.flyTo(plan.rootId);
      }
      p.done(
        'success',
        `${plan.newNodeIds.length} nodes, ${plan.newEdges.length} edges added — Ctrl+Z to undo · ${opSet.summary}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (p !== undefined) p.done('error', `voice ERROR: ${msg}`);
      else notify.error(`voice ERROR: ${msg}`);
      if (raw !== undefined) console.error('voice: raw claude output that failed to apply:\n', raw);
      else console.error('voice: failed', err);
    } finally {
      this.inFlight = false;
    }
  }
}
