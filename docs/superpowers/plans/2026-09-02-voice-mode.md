# Voice Mode Implementation Plan

**Goal:** Push-to-talk voice mode: hold a mic button, speak an instruction, and Claude — given mind3d's node-operation documentation, the current graph, and any attached source doc — returns a validated set of node/edge operations that are applied as one undoable composite command.

**Architecture:** Reuses the app's spawn-from-main + IPC-bridge + command-store patterns. nerd-dictation (Vosk, offline, already installed with a 68M en model, `--output=STDOUT` verified) transcribes in the main process; a one-shot `claude -p` turns the transcript into JSON operations; a pure, unit-tested core validates the JSON and produces GraphStore commands.

**Branch:** feature/voice-mode. **Spec = this doc.**

## Global Constraints
1. TypeScript strict, no new `any` (the one 3d-force-graph boundary excepted).
2. All graph mutations through GraphStore commands; the whole voice result is ONE composite (single undo).
3. Fail-fast: validate Claude's JSON precisely (name the offending field/ref); on any validation failure create NOTHING and surface the error + raw text.
4. No API keys/tokens anywhere; `claude -p` inherits the machine login; nerd-dictation is offline. Child env = process.env pass-through only.
5. Conventional commits, body ending exactly with:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01MMYpSBhhzTjjgXVt8WuLxh
   ```

## Operation schema (the "documentation" handed to Claude)
```json
{ "ops": [
    {"op":"node","tmp":"n1","label":"Funding strategy","notes":"optional markdown"},
    {"op":"node","tmp":"n2","label":"Grants","parent":"n1"},
    {"op":"edge","from":"n1","to":"<existing-node-id>"}
  ], "summary":"one sentence" }
```
`tmp` ids are batch-local; `parent`/`from`/`to` resolve to either a `tmp` in this batch or an existing node id. `parent` on a node implies an edge parent→node.

---

### Task V1: voiceOps core (pure, unit-tested)

**Files:** Create `src/renderer/src/core/voiceOps.ts`, `src/renderer/src/core/voicePrompt.ts`; Test `tests/voiceOps.test.ts`, `tests/voicePrompt.test.ts`.

**Interfaces produced:**
```ts
// voiceOps.ts
export interface VoiceNodeOp { op: 'node'; tmp: string; label: string; notes?: string; parent?: string }
export interface VoiceEdgeOp { op: 'edge'; from: string; to: string }
export type VoiceOp = VoiceNodeOp | VoiceEdgeOp;
export interface VoiceResult { ops: VoiceOp[]; summary: string }
export function parseVoiceResult(text: string): VoiceResult;
export interface VoicePlan { command: Command; newNodeIds: string[]; rootId: string | null }
export function planFromVoiceResult(result: VoiceResult, existingNodeIds: Set<string>): VoicePlan;
// voicePrompt.ts
export function buildVoicePrompt(opts: {
  transcript: string;
  nodes: { id: string; label: string }[];
  selectedId: string | null;
  docText?: string | null;
}): string;
```

**parseVoiceResult** — extract JSON from Claude's output (prefer a ```json fenced block; else the first `{`…last `}`); JSON.parse (throw `voice: Claude did not return valid JSON: <msg>` on failure); validate: top-level object with `ops` array and string `summary`; each op has `op` of 'node'|'edge'; node ops: non-empty string `label`, string `tmp`, optional string `notes`, optional string `parent`; edge ops: string `from`,`to`; unknown fields rejected; throw precise messages naming the op index. Returns the typed VoiceResult.

**planFromVoiceResult** — build the command:
1. Collect node ops in order; reject duplicate `tmp`; for each create a `MindNode` via `createNode(label)` (set `notes` if given), map `tmp → new id`. Record `newNodeIds` in order.
2. Resolve a ref: if it's a known `tmp` → its new id; else if in `existingNodeIds` → itself; else throw `voice: op references unknown id "<ref>"`.
3. Edges: for each node with `parent`, add `createEdge(resolve(parent), newId)`; for each edge op, `createEdge(resolve(from), resolve(to))`. Reject resolved self-loops (`voice: self-loop on "<id>"`).
4. Command = `composite('voice', [addNode… , addEdge…])` (nodes before edges). `rootId` = resolved id of the first node op with no `parent` and never an edge `to`; fallback first new node; null if no nodes.

**buildVoicePrompt** — returns a single string containing: (a) a short instruction that Claude is extending a 3D mindmap and must reply with ONLY a JSON object matching the schema (embed the schema block verbatim); (b) the existing nodes as `id\tlabel` lines (or "(empty map)"); (c) the selected node id or "(none)"; (d) if `docText`, a delimited "SOURCE DOCUMENT:" section (caller truncates to ~6000 chars); (e) "USER INSTRUCTION:" + transcript. Must instruct: prefer attaching to the selected node / existing ids when the instruction implies it; keep labels short; put detail in `notes`.

**Tests (write first, watch fail):**
- parse: fenced json ok; bare json ok; prose-wrapped json extracted; invalid json throws /valid JSON/; missing summary throws; node op missing label throws naming index; unknown `op` throws.
- plan: two nodes + parent → composite with 2 addNode + 1 addEdge, rootId = n1's id, newNodeIds length 2; edge to an existing id (pass a Set) → ok; ref to unknown id throws /unknown id/; duplicate tmp throws; self-loop (edge n1→n1) throws.
- prompt: includes the transcript, the schema keyword `"ops"`, each existing label, the selected id, and the doc text only when provided; says "(empty map)" for no nodes.

Run `npm test` (all prior 35 + new green) + `npm run typecheck`. Commit.

---

### Task V2: voiceRunner (main) + nerd-dictation IPC

**Files:** Create `src/main/voiceRunner.ts`; Modify `src/main/index.ts` (register), `src/shared/ipc.ts` + `src/preload/index.ts` (bridge).

**Push-to-talk via nerd-dictation** (verified: `nerd-dictation begin --output=STDOUT --cookie <f>` listens until `nerd-dictation end --cookie <f>`, then prints the full transcript to stdout and exits):
- IPC `voice-begin`: create a temp cookie path (`app.getPath('temp')/mind3d-voice-<pid>.cookie`); spawn `nerd-dictation begin --output=STDOUT --cookie <cookie>` (env pass-through, PATH must include `~/.local/bin` — prepend it); accumulate stdout into a buffer; keep the child + cookie in a single module-level `current` (reject a second begin while one is active with a `voice-error`). On spawn 'error' → `voice-error` with the message.
- IPC `voice-end`: if a session is active, spawn `nerd-dictation end --cookie <cookie>`; when the begin child emits 'close', send `voice-transcript` `{ text: buffer.trim() }` to the renderer and clear `current`. If the transcript is empty, still send it (renderer decides).
- `Mind3dApi` additions: `voiceBegin(): void` (send), `voiceEnd(): void` (send), `onVoiceTranscript(cb: (t:{text:string})=>void)`, `onVoiceError(cb:(e:{message:string})=>void)` — the `on*` wrappers use removeAllListeners-before-on like the existing claude ones (single-subscriber).

**Verify:** typecheck + build + a silent cold-start of the runner path is not automatable end-to-end without speech; confirm `nerd-dictation` resolves on PATH from a spawned child (log the resolved path) and that `voice-begin`/`voice-end` wire without error via a brief dev launch. Real transcription is smoke-tested with the user. Commit.

---

### Task V3: one-shot claude op call (main) + doc plumbing

**Files:** Modify `src/main/voiceRunner.ts` (add handler), `src/shared/ipc.ts` + `src/preload/index.ts`.

- IPC `voice-claude` via **`ipcMain.handle`** (renderer awaits a Promise): args `(prompt: string, cwd: string)`. Spawn `claude -p <prompt> --output-format text` (argv-only, `env: process.env`, `stdin.end()`), collect stdout; resolve with the stdout string on close (code 0), reject with an Error carrying stderr on non-zero/failure. This is the one-shot sibling of the per-node runner.
- `Mind3dApi`: `voiceClaude(prompt: string, cwd: string): Promise<string>`.
- Doc plumbing stays in the renderer: it already has `readTextFile`; V4 reads the selected node's `attachedFile` (if any) and passes it as `docText`.

**Verify:** typecheck + build; a headless check that `voice-claude` returns text for a trivial prompt ("reply with the word ok") — this is automatable (no speech). Commit.

---

### Task V4: UI — mic button + voice flow wiring

**Files:** Create `src/renderer/src/ui/voicePanel.ts`; Modify `src/renderer/src/main.ts` (topbar button + instantiate), `src/renderer/src/ui/view3d.ts` (add `spawnNear`), `src/renderer/src/style.css`.

- `View3D.spawnNear(ids: string[], anchorId: string | null): void` — populate the existing private `pendingSpawn` map for each id with a small random offset around the anchor node's live sim position (or origin if no anchor), so the next rebuild places new voice nodes near the selection instead of at the origin. (Public method; reuses the pendingSpawn mechanism `addChild`/dblclick already use.)
- Topbar: a `🎤` button (`#btn-voice`). Push-to-talk: `mousedown` → `window.mind3d.voiceBegin()` + status "🎤 listening…" + button active class; `mouseup`/`mouseleave` → `window.mind3d.voiceEnd()`. Guard against re-entrancy while a voice cycle is in flight.
- `voicePanel.ts` (or inline in main.ts, but a module is cleaner): install `onVoiceTranscript` / `onVoiceError` once. On transcript:
  1. If empty → status "voice: nothing heard"; stop.
  2. Show the heard transcript (status bar or a small transient line).
  3. Gather `nodes = [...store.state.nodes.values()].map(n=>({id:n.id,label:n.label}))`, `selectedId = selection.get()`, and `docText`: if the selected node has `attachedFile`, `await window.mind3d.readTextFile(path)` (truncate to 6000 chars; on read error, docText = null and note it).
  4. `prompt = buildVoicePrompt({transcript, nodes, selectedId, docText})`; status "🧠 thinking…"; `cwd` = selected node's attached-file dir (via `dirname`) else the map dir (`session.getMapDir()`).
  5. `const text = await window.mind3d.voiceClaude(prompt, cwd)`; `const result = parseVoiceResult(text)`; `const plan = planFromVoiceResult(result, new Set(store.state.nodes.keys()))`.
  6. `view3d.spawnNear(plan.newNodeIds, selectedId)`; `store.apply(plan.command)`; if `plan.rootId` `selection.set(plan.rootId)` and `view3d.flyTo(plan.rootId)`; status = `result.summary`.
  7. Any throw → status `voice ERROR: <msg>`; log the raw `text` to console for inspection; create nothing.
- Wire the mic button through the same `guard()` used by other topbar buttons where it fits; the async flow has its own try/catch per step 7.
- README: add a "Voice mode" section (hold 🎤, speak, Claude builds nodes; offline via nerd-dictation; needs the machine's claude login).

**Verify:** typecheck + build + dev launch (no renderer errors). Full voice→nodes flow is the live smoke test with the user speaking. Commit.

---

## Notes
- v1 is create-focused (adds nodes/edges; no voice-editing of existing nodes). Non-goals: continuous streaming, multi-language, on-canvas voice cursor.
- PATH: spawned children need `~/.local/bin` on PATH for `nerd-dictation`; prepend it in voiceRunner.
- Live smoke (with the user): hold mic, say e.g. "add three children under the selected node: grants, major donors, and events"; confirm nodes appear attached to the selection with one Ctrl+Z undoing all; then a doc test: attach a markdown file, say "map the main sections of the attached file".
