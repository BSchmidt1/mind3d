import { GraphStore } from './core/store';
import { Selection } from './core/selection';
import { View3D } from './ui/view3d';
import { fuzzyScore } from './core/fuzzy';
import { searchNodes } from './core/search';
import { OutlinePanel } from './ui/outlinePanel';
import { DetailPanel } from './ui/detailPanel';
import { MapSession } from './mapSession';
import { VoicePanel } from './ui/voicePanel';
import { initNotify, notify } from './ui/notify';
import { CommandRegistry } from './core/commandRegistry';
import { CommandPalette } from './ui/commandPalette';
import { ProposalPanel } from './ui/proposalPanel';
import { installAsk } from './ui/askController';
import { installImport } from './ui/importController';
import { installSnapshots } from './ui/snapshotController';
import { installTours } from './ui/tourController';
import { ContextMenu } from './ui/contextMenu';
import { TagBar } from './ui/tagBar';
import { collectTags } from './core/tags';

export const store = new GraphStore();
export const selection = new Selection();

// Undo/redo (or any other structural change) can remove the currently
// selected node. Clear a selection left dangling on a deleted node before
// any other store subscriber (View3D's rebuild, panels) reacts to the same
// event — registering first means selection.set(null)'s own listeners run
// and settle before View3D rebuilds against the now-consistent selection.
store.subscribe((ev) => {
  if (ev.kind !== 'structure') return;
  const sel = selection.get();
  if (sel !== null && !store.state.nodes.has(sel)) selection.set(null);
  // Same reconciliation for a selected EDGE (F10): a delete/undo/redo — or a
  // node deletion that cascades incident edges — can remove the selected edge.
  const edgeSel = selection.getEdge();
  if (edgeSel !== null && !store.state.edges.has(edgeSel)) selection.setEdge(null);
});

document.body.innerHTML = `
  <div id="topbar">
    <button id="btn-new">New</button>
    <button id="btn-open">Open</button>
    <button id="btn-save">Save</button>
    <button id="btn-undo" title="undo (Ctrl+Z)" disabled>↶</button>
    <button id="btn-redo" title="redo (Ctrl+Shift+Z)" disabled>↷</button>
    <button id="btn-ask" title="ask Claude about this map">Ask</button>
    <button id="btn-voice" title="hold to speak">🎤</button>
    <button id="btn-2d" title="toggle 2D / 3D layout">2D</button>
    <input id="search" placeholder="search… (fly-to)" />
    <div id="search-results" hidden></div>
    <span id="status-counts"></span>
  </div>
  <div id="layout">
    <div id="outline-panel"></div>
    <div id="view3d"></div>
    <div id="detail-panel"></div>
  </div>
  <div id="toast-host"></div>
  <div id="proposal-panel" hidden></div>
`;

initNotify(document.getElementById('toast-host')!);

// Thin shim kept for any caller still holding a `(msg: string) => void`
// status callback; new code should call `notify` directly.
export function setStatus(msg: string): void {
  notify.info(msg);
}

// --- command palette (Ctrl+K) ---
// The anti-top-bar-bloat mechanism: new actions register a PaletteCommand
// here instead of growing #topbar. Later tasks (F3b+) import `registry` and
// register their own commands.
export const registry = new CommandRegistry();
new CommandPalette(registry);

const statusCountsEl = document.getElementById('status-counts')!;

export const view3d = new View3D(
  document.getElementById('view3d')!,
  store,
  selection,
  (m) => notify.info(m)
);

// Read-only e2e/debug seam. The live camera pose and layout dims are otherwise
// module-scoped inside View3D and unreachable from the Playwright harness; this
// exposes them so the 2D-mode smoke can assert the top-down camera. Read-only,
// no mutation and no OS access, so it is inert under the renderer sandbox.
(window as unknown as { __mind3d?: unknown }).__mind3d = {
  camera: () => view3d.getCamera(),
  dims: () => view3d.dims()
};

// --- proposal preview (F3b) ---
// Shared accept/reject preview + 3D ghost, reused by Ask (F4), Import (F5),
// and Voice (F6). Mounted on a body-level card (never inside #view3d, which
// 3d-force-graph wipes). Only Accept mutates the store — as one composite,
// so the whole batch is a single undo.
export const proposalPanel = new ProposalPanel(
  document.getElementById('proposal-panel')!,
  store,
  selection,
  view3d
);
registry.register({
  id: 'dismiss-proposal',
  title: 'Dismiss proposal',
  run: () => proposalPanel.dismiss(),
  when: () => !proposalPanel.hidden
});

// --- empty-state onboarding hint ---
// Appended *after* View3D takes over #view3d: 3d-force-graph clears the
// container's existing children when it mounts, so an element placed there
// in the initial template would be wiped out before this ever ran.
const emptyHintEl = document.createElement('div');
emptyHintEl.id = 'empty-hint';
emptyHintEl.textContent = 'double-click to add · hold 🎤 to speak · Ctrl+K for commands · ? for shortcuts';
document.getElementById('view3d')!.appendChild(emptyHintEl);
function refreshEmptyHint(): void {
  emptyHintEl.hidden = store.state.nodes.size > 0;
}
store.subscribe(refreshEmptyHint);
refreshEmptyHint();

// --- search ---
const searchEl = document.getElementById('search') as HTMLInputElement;
const resultsEl = document.getElementById('search-results')!;
searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim();
  resultsEl.innerHTML = '';
  resultsEl.hidden = q === '';
  if (q === '') return;
  const hits = searchNodes(store.state, q).slice(0, 8);
  for (const { id } of hits) {
    const n = store.state.nodes.get(id);
    if (!n) continue;
    const row = document.createElement('div');
    row.className = 'search-row';
    row.textContent = n.label;
    // Flag a match that came only from notes so a notes-only hit isn't confusing.
    if (fuzzyScore(q, n.label) === null) {
      const badge = document.createElement('span');
      badge.className = 'search-field';
      badge.textContent = 'notes';
      row.appendChild(badge);
    }
    row.addEventListener('click', () => {
      selection.set(n.id);
      view3d.flyTo(n.id);
      resultsEl.hidden = true;
      searchEl.value = '';
    });
    resultsEl.appendChild(row);
  }
});
searchEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    (resultsEl.querySelector('.search-row') as HTMLElement | null)?.click();
  }
  if (ev.key === 'Escape') {
    resultsEl.hidden = true;
    searchEl.blur();
  }
  ev.stopPropagation();
});

// --- undo/redo (keyboard) ---
window.addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey || ev.key.toLowerCase() !== 'z') return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  ev.preventDefault();
  if (ev.shiftKey) store.redo();
  else store.undo();
});

// --- undo/redo buttons + change toasts (F14) ---
// Visible undo/redo primaries mirroring Ctrl+Z / Ctrl+Shift+Z — they call the
// SAME store.undo()/redo(). Their enabled state and the "Undid/Redid <name>"
// toasts are both driven off store change events: undo()/redo() emit
// source 'undo'/'redo' carrying the command's name (F14 ChangeEvent extension).
// A normal apply (source 'apply', incl. loadState) gets no toast.
const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
function refreshUndoRedo(): void {
  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
}
undoBtn.addEventListener('click', () => { store.undo(); });
redoBtn.addEventListener('click', () => { store.redo(); });
store.subscribe((ev) => {
  refreshUndoRedo();
  if (ev.source === 'undo') notify.info(`Undid: ${ev.name}`);
  else if (ev.source === 'redo') notify.info(`Redid: ${ev.name}`);
});
refreshUndoRedo();
registry.register({
  id: 'undo', title: 'Undo', hint: 'Ctrl+Z',
  run: () => { store.undo(); }, when: () => store.canUndo
});
registry.register({
  id: 'redo', title: 'Redo', hint: 'Ctrl+Shift+Z',
  run: () => { store.redo(); }, when: () => store.canRedo
});

new OutlinePanel(document.getElementById('outline-panel')!, store, selection);

// --- map session (new/open/save/autosave/quit-save) ---
const fileStateEl = document.createElement('span');
fileStateEl.id = 'file-state';
document.getElementById('topbar')!.insertBefore(fileStateEl, statusCountsEl);

export const session = new MapSession(store, (label) => {
  fileStateEl.textContent = label;
});

// --- voice mode (push-to-talk) ---
// VoicePanel drives its own feedback via `notify` (a single updating progress
// toast for the think→apply step, plus the editable transcript confirm gate),
// so it no longer takes a setStatus callback.
const voicePanel = new VoicePanel(store, selection, view3d, session);
const voiceBtn = document.getElementById('btn-voice')!;
function stopVoiceListening(): void {
  voicePanel.end();
  voiceBtn.classList.remove('active');
}
voiceBtn.addEventListener('mousedown', () => {
  if (voicePanel.begin()) voiceBtn.classList.add('active');
});
voiceBtn.addEventListener('mouseup', stopVoiceListening);
voiceBtn.addEventListener('mouseleave', stopVoiceListening);

function guard(fn: () => void | Promise<void>): void {
  void (async (): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      notify.error(`ERROR: ${(err as Error).message}`);
    }
  })();
}

function doNewMap(): void {
  guard(async () => {
    // newMap() is async now: on a non-empty map it awaits the in-app confirm
    // modal (F14) instead of the native, renderer-blocking confirm().
    const made = await session.newMap();
    if (made) {
      applyMode();
      notify.success('new map');
    } else {
      notify.info('kept current map');
    }
  });
}
function doOpenMap(): void {
  guard(async () => {
    await session.open();
    applyMode();
  });
}
function doSaveMap(): void {
  guard(() => session.save());
}
document.getElementById('btn-new')!.addEventListener('click', doNewMap);
document.getElementById('btn-open')!.addEventListener('click', doOpenMap);
document.getElementById('btn-save')!.addEventListener('click', doSaveMap);

registry.register({ id: 'new-map', title: 'New map', run: doNewMap });
registry.register({ id: 'open-map', title: 'Open map', hint: 'Ctrl+O', run: doOpenMap });
registry.register({ id: 'save-map', title: 'Save map', hint: 'Ctrl+S', run: doSaveMap });

// --- 2D / 3D layout mode (F12) ---
// A primary toggle (it changes the whole view): 2D flattens the SAME force
// layout via numDimensions(2), locks the camera top-down, and disables orbit
// (pan/zoom stay). The mode is map metadata held by MapSession and persisted
// per map; the session is the single source of truth. `applyMode` pushes the
// session's mode into View3D (on open/new/toggle); `session.setMode` records
// the toggle and marks the map dirty.
const btn2d = document.getElementById('btn-2d')!;
function update2DButton(): void {
  btn2d.classList.toggle('active', view3d.dims() === 2);
}
function applyMode(): void {
  view3d.setDims(session.getMode() === '2d' ? 2 : 3);
  update2DButton();
}
function doToggle2D(): void {
  session.setMode(session.getMode() === '2d' ? '3d' : '2d');
  applyMode();
}
btn2d.addEventListener('click', doToggle2D);
registry.register({ id: 'toggle-2d', title: 'Toggle 2D / 3D mode', run: doToggle2D });
update2DButton();

window.addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey) return;
  if (ev.key === 's') {
    ev.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    guard(() => session.save());
  }
  if (ev.key === 'o') {
    ev.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    doOpenMap();
  }
});

// --- freeze/release + counts in status ---
const freezeBtn = document.createElement('button');
freezeBtn.textContent = 'Freeze all';
const releaseBtn = document.createElement('button');
releaseBtn.textContent = 'Release all';
document.getElementById('topbar')!.insertBefore(freezeBtn, fileStateEl);
document.getElementById('topbar')!.insertBefore(releaseBtn, fileStateEl);
function doFreezeAll(): void {
  guard(() => {
    if (store.state.nodes.size === 0) { notify.info('map is empty'); return; }
    if (view3d.pinnedCount() === store.state.nodes.size) { notify.info('all nodes already pinned'); return; }
    view3d.freezeAllNow();
    notify.success('froze all nodes');
  });
}
function doReleaseAll(): void {
  guard(() => {
    if (view3d.pinnedCount() === 0) { notify.info('no pinned nodes'); return; }
    view3d.releaseAllNow();
    notify.success('released all nodes');
  });
}
freezeBtn.addEventListener('click', doFreezeAll);
releaseBtn.addEventListener('click', doReleaseAll);

registry.register({ id: 'freeze-all', title: 'Freeze all', run: doFreezeAll, when: () => store.state.nodes.size > 0 });
registry.register({ id: 'release-all', title: 'Release all', run: doReleaseAll, when: () => view3d.pinnedCount() > 0 });
registry.register({
  id: 'toggle-focus',
  title: 'Toggle focus mode',
  hint: 'x',
  run: () => view3d.toggleFocusMode()
});
registry.register({
  id: 'fly-to-selection',
  title: 'Fly to selection',
  hint: 'f',
  run: () => {
    const sel = selection.get();
    if (sel !== null) view3d.flyTo(sel);
  },
  when: () => selection.get() !== null
});

// --- first-class edges (F10) ---
// The selected edge, else the hovered one — so an edge command works whether
// the edge is clicked (selected) or just under the cursor.
function edgeTarget(): string | null {
  return selection.getEdge() ?? view3d.hoveredLink();
}
registry.register({
  id: 'edge-set-label',
  title: 'Edit edge label',
  run: () => { const id = edgeTarget(); if (id !== null) view3d.editEdge(id, 'label'); },
  when: () => edgeTarget() !== null
});
registry.register({
  id: 'edge-set-relation',
  title: 'Set edge relation',
  run: () => { const id = edgeTarget(); if (id !== null) view3d.editEdge(id, 'relation'); },
  when: () => edgeTarget() !== null
});
registry.register({
  id: 'edge-delete',
  title: 'Delete edge',
  run: () => { const id = edgeTarget(); if (id !== null) view3d.deleteEdgeById(id); },
  when: () => edgeTarget() !== null
});

function updateCounts(): void {
  const s = store.state;
  statusCountsEl.textContent = `${s.nodes.size} nodes · ${s.edges.size} edges · ${view3d.pinnedCount()} pinned`;
}
store.subscribe(updateCounts);
updateCounts();

// --- help overlay ---
const help = document.createElement('div');
help.id = 'help-overlay';
help.hidden = true;
help.innerHTML = `
  <h3>mind3d shortcuts</h3>
  <pre>
dblclick empty   new node          Tab        add child
click            select            l          link mode (Esc cancels)
drag / arrows    move + pin        Shift+↑/↓  move in depth
p                pin/unpin         e          edit label
click edge       edit label/relation          Delete removes selected edge
Delete           delete node       f          fly to selection
x                focus mode        Ctrl+Z/Shift+Z  undo/redo
Ctrl+S/O         save/open         ?          this help
Ctrl+K           command palette   ] / [      tour next / prev
right-click      context menu      #btn-2d    2D / 3D layout toggle
tag chip         filter / colour by tag
undo/redo buttons in the top bar (also Ctrl+Z / Shift+Z)
Ctrl+K exposes:  Ask the map · Import text/file/URL · snapshots · viewpoints & tours
outline: Enter sibling · Tab indent · Shift+Tab outdent · dblclick rename
  </pre>`;
document.body.appendChild(help);
function toggleHelp(): void {
  help.hidden = !help.hidden;
}
window.addEventListener('keydown', (ev) => {
  if (ev.key === '?' && !(document.activeElement instanceof HTMLInputElement) &&
      !(document.activeElement instanceof HTMLTextAreaElement)) {
    toggleHelp();
  }
});
help.addEventListener('click', () => { help.hidden = true; });

registry.register({ id: 'show-help', title: 'Show help', hint: '?', run: toggleHelp });

new DetailPanel(document.getElementById('detail-panel')!, store, selection, () => session.getMapDir());

// --- ask the map (F4) ---
// Send the whole graph (or the selected node's neighborhood) to Claude and
// preview the result via the shared proposal panel (adds/links) and/or a text
// answer. Registers preset + free-text asks as Ctrl+K commands and wires the
// #btn-ask primary.
installAsk({ store, selection, view3d, proposalPanel, registry, session });

// --- import → map (F5) ---
// Paste text, load a file, or fetch a URL; Claude extracts a node/edge
// structure, previewed via the shared proposal panel. Palette-only
// (`import-map`) — no new top-bar button.
installImport({ store, selection, view3d, proposalPanel, registry, session });

// --- right-click context menu (F13) ---
// Surfaces the common node/edge/background actions (otherwise keyboard-only) on
// right-click, reusing the same commands/flows and suppressing the native
// browser menu on the 3D view. Self-wiring: it attaches its own listener to
// view3d.getContainer(). Placed after installAsk/installImport so its "Ask
// about this" / "Import…" items can resolve the `ask-map` / `import-map`
// palette commands those installers register.
new ContextMenu({ view3d, store, selection, proposalPanel, session, registry });

// --- snapshots + visual diff (F8) ---
// Named checkpoints saved with the map; a diff view coloring added/changed
// nodes+edges and red-ghosting removals. Palette-only (snapshot-save /
// -compare / -restore, diff-clear); the diff renders through View3D.showDiff,
// never as DOM inside #view3d.
installSnapshots({ store, view3d, registry, session });

// --- camera viewpoints + tours (F9) ---
// Save named camera poses with the map and assemble ordered tours (viewpoints +
// nodes) walked with ] / [. Palette-only (viewpoint-save/-goto, tour-create/
// -play/-next/-prev/-stop); camera capture/apply lives in View3D.
installTours({ store, selection, view3d, registry, session });

// --- tag filter + color-by-tag (F11) ---
// Make the (previously write-only) node tags useful: a compact floating panel
// that dims/hides nodes without an active tag and optionally colors nodes by
// tag. Filter state is VIEW state (not in the map file, not command-tracked);
// it composes with focus mode (View3D dims a node if either excludes it).
// Palette-only (`tag-filter` opens the panel, `tag-color-toggle` flips colors) —
// no new top-bar button.
const tagBar = new TagBar(store, view3d);
registry.register({
  id: 'tag-filter',
  title: 'Filter by tag…',
  hint: 'dim / hide by tag',
  run: () => tagBar.open(),
  when: () => collectTags(store.state).length > 0
});
registry.register({
  id: 'tag-color-toggle',
  title: 'Toggle color by tag',
  run: () => tagBar.toggleColor(),
  when: () => collectTags(store.state).length > 0
});
