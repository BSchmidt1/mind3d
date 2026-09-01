import { GraphStore } from './core/store';
import { Selection } from './core/selection';
import { View3D } from './ui/view3d';
import { fuzzyScore } from './core/fuzzy';
import { OutlinePanel } from './ui/outlinePanel';
import { DetailPanel } from './ui/detailPanel';
import { MapSession } from './mapSession';

export const store = new GraphStore();
export const selection = new Selection();

document.body.innerHTML = `
  <div id="topbar">
    <button id="btn-new">New</button>
    <button id="btn-open">Open</button>
    <button id="btn-save">Save</button>
    <input id="search" placeholder="search… (fly-to)" />
    <div id="search-results" hidden></div>
    <span id="status"></span>
  </div>
  <div id="layout">
    <div id="outline-panel"></div>
    <div id="view3d"></div>
    <div id="detail-panel"></div>
  </div>
`;

const statusEl = document.getElementById('status')!;
export function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

export const view3d = new View3D(
  document.getElementById('view3d')!,
  store,
  selection,
  setStatus
);

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
document.getElementById('topbar')!.insertBefore(fileStateEl, statusEl);

export const session = new MapSession(store, (label) => {
  fileStateEl.textContent = label;
});

function guard(fn: () => void | Promise<void>): void {
  void (async (): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      setStatus(`ERROR: ${(err as Error).message}`);
    }
  })();
}

document.getElementById('btn-new')!.addEventListener('click', () => guard(() => session.newMap()));
document.getElementById('btn-open')!.addEventListener('click', () => guard(() => session.open()));
document.getElementById('btn-save')!.addEventListener('click', () => guard(() => session.save()));

window.addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey) return;
  if (ev.key === 's') { ev.preventDefault(); guard(() => session.save()); }
  if (ev.key === 'o') { ev.preventDefault(); guard(() => session.open()); }
});

// --- freeze/release + counts in status ---
const freezeBtn = document.createElement('button');
freezeBtn.textContent = 'Freeze all';
const releaseBtn = document.createElement('button');
releaseBtn.textContent = 'Release all';
document.getElementById('topbar')!.insertBefore(freezeBtn, fileStateEl);
document.getElementById('topbar')!.insertBefore(releaseBtn, fileStateEl);
freezeBtn.addEventListener('click', () => guard(() => {
  if (view3d.pinnedCount() === store.state.nodes.size) { setStatus('all nodes already pinned'); return; }
  view3d.freezeAllNow();
}));
releaseBtn.addEventListener('click', () => guard(() => {
  if (view3d.pinnedCount() === 0) { setStatus('no pinned nodes'); return; }
  view3d.releaseAllNow();
}));

function updateCounts(): void {
  const s = store.state;
  setStatus(`${s.nodes.size} nodes · ${s.edges.size} edges · ${view3d.pinnedCount()} pinned`);
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
outline: Enter sibling · Tab indent · Shift+Tab outdent · dblclick rename
  </pre>`;
document.body.appendChild(help);
window.addEventListener('keydown', (ev) => {
  if (ev.key === '?' && !(document.activeElement instanceof HTMLInputElement) &&
      !(document.activeElement instanceof HTMLTextAreaElement)) {
    help.hidden = !help.hidden;
  }
});
help.addEventListener('click', () => { help.hidden = true; });

new DetailPanel(document.getElementById('detail-panel')!, store, selection, () => session.getMapDir());
