# mind3d v2 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks run in the order F1 → F14; every task ends green (`npm test` + `npm run typecheck` + `npm run build`) before the next starts.

**Goal:** Ship all 14 v2 features (F1–F14) on the working Electron 3D-mindmapping app while keeping the design clean: a toast system and split status bar, a Ctrl+K command palette that new actions register into instead of growing the top bar, a shared Claude "proposal" engine (map-level Ask, Import, and Voice all reuse it with a ghosted accept/reject preview), semantic-or-lexical search over notes, snapshots+diff, camera tours, first-class edges, wired tags, a 2D mode, a context menu, and visible undo/redo with an in-app confirm modal.

**Architecture:** Unchanged three-layer shape — thin Electron main (`src/main/`: window, fs, dialogs, `claude`/`nerd-dictation` spawns), the preload bridge (`window.mind3d`), and the vanilla-TS renderer built on a command-pattern `GraphStore` (single source of truth, uniform undo/redo). Every new graph mutation is a `GraphStore` command; a batch is one `composite` (single undo). Pure logic lands in `core/` with vitest tests; UI/main are verified by typecheck + build + a bounded dev launch (and the Playwright harness under `e2e/`).

**Tech Stack:** Electron ^33, electron-vite ^2, Vite ^5, TypeScript ^5 (strict), Vitest ^2, 3d-force-graph ^1.80, three ^0.185 + three-spritetext, marked ^14 + dompurify ^3. F7 may add an offline embedding runtime (transformers.js / onnxruntime-web) **only if its spike succeeds** — otherwise no new dependency.

**Spec:** `.superpowers/sdd/v2/design-decisions.md` (binding: the 14 features, grouping/order, softened cuts, and clean-design principles). This plan follows it exactly.

## Global Constraints

1. **TypeScript `strict: true`; no `any`** except the single documented `3d-force-graph` boundary already in `src/renderer/src/ui/view3d.ts` (the `private graph: any` field, commented as such). Do not add others. `noUncheckedIndexedAccess` is on — index access yields `T | undefined`; narrow it.
2. **Every graph mutation goes through a `GraphStore` command.** Never write to `GraphState` (`nodes`/`edges` Maps) directly outside `core/commands.ts` / `core/store.ts`. A batch that must undo as one unit uses `composite(name, cmds)` (it rolls back atomically if a sub-command throws). Snapshots/viewpoints/tours/mode are map *metadata* (like `MapMeta`), not graph state — they live on `MapSession`, are serialized with the file, and are **not** command-tracked; restoring a snapshot uses `store.loadState` (clears history, like Open).
3. **Fail fast.** Validate inputs and `throw new Error` with a message naming the offending field/id/ref. Never silently default, drop, or sentinel-fill. Errors surface to the user as an error toast; they must not be swallowed. (The one intentional default is the backward-compat format upgrade in F8/F10/F12: an *absent* optional section on load becomes its documented default — a present-but-malformed value still throws.)
4. **No secrets, ever.** `claude` (per-node runner and the one-shot `claude-oneshot`) inherits the machine's Claude Code login; `nerd-dictation` is fully offline; F7's embedding model, if used, loads from a local/cached file with no network key; F5's URL fetch sends no credentials. Child processes get `process.env` pass-through only (voice prepends `~/.local/bin` to PATH, as today). No API key or token in code, config, or git history. `.env` stays gitignored.
5. **Renderer is sandboxed from the OS.** `contextIsolation: true`, `nodeIntegration: false`. The renderer touches the system only through `window.mind3d` (the preload bridge; every channel declared in `src/shared/ipc.ts`). All rendered markdown passes through `DOMPurify.sanitize` (reuse `DetailPanel.renderMarkdown`'s pattern for any new markdown surface).
6. **Conventional commits**, one per task, body ending EXACTLY with:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01MMYpSBhhzTjjgXVt8WuLxh
   ```
7. **Clean-design rules (from the spec):** do NOT grow the top bar unbounded — a new action registers a `PaletteCommand` in the F2 registry (Ctrl+K) instead of adding a button, unless it is a genuine primary (New/Open/Save, the mic, Ask, undo/redo, 2D toggle). Reuse the existing dark tokens/button styles, `core/fuzzy`, `DOMPurify`, `Toasts`, `pendingSpawn`/`spawnNear`, and `composite`. One renderer, one 3D code path (no second graph library).

## Shared-file serialization (executor must respect)

Several files are touched by many tasks; tasks run sequentially, so this is ordering guidance, not merge risk. Each task's **Files** block flags the shared files it edits:
- `src/renderer/src/main.ts` — F1, F2, F3b, F4, F5, F6, F9, F10, F11, F12, F13, F14 (wiring/registration).
- `src/renderer/src/style.css` — most tasks (append scoped rules; reuse tokens).
- `src/renderer/src/ui/view3d.ts` — F3b (ghost), F8 (diff overlay), F9 (camera get/apply), F10 (edges), F11 (dim-filter/color-by-tag), F12 (2D), F13 (hover getters).
- `src/shared/ipc.ts` + `src/preload/index.ts` — F3a (rename `voice-claude`→`claude-oneshot`, `voiceClaude`→`askClaude`), F5 (`fetchUrl`).
- `src/renderer/src/core/serialize.ts` — F8 (v2 bump + snapshots + upgrade), F9 (viewpoints/tours), F10 (edge `relation`), F12 (`mode`). See the **File format** note below.
- `src/renderer/src/core/model.ts` / `commands.ts` — F10 (edge `relation`, `setEdgeLabel`, `setEdgeRelation`).
- `src/renderer/src/core/store.ts` — F14 (extend `ChangeEvent`).

## File format policy (one bump, then optional-with-default)

`FILE_VERSION` bumps **once**, `1 → 2`, in **F8**. F8 also refactors the top-level validator into required keys `{version, meta, nodes, edges}` plus an **optional** set that each later task extends: `snapshots` (F8), `viewpoints` + `tours` (F9), `mode` (F12). An absent optional section loads as its default (`[]`, `[]`, `[]`, `'3d'`). F10's edge `relation` is an **optional edge field within v2** (default `'none'`), not a new numeric version. Validation stays strict: unknown keys and present-but-malformed values throw. Every format extension adds a test proving a file lacking that section still loads. A v1 file (no `snapshots`/etc.) upgrades in memory on load (F8 test). Older code loading a newer file rejects it via the unknown-key check — acceptable fail-fast.

---

### Task F1: Toasts + status-bar split + empty-state onboarding

Foundation for all later feedback. A pure `ToastStore` + a DOM host + a `notify` singleton; split the single `#status` line into persistent file-state (left) and counts (right); route every transient/action/error message through toasts; show a centered onboarding hint on an empty map.

**Files:**
- Create: `src/renderer/src/core/toasts.ts`, `src/renderer/src/ui/notify.ts`
- Test: `tests/toasts.test.ts`
- Modify (SHARED): `src/renderer/src/main.ts`, `src/renderer/src/style.css`; also `src/renderer/src/mapSession.ts` (its `onState` label already targets `#file-state` — keep), `src/renderer/src/ui/view3d.ts` is **not** modified here (its `onStatus` callback is rewired from `main.ts`).

**Interfaces produced:**
```ts
// core/toasts.ts
export type ToastKind = 'info' | 'success' | 'error';
export interface Toast { id: string; kind: ToastKind; message: string; expiresAt: number | null }
export interface ToastEvent { toasts: Toast[] }
export class ToastStore {
  add(kind: ToastKind, message: string, ttlMs?: number | null): string;   // ttl undefined→kind default; null→sticky
  update(id: string, kind: ToastKind, message: string, ttlMs?: number | null): void; // throws if id gone
  dismiss(id: string): void;
  prune(now: number): string[];         // remove expired (expiresAt !== null && <= now); returns removed ids
  list(): Toast[];                      // insertion order
  subscribe(fn: (ev: ToastEvent) => void): () => void;
}
// ui/notify.ts
export interface ProgressHandle { update(kind: ToastKind, message: string): void; done(kind: ToastKind, message: string): void; dismiss(): void }
export function initNotify(host: HTMLElement): void;   // mounts the DOM host + a prune interval; call once
export const notify: {
  info(message: string): string; success(message: string): string; error(message: string): string;
  progress(kind: ToastKind, message: string): ProgressHandle;   // sticky toast you can update()/done()
};
```
Defaults: `info`/`success` ttl 4000 ms, `error` ttl 8000 ms; `progress` adds a sticky (null) toast, `done(kind,msg)` re-`update`s it and re-arms a 4000 ms ttl, `dismiss()` removes it.

- [ ] **Step 1: failing test** `tests/toasts.test.ts` (uses an injected `now`, no DOM):
```ts
import { describe, expect, test } from 'vitest';
import { ToastStore, type ToastEvent } from '../src/renderer/src/core/toasts';

describe('ToastStore', () => {
  test('add appends, list preserves order, subscribe fires', () => {
    const s = new ToastStore();
    const events: ToastEvent[] = [];
    s.subscribe((e) => events.push(e));
    const a = s.add('info', 'a', 100);
    const b = s.add('error', 'b', null);
    expect(s.list().map((t) => t.message)).toEqual(['a', 'b']);
    expect(s.list()[1]!.expiresAt).toBeNull();
    expect(events.at(-1)!.toasts).toHaveLength(2);
    expect(typeof a).toBe('string'); expect(a).not.toBe(b);
  });
  test('add with default ttl per kind', () => {
    const s = new ToastStore();
    s.add('info', 'x');            // expiresAt set (finite)
    s.add('error', 'y');
    const [i, e] = s.list();
    expect(i!.expiresAt).not.toBeNull();
    expect(e!.expiresAt).not.toBeNull();
  });
  test('update mutates in place; missing id throws', () => {
    const s = new ToastStore();
    const id = s.add('info', 'working', null);
    s.update(id, 'success', 'done', 10);
    expect(s.list()[0]!.kind).toBe('success');
    expect(s.list()[0]!.message).toBe('done');
    expect(() => s.update('nope', 'info', 'x')).toThrow(/no such toast "nope"/);
  });
  test('dismiss removes; prune removes only expired', () => {
    const s = new ToastStore();
    const a = s.add('info', 'a', 100);
    s.add('info', 'b', null);
    s.add('info', 'c', 50);
    expect(s.prune(60)).toEqual([expect.any(String)]);   // only c expired
    expect(s.list().map((t) => t.message)).toEqual(['a', 'b']);
    s.dismiss(a);
    expect(s.list().map((t) => t.message)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: implement `core/toasts.ts`** — `crypto.randomUUID()` ids; `add(kind,message,ttlMs)` computes `expiresAt = ttlMs===null ? null : now()+(ttlMs ?? DEFAULT[kind])` where `now = Date.now`; `DEFAULT = { info:4000, success:4000, error:8000 }`; push, `emit()`. `update` finds by id (`throw new Error(\`no such toast "${id}"\`)` if absent), replaces kind/message and recomputes expiresAt. `dismiss` filters out + emit. `prune(now)` splits expired vs kept, replaces list, emits if anything removed, returns removed ids. `emit` sends `{ toasts: [...list] }` to listeners.

- [ ] **Step 3: implement `ui/notify.ts`** — module-level `const store = new ToastStore()`. `initNotify(host)` renders on every `store.subscribe`: clear host, for each toast append `<div class="toast toast-<kind>">message</div>` with a click handler `store.dismiss(t.id)`; start `setInterval(() => store.prune(Date.now()), 500)`. `notify.info/success/error` = `store.add(kind, msg)`. `progress(kind,msg)`: `const id = store.add(kind, msg, null); return { update:(k,m)=>store.update(id,k,m,null), done:(k,m)=>store.update(id,k,m,4000), dismiss:()=>store.dismiss(id) }`.

- [ ] **Step 4: rewire `main.ts` status + onboarding.**
  - Change the topbar template: keep `#file-state` (left, already inserted before `#status`); replace the single `#status` span usage. Add `<span id="status-counts"></span>` (right). Add a toast host `<div id="toast-host"></div>` appended to `document.body`, and `initNotify(document.getElementById('toast-host')!)` once, early.
  - Replace `export function setStatus` usage: keep the export as a thin `notify.info` shim for any leftover caller, but route deliberately: `View3D`'s 4th arg becomes `(m) => notify.info(m)`; `VoicePanel`'s `setStatus` arg becomes `(m) => notify.info(m)` (F6 upgrades this to a single `progress` handle). `guard()`'s catch becomes `notify.error(\`ERROR: ${(err as Error).message}\`)`. The New/Open/Save handlers' success text (`'new map'`, etc.) become `notify.success(...)` / `notify.info(...)`.
  - `updateCounts()` writes to `#status-counts` (`\`${n} nodes · ${e} edges · ${p} pinned\``), NOT the old status.
  - Onboarding overlay: append `<div id="empty-hint">double-click to add · hold 🎤 to speak · Ctrl+K for commands · ? for shortcuts</div>` inside `#view3d`; a `refreshEmptyHint()` sets `hidden = store.state.nodes.size > 0`; call it in a `store.subscribe` and once at boot.

- [ ] **Step 5: `style.css`** — add `#toast-host` (fixed bottom-right, column-reverse, gap, z-index 200, pointer-events none), `.toast` (pointer-events auto, dark card, padding, radius, box-shadow, max-width 320px, cursor pointer, fade-in), `.toast-info`/`.toast-success`/`.toast-error` left-border accents (`#6fb3ff`/`#5fd08a`/`#e05a5a`); `#status-counts { margin-left: auto; color: #8fa1b8; }`; `#empty-hint` (absolute, centered in `#view3d`, muted color, pointer-events none, `[hidden]` respected).

- [ ] **Step 6: verify** — `npm test` (55 prior + toasts new all green), `npm run typecheck`, `npm run build`; `npm run dev` (bounded): empty map shows the hint; add a node → hint disappears; Save/New/voice/errors appear as toasts that auto-dismiss (errors linger ~8 s, click dismisses); counts sit on the right, file-state on the left.

- [ ] **Step 7: commit** — `feat: toast system, split status bar, empty-state onboarding`

---

### Task F2: Command palette (Ctrl+K)

A pure command registry + a palette overlay with fuzzy filter. Existing primary actions and every v2 feature register commands here; this is the anti-top-bar-bloat mechanism.

**Files:**
- Create: `src/renderer/src/core/commandRegistry.ts`, `src/renderer/src/ui/commandPalette.ts`
- Test: `tests/commandRegistry.test.ts`
- Modify (SHARED): `src/renderer/src/main.ts` (create the registry, register existing actions, mount the palette), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/commandRegistry.ts
export interface PaletteCommand {
  id: string; title: string; hint?: string;
  run: () => void | Promise<void>;
  when?: () => boolean;                 // omitted ⇒ always enabled
}
export class CommandRegistry {
  register(cmd: PaletteCommand): () => void;   // throws on duplicate id; returns an unregister fn
  unregister(id: string): void;
  list(): PaletteCommand[];                     // only where when?.() !== false, registration order
  filter(query: string): PaletteCommand[];      // fuzzyScore over `${title} ${hint??''}`, desc; '' ⇒ list()
}
// ui/commandPalette.ts
export class CommandPalette {
  constructor(registry: CommandRegistry);       // installs the Ctrl+K global keydown
  open(): void; close(): void; toggle(): void;
}
```

- [ ] **Step 1: failing test** `tests/commandRegistry.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { CommandRegistry } from '../src/renderer/src/core/commandRegistry';

const cmd = (id: string, title: string, when?: () => boolean) =>
  ({ id, title, run: () => {}, when });

describe('CommandRegistry', () => {
  test('register + list; duplicate id throws; unregister removes', () => {
    const r = new CommandRegistry();
    const off = r.register(cmd('a', 'Add node'));
    r.register(cmd('b', 'Open map'));
    expect(r.list().map((c) => c.id)).toEqual(['a', 'b']);
    expect(() => r.register(cmd('a', 'dup'))).toThrow(/duplicate command id "a"/);
    off();
    expect(r.list().map((c) => c.id)).toEqual(['b']);
  });
  test('when() gates list and filter', () => {
    const r = new CommandRegistry();
    r.register(cmd('a', 'Alpha', () => false));
    r.register(cmd('b', 'Beta', () => true));
    expect(r.list().map((c) => c.id)).toEqual(['b']);
    expect(r.filter('a').map((c) => c.id)).toEqual([]);  // Alpha gated out even though it fuzzy-matches
  });
  test('filter ranks by fuzzy; empty query returns all enabled', () => {
    const r = new CommandRegistry();
    r.register(cmd('open', 'Open map'));
    r.register(cmd('opacity', 'Toggle opacity'));
    const hits = r.filter('opm');   // "OpenMap" contiguous-ish beats "Toggle opacity"
    expect(hits[0]!.id).toBe('open');
    expect(r.filter('').map((c) => c.id)).toEqual(['open', 'opacity']);
  });
});
```

- [ ] **Step 2: implement `core/commandRegistry.ts`** — `Map<string, PaletteCommand>` preserving insertion order; `register` throws `\`duplicate command id "${cmd.id}"\`` if present, else set + return `() => this.unregister(cmd.id)`. `list()` = `[...map.values()].filter(c => c.when?.() !== false)`. `filter(q)` = if `q===''` return `list()`; else map enabled commands to `{ c, s: fuzzyScore(q, \`${c.title} ${c.hint ?? ''}\`) }` (import from `core/fuzzy`), drop `s===null`, sort by `s` desc, return `c`s.

- [ ] **Step 3: implement `ui/commandPalette.ts`** — overlay `<div id="cmd-palette" hidden>` with an input and a `<div class="cmd-list">`. `constructor` appends it to `document.body`, adds a global `keydown`: `Ctrl+K` (or `Meta+K`) → `ev.preventDefault(); this.toggle()`, `Escape` closes. `open()` clears input, focuses it, renders `registry.filter('')`; on input → re-render `registry.filter(value)`; ArrowUp/Down move a highlighted index; Enter runs the highlighted command (`await cmd.run()` in a try/catch → `notify.error` on throw), then `close()`. Each row shows `title` (and muted `hint`). Clicking a row runs it.

- [ ] **Step 4: wire `main.ts`** — `export const registry = new CommandRegistry();` and `new CommandPalette(registry);`. Register existing primaries with stable ids: `new-map`, `open-map`, `save-map`, `freeze-all` (`when: () => store.state.nodes.size>0`), `release-all` (`when: () => view3d.pinnedCount()>0`), `toggle-focus` (`view3d.toggleFocusMode()`), `fly-to-selection` (`when: () => selection.get()!==null`), `show-help`. Each `run` calls the SAME function the button/handler already calls (extract small named functions where a handler is currently inline). Later tasks add their commands to this registry.

- [ ] **Step 5: `style.css`** — `#cmd-palette` (fixed, top-center, width ~min(560px,90vw), dark card, z-index 150), its `input` (full width, dark), `.cmd-list` rows with `.cmd-row.active` highlight and muted `.cmd-hint`.

- [ ] **Step 6: verify** — `npm test`/`typecheck`/`build`; dev launch: Ctrl+K opens; typing filters fuzzily; ↑/↓ + Enter runs; Freeze/Release rows disappear when not applicable; Esc closes.

- [ ] **Step 7: commit** — `feat: command palette (Ctrl+K) with fuzzy command registry`

---

### Task F3a: Shared Claude proposal engine (core) + voiceOps delegation + `claude-oneshot` IPC

Generalize the voice op-set into a reusable `core/proposal.ts` (parse + validate + plan → composite), make `voiceOps` a thin delegating wrapper so the 55 existing tests stay green, and generalize the one-shot spawn to a `claude-oneshot` IPC. This is the dependency for F3b/F4/F5/F6.

**Files:**
- Create: `src/renderer/src/core/proposal.ts`, `src/renderer/src/askClaude.ts` (renderer glue), `src/main/claudeOneshot.ts`
- Test: `tests/proposal.test.ts`
- Modify: `src/renderer/src/core/voiceOps.ts` (delegate), `src/main/voiceRunner.ts` (remove the `voice-claude` handler), `src/main/index.ts` (register `claudeOneshot`), (SHARED) `src/shared/ipc.ts` + `src/preload/index.ts` (rename `voiceClaude`→`askClaude`, channel `voice-claude`→`claude-oneshot`), `src/renderer/src/ui/voicePanel.ts` (one-line: `voiceClaude`→`askClaude`).

**Interfaces produced:**
```ts
// core/proposal.ts
export interface ProposalNodeOp { op: 'node'; tmp: string; label: string; notes?: string; parent?: string }
export interface ProposalEdgeOp { op: 'edge'; from: string; to: string; label?: string }  // `relation?` added by F10
export type ProposalOp = ProposalNodeOp | ProposalEdgeOp;
export interface ProposalOpSet { ops: ProposalOp[]; summary: string; answer?: string }     // `answer` used by F4/F5
export function parseProposal(text: string): ProposalOpSet;
export interface Proposal {
  opSet: ProposalOpSet;
  command: Command;                                   // composite('proposal', [addNode…, addEdge…])
  newNodes: { id: string; label: string }[];          // in nodeOps order
  newNodeIds: string[];                               // = newNodes.map(n => n.id)
  newEdges: { id: string; source: string; target: string }[];
  rootId: string | null;
  summary: string;
  humanOps: string[];                                 // human-readable per-op preview lines
}
export function planProposal(
  opSet: ProposalOpSet,
  existingNodeIds: Set<string>,
  labelOf: (id: string) => string                     // resolves EXISTING node labels for humanOps
): Proposal;
// askClaude.ts (renderer, impure — touches window.mind3d)
export async function askClaudeForOps(prompt: string, cwd: string): Promise<ProposalOpSet>;
```

`parseProposal` mirrors the current `parseVoiceResult` exactly, plus: top-level allows `answer` (optional string); edge ops allow `label` (optional string). It MUST keep these error substrings so `tests/voiceOps.test.ts` stays green through delegation: the token `op[<i>]` for per-op errors, and the phrases `valid JSON`, `summary`, unknown-field name (e.g. `bogus`), `unknown id`, `duplicate`, `self-loop`, `nothing to create`. Extraction is the same fenced-then-braces logic.

`planProposal` ports `planFromVoiceResult`'s algorithm verbatim (nodeOps in order → `createNode`, `notes` if given; resolve refs via tmp-map then `existingNodeIds`; parent edges then edge ops; reject dup tmp / unknown id / self-loop / empty; `rootId` = first parent-less node that is never an edge target, else first new node, else null) and additionally: sets `edge.label = op.label ?? null` when building each `createEdge`; records `newNodes`, `newEdges` (with resolved source/target ids and the minted edge id); builds `humanOps` — `+ node "<label>"` (append ` under "<parentLabelResolved>"` when parented), `+ edge "<fromLabel>" → "<toLabel>"` (append ` "<label>"` when set). `<fromLabel>`/`<toLabel>` come from the tmp node's op label or `labelOf(existingId)`.

- [ ] **Step 1: failing test** `tests/proposal.test.ts` — port the parse + plan cases from `voiceOps.test.ts` against `parseProposal`/`planProposal(_, _, () => 'X')`, PLUS new cases: (a) top-level `answer` string is preserved and non-string `answer` throws `/answer/`; (b) edge `label` is parsed and lands on the created edge; (c) `humanOps` contains `node "A"` and `edge "A" → "B"` for a two-node+edge set; (d) `newEdges` carries resolved source/target ids and a real edge id; (e) an op-set with only an `answer` and empty `ops` → `parseProposal` OK, but `planProposal` throws `/nothing to create/` (callers must gate on `ops.length`).

- [ ] **Step 2: implement `core/proposal.ts`** per the interface + semantics above (import `createNode`, `createEdge` from `./model`; `addNode`, `addEdge`, `composite`, `type Command` from `./commands`).

- [ ] **Step 3: migrate `core/voiceOps.ts` to delegate** — replace its body with type aliases + thin wrappers (keeps every existing export name and signature, so `tests/voiceOps.test.ts` is untouched and green):
```ts
import { parseProposal, planProposal, type ProposalNodeOp, type ProposalEdgeOp, type ProposalOp, type ProposalOpSet } from './proposal';
import type { Command } from './commands';
export type VoiceNodeOp = ProposalNodeOp;
export type VoiceEdgeOp = ProposalEdgeOp;
export type VoiceOp = ProposalOp;
export type VoiceResult = ProposalOpSet;
export interface VoicePlan { command: Command; newNodeIds: string[]; rootId: string | null }
export function parseVoiceResult(text: string): VoiceResult { return parseProposal(text); }
export function planFromVoiceResult(result: VoiceResult, existingNodeIds: Set<string>): VoicePlan {
  const p = planProposal(result, existingNodeIds, () => '');
  return { command: p.command, newNodeIds: p.newNodeIds, rootId: p.rootId };
}
```
(`VoiceEdgeOp`/`VoiceResult` widen — the old objects the voice test constructs remain assignable since the new fields are optional.)

- [ ] **Step 4: `askClaude.ts`** — `export async function askClaudeForOps(prompt, cwd) { return parseProposal(await window.mind3d.askClaude(prompt, cwd)); }`.

- [ ] **Step 5: generalize the one-shot IPC.** Create `src/main/claudeOneshot.ts` exporting `registerClaudeOneshotIpc(): void` — move the `voice-claude` `ipcMain.handle` body from `voiceRunner.ts` here verbatim but on channel `'claude-oneshot'` (same spawn `claude -p <prompt> --output-format text`, `stdin.end()`, resolve stdout on code 0, reject with stderr otherwise, same non-empty validation). Remove that handler from `voiceRunner.ts` (it keeps only `voice-begin`/`voice-end`). In `src/main/index.ts` import + call `registerClaudeOneshotIpc()`.
  - `src/shared/ipc.ts`: replace `voiceClaude(prompt, cwd): Promise<string>` with `askClaude(prompt: string, cwd: string): Promise<string>`.
  - `src/preload/index.ts`: replace the `voiceClaude` line with `askClaude: (prompt, cwd) => ipcRenderer.invoke('claude-oneshot', prompt, cwd)`.
  - `src/renderer/src/ui/voicePanel.ts`: change the single call `window.mind3d.voiceClaude(...)` → `window.mind3d.askClaude(...)`.

- [ ] **Step 6: verify** — `npm test` (55 existing green via delegation + new `proposal.test.ts`), `npm run typecheck`, `npm run build`; a bounded headless check that `claude-oneshot` still returns text (dev console: `await window.mind3d.askClaude('reply with the word ok', '/tmp')`).

- [ ] **Step 7: commit** — `feat: shared Claude proposal engine (core) + voiceOps delegation + claude-oneshot IPC`

---

### Task F3b: Proposal preview panel with 3D ghost + accept/reject

The UI half of F3: a floating panel showing the summary + human op list + Accept/Reject, with the proposed adds ghosted (translucent) in the 3D view. Consumed by F4/F5/F6.

**Files:**
- Create: `src/renderer/src/ui/proposalPanel.ts`
- Modify (SHARED): `src/renderer/src/ui/view3d.ts` (ghost support), `src/renderer/src/main.ts` (instantiate + export the singleton), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// view3d.ts additions
export interface GhostData { nodes: { id: string; label: string }[]; links: { source: string; target: string }[]; anchorId: string | null }
// on View3D:
showGhost(g: GhostData): void;   // seeds pendingSpawn for ghost nodes near anchor, sets this.ghost, rebuild()
clearGhost(): void;              // this.ghost = null, rebuild()
// ui/proposalPanel.ts
export class ProposalPanel {
  constructor(container: HTMLElement, store: GraphStore, selection: Selection, view3d: View3D);
  show(proposal: Proposal, opts?: { answer?: string | null }): void;   // ghosts + renders accept/reject
  showAnswer(text: string): void;                                       // text-only reply, single OK button
  hide(): void;
}
```

- [ ] **Step 1: view3d ghost support.** Add `private ghost: GhostData | null = null;`. Extend `SimNode` with `ghost?: boolean` and the link tuple with `ghost?: boolean`. In `rebuild()`, after building real `simNodes`/`simLinks`, if `this.ghost`: seed `pendingSpawn` for each ghost node id near the anchor's live position (reuse the `spawnNear` offset math), append ghost sim nodes (`{ id, ghost: true, x/y/z from pendingSpawn }`) and ghost links (`{ id: 'ghost:'+i, source, target, ghost: true }`); real endpoints already present. In `makeSprite`, branch first on ghost: for a ghost node read the label from `this.ghost.nodes` (NOT the store — it isn't there yet), render translucent (`mat.opacity = 0.5`) with an accent border `#ffd54a`; guard the existing `store.state.nodes.get` path so it only runs for non-ghost nodes. Add `.linkColor((l:any) => l.ghost ? '#ffd54a' : /* existing */ '#5b6b80')` and keep ghost links at reduced opacity. `showGhost`/`clearGhost` set the field and `rebuild()`.

- [ ] **Step 2: implement `ui/proposalPanel.ts`.** `show(proposal, opts)`:
  1. `const anchor = this.selection.get();`
  2. `this.view3d.showGhost({ nodes: proposal.newNodes, links: proposal.newEdges.map(e => ({ source: e.source, target: e.target })), anchorId: anchor });`
  3. render into the container (un-hide): summary line, an optional `answer` block (DOMPurify-sanitized markdown if present), a `<ul>` of `proposal.humanOps`, and an `[Accept]` `[Reject]` bar.
  4. Accept → `this.view3d.clearGhost(); this.view3d.spawnNear(proposal.newNodeIds, anchor); this.store.apply(proposal.command); if (proposal.rootId) { this.selection.set(proposal.rootId); this.view3d.flyTo(proposal.rootId); } notify.success(proposal.summary); this.hide();`
  5. Reject → `this.view3d.clearGhost(); notify.info('proposal discarded'); this.hide();`
  `showAnswer(text)` renders sanitized markdown + a single OK (`hide()`); no ghost. `hide()` sets the container `hidden`, clears its innerHTML, and (defensively) `clearGhost()`.

- [ ] **Step 3: wire `main.ts` + style.** Add `<div id="proposal-panel" hidden></div>` to the layout (overlay anchored bottom-center of `#view3d` or a fixed card). `export const proposalPanel = new ProposalPanel(document.getElementById('proposal-panel')!, store, selection, view3d);`. Register a palette command `dismiss-proposal` (`when: () => !panel.hidden`) that rejects. Style `#proposal-panel` (dark card, max-width 420px, z-index 120), `.proposal-ops li` (muted, monospace-ish), the Accept (`#5fd08a`) / Reject buttons.

- [ ] **Step 4: verify** — typecheck/build/dev. Manually drive via console: `proposalPanel.show(planProposal(parseProposal('{"ops":[{"op":"node","tmp":"n1","label":"Ghost A"},{"op":"node","tmp":"n2","label":"Ghost B","parent":"n1"}],"summary":"demo"}'), new Set(store.state.nodes.keys()), (id)=>store.state.nodes.get(id)?.label ?? id))` → two translucent nodes + a ghost link appear; Reject removes them without touching the store/undo stack; re-run and Accept → nodes become real, one Ctrl+Z undoes all, selection flies to root.

- [ ] **Step 5: commit** — `feat: proposal preview panel with 3D ghost + accept/reject`

---

### Task F4: Ask the map

Send the whole graph (or the selected subgraph / N-hop neighborhood) to Claude; show the result as an F3b proposal (adds/links) and/or a text answer. Ships a small prompt library. Graph→context serialization is pure/tested.

**Files:**
- Create: `src/renderer/src/core/askContext.ts`, `src/renderer/src/core/askPrompts.ts`, `src/renderer/src/ui/askController.ts`
- Test: `tests/askContext.test.ts`, `tests/askPrompts.test.ts`
- Modify (SHARED): `src/renderer/src/main.ts` (an `#btn-ask` primary button + register palette commands), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/askContext.ts
export type AskScope = 'all' | 'selection' | 'neighborhood';
export function serializeGraphContext(
  state: GraphState,
  opts: { scope: AskScope; focusId?: string | null; hops?: number }
): string;   // compact id\tlabel lines + edge lines (source -> target ["label"]); marks the focus/selected set
// core/askPrompts.ts
export interface AskPreset { id: string; title: string; instruction: string }
export const ASK_PRESETS: AskPreset[];   // what am I missing? / connect unconnected nodes / cluster these / steelman this branch / find contradictions
export function buildAskPrompt(opts: { instruction: string; context: string }): string;
```
`serializeGraphContext`: for `neighborhood` uses `nHopNeighborhood(state.edges.values(), focusId, hops ?? 2)` (throws if `focusId` null); for `selection` restricts to the focus id + its incident edges; for `all` everything. Emits `NODES:` block (`id\tlabel` — append a ` :: <first 80 chars of notes>` when notes non-empty) and `EDGES:` block (`sourceId -> targetId` plus ` "label"` when set), with a leading `FOCUS: <id>` line when a focus set exists. Pure, deterministic (insertion order).

`buildAskPrompt`: instructs Claude that it is analyzing a mind map; embeds the SAME proposal JSON schema block used by voice (reuse the literal so all callers agree), tells it to return ONLY that JSON object, may include `answer` (a short text reply) and MAY return an empty `ops` array when only answering; then `GRAPH CONTEXT:` + context, then `TASK:` + instruction (fenced like the voice transcript so content can't blur structure).

- [ ] **Step 1: failing tests.**
  - `askContext.test.ts`: build a small graph; `scope:'all'` output contains both labels and an edge line; `scope:'neighborhood', focusId, hops:1` excludes a 2-hop node; `focusId:null` with `neighborhood` throws `/focus/`; notes excerpt appears; edge label appears.
  - `askPrompts.test.ts`: `ASK_PRESETS` has ≥5 entries with unique ids; `buildAskPrompt` output contains `"ops"`, the instruction text, and the context text.
- [ ] **Step 2: implement both core modules** (pure).
- [ ] **Step 3: implement `ui/askController.ts`** — export `installAsk(deps: { store, selection, view3d, proposalPanel, registry, session })`. It: (a) registers a palette command per `ASK_PRESET` (`ask-<preset.id>`) and a free-text `ask-map` command (prompts via a small inline input or the F14 modal); (b) wires the `#btn-ask` button to open the same free-text entry. Flow for any ask: choose scope (`selection.get() ? 'neighborhood' : 'all'`), `context = serializeGraphContext(store.state, { scope, focusId: selection.get(), hops: 2 })`, `prompt = buildAskPrompt({ instruction, context })`, `cwd = await session.getMapDir()`, `const p = notify.progress('info','🧠 asking the map…')`; `const opSet = await askClaudeForOps(prompt, cwd)`; if `opSet.ops.length === 0` → `p.dismiss(); proposalPanel.showAnswer(opSet.answer ?? '(no answer)')`; else `p.done('success', opSet.summary); proposalPanel.show(planProposal(opSet, new Set(store.state.nodes.keys()), (id) => store.state.nodes.get(id)?.label ?? id), { answer: opSet.answer })`. Any throw → `p.done('error', \`ask ERROR: ${msg}\`)` and log raw text.
- [ ] **Step 4: wire `main.ts`** — add `<button id="btn-ask">Ask</button>` (primary) after Save; `installAsk({...})`.
- [ ] **Step 5: verify** — typecheck/build/dev with a real map: "what am I missing?" returns a proposal preview of new nodes/links (Accept adds them, one undo); "find contradictions" with no structural change returns a text answer via `showAnswer`.
- [ ] **Step 6: commit** — `feat: ask-the-map (graph context + prompt library) via proposal preview`

---

### Task F5: Import text / file / URL → map

Paste text, pick a file, or fetch a URL → Claude extracts a structure → F3b proposal preview → apply. The extraction prompt is pure/tested; the URL fetch is a scheme-allowlisted main-process handler.

**Files:**
- Create: `src/renderer/src/core/importPrompt.ts`, `src/renderer/src/ui/importController.ts`
- Test: `tests/importPrompt.test.ts`
- Modify (SHARED): `src/main/persistence.ts` (add `url-fetch` handler), `src/shared/ipc.ts` + `src/preload/index.ts` (`fetchUrl`), `src/renderer/src/main.ts` (register palette command), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/importPrompt.ts
export const IMPORT_TRUNCATE = 12000;
export function buildImportPrompt(sourceText: string): string;   // truncates to IMPORT_TRUNCATE, embeds proposal schema
// shared/ipc.ts addition
fetchUrl(url: string): Promise<string>;   // main-process fetch, http/https only
```
`buildImportPrompt`: instructs Claude to read the source and extract a concise node/edge structure (short labels, detail in `notes`), replying ONLY with the proposal JSON (embed the same schema literal); truncates the source and fences it under `SOURCE:`.

- [ ] **Step 1: failing test** `importPrompt.test.ts`: output contains `"ops"`, the source snippet, and truncates input longer than `IMPORT_TRUNCATE` (assert length bound + that a sentinel past the cutoff is absent).
- [ ] **Step 2: implement `core/importPrompt.ts`** (pure).
- [ ] **Step 3: `url-fetch` handler** in `persistence.ts`: `ipcMain.handle('url-fetch', async (_e, url: string) => { const p = new URL(url).protocol; if (p !== 'http:' && p !== 'https:') throw new Error(\`url-fetch: scheme "${p}" not allowed\`); const res = await fetch(url); if (!res.ok) throw new Error(\`url-fetch: ${res.status} ${res.statusText}\`); return res.text(); })` (global `fetch` exists on Node 20/Electron 33). Add `fetchUrl` to `Mind3dApi` + preload (`invoke('url-fetch', url)`).
- [ ] **Step 4: `ui/importController.ts`** — `installImport(deps: { store, selection, view3d, proposalPanel, registry, session })` registers palette command `import-map` opening a modal with a `<textarea>`, a "From file…" button (`pickAttachFile` + `readTextFile`), a "From URL…" input (`fetchUrl`), and an Import button. On Import: resolve `sourceText`; if empty → `notify.error('import: nothing to import')`; else `prompt = buildImportPrompt(sourceText)`, `cwd = await session.getMapDir()`, `progress`, `opSet = await askClaudeForOps(prompt, cwd)`; if `opSet.ops.length===0` → `showAnswer`; else `proposalPanel.show(planProposal(opSet, new Set(store.state.nodes.keys()), labelOf), { answer: opSet.answer })`. Errors → error toast + raw log.
- [ ] **Step 5: wire `main.ts`** — `installImport({...})` (palette-only; no new top-bar button).
- [ ] **Step 6: verify** — typecheck/build/dev: paste a short outline → preview of extracted nodes; Accept adds them (one undo). File and URL paths each produce a preview. Bad scheme (`file://`) → error toast.
- [ ] **Step 7: commit** — `feat: import text/file/URL to map via Claude extraction`

---

### Task F6: Voice upgrades — editable transcript confirm + shared engine

Add an editable transcript confirm step before Claude runs, migrate the voice flow onto the shared proposal engine, and consolidate voice progress into a single updating toast. Investigate live/interim partials; if `nerd-dictation` STDOUT defers, the editable confirm is the review gate.

**Files:**
- Modify: `src/renderer/src/ui/voicePanel.ts`, `src/renderer/src/main.ts` (voice feedback via `progress`), `src/renderer/src/style.css`; investigation may touch `src/main/voiceRunner.ts` (only if a safe partial-stream mode exists — otherwise no change).

- [ ] **Step 1: partial-transcript spike (bounded).** Check whether `nerd-dictation begin --output=STDOUT` can emit interim text incrementally (vs. only on `end`). If a safe streaming flag exists, add an `onVoicePartial` channel and show interim text in the confirm box; if not (the likely case), document the deferral in a code comment and rely on the editable confirm. Do NOT block the feature on this.
- [ ] **Step 2: editable confirm step.** In `voicePanel.ts`, split `runFlow(transcript)` into: `onTranscript` → render an inline confirm UI (a `#voice-confirm` overlay with a `<textarea>` pre-filled with the transcript, `[Run]` `[Cancel]`). Empty transcript → `notify.info('voice: nothing heard')`, stay idle. `[Cancel]` → clear `inFlight`, close. `[Run]` → proceed with the edited text. Keep the `inFlight`/`listening` contract intact: `inFlight` still spans listen→confirm→think→apply and clears in a `finally`; the confirm step holds `inFlight` true (a second mic press must not start a new session mid-confirm).
- [ ] **Step 3: migrate to the shared engine + single-toast feedback.** In the Run handler: build the prompt with `buildVoicePrompt` (unchanged — voice-tailored), `const p = notify.progress('info','🧠 thinking…')`; `const opSet = await askClaudeForOps(prompt, cwd)` (replaces `voiceClaude` + `parseVoiceResult`); `const plan = planProposal(opSet, new Set(store.state.nodes.keys()), (id)=>store.state.nodes.get(id)?.label ?? id)`; **direct-apply with an undo affordance** (the cleaner UX for hold-to-speak — documented choice; Ask/Import own the preview flow): `view3d.spawnNear(plan.newNodeIds, selectedId); store.apply(plan.command); if (plan.rootId){ selection.set(plan.rootId); view3d.flyTo(plan.rootId); } p.done('success', \`${plan.newNodeIds.length} added — Ctrl+Z to undo · ${opSet.summary}\`)`. Errors → `p.done('error', \`voice ERROR: ${msg}\`)` + raw log. Update the mapSession/main `setStatus`-style calls for voice to use this `progress` handle instead of stacking info toasts.
- [ ] **Step 4: docs.** Update `docs/USER_GUIDE.md` / README voice section: hold 🎤 → speak → edit the heard text → Run → nodes appear, Ctrl+Z undoes the batch; note that Ask/Import show an accept/reject preview while voice direct-applies.
- [ ] **Step 5: verify** — `npm test`/`typecheck`/`build` (voiceOps + voicePrompt tests still green — voicePrompt unchanged; voiceOps still delegates); dev launch: the confirm box appears with editable text; Cancel aborts cleanly; Run creates nodes with a single progress toast that ends in a success/undo hint; live mic round-trip is the human smoke test.
- [ ] **Step 6: commit** — `feat: voice upgrades — editable transcript confirm + shared proposal engine`

---

### Task F7: Search notes + semantic-search spike with lexical fallback

FIRST a feasibility spike for a local offline embedding model; UNCONDITIONALLY build a lexical ranker that searches labels AND notes (so search covers notes regardless); layer semantic ranking on top only if the spike succeeds, always falling back to lexical.

**Files:**
- Create: `src/renderer/src/core/search.ts`; Test `tests/search.test.ts`. Conditionally: `src/renderer/src/core/semantic.ts` (pure cosine) + `tests/semantic.test.ts`, `src/renderer/src/embeddingWorker.ts` (worker), and a throwaway `spike/embed-spike/` (git-ignored, not committed).
- Modify (SHARED): `src/renderer/src/main.ts` (search box uses `searchNodes`; optional "related to X" command), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/search.ts (ALWAYS built)
export interface SearchHit { id: string; score: number }
export function searchNodes(state: GraphState, query: string): SearchHit[];   // fuzzy over label + notes, ranked desc
// core/semantic.ts (ONLY if spike succeeds)
export function cosineSimilarity(a: Float32Array, b: Float32Array): number;    // throws on length mismatch
export function rankByCosine(query: Float32Array, vecs: Map<string, Float32Array>): SearchHit[];
```

- [ ] **Step 1: SPIKE (bounded, throwaway).** In `spike/embed-spike/`, attempt to load a small MiniLM embedding model (all-MiniLM-L6-v2, ~23 MB) in the Electron **renderer**, offline, no keys — try `@xenova/transformers` (transformers.js) with a locally-cached/bundled model dir first, then `onnxruntime-web` if needed. Success criteria: model loads with the network OFF (after one allowed cache/populate), embeds two strings, cosine ranks the more-similar pair higher, and total added footprint is acceptable. Record PASS/FAIL + notes in the commit body and in `docs/build-records/`. **This spike gates Step 3 only; Steps 2/4 run either way.**
- [ ] **Step 2: lexical ranker (unconditional).** `tests/search.test.ts`: a node whose match is only in `notes` (not `label`) is found; label matches outrank notes-only matches; non-matching query returns `[]`; ranking is by fuzzy score. Implement `searchNodes` = for each node compute `labelScore = fuzzyScore(q, label)`, `notesScore = fuzzyScore(q, notes)`; keep nodes with any non-null; score = `max(labelScore ?? -Inf, (notesScore ?? -Inf) - PENALTY)` (a small notes penalty so a label hit wins ties); sort desc.
- [ ] **Step 3: semantic layer (ONLY on spike PASS).** `tests/semantic.test.ts`: `cosineSimilarity` on hand vectors (orthogonal→0, identical→1, length-mismatch throws `/length/`); `rankByCosine` orders by similarity. Implement `core/semantic.ts` (pure). Add `src/renderer/src/embeddingWorker.ts` (a Web Worker: loads the model once, embeds `{id,text}` batches, posts back `{id, vec}`), an incremental index in the renderer that re-embeds only nodes whose `label`/`notes` changed (subscribe to `props`/`structure` events; keep compute OFF the main thread), and switch the search box to: semantic rank when the index is ready, else `searchNodes` (lexical) — always a working fallback if the model fails to load at runtime. If the spike FAILED, SKIP this step and add a one-line deferral note in `docs/build-records/` (embeddings deferred; lexical+notes shipped).
- [ ] **Step 4: wire `main.ts`.** Replace the search box's `fuzzyScore(q, n.label)` block with `searchNodes(store.state, q)` (now covers notes); if semantic is active, prefer it. Optionally register a `related-to-selection` palette command (semantic → nearest neighbors; lexical fallback → `searchNodes` on the selected label).
- [ ] **Step 5: verify** — `npm test`/`typecheck`/`build`; dev: searching a term that appears only in a node's notes finds it; if semantic active, "related to X" surfaces semantically-near nodes; with the model absent, search still works (lexical).
- [ ] **Step 6: commit** — `feat: search notes + semantic-search spike with lexical fallback`

---

### Task F8: Snapshots + visual diff (file format v2 + v1 upgrade)

Named checkpoints saved in the map file; a diff view coloring nodes/edges added/removed/changed. Bumps `FILE_VERSION` to 2 and installs the optional-section loader + v1 in-memory upgrade (see the File format policy above).

**Files:**
- Create: `src/renderer/src/core/snapshot.ts`, `src/renderer/src/ui/snapshotController.ts`
- Test: `tests/snapshot.test.ts`; extend `tests/serialize.test.ts`
- Modify (SHARED): `src/renderer/src/core/serialize.ts` (v2 + snapshots + upgrade), `src/renderer/src/mapSession.ts` (hold/serialize snapshots), `src/renderer/src/ui/view3d.ts` (diff overlay), `src/renderer/src/main.ts` (register commands), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/snapshot.ts
export interface Snapshot { id: string; name: string; createdAt: string; nodes: MindNode[]; edges: MindEdge[] }
export function createSnapshot(name: string, state: GraphState): Snapshot;   // deep copies current nodes/edges
export function snapshotToState(snap: Snapshot): GraphState;
export interface GraphDiff {
  nodesAdded: string[]; nodesRemoved: string[]; nodesChanged: string[];
  edgesAdded: string[]; edgesRemoved: string[]; edgesChanged: string[];
}
export function diffStates(before: GraphState, after: GraphState): GraphDiff;  // by id; changed = same id, differing fields
// serialize.ts (CHANGED)
export const FILE_VERSION = 2;
export function serializeGraph(state: GraphState, meta: MapMeta, extras?: { snapshots?: Snapshot[] }): string;
export function deserializeGraph(text: string): { state: GraphState; meta: MapMeta; snapshots: Snapshot[] };
```

- [ ] **Step 1: `snapshot.test.ts`** — `createSnapshot` deep-copies (mutating the store after does not change the snapshot); `snapshotToState` round-trips; `diffStates`: added/removed by id, `nodesChanged` when a label/notes/color/position differs, `edgesChanged` when an edge's endpoints/label differ, unchanged ids absent from every list.
- [ ] **Step 2: implement `core/snapshot.ts`** — deep copy via `structuredClone` of `[...state.nodes.values()]`/`[...edges.values()]`; `diffStates` compares id sets + per-field equality (nodes: label,notes,color,tags,fx,fy,fz,attachedFile; edges: source,target,label,(relation once F10 lands — compare defensively via `JSON.stringify` of a normalized tuple)).
- [ ] **Step 3: serialize v2.** Bump `FILE_VERSION = 2`. Refactor the top-level validator: `TOP_REQUIRED = {version, meta, nodes, edges}`, `TOP_OPTIONAL = {snapshots}` (F9/F12 will extend this set). Reject keys outside required∪optional; require all required present; `snapshots` defaults to `[]` when absent (parse+validate each snapshot strictly when present — reuse `parseNode`/`parseEdge`). Accept `version` `1` **or** `2` (a v1 doc has no optionals → upgrades to `{...snapshots:[]}` in memory); reject any other version. `serializeGraph` writes `version:2` and includes `snapshots` (default `[]`). `deserializeGraph` returns `{state, meta, snapshots}`.
- [ ] **Step 4: extend `serialize.test.ts`** (necessary, called out): change `rejects wrong version` to expect a rejection for **version 3** (not 2); ADD `accepts a v1 file (no snapshots) and upgrades to empty snapshots`; ADD `round-trips snapshots`; keep the existing round-trip/field/dangling-edge/duplicate/pin tests (they pass unchanged — 2-arg `serializeGraph` still valid, `snapshots` defaults to `[]`, `deserialize`'s extra `snapshots` key doesn't disturb the `state`/`meta` assertions).
- [ ] **Step 5: `mapSession.ts`** — hold `private snapshots: Snapshot[] = []`; read them in `open()` (`const { state, meta, snapshots } = deserializeGraph(...)`), write them in `save()`/recovery (`serializeGraph(state, meta, { snapshots: this.snapshots })`); expose `addSnapshot(name)`, `listSnapshots()`, `restoreSnapshot(id)` (→ `store.loadState(snapshotToState(snap))`, marks dirty). `newMap()` clears snapshots.
- [ ] **Step 6: diff overlay + commands.** `ui/snapshotController.ts` registers palette commands: `snapshot-save` (name via F14 modal/inline prompt → `session.addSnapshot`), `snapshot-compare` (pick a snapshot → `diffStates(snapshotToState(snap), store.state)` → `view3d.showDiff(diff)` + a summary toast/panel), `snapshot-restore`, `diff-clear`. `view3d.showDiff(diff)`: color current nodes via a `diffColors: Map<id,color>` (added `#5fd08a`, changed `#ffd54a`), ghost the removed nodes (reuse the ghost mechanism, red `#e05a5a`); `clearDiff()` resets. `makeSprite` consults `diffColors` before the default color.
- [ ] **Step 7: verify** — `npm test`/`typecheck`/`build`; dev: save a snapshot, mutate the map, Compare → added green / changed yellow / removed red-ghosted + counts; Restore loads the snapshot (history cleared, like Open); Save then reopen the file → snapshots persist; open an existing v1 map file → loads fine with zero snapshots.
- [ ] **Step 8: commit** — `feat: snapshots + visual diff (file format v2 + v1 upgrade)`

---

### Task F9: Camera viewpoints and tours

Save named camera viewpoints (position + target) with the map; a tour is an ordered list of viewpoints/nodes with next/prev (and keys). Viewpoint/tour models are pure/tested; camera application lives in View3D.

**Files:**
- Create: `src/renderer/src/core/viewpoint.ts`, `src/renderer/src/ui/tourController.ts`
- Test: `tests/viewpoint.test.ts`; extend `tests/serialize.test.ts`
- Modify (SHARED): `src/renderer/src/core/serialize.ts` (add `viewpoints`/`tours` to the optional set), `src/renderer/src/mapSession.ts` (hold/serialize), `src/renderer/src/ui/view3d.ts` (`getCamera`/`applyCamera`), `src/renderer/src/main.ts` (register commands + prev/next keys), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/viewpoint.ts
export interface Vec3 { x: number; y: number; z: number }
export interface Viewpoint { id: string; name: string; position: Vec3; target: Vec3 }
export interface TourStop { kind: 'viewpoint' | 'node'; ref: string }
export interface Tour { id: string; name: string; stops: TourStop[] }
export function createViewpoint(name: string, position: Vec3, target: Vec3): Viewpoint;
export function stepTour(tour: Tour, index: number, dir: 1 | -1): number;   // clamped to [0, stops.length-1]; throws on empty tour
// view3d.ts additions
getCamera(): { position: Vec3; target: Vec3 };
applyCamera(vp: { position: Vec3; target: Vec3 }, ms?: number): void;   // graph.cameraPosition(pos, target, ms)
// serialize.ts (extended)
export function serializeGraph(state, meta, extras?: { snapshots?: Snapshot[]; viewpoints?: Viewpoint[]; tours?: Tour[] }): string;
export function deserializeGraph(text): { state; meta; snapshots: Snapshot[]; viewpoints: Viewpoint[]; tours: Tour[] };
```

- [ ] **Step 1: `viewpoint.test.ts`** — `createViewpoint` sets a uuid + fields; `stepTour` clamps at both ends (`index 0, dir -1 → 0`; last, `+1 → last`) and moves otherwise; empty tour throws `/empty tour/`.
- [ ] **Step 2: implement `core/viewpoint.ts`** (pure).
- [ ] **Step 3: serialize extension** — add `viewpoints`,`tours` to `TOP_OPTIONAL` (default `[]` each, strict validation when present); extend `serializeGraph`'s `extras` and `deserializeGraph`'s return. Extend `serialize.test.ts`: a v2 file lacking `viewpoints`/`tours` still loads (defaults `[]`); round-trip viewpoints+tours.
- [ ] **Step 4: view3d camera get/apply** — `getCamera()` returns `graph.cameraPosition()` (current) + `graph.controls().target`; `applyCamera` calls `graph.cameraPosition(position, target, ms ?? 800)`.
- [ ] **Step 5: `ui/tourController.ts` + mapSession** — mapSession holds `viewpoints`/`tours`, serialized like snapshots. Controller registers palette commands: `viewpoint-save` (name → `createViewpoint(name, ...view3d.getCamera())`), `viewpoint-goto` (pick → `applyCamera`), `tour-create` (from current viewpoints/selected nodes), `tour-play` (holds an index; `applyCamera` for a `viewpoint` stop or `flyTo` for a `node` stop). Bind `[` / `]` (or PageUp/PageDown) to prev/next while a tour is active via `stepTour`.
- [ ] **Step 6: verify** — typecheck/build/dev: save two viewpoints, goto each (camera animates); build a 3-stop tour, `]`/`[` walk it; Save+reopen → viewpoints/tours persist; a v2 file without them still opens.
- [ ] **Step 7: commit** — `feat: camera viewpoints and tours`

---

### Task F10: First-class edges — selection, label, relation

Edge selection (click an edge → a lightweight edge editor), editable edge label, and an edge relation (none/supports/refutes/depends) rendered as color/style and understood by the proposal schema. Adds `relation` to the model, `setEdgeLabel`/`setEdgeRelation` commands, and the proposal-schema relation field.

**Files:**
- Modify (SHARED): `src/renderer/src/core/model.ts` (`EdgeRelation`, `MindEdge.relation`, `createEdge` default), `src/renderer/src/core/commands.ts` (`setEdgeLabel`, `setEdgeRelation`), `src/renderer/src/core/serialize.ts` (edge `relation` optional-with-default), `src/renderer/src/core/proposal.ts` (edge `relation` in schema + plan), `src/renderer/src/core/voicePrompt.ts` (+ F4/F5 prompt schema literal: mention relation), `src/renderer/src/ui/view3d.ts` (edge click/editor, link color/label by relation), `src/renderer/src/main.ts` (register edge commands)
- Test: extend `tests/store.test.ts`, `tests/serialize.test.ts`, `tests/proposal.test.ts`

**Interfaces produced:**
```ts
// model.ts
export type EdgeRelation = 'none' | 'supports' | 'refutes' | 'depends';
export const EDGE_RELATIONS: EdgeRelation[] = ['none', 'supports', 'refutes', 'depends'];
export interface MindEdge { id: string; source: string; target: string; label: string | null; relation: EdgeRelation }
export function createEdge(source: string, target: string, label?: string | null, relation?: EdgeRelation): MindEdge; // defaults null,'none'
// commands.ts
export function setEdgeLabel(id: string, label: string | null): Command;      // kind 'structure' (forces link rebuild)
export function setEdgeRelation(id: string, relation: EdgeRelation): Command;  // kind 'structure'
// proposal.ts (extended)
export interface ProposalEdgeOp { op: 'edge'; from: string; to: string; label?: string; relation?: EdgeRelation }
```

- [ ] **Step 1: model + createEdge default.** Add `relation` to `MindEdge` and default it in `createEdge`. Existing `createEdge(a,b)` callers keep working (relation `'none'`).
- [ ] **Step 2: commands + test.** `setEdgeLabel`/`setEdgeRelation` as prop-style commands on edges (capture prev for undo; `throw` if no such edge; `kind: 'structure'` so `view3d.rebuild()` repaints links). Extend `store.test.ts`: set/undo label; set/undo relation; invalid relation is a TS-level constraint (runtime guard in serialize/proposal). Note: `deleteEdge`/`reparent`/`addEdge` already handle the edge object generically — no change needed beyond the new field flowing through.
- [ ] **Step 3: serialize relation (optional-with-default).** Refactor `parseEdge`: required keys `{id,source,target,label}` + optional `{relation}`; reject keys outside that union; when `relation` present, validate it is one of `EDGE_RELATIONS` (`throw` naming the edge), else default `'none'`. `serializeGraph` writes `relation` (it's now on every edge). Extend `serialize.test.ts`: a v2 edge WITHOUT `relation` loads as `'none'`; an edge with an invalid relation throws; round-trip preserves a set relation. (The existing round-trip test's edges now carry `relation:'none'` via `createEdge` — still `toEqual`-equal on both sides.)
- [ ] **Step 4: proposal schema relation.** Add `relation?: EdgeRelation` to `ProposalEdgeOp`; `parseProposal` validates it (optional; must be in `EDGE_RELATIONS`, else `throw` naming the op index); `planProposal` passes it into `createEdge(from, to, op.label ?? null, op.relation ?? 'none')` and includes it in `humanOps`. Extend `proposal.test.ts`: relation parsed + applied to the created edge; invalid relation throws `/op\[/`. Update the shared schema literal (used by `voicePrompt`, `askPrompts`, `importPrompt`) to document the optional `relation` values.
- [ ] **Step 5: view3d edges.** Extend `simLinks` to carry `label`/`relation` (read from store edges in `rebuild`). Add `.linkColor((l) => RELATION_COLOR[l.relation])` (`none` default grey, `supports` green, `refutes` red, `depends` blue) and `.linkLabel((l) => l.label ?? '')`. Track `hoverLinkId` via `.onLinkHover`. Add `.onLinkClick((l) => this.openEdgeEditor(l.id))` → a small floating editor (a text `<input>` for label + a `<select>` of `EDGE_RELATIONS`) positioned near the link midpoint, applying `setEdgeLabel`/`setEdgeRelation` on change; Esc/blur closes.
- [ ] **Step 6: wire `main.ts`** — register palette commands `edge-set-relation`/`edge-set-label`/`edge-delete` gated on a hovered/selected edge (via new `view3d.hoveredLink()`), reusing the same handlers.
- [ ] **Step 7: verify** — `npm test`/`typecheck`/`build`; dev: click an edge → editor; set a label (renders on the link) and a relation (link recolors); Ctrl+Z reverts each; Save+reopen preserves both; open a pre-F10 v2 file → edges load with relation `none`; Ask/voice can produce a `supports`/`refutes` edge via the schema.
- [ ] **Step 8: commit** — `feat: first-class edges — selection, label, relation`

---

### Task F11: Tag filter and color-by-tag

Make the existing (write-only) tags useful: a filter (show/dim/hide by tag) + a color-by-tag option, integrated with the View3D dim mechanism. A small pure tags index + filter state.

**Files:**
- Create: `src/renderer/src/core/tags.ts`, `src/renderer/src/ui/tagBar.ts`
- Test: `tests/tags.test.ts`
- Modify (SHARED): `src/renderer/src/ui/view3d.ts` (dim-filter + color-by-tag), `src/renderer/src/main.ts` (mount tag bar + register commands), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// core/tags.ts
export function collectTags(state: GraphState): string[];                    // sorted unique across nodes
export function nodesWithAnyTag(state: GraphState, tags: Set<string>): Set<string>;
export function tagColor(tag: string): string;                              // deterministic hash → stable hsl()
// view3d.ts additions
setDimFilter(visible: Set<string> | null): void;   // null clears; else dim (DIM_OPACITY) nodes not in the set
setColorByTag(colorOf: ((nodeId: string) => string | null) | null): void;  // null clears override
```

- [ ] **Step 1: `tags.test.ts`** — `collectTags` returns sorted unique tags; `nodesWithAnyTag` returns exactly the nodes carrying any active tag (empty set → empty); `tagColor` is deterministic (same tag → same color) and stable across calls.
- [ ] **Step 2: implement `core/tags.ts`** (pure).
- [ ] **Step 3: view3d.** Generalize the dim path: `makeSprite` already dims non-`focusSet` nodes — add a parallel `dimFilter: Set<string> | null` (a node is dimmed if `focusSet` excludes it OR `dimFilter` excludes it). `setColorByTag(colorOf)`: store the fn; in `makeSprite`, when set and not selected, use `colorOf(id) ?? node.color ?? default`. `refresh()` after either setter.
- [ ] **Step 4: `ui/tagBar.ts` + main.** A compact tag bar (in the outline panel header or a collapsible strip): toggle chips from `collectTags(store.state)` (rebuilt on structure events), a mode selector (show/dim/hide), and a "color by tag" checkbox. On change: compute `active` set; `visible = nodesWithAnyTag(store.state, active)`; `view3d.setDimFilter(active.size === 0 ? null : visible)` (hide mode = dim at opacity 0 / skip; keep one code path — dim is the primary; document hide as stronger dim). Color-by-tag → `view3d.setColorByTag(on ? (id) => { const t = store.state.nodes.get(id)?.tags[0]; return t ? tagColor(t) : null } : null)`. Register palette commands `tag-filter`/`tag-color-toggle`.
- [ ] **Step 5: verify** — typecheck/build/dev: tag a few nodes; activating a tag dims the rest; color-by-tag recolors sprites by first tag; clearing restores; interacts sanely with focus mode (both dims compose).
- [ ] **Step 6: commit** — `feat: tag filter and color-by-tag`

---

### Task F12: 2D mode toggle (persisted per map)

A toggle (toolbar + palette) switching the layout to 2D via `numDimensions(2)`, camera locked top-down, orbit disabled (pan/zoom only), z pinned to 0. One renderer, one code path. Persist the mode per map.

**Files:**
- Modify (SHARED): `src/renderer/src/ui/view3d.ts` (`setDims`), `src/renderer/src/core/serialize.ts` (`mode` optional), `src/renderer/src/mapSession.ts` (hold/serialize/apply mode), `src/renderer/src/main.ts` (toggle button + palette command), `src/renderer/src/style.css`
- Test: extend `tests/serialize.test.ts`

**Interfaces produced:**
```ts
// view3d.ts
setDims(n: 2 | 3): void;   // graph.numDimensions(n); 2D: lock camera top-down, disable orbit rotate, pin z=0 for edits
dims(): 2 | 3;
// serialize.ts (extended)
export type ViewMode = '2d' | '3d';
export function serializeGraph(state, meta, extras?: { snapshots?; viewpoints?; tours?; mode?: ViewMode }): string;
export function deserializeGraph(text): { state; meta; snapshots; viewpoints; tours; mode: ViewMode };   // default '3d'
```

- [ ] **Step 1: view3d `setDims`.** `graph.numDimensions(n)`. In 2D: set `this.dimsValue = 2`; disable orbit rotation (`graph.controls().enableRotate = false`), position the camera straight down the z axis at the graph center (top-down), keep pan/zoom; clamp new-node creation to `z = 0` (in `dblclick`/`addChild`/`spawnNear`, force z to 0 when `dimsValue === 2`) and set `numDimensions(2)` so the sim keeps z≈0. 3D reverses (`enableRotate = true`). `dims()` returns the current value.
- [ ] **Step 2: serialize `mode`.** Add `mode` to `TOP_OPTIONAL` (default `'3d'`; validate it is `'2d'`|`'3d'`). Extend `serializeGraph`/`deserializeGraph`. Extend `serialize.test.ts`: a file without `mode` loads as `'3d'`; round-trip `'2d'`.
- [ ] **Step 3: mapSession + main.** mapSession holds `mode`, serializes it, and on `open()` calls `view3d.setDims(mode === '2d' ? 2 : 3)`; `newMap()` resets to `'3d'`. main adds a `#btn-2d` toggle (primary — it changes the whole view) + a `toggle-2d` palette command that flips `view3d.dims()` and updates the stored mode (marks dirty).
- [ ] **Step 4: verify** — typecheck/build/dev: toggle 2D → graph flattens, camera top-down, rotation disabled, pan/zoom + node create/drag still work in-plane; toggle back to 3D; Save+reopen restores the mode.
- [ ] **Step 5: commit** — `feat: 2D mode toggle (numDimensions) persisted per map`

---

### Task F13: Node / edge / background context menu

Right-click a node → menu (add child, link, ask Claude, attach, delete, pin/unpin); right-click empty → new node, paste; right-click an edge → edit label/relation, delete. Reuses existing commands and suppresses the browser menu; keyboard shortcuts stay.

**Files:**
- Create: `src/renderer/src/ui/contextMenu.ts`
- Modify (SHARED): `src/renderer/src/ui/view3d.ts` (expose `hoveredNode()`/`hoveredLink()`; a public `addChildTo(id)`/`startLinkFrom(id)`/`togglePinFor(id)` if not already public), `src/renderer/src/main.ts` (mount the menu), `src/renderer/src/style.css`

**Interfaces produced:**
```ts
// view3d.ts additions (getters + small public wrappers over existing private methods)
hoveredNode(): string | null;   // returns this.hoverNodeId
hoveredLink(): string | null;   // returns this.hoverLinkId (added in F10)
container(): HTMLElement;        // for the menu to attach a 'contextmenu' listener
addChildTo(id: string): void; startLinkFrom(id: string): void; togglePinFor(id: string): void; deleteNodeById(id: string): void;
// ui/contextMenu.ts
export class ContextMenu { constructor(deps: { view3d; store; selection; proposalPanel; session; registry }); }  // self-wiring
```

- [ ] **Step 1: view3d exposure.** Add the getters and thin public wrappers delegating to the existing private `addChild`/`link`/`togglePin`/`deleteNode` paths (do not duplicate logic). Ensure the container's default `contextmenu` is not triggered elsewhere.
- [ ] **Step 2: `ui/contextMenu.ts`.** Attach a `'contextmenu'` listener on `view3d.container()`: `ev.preventDefault()`, read `view3d.hoveredNode()` then `view3d.hoveredLink()`; build a positioned `<div class="ctx-menu">` with items by target:
  - node: Add child, Link from here, Ask about this (F4 neighborhood ask on this node), Attach file (`setAttachedFile` via `pickAttachFile`), Pin/Unpin, Delete.
  - edge: Edit label…, Set relation ▸ (submenu of `EDGE_RELATIONS`), Delete edge.
  - background: New node here (worldPointAt at the cursor), Paste (if clipboard text → import via F5's `buildImportPrompt`).
  Each item calls the SAME function its palette command/handler uses. Click-away / Esc closes; only one menu at a time.
- [ ] **Step 3: verify** — typecheck/build/dev: right-click surfaces the correct menu per target; every item performs its action and is undoable where it mutates; the native browser menu never appears; keyboard shortcuts still work.
- [ ] **Step 4: commit** — `feat: node/edge/background context menu`

---

### Task F14: Undo/redo visibility + change toasts + in-app confirm modal

Visible undo/redo buttons (enabled from `store.canUndo`/`canRedo`), a toast naming what was undone/redone (the command name), and an in-app styled confirm modal replacing bare `confirm()`.

**Files:**
- Create: `src/renderer/src/ui/modal.ts`
- Modify (SHARED): `src/renderer/src/core/store.ts` (extend `ChangeEvent` with `name` + `source`), `src/renderer/src/mapSession.ts` (`newMap` → async modal), `src/renderer/src/main.ts` (undo/redo buttons + change toasts + async New), `src/renderer/src/style.css`
- Test: extend `tests/store.test.ts`

**Interfaces produced:**
```ts
// store.ts (ChangeEvent EXTENDED — additive)
export interface ChangeEvent { kind: ChangeKind; ids: string[]; name: string; source: 'apply' | 'undo' | 'redo' }
// ui/modal.ts
export function confirmModal(message: string, opts?: { okLabel?: string; cancelLabel?: string }): Promise<boolean>;
```

- [ ] **Step 1: extend `ChangeEvent`.** `apply` emits `{ kind, ids, name: cmd.name, source: 'apply' }`; `undo` → `source: 'undo'`; `redo` → `source: 'redo'`; `loadState` → `{ kind:'structure', ids:[], name:'loadState', source:'apply' }`. Existing subscribers read only `.kind`/`.ids` (verified across view3d, main, detailPanel, mapSession) so they are unaffected. Extend `store.test.ts`: the existing "events carry kind and ids" test stays green (it reads `.kind`/`.ids`); ADD a test asserting `name` + `source` across an apply / undo / redo sequence (e.g. `setLabel` → `['apply','undo','redo']` with `name==='setLabel'`).
- [ ] **Step 2: `ui/modal.ts`.** `confirmModal` returns a `Promise<boolean>`: build a centered overlay (`#app-modal`) with the message and OK/Cancel buttons; resolve `true`/`false` on click, `Escape` → `false`, click-scrim → `false`; remove the overlay on settle. Consistent with the dark tokens.
- [ ] **Step 3: mapSession modal.** Make `newMap()` `async`: replace `confirm('Discard current map?')` with `await confirmModal('Discard current map?', { okLabel: 'Discard', cancelLabel: 'Keep' })`; return the boolean as today.
- [ ] **Step 4: main.ts buttons + toasts + async New.**
  - Add `#btn-undo`/`#btn-redo` (primary) near New/Open/Save; a `refreshUndoRedo()` sets `disabled` from `store.canUndo`/`canRedo`, called on every change event; wire clicks to `store.undo()`/`store.redo()` and Ctrl+Z/Shift+Z already present.
  - Subscribe once: on `ev.source === 'undo'` → `notify.info(\`Undid: ${ev.name}\`)`; on `'redo'` → `notify.info(\`Redid: ${ev.name}\`)` (skip `loadState`).
  - The New handler becomes `guard(async () => { const made = await session.newMap(); notify[made ? 'success' : 'info'](made ? 'new map' : 'kept current map'); })`.
  - Register palette commands `undo`/`redo` (`when` from canUndo/canRedo).
- [ ] **Step 5: verify** — `npm test` (store test + all prior green), `typecheck`, `build`; dev: undo/redo buttons enable/disable correctly; each undo/redo shows a toast naming the command; New on a non-empty map shows the styled modal (Keep aborts, Discard clears); Esc/scrim cancels.
- [ ] **Step 6: commit** — `feat: undo/redo buttons, change toasts, in-app confirm modal`

---

## Self-review record

1. **Feature coverage (F1–F14):** every feature is exactly one task (F3 split into F3a core/engine + F3b preview UI). F1 toasts+status-split+onboarding; F2 palette; F3a proposal core+voiceOps delegation+`claude-oneshot`; F3b ghost preview; F4 ask; F5 import; F6 voice upgrades; F7 search-notes + semantic spike/fallback; F8 snapshots+diff (v2 format); F9 viewpoints/tours; F10 edges (label+relation); F11 tags; F12 2D; F13 context menu; F14 undo/redo visibility + confirm modal. ✓
2. **F3 split & voiceOps migration:** F3a builds pure `core/proposal.ts` (`parseProposal`/`planProposal`/`Proposal`) carrying the voice algorithm verbatim; `voiceOps.ts` becomes type-alias + thin delegating wrappers so `tests/voiceOps.test.ts` and `tests/voicePrompt.test.ts` stay green **untouched** (chosen over updating callers/tests). Error substrings preserved (`op[i]`, `valid JSON`, `summary`, `unknown id`, `duplicate`, `self-loop`, `nothing to create`) so delegation passes. One-shot spawn generalized to `claude-oneshot` (`voiceClaude`→`askClaude`); F3b adds the ghost + accept/reject. ✓
3. **F7 fallback structure:** Step 1 is a bounded, throwaway spike (transformers.js/onnxruntime-web MiniLM in the renderer, offline, no keys) that gates ONLY the semantic layer. Step 2 (`core/search.ts` lexical over **label + notes** + fuzzy) is unconditional, so "search must cover notes" holds regardless. Step 3 (pure cosine + a worker + incremental re-embed) runs only on spike PASS and always falls back to lexical at runtime; on FAIL it is skipped with a documented deferral. No hard dependency on embeddings. ✓
4. **Format safety:** one bump `1→2` in F8 with a required/optional top-level split; F9 (`viewpoints`/`tours`), F12 (`mode`), and F10 (edge `relation`, optional-with-default) extend the v2 family without further numeric bumps; every extension adds a "loads without this section" test, and v1 files upgrade in memory (F8 test). Strict validation retained (unknown keys and malformed values throw). ✓
5. **Interface consistency:** `Proposal`/`ProposalOpSet`/`parseProposal`/`planProposal` defined in F3a are consumed with identical signatures by F3b (`proposalPanel.show(proposal)`), F4, F5, F6; `askClaudeForOps(prompt, cwd)` used identically by F4/F5/F6; `view3d.showGhost/clearGhost/spawnNear/flyTo/getCamera/applyCamera/setDimFilter/setColorByTag/setDims/hoveredNode/hoveredLink` referenced consistently across F3b/F8/F9/F10/F11/F12/F13; `EdgeRelation`/`EDGE_RELATIONS` defined once in `model.ts` (F10) and imported by `commands.ts`/`serialize.ts`/`proposal.ts`/`view3d.ts`; `ChangeEvent`'s new `name`/`source` (F14) are additive and read only where needed. ✓
6. **Clean-design & no placeholders:** new actions register in the F2 registry (no unbounded top-bar growth; only genuine primaries get buttons — Ask, undo/redo, 2D, mic); reuse of `core/fuzzy`, `DOMPurify`, `Toasts`, `pendingSpawn`/`spawnNear`, `composite`, the ghost mechanism, the single dim path. No TODOs/placeholders — each task's shared-file edits and interfaces are named exactly so tasks compose. ✓
