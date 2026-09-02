# mind3d — guide for AI agents working in this repo

A 3D mind-mapping desktop app: Electron + Vite + TypeScript, a `3d-force-graph`
view, a Workflowy-style outline, per-node markdown/attachments, a per-node
`claude -p` runner, and a push-to-talk **voice mode** (offline transcription →
Claude → nodes). Cycles are allowed; the model is a general directed graph, not a
tree.

This file is the orientation you should read before changing anything. The
companion end-user doc is `docs/USER_GUIDE.md`.

## Commands

```bash
npm install
npm run dev         # launch the app (electron-vite, hot reload)
npm run build       # production build (main + preload + renderer)
npm test            # vitest (pure-logic unit tests)
npm run typecheck   # tsc --noEmit
```

Always run `npm test` and `npm run typecheck` before committing; run `npm run
build` when you touch main/preload or anything that could break bundling.

## Non-negotiable rules

1. **TypeScript strict, no `any`.** The single permitted `any` is the
   `3d-force-graph` boundary in `src/renderer/src/ui/view3d.ts`, and it is
   commented as such. Do not add others.
2. **Every graph mutation goes through a `GraphStore` command.** Never write to
   `GraphState` (its `nodes`/`edges` Maps) directly outside `core/commands.ts` /
   `core/store.ts`. Commands are what make undo/redo correct across all three UI
   surfaces. A batch of changes that should undo as one unit uses
   `composite(name, cmds)` (it rolls back atomically if a sub-command throws).
3. **Fail fast.** Validate inputs and `throw new Error` with a message naming the
   offending field/id. Never silently default, drop, or sentinel-fill. Errors
   surface to the user via the status bar; they must not be swallowed.
4. **No secrets, ever.** `claude -p` inherits the machine's Claude Code login;
   `nerd-dictation` is fully offline. Child processes get `process.env`
   pass-through only. No API key or token goes into code, config, or git history.
   `.env` is gitignored.
5. **Renderer is sandboxed from the system.** `contextIsolation: true`,
   `nodeIntegration: false`. The renderer touches the OS only through
   `window.mind3d` (the preload bridge). All rendered markdown passes through
   `DOMPurify.sanitize`.
6. **Conventional commits**, body ending with the project's Co-Authored-By +
   Claude-Session trailer (see git log for the exact form).

## Architecture

Three layers, thin at the edges:

- **`src/main/`** — Electron main process. Window creation, native dialogs,
  filesystem, and child processes (`claude -p`, `nerd-dictation`). Keep it thin:
  it does I/O and spawns, nothing about graph semantics.
  - `index.ts` — window + app lifecycle + the quit/close save handshake; registers
    every IPC module.
  - `persistence.ts` — open/save dialogs, atomic write + `.bak.1..5` rotation,
    the `recovery.json` writer, and `open-external` (scheme-allowlisted).
  - `claudeRunner.ts` — the per-node streaming `claude -p` runner.
  - `voiceRunner.ts` — `nerd-dictation` push-to-talk + the one-shot `voice-claude`
    handler.
- **`src/preload/index.ts`** — the `window.mind3d` bridge. Every renderer→OS call
  and every OS→renderer event is declared here and in `src/shared/ipc.ts`. `on*`
  subscription wrappers use `removeAllListeners`-before-`on` (single-subscriber,
  last-wins).
- **`src/shared/ipc.ts`** — the `Mind3dApi` interface and IPC payload types. The
  one contract both processes share.
- **`src/renderer/`** — everything else, vanilla TS + DOM, no UI framework.
  - `core/` — pure, unit-tested logic: `model.ts` (types + `createNode`/
    `createEdge`), `commands.ts` (the command factories), `store.ts`
    (`GraphStore`: apply/undo/redo + change events), `serialize.ts` (versioned
    JSON + strict validation), `outline.ts` (graph→spanning-tree projection with
    mirror rows), `neighborhood.ts` (n-hop BFS for focus mode), `fuzzy.ts`
    (search scoring), `selection.ts`, `voiceOps.ts` + `voicePrompt.ts` (voice:
    parse+validate Claude's JSON → commands, and build the prompt).
  - `ui/` — `view3d.ts` (the 3D view + all its interactions), `outlinePanel.ts`,
    `detailPanel.ts`, `claudeSection.ts`, `voicePanel.ts`.
  - `main.ts` — wires the top bar, panels, keyboard shortcuts, map session, and
    the cross-surface glue (search, undo/redo, selection reconciliation).
  - `mapSession.ts` — new/open/save/autosave/quit-save state.

Data flow: a UI surface builds a `Command` and calls `store.apply(cmd)`. The store
mutates state, pushes to the undo stack, and emits a `ChangeEvent {kind, ids}`.
Every surface subscribes and re-renders from the store. There is one source of
truth (`store.state`); the 3D simulation keeps its **own** copy of node positions
(`View3D.simNodes`) and never mutates the model — pins are committed back through
`setPosition` commands.

## Common tasks

**Add a graph mutation:** write a factory in `core/commands.ts` returning
`{ name, kind: 'structure'|'props', ids, execute(s), undo(s) }` (capture prior
state in `execute` for `undo`; guard "undo before execute"). `structure` events
trigger full rebuilds; `props` events trigger targeted refreshes. Add a unit test
in `tests/store.test.ts`.

**Add a renderer↔main call:** declare it on `Mind3dApi` in `shared/ipc.ts`, wire
it in `preload/index.ts` (`invoke` for request/response, `send`/`on` for
fire-and-forget/streaming), and add the `ipcMain.handle`/`ipcMain.on` in the
relevant `src/main/*.ts`. Keep channel names symmetric.

**Testing reality:** `core/` is pure and unit-tested (vitest) — that's where the
real logic lives, put tests there. `ui/` and `src/main/` have no unit harness
(matching the repo's existing pattern); they're verified by `npm run build` +
`typecheck` + a launched dev instance, and the browser E2E harness under `e2e/`
(Playwright driving the built Electron app). GUI interactions and the real
voice/claude round-trips are verified by a human/interactive pass.

## Gotchas (hard-won — read before debugging)

- **Preload path is `.mjs`.** electron-vite emits the preload as
  `out/preload/index.mjs` (because `package.json` has `"type": "module"`).
  `src/main/index.ts` must reference `index.mjs`, and `sandbox: false` is required
  for an ESM preload in this Electron version. A wrong `.js` reference silently
  makes `window.mind3d` `undefined` and every IPC feature dead with no error.
- **`~/.local/bin` is on the ambient PATH**, so tests/spawns can *accidentally
  start the real microphone* via `nerd-dictation`. Blank `PATH` in any test that
  exercises the spawn path so nothing resolves the real binary.
- **`voiceRunner` needs `~/.local/bin` prepended** to the spawned child's PATH to
  find `nerd-dictation`; the Vosk model lives at `~/.config/nerd-dictation/model`;
  transcription uses `nerd-dictation begin --output=STDOUT --cookie <f>` … `end`.
- **`3d-force-graph.refresh()` re-invokes `nodeThreeObject` for every node** — it
  regenerates all label sprites (canvas textures). That's why selection recolour
  works, and also why it's O(n) per selection change; watch it at large node
  counts.
- **`Selection` lives outside the store.** `main.ts` reconciles it on every
  `structure` event (clears a selection pointing at a deleted node) — it's
  registered *first* so it settles before View3D rebuilds. If you add a surface
  that reads selection during a structure event, respect that order.
- **DetailPanel guards against clobbering an in-progress edit** and flushes
  pending notes/tags/prompt edits when the selection changes (canvas clicks don't
  blur inputs). Keep that contract if you touch it.
- **The outline is a projection**, recomputed from the graph each render; cycles
  and re-entrant edges render as non-editable `mirror` rows. Don't treat it as
  owning structure.
- **Voice `inFlight` vs `listening`:** `voicePanel.ts` separates "a mic session is
  physically open" (`listening`) from "the whole listen→think→apply cycle is
  running" (`inFlight`). `end()`/`onVoiceError` guard on `listening`; a mid-cycle
  press must not free `inFlight`. `inFlight` clears in a `finally`.

## How this repo was built

Built with subagent-driven development: per-task implement → review → scoped
re-review, then whole-branch review and an interactive smoke test. The design
specs and task plans are under `docs/superpowers/`, and condensed build records
(ledger, smoke report) under `docs/build-records/`. If you extend the app, keep the
same discipline: pure logic in `core/` with tests, thin I/O in `main/`, and every
mutation through a command.
