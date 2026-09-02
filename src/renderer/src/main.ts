import { GraphStore } from './core/store';
import { Selection } from './core/selection';
import { View3D } from './ui/view3d';
import { fuzzyScore } from './core/fuzzy';
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
});

document.body.innerHTML = `
  <div id="topbar">
    <button id="btn-new">New</button>
    <button id="btn-open">Open</button>
    <button id="btn-save">Save</button>
    <button id="btn-ask" title="ask Claude about this map">Ask</button>
    <button id="btn-voice" title="hold to speak">🎤</button>
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
  const scored = [...store.state.nodes.values()]
    .map((n) => ({ n, s: fuzzyScore(q, n.label) }))
    .filter((r): r is { n: (typeof r)['n']; s: number } => r.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  for (const { n } of scored) {
    const row = document.createElement('div');
    row.className = 'search-row';
    row.textContent = n.label;
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

// --- undo/redo ---
window.addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey || ev.key.toLowerCase() !== 'z') return;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  ev.preventDefault();
  if (ev.shiftKey) store.redo();
  else store.undo();
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
const voicePanel = new VoicePanel(store, selection, view3d, session, (m) => notify.info(m));
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
  guard(() => {
    if (session.newMap()) notify.success('new map');
    else notify.info('kept current map');
  });
}
function doOpenMap(): void {
  guard(() => session.open());
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
    guard(() => session.open());
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
Delete           delete node       f          fly to selection
x                focus mode        Ctrl+Z/Shift+Z  undo/redo
Ctrl+S/O         save/open         ?          this help
Ctrl+K           command palette
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
