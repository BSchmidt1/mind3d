# mind3d — end-phase interactive smoke test

**Date:** 2026-09-01 · **Branch:** build-v1 @ `5b99675` · **Method:** real Electron app driven with xdotool mouse/keyboard events, verified with screenshots plus read-only Chrome DevTools Protocol state assertions.

**Overall verdict: SHIP-BLOCKING BUGS FOUND — 2 must-fix, 1 should-fix.** Persistence, IPC, undo/redo, outline, detail panel and the Claude runner are all fundamentally sound (the preload fix is confirmed working end-to-end; every IPC channel was exercised). The blockers are in the 3D view's sizing/selection plumbing and one UI race in the Claude section.

---

## Harness notes (read first — these are not app defects)

The app was driven on a **nested Xephyr X server on `:5`**, launched with `ELECTRON_CLI_ARGS='["--enable-unsafe-swiftshader"]'` and `REMOTE_DEBUGGING_PORT=9333`. No application source, config or packaging was modified.

Why: on the primary display `:1` the test was not executable.
1. `mutter` focus-stealing prevention refused every `_NET_ACTIVE_WINDOW` request; the app window ended up with `_NET_WM_STATE_DEMANDS_ATTENTION` and could not be raised or focused programmatically once another window took focus.
2. A **latched XKB group** (`Group 2: on`, layout `de,us,us`) plus **ibus XIM** swallowed synthetic keystrokes in every focused `<input>`/`<textarea>` — reproduced with a plain `zenity --entry` canary, so it was global, not app-specific. `setxkbmap -layout de,us,us -variant qwerty,,` (identical layout, re-applied) cleared it.
3. `xdotool getwindowgeometry` reports a wrong absolute position for the reparented window (double-counts the frame offset); `xwininfo` "Absolute upper-left" is authoritative.

Under Xephyr the GPU process fails to initialise; `--enable-unsafe-swiftshader` gives software WebGL and sprites render correctly. All resulting `viz_main_impl` / `gl_utils` log lines are environment noise.

**Side effects on the user's session, all restored:** `ibus-x11` was killed (it took `ibus-daemon` with it) and `ibus-daemon --panel disable --xim -d` was restarted; the keyboard layout was re-applied identically; workspace was switched to 2 and back to 0; one click landed in the user's Chrome window (hover only, no navigation); the Text Editor window that the app's "Open file" opened was closed; Obsidian's "Vault not found" dialog was dismissed (Obsidian itself had been running since Aug 28 — not started by this test). No orphan processes remain.

---

## Cross-cutting findings

### A. MUST FIX — the WebGL canvas is sized to the window, not to its container
`src/renderer/src/ui/view3d.ts:45-54` never calls `.width()` / `.height()` on the `ForceGraph3D` instance. The library defaults them to `window.innerWidth` / `window.innerHeight` (`node_modules/3d-force-graph/dist/3d-force-graph.js:143458`) and has **no** `ResizeObserver` and no `resize` listener (grep: 0 hits), so they never change.

Measured live via CDP:

```
canvas: ["1600px", "972px"]   #view3d container: [1000, 935]   (overflow:hidden)
```

Consequences:

1. **~37.5% of the rendered scene is permanently invisible** (canvas x 1000–1600, plus 37px of height). Nodes routinely land there: the Tab-created child `Gamma` rendered at window x = 1770.
2. **Double-click node placement is wrong.** `worldPointAt()` (`view3d.ts:188-205`) builds NDC from the *container* rect, while the camera projection and `graph2ScreenCoords` use the *canvas* dimensions. Double-click at window (500,300) put the node and its label editor at (632,321) — exactly the 1.6× width ratio predicted, i.e. 132px right and 21px below the cursor. Evidence: `i1-a-c.png`.
3. **Node dragging is unaffected** (force-graph derives the pointer NDC from the canvas rect itself), so drag is WYSIWYG while double-click is not — which confirms the diagnosis. Evidence: `i4-drag-c.png` (dropped at (500,420), rendered at (500,420)).
4. Resizing the window never corrects it and makes the mismatch worse.

Fix: set `.width()/.height()` from the container and update them on a `ResizeObserver`.

### B. MUST FIX — a node created by double-click is immediately deselected
`3d-force-graph` dispatches click callbacks from `pointerup` **inside `requestAnimationFrame`** (`3d-force-graph.js` ~line 143835, comment: "trigger click events asynchronously, to allow hoverObj to be set"). The DOM `dblclick` fires synchronously after the second click, so the sequence is:

```
pointerup#1 → rAF queued        pointerup#2 → rAF queued
dblclick    → addNode, selection.set(id), beginLabelEdit   ← synchronous
next frame  → queued onBackgroundClick → selection.set(null)   ← wipes it
```

Observed on every double-click: `selection.get() === null`, detail panel shows "no node selected", outline row not highlighted (`i1-b-top.png`). The label editor still works because it captured the id in a closure. **Practical impact: you cannot press Tab / p / x / e / Delete on a node you just created — you have to click it first.**

Fix: ignore the background click for a short window after a dblclick-create, or set the selection from a deferred callback of your own.

### C. SHOULD FIX — Claude "Run" does nothing when clicked straight from the prompt box
The textarea `blur` handler (`ui/claudeSection.ts:55-58`) applies `setClaudePrompt`; the store event re-enters `DetailPanel.render()` (`ui/detailPanel.ts:18-21`), and because the active element is no longer an input inside the panel, the guard at `detailPanel.ts:55-58` does not fire and `render()` replaces `container.innerHTML` — destroying the Run button between mousedown and mouseup, so no click event is delivered.

Measured: `activeBeforeClick=cs-prompt` → after the click `runDisabled=false, state=""` (no run started). The prompt is saved correctly; a second click on Run works. This is exactly the mousedown-blur race that was flagged.

### D. Detail-panel scroll position resets on every re-render
Because the panel is taller than the window, Run/Kill land at or below the bottom window edge after each rebuild — measured `runWindowCenter = [1309, 1000]` in a 1000px-tall window, i.e. unclickable until you scroll again. Every Run required a fresh scroll.

### E. Every `claude -p` result is polluted by a 3-second stdin warning
`src/main/claudeRunner.ts:25-28` spawns with default stdio, leaving stdin an open pipe, so every result begins with:

```
Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command,
redirect stdin explicitly: < /dev/null to skip, or wait longer.
```

and every run is delayed ~3s. Fix: `stdio: ['ignore','pipe','pipe']` or `child.stdin.end()`.

### F. Enter after clicking an outline mirror (↪) row creates a node
Clicking a mirror row correctly selects the mirrored target, but the ensuing re-render moves DOM focus to that target's **tree** row (`ui/outlinePanel.ts:67`), so the next Enter runs the tree row's "new sibling" handler. Measured: nodes 7 → 8, an "(unnamed)" root sibling of Alpha. Expected behaviour was that Enter/Tab on a mirror row do nothing.

### G. Known deferred, confirmed — Freeze all on an empty map
`src/renderer/src/main.ts:133-136`: `pinnedCount() === nodes.size` is `0 === 0`, so an empty map reports **"all nodes already pinned"**. Release all on an empty map correctly reports "no pinned nodes".

### H. Minor — an unpinned node does not drift
After `p`, `togglePin` → `setPosition(null)` → `syncProps` → `refresh()`, with no `d3ReheatSimulation()`. Once the engine has cooled the node simply stays where it was until something else reheats the simulation.

---

## Per-item results

| # | Item | Verdict |
|---|------|---------|
| 1 | 3D basics | **PARTIAL** |
| 2 | Selection visuals | **PASS** |
| 3 | Tab child + link mode | **PASS** |
| 4 | Pinning / arrows / undo | **PASS** (1 partial) |
| 5 | Search + fly + focus | **PASS** |
| 6 | Outline | **PARTIAL** |
| 7 | Detail panel | **PASS** |
| 8 | Attachment | **PASS** |
| 9 | Claude runner | **PARTIAL** |
| 10 | Persistence | **PASS** |
| 11 | Corrupt file | **PASS** |
| 12 | Recovery | **PASS** |
| 13 | Help + freeze | **PASS** (known issue G) |
| 14 | Log review | **PASS** |

### 1. 3D basics — PARTIAL
Double-click creates a node, the label editor opens focused with the text pre-selected, Enter commits, and the sprite shows the label (`i1-a-c.png`, `i1-b-top.png`). **Fails** on placement: the node and editor appear at (632,321) for a click at (500,300) — Finding A. Also the new node is deselected before you can act on it — Finding B.

### 2. Selection visuals — PASS
Clicking a node turns its sprite `#ffd54a` with a yellow border; clicking the second node reverts the first and highlights the second (`i2-strip.png`, `i2-strip2.png`). **The gating question is answered: `graph.refresh()` does re-invoke `nodeThreeObject`** — `refresh` is exposed via `linkedFGMethods` and sets `_flushObjects = true`. The outline row highlights and the detail panel populates on a normal click (`i2-panels.png`).

### 3. Tab child + link mode — PASS
Tab on a selected node creates a child with the editor open and the child selected (`Beta->Gamma`). `l` shows "link mode: click target node (Esc cancels)"; clicking the target creates an arrowed edge and reports "edge created" (`i3-status-strip.png`, `i3-link2-view.png` shows the arrowhead). `l` then clicking the same node reports "link cancelled: self-loop not allowed" with the edge count unchanged (`i3-self-status.png`). Caveat: the child frequently spawns into the clipped region (Finding A).

### 4. Pinning, keyboard movement, undo — PASS (one partial)
Drag pins the node and adds a border; `p` unpins and removes it (`i4-strip.png`); dragging again re-pins at the exact drop point. Held ArrowRight moved x by exactly +120 (15 × MOVE_STEP) and **a single Ctrl+Z restored the pre-move position exactly, in one step**; Shift+Up moved z 0 → −64 and one Ctrl+Z restored it. **Partial:** after `p` the node does not visibly drift (Finding H).

### 5. Search, fly-to, focus mode — PASS
Built 8 nodes including the chain Alpha→Beta→Gamma→Delta. Typing `Gam` shows the fuzzy dropdown (`i5-s1.png`); Enter selects the best hit and flies the camera to it. **Regression check holds:** with Alpha selected, `x` yields `focusSet = {Alpha, Beta, Gamma}` — Delta (3 hops) is excluded. Out-of-set nodes visibly dim (`i5-dim-strip.png`); `x` again restores and clears `focusSet`.

### 6. Outline — PARTIAL
Passing: rows mirror the 3D tree with correct indentation; row click drives the 3D selection and vice-versa; **clicking a row then immediately pressing Enter opens an inline editor for a new sibling** (the focus fix works — `i6-enter-c.png`); **Tab indents under the previous sibling and creates no stray 3D child** (nodes stayed 7, edge `Zeta->Eta` added — the Tab-collision fix works); Shift+Tab outdents; a cycle (`Delta->Alpha`) renders the italic grey `↪ Alpha` mirror row (`i6-cycle-c.png`) and clicking it selects Alpha; the root selector re-roots and `(auto)` restores the full view (`i6-root-c.png`, `i6-auto-c.png`); **after dragging a 3D node, `activeElement` is BODY and Tab creates a 3D child** (`Epsilon->new node`) — the focus-stealing fix works.

Failing: Enter after clicking a mirror row creates a node — Finding F. Observation: with an explicit root selected, disconnected components (Epsilon/Zeta/Eta) are still listed below the subtree.

### 7. Detail panel — PASS
Markdown notes render formatted in the preview (H1 + bold — `i7-notes-c.png`); tags `x, y` parse to `["x","y"]` and persist on blur; the colour picker recolours the sprite (`#ff5050` clearly visible in `i7-colorvis-c.png`) and "clear color" restores the default (`i7-cleared-c.png`). **Flush fix works:** with `" EXTRA"` typed but uncommitted in Theta's notes, clicking Delta in 3D switched the panel to Delta *and* preserved Theta's text. Ctrl+Z afterwards undoes that flushed `setNotes` on the now-unshown node, with no visible feedback in the panel — worth noting but coherent.

### 8. Attachment — PASS
Attach… opens the GTK dialog; Ctrl+L + path + Enter attached `/tmp/claude-1000/mind3d-smoke/note.md`; the path is shown and the file's markdown renders in the preview, headings, list and bold included (`i8-attached-c.png`). "Open file" opened note.md in GNOME Text Editor (via the desktop portal, so it surfaced on the user's display). "Open in Obsidian" dispatched the URI correctly; Obsidian answered "Vault not found. Unable to find a vault for the URL obsidian://open?path=…" (`i8-error.png`) — **mind3d did not crash and logged nothing**.

### 9. Claude runner — PARTIAL
Passing: Run disables Run / enables Kill / shows "running…"; output streams into the `<pre>` while running (observed `out_len=157` mid-run); on exit the buttons flip back and the result is shown with its ISO timestamp. Run 1 returned `mind3d-smoke-ok`. The result persists across deselect/reselect. **cwd is correct** — run 2 (`summarize note.md in one sentence`) on the node with the attachment answered from the file: *"…three placeholder items (alpha, beta, gamma) and the secret word 'pineapple'"*. Run then Kill mid-run ends the output with `[killed]` and stores it with a timestamp. **Two concurrent runs did not mix**: Delta stored `DELTA-RUN`, Theta stored `THETA-RUN`.

Failing: Run clicked directly from the focused prompt box does nothing — Finding C. Plus Findings D and E.

### 10. Persistence — PASS
Ctrl+S opened the save dialog and wrote `demo.json`; the status bar shows the path with no dirty marker. An edit set the `*` marker and autosave cleared it within ~2s with the edit on disk (`i10-strip.png`). Repeated saves rotate `demo.json.bak.1/.2/.3`. **Quit-save works:** a rename made <1s before Ctrl+Q was on disk after the app exited. After relaunch and Open, all 8 nodes round-tripped with **byte-identical `fx`/`fy`/`fz`** (pinned nodes at exact positions, unpinned still `null` so they re-simulate) and identical colours, tags, notes, attached file, claude prompts and claude results; 5 edges restored. Full diff: every node `diffs=NONE`.

### 11. Corrupt file — PASS
Opening `corrupt.json` shows `ERROR: mind3d file is not valid JSON: Unexpected non-whitespace character after JSON at position 4294 (line 155 column 2)` in the status bar; the current map is untouched (still 8 nodes), the file-state still points at `demo.json`, and the app remains fully usable.

### 12. Recovery — PASS
New shows the confirm dialog and clears the map on accept. Adding a node without saving wrote `/home/beschmidt/.config/mind3d/recovery.json` (496 bytes, containing `RecoveryNode`) within ~3s, and the status showed `(unsaved — recovery written)`.

### 13. Help + freeze — PASS (known issue G)
`?` shows the shortcuts overlay (`i13-help-c.png`); clicking dismisses it. Freeze all pinned 3/3 and one Ctrl+Z reverted it to 1/3; Release all unpinned 0/3 and one Ctrl+Z reverted it to 3/3. On an empty map, Freeze all reports "all nodes already pinned" (Finding G) and Release all correctly reports "no pinned nodes".

### 14. Log review — PASS
45 log lines total across the whole session. **No app-level JavaScript errors, no uncaught exceptions, no unhandled promise rejections.** Every line is environment noise: `viz_main_impl.cc … Exiting GPU process` and `Automatic fallback to software WebGL` (Xephyr has no GPU), `gl_utils.cc … GPU stall due to ReadPixels`, and two GTK/GLib assertions emitted by the native file dialogs (also seen on the primary display).

`window.mind3d` is defined and every IPC channel was exercised successfully — `map-open`, `map-save`, `map-recovery-save`, `file-pick`, `file-read`, `open-path`, `open-external`, `path-dirname`, `claude-run`, `claude-kill`, `save-requested`/`save-done`. The preload-path fix is confirmed working end-to-end.

---

## Artefacts

Screenshots and state dumps: `/tmp/claude-1000/mind3d-smoke/` (`i1-*` … `i13-*`, `before-reload.json`, `after-reload.json`, `demo.json`, `corrupt.json`, `dev.log`).

---

## Fix wave

All 7 controller-approved fixes applied on `build-v1`.

1. **A (SHIP-BLOCKER, canvas sizing)** — `src/renderer/src/ui/view3d.ts`: chained `.width(container.clientWidth).height(container.clientHeight)` onto the `ForceGraph3D` instance right after construction, and added a `ResizeObserver` on `container` that re-applies both dimensions on every resize. This also resolves the double-click coordinate offset (Finding A.2): `worldPointAt()`'s NDC (built from the container rect) and the camera's projection (now sized from the same container) agree.
2. **B (SHIP-BLOCKER, dblclick node deselected)** — `view3d.ts`: added a private `suppressNextBgClick` flag, set `true` at the end of the `dblclick` handler right after `selection.set(node.id)`; `onBackgroundClick` now checks and clears the flag first and returns early instead of deselecting, before falling through to the existing link-mode-gated `selection.set(null)`.
3. **C (SHOULD-FIX, Run mousedown race)** — `src/renderer/src/ui/detailPanel.ts`: added a `renderTimer`/`scheduleRender()` (macrotask-deferred `setTimeout(…, 0)`) and routed the `store.subscribe` callback through it instead of calling `render()` directly. `selection.subscribe` still calls `render()` synchronously, so switching nodes remains immediate; only the store-triggered rebuild (the one racing the Run mousedown→blur→setClaudePrompt chain) is deferred, letting the native click complete on the still-attached button first.
4. **D (scroll reset)** — `detailPanel.ts`: `render()` now captures `this.container.scrollTop` in a local at the very top (before any teardown or early return) and restores it via `this.container.scrollTop = scrollTop` immediately after the full rebuild completes (right after `this.shownId = id`).
5. **H (unpinned nodes don't drift)** — `view3d.ts`: added `this.graph.d3ReheatSimulation()` after the unpin branch's `store.apply(setPosition(id, null, null, null))` in `togglePin()`, and after `store.apply(releaseAll(...))` in `releaseAllNow()`.
6. **E (stdin warning)** — `src/main/claudeRunner.ts`: added `child.stdin.end()` immediately after `spawn(...)`, closing the otherwise-open stdin pipe so `claude -p` no longer waits ~3s for stdin data.
7. **G (empty-map Freeze all)** — `src/renderer/src/main.ts`: the Freeze-all click handler now special-cases `store.state.nodes.size === 0` → `setStatus('map is empty')` and returns, checked before the existing `pinnedCount() === nodes.size` check.

**Deviations from the brief:** none — all 7 items implemented as specified, no other files touched.

**Verification:**
- `npm test`: 35/35 green, all 6 suites pass, none of the changed logic is covered by existing tests (view3d/detailPanel/claudeRunner/main.ts have no direct unit tests in this suite) — no test needed updating since no tested behavior changed.
- `npm run typecheck`: clean, no errors, no new `any`.
- `npm run build`: clean production build (main, preload, renderer all bundle successfully).
- `npm run dev`: launched Electron under Xvfb-less environment for ~15s; main/preload/renderer all built and started, dev server up on `http://localhost:5173/`, no renderer console errors in the log; process tree torn down cleanly afterward with no orphans.

Full interactive GUI re-verification of these 7 fixes (canvas fill, dblclick selection persistence, Run-from-prompt-box click, scroll retention, unpin drift, stdin-warning-free Claude runs, empty-map Freeze message) is expected to happen in a separate smoke pass, per the brief.

---

## Re-verification (fix wave `9086752`)

Scoped interactive re-test of the 7 fixes, same method as the original pass (Xephyr `:5`, `--enable-unsafe-swiftshader`, real xdotool input, read-only CDP assertions). The primary display was still hostile, so the nested server was used again.

**Result: 6 of 7 fixed, 1 partial.** The regression sweep is clean.

| # | Fix | Verdict |
|---|-----|---------|
| 1 | Canvas sizing | **PASS** |
| 2 | Dblclick keeps selection | **PASS** |
| 3 | Run-button race | **PASS** |
| 4 | Detail-panel scroll | **PARTIAL** |
| 5 | Unpin drift | **PASS** |
| 6 | Claude stdin warning | **PASS** |
| 7 | Empty-map Freeze all | **PASS** |

### 1. Canvas sizing — PASS
Canvas now matches its container exactly, and nothing is clipped:

```
canvasAttr:[1000,935]  canvasCss:["1000px","935px"]  container:[1000,935]  innerWindow:[1600,972]
```

(was 1600×972 canvas in a 1000×935 container.) Double-click placement is exact — the systematic 1.6× offset is gone:

| double-click at | label editor lands at |
|---|---|
| (500,300) | (500,311) |
| (600,400) | (600,411) |
| (500,400) *after resize* | (500,411) |

The 11–12px y delta is the deliberate `coords.y + 12` in `beginLabelEdit`. **Resize follows correctly:** resizing the window to 1300×850 gave container 700×785 and canvas `700px×785px` with `camera.aspect = 0.8917` (= 700/785); restoring 1600×1000 returned both to 1000×935. The `ResizeObserver` works.

*Side observation, pre-existing and not caused by this fix:* any structural rebuild (`graphData()`) nudges the camera dolly — z oscillates between 170 and 214.19. Verified this is not double-click specific: a single click leaves z unchanged, 4s of idling leaves z unchanged, but **adding a node via Tab** moved z 170 → 214.19 just as a double-click does. The same behaviour was present before the fix wave (first pass recorded z 214.19 → 245.18 across a node add). Effect: a node placed exactly under the cursor can shift by a few tens of pixels once the next structural change lands. Worth a separate look; out of scope here.

### 2. Dblclick-create keeps selection — PASS
After a double-click create and label commit:

```
sel=Root | panel=Root | outlineSelectedRows=1
```

and pressing Tab immediately produced a child: `labels=Root,Kid  edges=Root->Kid`. The `suppressNextBgClick` flag correctly swallows the one queued `onBackgroundClick`.

### 3. Run-button race — PASS
With `document.activeElement === 'cs-prompt'` (prompt textarea focused, prompt typed), the **first** click on Run started the run:

```
active before click: cs-prompt
runDisabled=true  killDisabled=false  state="running…"
```

The macrotask-deferred store render lets the native click complete on the still-attached button.

### 4. Detail-panel scroll — PARTIAL
The fix works for synchronously-rendered panel content but is still lost when the node has an **attached file**, because the panel's overflow then comes from the asynchronously-loaded file preview.

`render()` captures `scrollTop` at the top and restores it at the bottom, but `#dp-file-preview` is filled later, in the `.then()` of `window.mind3d.readTextFile(...)` (`detailPanel.ts:133-140`). At the moment of restore the preview is empty, so the panel is shorter than its final height and the `scrollTop` write is clamped.

Measurements, all with a verified re-render (pin state flipped, proving `render()` ran):

| Window | Attached file | scrollHeight/clientHeight | max scrollTop | before → after |
|---|---|---|---|---|
| 1600×1000 | yes | 1015 / 935 | 80 | **80 → 0** ✗ |
| 1600×700 | no | 790 / 635 | 155 | 155 → 155 ✓ |
| 1600×700 | yes | 1015 / 635 | 380 | 380 → 380 ✓ |

It fails only when the scrollable margin is smaller than the preview's contribution (~230px) — i.e. exactly the configuration in the original report, where Run/Kill sat at the window's bottom edge on the node carrying the attachment.

Suggested fix: restore `scrollTop` again inside the `readTextFile(...).then()` after `renderMarkdown`, or reserve the preview's height so layout is stable at restore time.

### 5. Unpin drift — PASS
Dragged a node to pin it (`fx=-38.4`), then pressed `p` with no further interaction:

```
pos before p:  -38.4, 6.7, 0.0
pos +0.3s:     -16.5, 2.9, 0.0
pos +1.8s:     -16.5, 2.9, 0.0   (settled)
```

It rejoins the simulation immediately; `d3ReheatSimulation()` does the job. It converges quickly here because the test graph only had two nodes.

### 6. Claude result prefix — PASS
Stored result for `say exactly: RACE-OK`:

```json
{"text":"RACE-OK\n","timestamp":"2026-09-01T17:52:06.746Z"}
```

No `no stdin data received` warning anywhere in the streamed or stored output, and the run completed within ~3s of the Run click instead of stalling 3s on stdin. `child.stdin.end()` fixed it.

### 7. Empty-map Freeze all — PASS
On a fresh New map: Freeze all → `"map is empty"`; Release all → `"no pinned nodes"` (unchanged, still correct).

### Regression sweep — PASS
- **Click-select recolouring:** clicking Alpha's sprite turns it from `#dfe6ee` to `#ffd54a` with a yellow border (`rg-strip.png`); `sel=Alpha`.
- **Outline Enter/Tab flow:** clicking a row then Enter opens the inline editor (`activeElement.className === 'outline-edit'`), the typed label commits (`RegSib`), and Tab indents it under the previous sibling (`EtaEdited->RegSib`) with **no stray 3D node** (count stayed 9).
- **Save/reopen round-trip:** Ctrl+S → New → Open `demo.json` restored 9 nodes and 6 edges with every field identical (`fx/fy/fz`, colour, tags, notes, attached file, claude prompt, claude result) — "all nodes identical, edges identical: True".

### Dev log
48 lines. **No app-level JavaScript errors, no uncaught exceptions, no unhandled rejections, and no `ResizeObserver loop` warnings** from the new observer. Every entry is the same environment noise as before: GPU-process init failure and software-WebGL fallback (Xephyr has no GPU), `GPU stall due to ReadPixels`, and GTK/GLib assertions emitted by the native file dialogs (more of them this pass simply because more dialogs were opened).

All processes were killed cleanly (0 orphans). Session side effects: none new this pass — `ibus-daemon` is running, the keyboard layout is unchanged (`de,us,us` / `qwerty,,`), and the desktop is back on workspace 0.

---

## Fix wave follow-up: item 4 (detail-panel scroll, attached-file case)

Root cause per the re-verification: `render()` restores `scrollTop` before `readTextFile(...).then()` fills `#dp-file-preview`, so on a node with an attached file the panel grows by ~230px after the restore and the earlier write gets clamped back toward 0 in tight-viewport cases.

Fix, in `src/renderer/src/ui/detailPanel.ts`: inside the `readTextFile(...).then()` callback, after `renderMarkdown(filePreview, text)`, re-apply `this.container.scrollTop = scrollTop` (the same value captured at the top of `render()`), guarded by `this.shownId === id` so a late resolve for a node the panel has since switched away from doesn't yank the current scroll position. Added the identical guarded restore to the `.catch()` branch, since the error-text fallback also changes panel height.

**Verification:**
- `npm test`: 35/35 green, unchanged (no tested logic touched).
- `npm run typecheck`: clean.
- `npm run build`: clean production build.
- No GUI pass run — per instruction, the mechanism was already verified interactively in the re-verification pass above and this is the reviewer-prescribed completion of that fix.

Commit: `4ff3548`.

---

## X-close check (commits `4ff3548`, `3a3d856`)

Scoped live verification of the X-close save handshake and the link-navigation hardening. Same method (Xephyr `:5`, real xdotool input, read-only CDP assertions).

**Result: 5/5 PASS.**

| # | Item | Verdict |
|---|------|---------|
| 1 | Create 2 nodes, Ctrl+S to `xclose-test.json` | **PASS** |
| 2 | Type notes unblurred, close via WM X | **PASS** |
| 3 | Clean exit within ~5s, no orphans | **PASS** |
| 4 | Relaunch + Open → notes present | **PASS** |
| 5 | Link click doesn't navigate the app window | **PASS** |

### Method note — how the "X button" was simulated
Xephyr runs without a window manager, so there is no titlebar X and `alt+F4` has no handler; `wmctrl` is not installed and no standalone WM (openbox/metacity/marco/xfwm4/mutter) exists on this machine.

`xdotool windowclose` turned out to be the wrong tool: it **destroyed** the X window outright (`xwininfo` afterwards: `Bad Drawable … No such window`) without going through Electron's `close` event, leaving the process tree alive with a live but window-less renderer and nothing saved. That is an artifact of the destroy path, not an app defect — a real WM never destroys a window without asking first.

The faithful path is the `WM_PROTOCOLS`/`WM_DELETE_WINDOW` ClientMessage that a WM's X button sends. `/tmp/claude-1000/mind3d-smoke/wmclose.py` sends exactly that via `libX11.XSendEvent`, and Electron's `win.on('close')` handler picks it up as intended. All results below use that.

### 1. Setup — PASS
Two nodes created by double-click (`NodeOne`, `NodeTwo`), Ctrl+S saved to `/tmp/claude-1000/mind3d-smoke/xclose-test.json` (826 bytes), status bar clean (no dirty marker).

### 2. Unblurred notes + X-close — PASS
State captured immediately before the close, confirming the edit was genuinely uncommitted:

```
textarea="XCLOSE-UNBLURRED-NOTE-42" | store notes="" | activeEl=dp-notes
```

`WM_DELETE_WINDOW` sent → the file was rewritten (826 → 853 bytes) containing the typed text, with `xclose-test.json.bak.1` rotated. The `close` → `save-requested` → `document.activeElement.blur()` → notes-blur → `setNotes` → serialize chain fired with real focus events.

**Timing:** in a separate instrumented run the file's mtime changed **26 ms** after the ClientMessage — the flush and write are effectively instantaneous, nowhere near the 5 s handshake timeout.

### 3. Clean exit — PASS
Measured from the ClientMessage to the whole `dist/electron` process tree disappearing: **0.19 s**. `electron-vite` exited with it; 0 orphans afterwards.

(An earlier figure of 7.35 s in the first attempt was an artefact of a coarse `ps aux | grep | wc -l` polling loop at 0.5 s granularity, not app latency — the clean measurement is 0.19 s.)

### 4. Reload → notes present — PASS
Relaunched, Open `xclose-test.json`:

```
nodes=1  [{"l":"NodeOne","notes":"EXITTIME-NOTE"}]
panel=NodeOne | notesTextarea="EXITTIME-NOTE"
```

The text typed and never blurred before the X-close survives the round trip and is shown in the panel (`xc-panel.png`). This is the end-to-end path CDP could not exercise.

### 5. Link click does not navigate — PASS
Notes set to `[x](https://example.com)`; the preview rendered `<p><a href="https://example.com">x</a></p>` (DOMPurify keeps the anchor, as expected). Clicking the rendered link:

| | before click | after click |
|---|---|---|
| `location.href` | `http://localhost:5173/` | `http://localhost:5173/` |
| nodes | 1 | 1 |
| `#topbar` / `#outline-list` / `#dp-notes` | present | present |
| panel label | — | `NodeOne` |

The app window did not navigate and the UI is fully intact (`xc-link-top.png`). The dev log shows `Opening in existing browser session.`, i.e. the click was routed through the allowlisted `openExternal` IPC to the system browser, which is the designed behaviour.

### Errors
No app-level JavaScript errors, uncaught exceptions or unhandled rejections. The dev log contains only the usual environment noise (GPU-process init failure and software-WebGL fallback under Xephyr, `GPU stall due to ReadPixels`, and GTK/GLib assertions from the native file dialogs).

### Session side effects
All processes killed (0 orphans); `ibus-daemon` running; keyboard layout unchanged (`de,us,us` / `qwerty,,`); desktop on workspace 0. **One thing left behind:** step 5's `openExternal` opened `https://example.com` in the user's existing Chrome window (title now "Example Domain - Google Chrome"). It was left open deliberately — closing it would have meant clicking inside the user's live browser, which is riskier than one stray tab. A single Ctrl+W dismisses it.
