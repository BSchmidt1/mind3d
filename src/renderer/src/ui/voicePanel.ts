import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { View3D } from './view3d';
import type { MapSession } from '../mapSession';
import { parseVoiceResult, planFromVoiceResult } from '../core/voiceOps';
import { buildVoicePrompt } from '../core/voicePrompt';

const DOC_TRUNCATE = 6000;

// Drives the push-to-talk voice flow: begin/end wrap the main-process
// nerd-dictation session; a transcript is turned into a `claude -p` prompt,
// parsed into a VoicePlan, and applied as one composite (one undo).
export class VoicePanel {
  // Spans the whole cycle — listening AND the subsequent claude "thinking"
  // step — so a second mousedown can't begin a new session while a prior
  // transcript is still being processed.
  private inFlight = false;
  // True only while a nerd-dictation session is physically open, i.e.
  // between voiceBegin() and the transcript (or a voice-error) arriving.
  // Kept distinct from inFlight so end() and handleVoiceError don't act on
  // a session that has already closed but whose "thinking" step is still
  // running — see begin()/end()/handleVoiceError below.
  private listening = false;

  constructor(
    private store: GraphStore,
    private selection: Selection,
    private view3d: View3D,
    private session: MapSession,
    private setStatus: (msg: string) => void
  ) {
    window.mind3d.onVoiceTranscript((t) => {
      // The session is no longer physically open once its transcript
      // arrives; inFlight stays true through the Claude/parse/plan/apply
      // steps below and is cleared in runFlow's finally.
      this.listening = false;
      void this.runFlow(t.text);
    });
    window.mind3d.onVoiceError((e) => this.handleVoiceError(e.message));
  }

  // Returns true iff a new listening session actually started (so callers
  // can gate visual "active" feedback on a real begin, not a no-op).
  begin(): boolean {
    if (this.inFlight) {
      this.setStatus('voice: still processing previous request…');
      return false;
    }
    this.inFlight = true;
    this.listening = true;
    window.mind3d.voiceBegin();
    this.setStatus('🎤 listening…');
    return true;
  }

  end(): void {
    // No session physically open (already delivered its transcript/error,
    // or begin() no-op'd) — sending voice-end here would be spurious: main
    // replies with "no voice session in progress", and that error must not
    // be allowed to clobber a cycle that's still thinking or already done.
    if (!this.listening) return;
    this.listening = false;
    window.mind3d.voiceEnd();
  }

  // A voice-error can arrive after the listening session already closed
  // (e.g. a duplicate voice-end sent on mouseleave+mouseup racing the real
  // one, whose failed handshake reports late, or once a transcript already
  // succeeded) — ignore it then, since it would otherwise clobber a good
  // result already shown in status. While a session is genuinely open
  // (e.g. nerd-dictation failed to start), surface it and reset.
  private handleVoiceError(message: string): void {
    if (!this.listening) {
      console.error(`voice: stale/spurious voice-error ignored: ${message}`);
      return;
    }
    this.listening = false;
    this.inFlight = false;
    this.setStatus(`voice ERROR: ${message}`);
  }

  private async runFlow(transcript: string): Promise<void> {
    let claudeText: string | undefined;
    try {
      if (transcript.trim() === '') {
        this.setStatus('voice: nothing heard');
        return;
      }
      this.setStatus(`heard: "${transcript}"`);

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
      this.setStatus('🧠 thinking…');

      const cwd = selectedNode?.attachedFile
        ? await window.mind3d.dirname(selectedNode.attachedFile)
        : await this.session.getMapDir();

      claudeText = await window.mind3d.askClaude(prompt, cwd);
      const result = parseVoiceResult(claudeText);
      const plan = planFromVoiceResult(result, new Set(this.store.state.nodes.keys()));

      this.view3d.spawnNear(plan.newNodeIds, selectedId);
      this.store.apply(plan.command);
      if (plan.rootId !== null) {
        this.selection.set(plan.rootId);
        this.view3d.flyTo(plan.rootId);
      }
      this.setStatus(result.summary);
    } catch (err) {
      if (claudeText !== undefined) console.error('voice: raw claude output that failed to apply:\n', claudeText);
      this.setStatus(`voice ERROR: ${(err as Error).message}`);
    } finally {
      this.inFlight = false;
    }
  }
}
