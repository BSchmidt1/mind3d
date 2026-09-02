# mind3d — User Guide

A desktop app for building mind maps in 3D space. Nodes float in a force-directed
layout you can orbit and fly through; you can also pin them by hand, edit the same
map as a text outline, attach notes and files, and grow the map by voice or by
asking Claude. Cycles are welcome — the graph is not restricted to a tree.

---

## Install & run

Requirements: Node ≥ 20 and npm. Linux (developed and tested on X11).

```bash
cd mind3d
npm install
npm run dev        # launch the app (hot-reload dev build)
```

Other scripts: `npm run build` (production build), `npm test` (unit tests),
`npm run typecheck`.

Press **?** at any time inside the app for the keyboard-shortcut overlay.

---

## The window

- **3D view** (centre) — the map itself. Left-drag to orbit, mouse-wheel or
  middle-drag to zoom, right-drag to pan.
- **Outline** (left) — the same graph as an indented, Workflowy-style list.
- **Detail panel** (right) — everything about the selected node: colour, tags,
  markdown notes, an attached file, and a Claude prompt.
- **Top bar** — New / Open / Save, the 🎤 voice button, search, Freeze all /
  Release all, and a status line (node/edge counts, the current file, and
  transient messages).

---

## Creating and editing nodes

The 3D view *is* the editor. With a node selected, most actions are single keys.

| Action | How |
|---|---|
| New node | **Double-click** empty space (it appears where you click) |
| Add a child | **Tab** (creates a linked child near the selection) |
| Select | **Click** a node (or an outline row) |
| Edit the label | **e**, or double-click an outline row; **Enter** commits |
| Link two nodes | **l**, then click the target (**Esc** cancels) |
| Delete | **Delete** (removes the node and its edges) |
| Undo / redo | **Ctrl+Z** / **Ctrl+Shift+Z** |

Selection is shared everywhere: click a node in 3D and its outline row and detail
panel follow, and vice-versa.

### Moving and pinning

By default nodes are placed by the physics simulation. The moment you position one
yourself it becomes **pinned** — it keeps that exact spot and is restored there
when you reopen the map.

| Action | How |
|---|---|
| Move (and pin) | **Drag** a node, or use the **arrow keys** while it's selected |
| Move toward / away from camera | **Shift + ↑ / ↓** |
| Pin / unpin | **p** (an unpinned node drifts back into the layout) |
| Pin everything where it sits | **Freeze all** |
| Release everything back to physics | **Release all** |

Freeze/Release are undoable like any other edit.

### The outline

The left panel is a live projection of the graph as a tree, rooted at a node you
choose (or "(auto)", which shows every component). Because the graph can contain
cycles, any edge that would revisit an already-shown node appears as an italic
**↪ mirror** row — click it to jump to the real node; it can't be edited in place.

| Action | How |
|---|---|
| New sibling | **Enter** on a row |
| Indent (re-parent under previous sibling) | **Tab** |
| Outdent | **Shift+Tab** |
| Rename | double-click the row |
| Re-root | the **root** dropdown at the top of the panel |

---

## Finding your way around

- **Search** (top bar): fuzzy-matches labels; **Enter** flies the camera to the
  best hit.
- **Fly to selection**: **f**.
- **Focus mode**: **x** dims everything more than two hops from the selected node,
  so you can concentrate on its neighbourhood; **x** again restores.

---

## Notes, colour, tags, and files

The detail panel (right) acts on the selected node:

- **Notes** — markdown; the preview renders as you type (blur to commit). Good for
  the detail that doesn't belong in a short label.
- **Colour / tags** — colour recolours the node's label in 3D; tags are
  comma-separated.
- **Attached file** — attach any file with **Attach…**. If it's markdown you get a
  preview. **Open in Obsidian** hands the path to Obsidian (`obsidian://`), and
  **Open file** opens it in your default app. This is how you tie a node to a
  document in your vault.

---

## Ask Claude on a node

Each node has a **claude** section in the detail panel. Type a prompt, press
**Run**, and the app runs `claude -p` for you, streaming the answer in and storing
it on the node (undoable). If the node has an attached file, Claude runs in that
file's directory so it can read it. **Kill** stops a run.

No API key is stored anywhere — this uses your machine's existing Claude Code
login.

---

## Voice mode

Hold the **🎤** button, speak an instruction, **edit the heard text if needed**,
Run, and Claude turns it into nodes and edges — added to your map as a single
undoable step.

1. Select a node first if you want the new nodes attached under it (optional).
2. **Press and hold** 🎤. A **🎤 listening…** toast appears and the button pulses.
3. Speak a plain instruction, e.g. *"add three children under the selected node:
   grants, major donors, and events"*, or *"map the main sections of the attached
   file"* if the selected node has a document attached.
4. **Release.** An **editable confirm box** pops up pre-filled with what was heard.
   Fix any mis-heard word, then **Run** (or press **Ctrl+Enter**). **Cancel**
   (or **Esc** / click outside) aborts without calling Claude.
5. A single **🧠 thinking…** toast updates in place, then ends with a short summary
   like *"3 added — Ctrl+Z to undo"*; the new nodes appear near your selection.
6. Not what you wanted? A single **Ctrl+Z** removes the whole voice result.

Unlike **Ask** and **Import** (which show an accept/reject ghost preview before
adding anything), voice **direct-applies** on Run — the editable confirm box is
its review gate — and the batch is one undo.

Details worth knowing:
- Transcription is fully **offline** (nerd-dictation / Vosk, English) — nothing
  leaves the machine to become text.
- Turning that text into nodes uses `claude -p` with your existing login — again,
  no keys stored.
- The small offline speech model can mis-hear the odd word; Claude usually recovers
  your intent anyway. If a result is off, undo and rephrase.
- If it points at a document, it reads the **selected node's attached file**.

---

## Saving, autosave, and recovery

- Maps are plain **JSON** files. **Ctrl+S** / **Save** (or **Ctrl+O** / **Open**).
- Saves are atomic and keep the last five backups next to the file
  (`yourmap.json.bak.1` … `.bak.5`).
- Once a map has been saved once, it **autosaves** about two seconds after each
  change, and again when you quit or close the window.
- A map you've **never saved** is continuously written to a recovery file at
  `~/.config/mind3d/recovery.json` so an unsaved session isn't lost — open it by
  hand via **Open** if you need it. (It is not auto-restored on startup.)
- If a file is corrupt, **Open** reports a precise error in the status bar and
  leaves your current map untouched.

---

## Keyboard reference

```
3D view
  double-click empty   new node          Tab              add child
  click                select            l                link mode (Esc cancels)
  drag / arrows        move + pin        Shift+↑/↓         move in depth
  p                    pin / unpin       e                edit label
  Delete               delete node       f                fly to selection
  x                    focus mode        Ctrl+Z / Ctrl+Shift+Z   undo / redo
  Ctrl+S / Ctrl+O      save / open       ?                this help

Outline
  Enter  new sibling     Tab  indent     Shift+Tab  outdent     double-click  rename

Top bar
  🎤 (hold)  voice mode    Freeze all / Release all    search (Enter = fly to)
```

---

## Scope

This is a v1. Voice mode currently **creates** nodes (it doesn't yet edit existing
ones by voice), transcription is English, and the app targets Linux/X11. Very large
maps (toward a couple of thousand nodes) still work but selection redraws get
heavier — pin what you can and use focus mode.
