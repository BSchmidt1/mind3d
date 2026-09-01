# mind3d — 3D mindmapping desktop app

Date: 2026-09-01. Status: approved in chat (design + additions).

## Purpose

Personal thinking/strategy tool for Benjamin: arbitrary directed graph (cycles allowed — "loopy"), rendered as a navigable 3D force-directed graph with manual pinning that persists, edited both directly in 3D and via a keyboard-fast outline. Nodes can attach an Obsidian/markdown file and a Claude prompt runnable via `claude -p` from inside the app.

Stated assumptions (user did not override): comfortable ceiling ~2,000 nodes; nodes carry a short label plus optional markdown notes.

## Architecture

1. **Electron** — thin main process (window, file dialogs, fs, autosave, `claude -p` child processes); everything else in the renderer.
2. Renderer: **TypeScript + Vite**, no UI framework; vanilla TS modules around a small event-emitting store.
3. 3D view: **`3d-force-graph`** (bundles Three.js + d3-force-3d).
4. Repo: `~/Claude_projects/mind3d/`, local git (no remote yet).

## Data model

One map = one versioned JSON file:

```jsonc
{
  "version": 1,
  "meta": { "name": "...", "createdAt": "...", "modifiedAt": "..." },
  "nodes": [{
    "id": "...", "label": "...", "notes": "",          // notes = markdown
    "color": null, "tags": [],
    "fx": null, "fy": null, "fz": null,                 // non-null = pinned (manual placement)
    "attachedFile": null,                                // absolute path to md/Obsidian file
    "claudePrompt": null,
    "claudeResult": null                                 // { "text": "...", "timestamp": "..." }
  }],
  "edges": [{ "id": "...", "source": "...", "target": "...", "label": null }]
}
```

Directed edges, cycles allowed, no tree constraint anywhere in the model. Pinned nodes restore exact positions on load; unpinned nodes re-simulate.

## Components

1. **GraphStore** (renderer, pure logic) — single source of truth. All mutations are command objects (execute/undo), giving uniform undo/redo across both editing surfaces. Emits change events. Serialization to/from the file format with strict validation.
2. **View3D** — wraps 3d-force-graph.
   - Mouse: orbit/zoom/pan; drag node = move + pin; click = select; double-click empty space = new node.
   - Keyboard: arrow keys move selected node in the camera-relative screen plane, Shift+↑/↓ along the view (depth) axis; any keyboard move pins. `P` toggle pin, "freeze all"/"release all" commands. `Tab` add child, `L` link mode, `Del` delete, `E` edit label, `F` fly camera to selection.
   - Search box with fuzzy match + fly-to. Focus mode dims everything beyond the selection's 2-hop neighborhood.
3. **OutlinePanel** — Workflowy-style projection: spanning tree from a selectable root; edges not in the tree render as ghost "mirror" references (this is how cycles stay representable). `Enter` sibling, `Tab`/`Shift+Tab` indent/outdent (= re-parent edge), inline label editing. All edits flow through GraphStore commands, so 3D and outline cannot diverge.
4. **DetailPanel** — for the selected node: markdown notes (edit + preview); attachments UI:
   - Attached file: pick via dialog; "Open in Obsidian" (`obsidian://open?path=...` via `shell.openExternal`, fallback: open with default app); content preview.
   - Claude prompt: text field + **Run** button → main process spawns `claude -p "<prompt>"` (`--output-format text`), cwd = attached file's directory (else the map file's directory) so Claude can read the file without permission prompts. Output streams live into the panel; on exit the result + timestamp is stored on the node (undoable command). One run at a time per node; kill button.
5. **Persistence** (main process) — open/save dialogs, debounced autosave + save on quit, write-temp-then-rename, keeps last 5 backups (`<file>.bak.1..5`).

## Claude integration — auth

The spawned `claude` CLI inherits the machine's existing Claude Code login. No API key is embedded in the app or repo. If a dedicated token is ever wanted, it is read from a gitignored `.env` (`CLAUDE_CODE_OAUTH_TOKEN`) and passed via env to the child process only.

## Error handling

Fail-fast: strict schema validation on load with precise error messages; never silently drop or default fields; refuse to overwrite a file that fails to parse; versioned format so migrations are explicit; child-process failures (claude not found, non-zero exit) surface verbatim in the UI.

## Testing

Vitest for pure logic: GraphStore commands, undo/redo, serialization round-trips (including pin fields and attachments), outline spanning-tree projection incl. cycle cases, validation error cases. 3D interaction verified manually. No browser-automation tests in v1.

## Out of scope (v1)

VR, collaboration/sync, imports, >10k-node scale, AI features beyond the per-node `claude -p` runner.
