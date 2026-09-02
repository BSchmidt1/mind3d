import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import {
  addEdge, addNode, composite, deleteNode, freezeAll, releaseAll, setLabel, setPosition
} from '../core/commands';
import { createEdge, createNode } from '../core/model';
import type { GraphState } from '../core/model';
import { nHopNeighborhood } from '../core/neighborhood';
import type { GraphDiff } from '../core/snapshot';

interface SimNode {
  id: string;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  ghost?: boolean;
}

// A translucent preview of a proposal's adds (F3b), rendered in the same force
// graph as the real nodes but NOT committed to the GraphStore. Only Accept
// mutates the store; the ghost lives entirely in View3D's sim arrays.
export interface GhostData {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string }[];
  anchorId: string | null;
  // Border/link tint for the preview. Defaults to GHOST_ACCENT (proposal
  // yellow); the snapshot diff view (F8) reuses the ghost mechanism with a red
  // accent to show removed nodes/edges.
  accent?: string;
}

const MOVE_STEP = 8;
const DIM_OPACITY = 0.12;
const GHOST_OPACITY = 0.5;
const GHOST_ACCENT = '#ffd54a';
// Snapshot diff (F8) colors, matching the toast/onboarding accents.
const DIFF_ADDED = '#5fd08a';
const DIFF_CHANGED = '#ffd54a';
const DIFF_REMOVED = '#e05a5a';

export class View3D {
  // 3d-force-graph has no useful public types; this is the documented `any` boundary.
  private graph: any;
  private simNodes: SimNode[] = [];
  private simLinks: { id: string; source: string; target: string; ghost?: boolean }[] = [];
  private ghost: GhostData | null = null;
  // Snapshot diff overlay (F8): per-id tints for present (added/changed)
  // nodes/edges. Removed nodes/edges are shown via the red-accented ghost.
  // Non-null iff a diff view is active.
  private diffNodeColors: Map<string, string> | null = null;
  private diffLinkColors: Map<string, string> | null = null;
  private hoverNodeId: string | null = null;
  private linkMode = false;
  private focusMode = false;
  private focusSet: Set<string> | null = null;
  private keyMoveActive = false;
  private keyMoveNodeId: string | null = null;
  private pendingSpawn = new Map<string, { x: number; y: number; z: number }>();
  private labelInput: HTMLInputElement;
  private suppressNextBgClick = false;

  constructor(
    private container: HTMLElement,
    private store: GraphStore,
    private selection: Selection,
    private onStatus: (msg: string) => void
  ) {
    this.graph = new (ForceGraph3D as any)(container);
    this.graph
      .width(container.clientWidth)
      .height(container.clientHeight)
      .backgroundColor('#14181f')
      .nodeId('id')
      .linkSource('source')
      .linkTarget('target')
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .linkOpacity(0.35)
      .linkColor((l: { id: string; ghost?: boolean }) => {
        if (l.ghost) return this.ghost?.accent ?? GHOST_ACCENT;
        return this.diffLinkColors?.get(l.id) ?? '#5b6b80';
      })
      .nodeThreeObject((n: SimNode) => this.makeSprite(n))
      .onNodeClick((n: SimNode) => this.handleNodeClick(n.id))
      .onNodeHover((n: SimNode | null) => {
        this.hoverNodeId = n ? n.id : null;
      })
      .onNodeDragEnd((n: SimNode) => {
        this.store.apply(setPosition(n.id, n.x ?? 0, n.y ?? 0, n.z ?? 0));
      })
      .onBackgroundClick(() => {
        if (this.suppressNextBgClick) {
          this.suppressNextBgClick = false;
          return;
        }
        if (!this.linkMode) this.selection.set(null);
      });

    const resizeObserver = new ResizeObserver(() => {
      this.graph.width(this.container.clientWidth).height(this.container.clientHeight);
    });
    resizeObserver.observe(container);

    this.container.addEventListener('dblclick', (ev) => {
      if (this.hoverNodeId !== null) return;
      const p = this.worldPointAt(ev.clientX, ev.clientY);
      const node = createNode('new node');
      node.fx = p.x;
      node.fy = p.y;
      node.fz = p.z;
      this.pendingSpawn.set(node.id, p);
      this.store.apply(addNode(node));
      this.selection.set(node.id);
      this.suppressNextBgClick = true;
      this.beginLabelEdit(node.id);
    });

    window.addEventListener('keydown', (ev) => this.handleKey(ev));
    window.addEventListener('keyup', (ev) => this.handleKeyUp(ev));

    this.labelInput = document.createElement('input');
    this.labelInput.id = 'label-editor';
    this.labelInput.hidden = true;
    container.appendChild(this.labelInput);

    this.store.subscribe((ev) => {
      if (ev.kind === 'structure') this.rebuild();
      else this.syncProps(ev.ids);
    });
    this.selection.subscribe(() => {
      this.recomputeFocus();
      this.graph.refresh();
    });
    this.rebuild();
  }

  private makeSprite(n: SimNode): THREE.Object3D {
    if (n.ghost) {
      // Ghost nodes are not in the store yet — their label comes from the
      // pending proposal. Rendered translucent with an accent border so the
      // preview reads as "not yet real".
      const g = this.ghost?.nodes.find((gn) => gn.id === n.id);
      if (!g) throw new Error(`ghost sprite for unknown ghost node "${n.id}"`);
      const sprite = new SpriteText(g.label === '' ? '·' : g.label);
      sprite.textHeight = 6;
      sprite.color = '#dfe6ee';
      sprite.borderColor = this.ghost?.accent ?? GHOST_ACCENT;
      sprite.borderWidth = 0.6;
      const mat = sprite.material as THREE.Material;
      mat.opacity = GHOST_OPACITY;
      mat.transparent = true;
      return sprite;
    }
    const m = this.store.state.nodes.get(n.id);
    if (!m) throw new Error(`sprite for unknown node "${n.id}"`);
    const sprite = new SpriteText(m.label === '' ? '·' : m.label);
    sprite.textHeight = 6;
    const selected = this.selection.get() === n.id;
    // In a diff view, added/changed nodes take their diff tint (removed nodes
    // are separate red ghosts). Otherwise selection highlight, then the node's
    // own color, then the default.
    const diffColor = this.diffNodeColors?.get(n.id);
    sprite.color = diffColor ?? (selected ? '#ffd54a' : (m.color ?? '#dfe6ee'));
    if (m.fx !== null) sprite.borderColor = selected ? '#ffd54a' : '#5b6b80';
    if (m.fx !== null) sprite.borderWidth = 0.4;
    const mat = sprite.material as THREE.Material;
    if (this.focusSet && !this.focusSet.has(n.id)) mat.opacity = DIM_OPACITY;
    mat.transparent = true;
    return sprite;
  }

  private rebuild(): void {
    const old = new Map(this.simNodes.map((n) => [n.id, n]));
    this.simNodes = [...this.store.state.nodes.values()].map((m) => {
      const prev = old.get(m.id);
      const spawn = this.pendingSpawn.get(m.id);
      this.pendingSpawn.delete(m.id);
      return {
        id: m.id,
        x: spawn?.x ?? prev?.x,
        y: spawn?.y ?? prev?.y,
        z: spawn?.z ?? prev?.z,
        fx: m.fx ?? undefined,
        fy: m.fy ?? undefined,
        fz: m.fz ?? undefined
      };
    });
    this.simLinks = [...this.store.state.edges.values()].map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target
    }));
    if (this.ghost) this.appendGhost(this.ghost);
    this.recomputeFocus();
    this.graph.graphData({ nodes: this.simNodes, links: this.simLinks });
  }

  // Append the proposal preview's nodes/links to the freshly-built real sim
  // arrays. Ghost nodes are seeded into `pendingSpawn` (once, near the anchor's
  // live position — same offset math as spawnNear) so their placement is stable
  // across rebuilds while the preview is up. The seed persists until Accept
  // (spawnNear re-seeds the now-real ids) or clearGhost (which prunes it).
  private appendGhost(ghost: GhostData): void {
    const anchor = ghost.anchorId !== null ? this.simNodes.find((n) => n.id === ghost.anchorId) : undefined;
    const base = anchor
      ? { x: anchor.x ?? 0, y: anchor.y ?? 0, z: anchor.z ?? 0 }
      : { x: 0, y: 0, z: 0 };
    for (const g of ghost.nodes) {
      if (!this.pendingSpawn.has(g.id)) {
        this.pendingSpawn.set(g.id, {
          x: base.x + 20 * (Math.random() - 0.5),
          y: base.y + 20 * (Math.random() - 0.5),
          z: base.z + 20 * (Math.random() - 0.5)
        });
      }
      const p = this.pendingSpawn.get(g.id)!;
      this.simNodes.push({ id: g.id, ghost: true, x: p.x, y: p.y, z: p.z });
    }
    ghost.links.forEach((l, i) => {
      this.simLinks.push({ id: `ghost:${i}`, source: l.source, target: l.target, ghost: true });
    });
  }

  // Show a translucent preview of a proposal's adds. Does NOT touch the store.
  showGhost(g: GhostData): void {
    this.ghost = g;
    this.rebuild();
  }

  // Remove the preview and prune its pending-spawn seeds (so a rejected
  // proposal leaves nothing behind, and an accepted one gets fresh placement
  // from the caller's spawnNear for the now-real ids).
  clearGhost(): void {
    if (this.ghost) {
      for (const g of this.ghost.nodes) this.pendingSpawn.delete(g.id);
    }
    this.ghost = null;
    this.rebuild();
  }

  // Snapshot diff view (F8): tint present added/changed nodes and edges, and
  // render the removed nodes/edges as red ghosts. `before` is the snapshot's
  // materialized state — it supplies the removed nodes' labels and the removed
  // edges' endpoints, which are no longer in the live store. Reuses the ghost
  // mechanism (red accent) for the removals, so it composes with the existing
  // pendingSpawn placement. A single rebuild repaints everything.
  showDiff(diff: GraphDiff, before: GraphState): void {
    this.diffNodeColors = new Map();
    for (const id of diff.nodesAdded) this.diffNodeColors.set(id, DIFF_ADDED);
    for (const id of diff.nodesChanged) this.diffNodeColors.set(id, DIFF_CHANGED);
    this.diffLinkColors = new Map();
    for (const id of diff.edgesAdded) this.diffLinkColors.set(id, DIFF_ADDED);
    for (const id of diff.edgesChanged) this.diffLinkColors.set(id, DIFF_CHANGED);
    const removedNodes = diff.nodesRemoved.map((id) => {
      const n = before.nodes.get(id);
      if (!n) throw new Error(`showDiff: removed node "${id}" missing from before-state`);
      return { id, label: n.label };
    });
    const removedLinks = diff.edgesRemoved.map((id) => {
      const e = before.edges.get(id);
      if (!e) throw new Error(`showDiff: removed edge "${id}" missing from before-state`);
      return { source: e.source, target: e.target };
    });
    // Clear any prior ghost's seeds before installing the diff ghost.
    if (this.ghost) {
      for (const g of this.ghost.nodes) this.pendingSpawn.delete(g.id);
    }
    this.ghost = { nodes: removedNodes, links: removedLinks, anchorId: null, accent: DIFF_REMOVED };
    this.rebuild();
  }

  clearDiff(): void {
    this.diffNodeColors = null;
    this.diffLinkColors = null;
    this.clearGhost(); // drops the red removed-node ghosts + rebuilds
  }

  diffActive(): boolean {
    return this.diffNodeColors !== null;
  }

  private syncProps(ids: string[]): void {
    for (const id of ids) {
      const m = this.store.state.nodes.get(id);
      const sim = this.simNodes.find((n) => n.id === id);
      if (!m || !sim) continue;
      sim.fx = m.fx ?? undefined;
      sim.fy = m.fy ?? undefined;
      sim.fz = m.fz ?? undefined;
      if (m.fx !== null) {
        sim.x = m.fx;
        sim.y = m.fy ?? undefined;
        sim.z = m.fz ?? undefined;
      }
    }
    this.graph.refresh();
  }

  private recomputeFocus(): void {
    if (!this.focusMode) {
      this.focusSet = null;
      return;
    }
    const sel = this.selection.get();
    if (sel === null) {
      this.focusSet = null;
      return;
    }
    this.focusSet = nHopNeighborhood(this.store.state.edges.values(), sel, 2);
  }

  private handleNodeClick(id: string): void {
    if (this.linkMode) {
      const from = this.selection.get();
      this.linkMode = false;
      this.container.style.cursor = '';
      if (from === null) {
        this.onStatus('link cancelled: nothing selected');
        return;
      }
      if (from === id) {
        this.onStatus('link cancelled: self-loop not allowed');
        return;
      }
      this.store.apply(addEdge(createEdge(from, id)));
      this.onStatus('edge created');
      return;
    }
    this.selection.set(id);
  }

  private worldPointAt(clientX: number, clientY: number): { x: number; y: number; z: number } {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const cam = this.graph.camera() as THREE.PerspectiveCamera;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const target = this.graph.controls().target as THREE.Vector3;
    const normal = cam.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, target);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, pt)) {
      throw new Error('dblclick ray does not intersect view plane');
    }
    return { x: pt.x, y: pt.y, z: pt.z };
  }

  private typingInInput(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable);
  }

  private focusInOutlinePanel(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLElement && el.closest('#outline-panel') !== null;
  }

  private handleKey(ev: KeyboardEvent): void {
    if (this.typingInInput()) return;
    const sel = this.selection.get();
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(ev.key) && sel !== null) {
      ev.preventDefault();
      if (this.keyMoveActive && this.keyMoveNodeId !== sel) return;
      this.keyMove(sel, ev.key, ev.shiftKey);
      return;
    }
    switch (ev.key) {
      case 'p':
        if (sel !== null) this.togglePin(sel);
        break;
      case 'Tab':
        if (sel !== null && !ev.shiftKey && !this.focusInOutlinePanel()) {
          ev.preventDefault();
          this.addChild(sel);
        }
        break;
      case 'l':
        if (sel !== null) {
          this.linkMode = true;
          this.container.style.cursor = 'crosshair';
          this.onStatus('link mode: click target node (Esc cancels)');
        }
        break;
      case 'Escape':
        this.linkMode = false;
        this.container.style.cursor = '';
        this.labelInput.hidden = true;
        break;
      case 'Delete':
      case 'Backspace':
        if (sel !== null) {
          this.selection.set(null);
          this.store.apply(deleteNode(sel));
        }
        break;
      case 'e':
        if (sel !== null) this.beginLabelEdit(sel);
        break;
      case 'f':
        if (sel !== null) this.flyTo(sel);
        break;
      case 'x':
        this.toggleFocusMode();
        break;
    }
  }

  private keyMove(id: string, key: string, shift: boolean): void {
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim) throw new Error(`keyMove: node "${id}" not in simulation`);
    const cam = this.graph.camera() as THREE.PerspectiveCamera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    let d = new THREE.Vector3();
    if (key === 'ArrowLeft') d = right.multiplyScalar(-MOVE_STEP);
    if (key === 'ArrowRight') d = right.multiplyScalar(MOVE_STEP);
    if (key === 'ArrowUp') d = shift ? fwd.multiplyScalar(MOVE_STEP) : up.multiplyScalar(MOVE_STEP);
    if (key === 'ArrowDown') d = shift ? fwd.multiplyScalar(-MOVE_STEP) : up.multiplyScalar(-MOVE_STEP);
    if (!this.keyMoveActive) {
      this.keyMoveActive = true;
      this.keyMoveNodeId = id;
    }
    sim.fx = (sim.fx ?? sim.x ?? 0) + d.x;
    sim.fy = (sim.fy ?? sim.y ?? 0) + d.y;
    sim.fz = (sim.fz ?? sim.z ?? 0) + d.z;
    sim.x = sim.fx;
    sim.y = sim.fy;
    sim.z = sim.fz;
    this.graph.d3ReheatSimulation();
  }

  private handleKeyUp(ev: KeyboardEvent): void {
    if (!this.keyMoveActive) return;
    if (!ev.key.startsWith('Arrow')) return;
    const id = this.keyMoveNodeId;
    this.keyMoveActive = false;
    this.keyMoveNodeId = null;
    if (id === null) return;
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim) return;
    this.store.apply(setPosition(id, sim.fx ?? 0, sim.fy ?? 0, sim.fz ?? 0));
  }

  private togglePin(id: string): void {
    const m = this.store.state.nodes.get(id);
    if (!m) throw new Error(`togglePin: no such node "${id}"`);
    if (m.fx !== null) {
      this.store.apply(setPosition(id, null, null, null));
      this.graph.d3ReheatSimulation();
      return;
    }
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim) throw new Error(`togglePin: node "${id}" not in simulation`);
    this.store.apply(setPosition(id, sim.x ?? 0, sim.y ?? 0, sim.z ?? 0));
  }

  private addChild(parentId: string): void {
    const sim = this.simNodes.find((n) => n.id === parentId);
    if (!sim) throw new Error(`addChild: node "${parentId}" not in simulation`);
    const base = { x: sim.x ?? 0, y: sim.y ?? 0, z: sim.z ?? 0 };
    const child = createNode('new node');
    this.pendingSpawn.set(child.id, {
      x: base.x + 20 * (Math.random() - 0.5),
      y: base.y + 20 * (Math.random() - 0.5),
      z: base.z + 20 * (Math.random() - 0.5)
    });
    this.store.apply(composite('addChild', [addNode(child), addEdge(createEdge(parentId, child.id))]));
    this.selection.set(child.id);
    this.beginLabelEdit(child.id);
  }

  private beginLabelEdit(id: string): void {
    const m = this.store.state.nodes.get(id);
    if (!m) throw new Error(`beginLabelEdit: no such node "${id}"`);
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim) throw new Error(`beginLabelEdit: node "${id}" not in simulation`);
    const coords = this.graph.graph2ScreenCoords(sim.x ?? 0, sim.y ?? 0, sim.z ?? 0);
    this.labelInput.value = m.label;
    this.labelInput.style.left = `${coords.x}px`;
    this.labelInput.style.top = `${coords.y + 12}px`;
    this.labelInput.hidden = false;
    this.labelInput.focus();
    this.labelInput.select();
    this.labelInput.onkeydown = (ev): void => {
      if (ev.key === 'Enter') {
        this.store.apply(setLabel(id, this.labelInput.value));
        this.labelInput.hidden = true;
      }
      if (ev.key === 'Escape') this.labelInput.hidden = true;
      ev.stopPropagation();
    };
    this.labelInput.onblur = (): void => {
      this.labelInput.hidden = true;
    };
  }

  // Public: seed pendingSpawn for voice-created nodes so the next rebuild
  // places them near the anchor node's live sim position (or origin if
  // there's no anchor / it's not in the current simulation) instead of at
  // the origin. Reuses the same mechanism dblclick/addChild rely on.
  spawnNear(ids: string[], anchorId: string | null): void {
    const anchor = anchorId !== null ? this.simNodes.find((n) => n.id === anchorId) : undefined;
    const base = anchor
      ? { x: anchor.x ?? 0, y: anchor.y ?? 0, z: anchor.z ?? 0 }
      : { x: 0, y: 0, z: 0 };
    for (const id of ids) {
      this.pendingSpawn.set(id, {
        x: base.x + 20 * (Math.random() - 0.5),
        y: base.y + 20 * (Math.random() - 0.5),
        z: base.z + 20 * (Math.random() - 0.5)
      });
    }
  }

  flyTo(id: string): void {
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim) throw new Error(`flyTo: node "${id}" not in simulation`);
    const pos = { x: sim.x ?? 0, y: sim.y ?? 0, z: sim.z ?? 0 };
    const dist = 120;
    const len = Math.hypot(pos.x, pos.y, pos.z) || 1;
    this.graph.cameraPosition(
      { x: pos.x * (1 + dist / len), y: pos.y * (1 + dist / len), z: pos.z * (1 + dist / len) },
      pos,
      800
    );
  }

  toggleFocusMode(): void {
    this.focusMode = !this.focusMode;
    this.recomputeFocus();
    this.graph.refresh();
    this.onStatus(this.focusMode ? 'focus mode on' : 'focus mode off');
  }

  pinnedCount(): number {
    return [...this.store.state.nodes.values()].filter((n) => n.fx !== null).length;
  }

  livePositions(): Map<string, { x: number; y: number; z: number }> {
    return new Map(this.simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }]));
  }

  freezeAllNow(): void {
    this.store.apply(freezeAll(this.store.state, this.livePositions()));
  }

  releaseAllNow(): void {
    this.store.apply(releaseAll(this.store.state));
    this.graph.d3ReheatSimulation();
  }
}
