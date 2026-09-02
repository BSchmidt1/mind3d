import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { CommandRegistry } from '../core/commandRegistry';
import type { View3D } from './view3d';
import type { ProposalPanel } from './proposalPanel';
import type { MapSession } from '../mapSession';
import { setAttachedFile, setEdgeRelation } from '../core/commands';
import { EDGE_RELATIONS, type EdgeRelation } from '../core/model';
import { notify } from './notify';

// Right-click context menu (F13). Surfaces the common node/edge/background
// actions that are otherwise hidden keyboard shortcuts, so the app is
// discoverable. Every item reuses an EXISTING command or flow — the menu adds
// no new mutation logic. The native browser/OS menu is suppressed on the 3D
// view via preventDefault; keyboard shortcuts are untouched.

// What was right-clicked. A hovered node wins over a hovered edge; otherwise
// the empty background (carrying the cursor point for "New node here").
export type MenuTarget =
  | { kind: 'node'; id: string; pinned: boolean }
  | { kind: 'edge'; id: string }
  | { kind: 'background'; clientX: number; clientY: number };

export interface MenuItem {
  label: string;
  run: () => void;
  // A leaf's run mutates; a parent carries a submenu (its own run is a no-op,
  // the submenu leaves do the work).
  submenu?: MenuItem[];
}

// The callbacks each item invokes. Kept as an injected interface so the item
// list (buildMenuItems) is a pure, DOM-free function that can be unit-tested;
// the ContextMenu class supplies real implementations that call existing
// commands/flows.
export interface MenuActions {
  addChild(id: string): void;
  linkFrom(id: string): void;
  askAbout(id: string): void;
  attachFile(id: string): void;
  togglePin(id: string): void;
  deleteNode(id: string): void;
  editEdgeLabel(id: string): void;
  setRelation(id: string, relation: EdgeRelation): void;
  deleteEdge(id: string): void;
  newNodeAt(clientX: number, clientY: number): void;
  importText(): void;
}

// Pure: the ordered item list for a target. No DOM, no side effects until an
// item's run() is invoked.
export function buildMenuItems(target: MenuTarget, a: MenuActions): MenuItem[] {
  switch (target.kind) {
    case 'node': {
      const id = target.id;
      return [
        { label: 'Add child', run: () => a.addChild(id) },
        { label: 'Link from here', run: () => a.linkFrom(id) },
        { label: 'Ask about this…', run: () => a.askAbout(id) },
        { label: 'Attach file…', run: () => a.attachFile(id) },
        { label: target.pinned ? 'Unpin' : 'Pin', run: () => a.togglePin(id) },
        { label: 'Delete node', run: () => a.deleteNode(id) }
      ];
    }
    case 'edge': {
      const id = target.id;
      return [
        { label: 'Edit label…', run: () => a.editEdgeLabel(id) },
        {
          label: 'Set relation',
          run: () => {
            /* parent row: the submenu leaves act */
          },
          submenu: EDGE_RELATIONS.map((r) => ({ label: r, run: () => a.setRelation(id, r) }))
        },
        { label: 'Delete edge', run: () => a.deleteEdge(id) }
      ];
    }
    case 'background':
      return [
        { label: 'New node here', run: () => a.newNodeAt(target.clientX, target.clientY) },
        { label: 'Import text / file / URL…', run: () => a.importText() }
      ];
  }
}

export interface ContextMenuDeps {
  view3d: View3D;
  store: GraphStore;
  selection: Selection;
  // proposalPanel + session are part of the F13 dependency surface (the ask /
  // import flows this menu delegates to were built against them); the menu
  // reaches those flows through the palette registry, so it holds the refs
  // without reading them directly.
  proposalPanel: ProposalPanel;
  session: MapSession;
  registry: CommandRegistry;
}

export class ContextMenu {
  private root: HTMLDivElement | null = null;
  private readonly actions: MenuActions;

  constructor(private readonly deps: ContextMenuDeps) {
    this.actions = this.buildActions();
    deps.view3d.getContainer().addEventListener('contextmenu', (ev) => this.onContextMenu(ev));
    // Close on click-away (any mousedown outside the open menu) and on Escape.
    document.addEventListener('mousedown', (ev) => {
      if (this.root && ev.target instanceof Node && !this.root.contains(ev.target)) this.close();
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close();
    });
  }

  private onContextMenu(ev: MouseEvent): void {
    // CRITICAL: suppress the native browser/OS context menu on the 3D view so
    // our menu is the only one that appears.
    ev.preventDefault();
    this.close(); // only one menu at a time
    const target = this.pickTarget(ev);
    const items = buildMenuItems(target, this.actions);
    this.open(items, ev.clientX, ev.clientY, this.headerFor(target));
  }

  private pickTarget(ev: MouseEvent): MenuTarget {
    const nodeId = this.deps.view3d.hoveredNode();
    if (nodeId !== null) {
      const n = this.deps.store.state.nodes.get(nodeId);
      if (!n) throw new Error(`contextMenu: hovered node "${nodeId}" not in store`);
      return { kind: 'node', id: nodeId, pinned: n.fx !== null };
    }
    const edgeId = this.deps.view3d.hoveredLink();
    if (edgeId !== null) return { kind: 'edge', id: edgeId };
    return { kind: 'background', clientX: ev.clientX, clientY: ev.clientY };
  }

  // A short, muted header naming the target (node label / edge endpoints), or
  // null for the background. Rendered via textContent (XSS: labels are
  // user/Claude/F5-authored).
  private headerFor(target: MenuTarget): string | null {
    const { nodes, edges } = this.deps.store.state;
    if (target.kind === 'node') {
      const n = nodes.get(target.id);
      return n ? n.label || '(unnamed)' : null;
    }
    if (target.kind === 'edge') {
      const e = edges.get(target.id);
      if (!e) return null;
      const s = nodes.get(e.source)?.label ?? e.source;
      const t = nodes.get(e.target)?.label ?? e.target;
      return `${s || '(unnamed)'} → ${t || '(unnamed)'}`;
    }
    return null;
  }

  private buildActions(): MenuActions {
    const { view3d, store, selection } = this.deps;
    return {
      addChild: (id) => view3d.addChildTo(id),
      linkFrom: (id) => view3d.startLinkFrom(id),
      askAbout: (id) => {
        // Reuse the F4 "Ask the map" flow scoped to this node: select it, then
        // run the registered free-text ask command (runAsk scopes to the
        // selected node's neighborhood). No duplicated ask logic here.
        selection.set(id);
        this.runPaletteCommand('ask-map');
      },
      attachFile: (id) => {
        void this.attach(id);
      },
      togglePin: (id) => view3d.togglePinFor(id),
      deleteNode: (id) => view3d.deleteNodeById(id),
      editEdgeLabel: (id) => view3d.editEdge(id, 'label'),
      setRelation: (id, relation) => store.apply(setEdgeRelation(id, relation)),
      deleteEdge: (id) => view3d.deleteEdgeById(id),
      newNodeAt: (x, y) => view3d.createNodeAt(x, y),
      // Reuse the F5 import flow (its modal, where paste works) via the palette
      // command rather than re-running the Claude round-trip here.
      importText: () => this.runPaletteCommand('import-map')
    };
  }

  // Attach a file to a node — the same flow as DetailPanel's "Attach…": native
  // picker, then the setAttachedFile command (so it undoes like any mutation).
  private async attach(id: string): Promise<void> {
    try {
      const path = await window.mind3d.pickAttachFile();
      if (path !== null) this.deps.store.apply(setAttachedFile(id, path));
    } catch (err) {
      notify.error(`attach failed: ${(err as Error).message}`);
    }
  }

  // Invoke a registered palette command by id (the SAME function the palette
  // runs). Fail-fast if the command is missing.
  private runPaletteCommand(id: string): void {
    const cmd = this.deps.registry.list().find((c) => c.id === id);
    if (!cmd) throw new Error(`contextMenu: no palette command "${id}"`);
    void cmd.run();
  }

  private open(items: MenuItem[], clientX: number, clientY: number, header: string | null): void {
    const root = document.createElement('div');
    root.className = 'ctx-menu';
    if (header !== null) {
      const h = document.createElement('div');
      h.className = 'ctx-header';
      h.textContent = header;
      root.appendChild(h);
    }
    for (const item of items) root.appendChild(this.renderItem(item));
    document.body.appendChild(root);
    this.root = root;
    this.position(root, clientX, clientY);
  }

  private renderItem(item: MenuItem): HTMLElement {
    if (item.submenu !== undefined) {
      const wrap = document.createElement('div');
      wrap.className = 'ctx-item ctx-has-submenu';
      const label = document.createElement('span');
      label.className = 'ctx-item-label';
      label.textContent = item.label;
      const caret = document.createElement('span');
      caret.className = 'ctx-caret';
      caret.textContent = '▸';
      wrap.append(label, caret);
      const sub = document.createElement('div');
      sub.className = 'ctx-submenu';
      for (const si of item.submenu) sub.appendChild(this.renderItem(si));
      wrap.appendChild(sub);
      return wrap;
    }
    const btn = document.createElement('button');
    btn.className = 'ctx-item';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      this.close();
      item.run();
    });
    return btn;
  }

  private position(root: HTMLElement, x: number, y: number): void {
    // Measure at the origin, then clamp so the menu stays fully on-screen.
    root.style.left = '0px';
    root.style.top = '0px';
    const rect = root.getBoundingClientRect();
    const maxX = Math.max(4, window.innerWidth - rect.width - 4);
    const maxY = Math.max(4, window.innerHeight - rect.height - 4);
    root.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
    root.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
  }

  private close(): void {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
