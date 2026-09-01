import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import { projectOutline, type OutlineItem } from '../core/outline';
import {
  addEdge, addNode, composite, deleteEdge, reparent, setLabel
} from '../core/commands';
import { createEdge, createNode } from '../core/model';

export class OutlinePanel {
  private rootId: string | null = null;
  private items: OutlineItem[] = [];
  private listEl: HTMLElement;
  private rootSel: HTMLSelectElement;
  private rendering = false;

  constructor(
    private container: HTMLElement,
    private store: GraphStore,
    private selection: Selection
  ) {
    container.innerHTML = `
      <div class="outline-head">
        <label>root <select id="outline-root"></select></label>
      </div>
      <div id="outline-list"></div>
    `;
    this.listEl = container.querySelector('#outline-list')!;
    this.rootSel = container.querySelector('#outline-root')!;
    this.rootSel.addEventListener('change', () => {
      this.rootId = this.rootSel.value === '' ? null : this.rootSel.value;
      this.render();
    });
    store.subscribe(() => this.render());
    selection.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    if (this.rendering) return;
    this.rendering = true;
    try {
      if (this.rootId !== null && !this.store.state.nodes.has(this.rootId)) this.rootId = null;
      this.renderRootSelector();
      this.items = projectOutline(this.store.state, this.rootId);
      this.listEl.innerHTML = '';
      let selectedRow: HTMLElement | null = null;
      this.items.forEach((item, idx) => {
        const node = this.store.state.nodes.get(item.nodeId);
        if (!node) throw new Error(`outline references missing node "${item.nodeId}"`);
        const row = document.createElement('div');
        row.className = `outline-row ${item.kind}`;
        if (this.selection.get() === item.nodeId && item.kind === 'tree') {
          row.classList.add('selected');
          selectedRow = row;
        }
        row.tabIndex = 0;
        row.style.paddingLeft = `${8 + item.depth * 16}px`;
        row.textContent = (item.kind === 'mirror' ? '↪ ' : '• ') + (node.label || '(unnamed)');
        row.addEventListener('click', () => this.selection.set(item.nodeId));
        if (item.kind === 'tree') {
          row.addEventListener('dblclick', () => this.beginEdit(row, item));
          row.addEventListener('keydown', (ev) => this.handleRowKey(ev, item, idx));
        }
        this.listEl.appendChild(row);
      });
      const active = document.activeElement;
      const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (selectedRow && !editing) (selectedRow as HTMLElement).focus();
    } finally {
      this.rendering = false;
    }
  }

  private renderRootSelector(): void {
    this.rootSel.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = '(auto)';
    this.rootSel.appendChild(auto);
    for (const n of this.store.state.nodes.values()) {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.label || '(unnamed)';
      if (n.id === this.rootId) opt.selected = true;
      this.rootSel.appendChild(opt);
    }
  }

  private beginEdit(row: HTMLElement, item: OutlineItem): void {
    const node = this.store.state.nodes.get(item.nodeId);
    if (!node) throw new Error(`edit of missing node "${item.nodeId}"`);
    const input = document.createElement('input');
    input.value = node.label;
    input.className = 'outline-edit';
    row.textContent = '';
    row.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') this.store.apply(setLabel(item.nodeId, input.value));
      if (ev.key === 'Enter' || ev.key === 'Escape') this.render();
    });
    input.addEventListener('blur', () => this.render());
  }

  private treeParentOf(idx: number): OutlineItem | null {
    const depth = this.items[idx]!.depth;
    for (let i = idx - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.kind === 'tree' && it.depth === depth - 1) return it;
    }
    return null;
  }

  private prevTreeSiblingOf(idx: number): OutlineItem | null {
    const depth = this.items[idx]!.depth;
    for (let i = idx - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.kind !== 'tree') continue;
      if (it.depth === depth) return it;
      if (it.depth < depth) return null;
    }
    return null;
  }

  private handleRowKey(ev: KeyboardEvent, item: OutlineItem, idx: number): void {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      const child = createNode('');
      const parentEdge = item.edgeId !== null ? this.store.state.edges.get(item.edgeId) : undefined;
      if (parentEdge) {
        this.store.apply(
          composite('outlineSibling', [addNode(child), addEdge(createEdge(parentEdge.source, child.id))])
        );
      } else {
        this.store.apply(addNode(child));
      }
      this.selection.set(child.id);
      const rows = this.listEl.querySelectorAll<HTMLElement>('.outline-row.selected');
      rows.forEach((r) => {
        const i = this.items.findIndex((it) => it.nodeId === child.id && it.kind === 'tree');
        if (i >= 0) this.beginEdit(r, this.items[i]!);
      });
      return;
    }
    if (ev.key === 'Tab' && !ev.shiftKey) {
      ev.preventDefault();
      ev.stopPropagation();
      const prev = this.prevTreeSiblingOf(idx);
      if (!prev) return;
      if (item.edgeId !== null) this.store.apply(reparent(item.edgeId, prev.nodeId));
      else this.store.apply(addEdge(createEdge(prev.nodeId, item.nodeId)));
      return;
    }
    if (ev.key === 'Tab' && ev.shiftKey) {
      ev.preventDefault();
      ev.stopPropagation();
      if (item.edgeId === null) return;
      const parent = this.treeParentOf(idx);
      if (!parent) return;
      if (parent.edgeId === null) this.store.apply(deleteEdge(item.edgeId));
      else {
        const grand = this.store.state.edges.get(parent.edgeId);
        if (!grand) throw new Error(`outline: missing parent edge "${parent.edgeId}"`);
        this.store.apply(reparent(item.edgeId, grand.source));
      }
    }
  }
}
