# mind3d — User Guide

A desktop app for building mind maps in 3D space. Nodes float in a force-directed
layout you can orbit and fly through; you can also pin them by hand, edit the same
map as a text outline, attach notes and files, and grow the map by voice, by
asking Claude, or by importing text. Cycles are welcome — the graph is not
restricted to a tree.

New to v2: a **command palette** (`Ctrl+K`) that runs any action, **Ask the map**
and **Import** flows that grow the graph with Claude, **snapshots** with a visual
diff, saved **camera viewpoints and tours**, first-class **edges** with a relation
type, a **tag filter**, a flat **2D mode**, and a **right-click menu**. Each is
covered below; press **?** for the shortcut overlay.

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
  middle-drag to zoom, right-drag to pan. **Right-click** anything for a menu.
- **Outline** (left) — the same graph as an indented, Workflowy-style list.
- **Detail panel** (right) — everything about the selected node: colour, tags,
  markdown notes, an attached file, and a Claude prompt.
- **Top bar** — New / Open / Save, **undo ↶ / redo ↷**, **Ask**, the 🎤 voice
  button, the **2D** toggle, search, Freeze all / Release all, the current file
  name, and node/edge/pinned counts on the right.
- **Toasts** (bottom-right) — every transient message (saved, thinking, errors,
  *Undid…*) appears as a small card that fades out; click one to dismiss it.
  Errors linger longer. On an empty map a centred hint reminds you how to start.

Anything not on the top bar is one `Ctrl+K` away — see **The command palette**.

---

## The command palette

Press **Ctrl+K** (or ⌘K) to open the command palette: a search box over every
action in the app. Type a few letters — matching is fuzzy, so *"opm"* finds
*"Open map"* — use **↑ / ↓** to move, **Enter** to run the highlighted command,
and **Esc** to close.

The palette is where features live that don't have a button: snapshots, camera
viewpoints and tours, tag filters, import, and the edge and per-preset ask
commands. Commands that don't apply right now (for example *Release all* when
nothing is pinned) simply don't appear. As you learn the app, the palette is the
fastest way to reach anything.

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
| Undo / redo | **Ctrl+Z** / **Ctrl+Shift+Z**, or the **↶ / ↷** buttons |

Undo and redo also have buttons in the top bar (greyed out when there's nothing
to undo or redo), and each one shows a toast naming what it reversed
(*"Undid: setLabel"*). Almost everything you do is a single undoable step.

Selection is shared everywhere: click a node in 3D and its outline row and detail
panel follow, and vice-versa.

**Right-click** a node (or an edge, or empty space) for a menu of the common
actions — see [The right-click menu](#the-right-click-menu).

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

### Edges

Edges are first-class objects you can select and edit, not just connectors.

- **Click an edge** to select it (its endpoints show in the status/header).
- A small editor lets you give the edge a **label** and a **relation**:
  *none*, *supports*, *refutes*, or *depends*. The relation colours the edge —
  green for supports, red for refutes, blue for depends, grey for none — so an
  argument map reads at a glance.
- With an edge selected, **Delete** removes just that edge.
- Right-click an edge for the same actions (*Edit label…*, *Set relation ▸*,
  *Delete edge*). The palette has *Edit edge label*, *Set edge relation*, and
  *Delete edge* too.

Ask and Voice can also create typed edges — for example asking Claude to map
which claims support or refute others.

---

## Finding your way around

- **Search** (top bar): fuzzy-matches node **labels and notes**; **Enter** flies
  the camera to the best hit. A result that matched only in a node's notes (not
  its label) carries a small **notes** badge so you know why it surfaced.
- **Fly to selection**: **f**.
- **Focus mode**: **x** dims everything more than two hops from the selected node,
  so you can concentrate on its neighbourhood; **x** again restores.
- **Command palette**: **Ctrl+K** — run any action by name (see above).

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

## Ask the map

Where the per-node runner answers *about one node*, **Ask** reasons over the
**whole graph** (or a slice of it) and proposes changes.

1. Click **Ask** in the top bar (or open the palette and pick an *Ask:* command)
   and type a question — *"what connections am I missing?"* — then submit with
   **Ctrl+Enter**.
2. If a node is selected, Ask looks at that node's **neighbourhood** (two hops);
   with nothing selected it considers the **entire map**.
3. Claude replies with a **preview**: the proposed new nodes and edges appear
   **ghosted** (translucent, gold-outlined) in the 3D view alongside a panel
   listing them. It may also include a short written answer.
4. **Accept** turns the ghosts into real nodes/edges as a single undoable step;
   **Reject** discards them and touches nothing.

Built-in presets (in the palette, prefixed *Ask:*):

- **What am I missing?** — gaps and missing nodes.
- **Connect unconnected nodes** — proposes edges between related-but-unlinked
  nodes.
- **Cluster / group these** — suggests groupings.
- **Steelman this branch** — the strongest version of the selected branch.
- **Find contradictions** — usually a written answer rather than new nodes.

Some questions return only a written answer (no structural change) — that shows
as a text reply with an **OK** button, nothing to accept.

---

## Import text, a file, or a URL

Turn existing material into a map. Open the palette → **Import text / file /
URL…** (or right-click empty space → *Import…*):

1. **Paste** text into the box, or click **From file…** to load one, or type a
   URL and **Fetch URL** to pull a web page — each fills the box so you can trim
   it before importing.
2. Click **Import**. Claude extracts a concise node/edge structure (short labels,
   detail in notes) and shows it as the same **accept/reject ghost preview** as
   Ask.
3. **Accept** to add it (one undo), **Reject** to drop it.

Only `http` / `https` URLs are fetched. As a safety measure, the extraction step
runs Claude with all tools disabled, so text pulled in from a file or the web
can't make it touch your filesystem or network — it can only become a map.

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

## Snapshots and visual diff

Snapshots are named checkpoints of the whole map, saved **inside the map file**.

- **Ctrl+K → Snapshot: save checkpoint…** and give it a name (e.g. *"before big
  refactor"*).
- Later, **Snapshot: compare with current…** picks a checkpoint and paints the
  difference over the live map: nodes and edges that were **added** since glow
  green, **changed** ones yellow, and **removed** ones appear as red ghosts. A
  toast summarises the counts. **Snapshot: clear diff view** returns to normal.
- **Snapshot: restore…** replaces the current map with a checkpoint. This is a
  hard reset — it clears the undo history (like opening a file), so you're asked
  to confirm first.

Snapshots travel with the map: save the file and they're still there next time.

---

## Camera viewpoints and tours

Save camera angles and string them into a guided walkthrough — handy for
presenting a map or returning to a favourite view.

- **Ctrl+K → Viewpoint: save current camera…** stores where you're looking from,
  under a name. **Viewpoint: go to…** animates the camera back to any saved one.
- **Tour: create…** assembles an ordered list of stops from your saved viewpoints
  and the currently selected node. **Tour: play…** starts it; step through with
  **]** (next) and **[** (previous), or the *Tour: next/previous stop* commands.
  A viewpoint stop flies the camera; a node stop selects and flies to that node.
- **Tour: stop** ends playback.

Viewpoints and tours are saved with the map, like snapshots.

---

## Tags: filter and colour

Node tags (set in the detail panel) become a way to navigate.

- **Ctrl+K → Filter by tag…** opens a small panel of your tags. Activate one or
  more and the map dims every node that doesn't carry an active tag, so a subset
  stands out. Switch the mode from **dim** to **hide** to push non-matching nodes
  all the way out of sight. Clear the tags to restore everything.
- **Toggle color by tag** recolours each node by its first tag (a stable colour
  per tag), so clusters read by hue.

Tag filtering is a **view** setting — it isn't saved in the file and doesn't
affect the graph itself, and it composes with focus mode (a node is dimmed if
either rule hides it).

---

## 2D mode

Click **2D** in the top bar (or **Ctrl+K → Toggle 2D / 3D mode**) to flatten the
map onto a top-down plane. It's the same force layout with depth removed:
rotation is disabled, but you still pan, zoom, and create/drag nodes in the
plane. Click **2D** again (now the active state) to return to full 3D. The mode
is remembered **per map** — a map saved in 2D reopens in 2D.

---

## The right-click menu

Right-click in the 3D view for a context menu tuned to what's under the cursor
(the native browser menu is suppressed):

- **On a node** — Add child, Link from here, **Ask about this…** (an Ask scoped
  to that node's neighbourhood), Attach file…, Pin / Unpin, Delete node.
- **On an edge** — Edit label…, Set relation ▸ (none / supports / refutes /
  depends), Delete edge.
- **On empty space** — New node here (at the cursor), or Import text / file /
  URL….

Every item does exactly what its keyboard shortcut or palette command does — the
menu is just a discoverable way in. Click away or press **Esc** to dismiss it.

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
- If a file is corrupt, **Open** reports a precise error as a toast and leaves
  your current map untouched.

---

## Keyboard reference

```
3D view
  double-click empty   new node          Tab              add child
  click node           select            l                link mode (Esc cancels)
  click edge           select + edit label / relation
  drag / arrows        move + pin        Shift+↑/↓         move in depth
  p                    pin / unpin       e                edit label
  Delete               delete node/edge  f                fly to selection
  x                    focus mode        Ctrl+Z / Ctrl+Shift+Z   undo / redo
  Ctrl+K               command palette   ?                this help
  Ctrl+S / Ctrl+O      save / open       right-click      context menu
  ] / [                tour next / prev (while a tour is playing)

Outline
  Enter  new sibling     Tab  indent     Shift+Tab  outdent     double-click  rename

Top bar
  ↶ / ↷  undo / redo    Ask  ask the map    🎤 (hold)  voice mode    2D  flat mode
  Freeze all / Release all    search (labels + notes; Enter = fly to)
```

Anything without a key or button is in the **command palette** (**Ctrl+K**).

---

## Scope

Voice mode currently **creates** nodes (it doesn't yet edit existing ones by
voice) and transcription is English; the app targets Linux/X11. Search is fuzzy
over labels and notes (not semantic). Very large maps (toward a couple of
thousand nodes) still work but selection redraws get heavier — pin what you can
and use focus mode.
