import { GraphStore } from './core/store';
import { Selection } from './core/selection';
import { View3D } from './ui/view3d';
import { fuzzyScore } from './core/fuzzy';

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
