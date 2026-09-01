import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import {
  addEdge, addNode, composite, deleteNode, freezeAll, releaseAll, setLabel, setPosition
} from '../core/commands';
import { createEdge, createNode } from '../core/model';

interface SimNode {
  id: string;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

const MOVE_STEP = 8;
const DIM_OPACITY = 0.12;

export class View3D {
  // 3d-force-graph has no useful public types; this is the documented `any` boundary.
  private graph: any;
  private simNodes: SimNode[] = [];
  private simLinks: { id: string; source: string; target: string }[] = [];
  private hoverNodeId: string | null = null;
  private linkMode = false;
  private focusMode = false;
  private focusSet: Set<string> | null = null;
  private keyMoveActive = false;
  private keyMoveStart: [number, number, number] | null = null;
  private pendingSpawn = new Map<string, { x: number; y: number; z: number }>();
  private labelInput: HTMLInputElement;

  constructor(
    private container: HTMLElement,
    private store: GraphStore,
    private selection: Selection,
    private onStatus: (msg: string) => void
  ) {
    this.graph = new (ForceGraph3D as any)(container);
    this.graph
      .backgroundColor('#14181f')
      .nodeId('id')
      .linkSource('source')
      .linkTarget('target')
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .linkOpacity(0.35)
      .nodeThreeObject((n: SimNode) => this.makeSprite(n))
      .onNodeClick((n: SimNode) => this.handleNodeClick(n.id))
      .onNodeHover((n: SimNode | null) => {
        this.hoverNodeId = n ? n.id : null;
      })
      .onNodeDragEnd((n: SimNode) => {
        this.store.apply(setPosition(n.id, n.x ?? 0, n.y ?? 0, n.z ?? 0));
      })
      .onBackgroundClick(() => {
        if (!this.linkMode) this.selection.set(null);
      });

    this.container.addEventListener('dblclick', (ev) => {
      if (this.hoverNodeId !== null) return;
      const p = this.worldPointAt(ev.clientX, ev.clientY);
      const node = createNode('new node');
      node.fx = p.x;
      node.fy = p.y;
      node.fz = p.z;
      this.store.apply(addNode(node));
      this.selection.set(node.id);
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
    const m = this.store.state.nodes.get(n.id);
    if (!m) throw new Error(`sprite for unknown node "${n.id}"`);
    const sprite = new SpriteText(m.label === '' ? '·' : m.label);
    sprite.textHeight = 6;
    const selected = this.selection.get() === n.id;
    sprite.color = selected ? '#ffd54a' : (m.color ?? '#dfe6ee');
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
    this.recomputeFocus();
    this.graph.graphData({ nodes: this.simNodes, links: this.simLinks });
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
    const hops = new Set<string>([sel]);
    for (let i = 0; i < 2; i++) {
      for (const e of this.store.state.edges.values()) {
        if (hops.has(e.source)) hops.add(e.target);
        if (hops.has(e.target)) hops.add(e.source);
      }
    }
    this.focusSet = hops;
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

  private handleKey(ev: KeyboardEvent): void {
    if (this.typingInInput()) return;
    const sel = this.selection.get();
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(ev.key) && sel !== null) {
      ev.preventDefault();
      this.keyMove(sel, ev.key, ev.shiftKey);
      return;
    }
    switch (ev.key) {
      case 'p':
        if (sel !== null) this.togglePin(sel);
        break;
      case 'Tab':
        if (sel !== null) {
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
      this.keyMoveStart = [sim.x ?? 0, sim.y ?? 0, sim.z ?? 0];
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
    const sel = this.selection.get();
    this.keyMoveActive = false;
    this.keyMoveStart = null;
    if (sel === null) return;
    const sim = this.simNodes.find((n) => n.id === sel);
    if (!sim) return;
    this.store.apply(setPosition(sel, sim.fx ?? 0, sim.fy ?? 0, sim.fz ?? 0));
  }

  private togglePin(id: string): void {
    const m = this.store.state.nodes.get(id);
    if (!m) throw new Error(`togglePin: no such node "${id}"`);
    if (m.fx !== null) {
      this.store.apply(setPosition(id, null, null, null));
      return;
    }
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim) throw new Error(`togglePin: node "${id}" not in simulation`);
    this.store.apply(setPosition(id, sim.x ?? 0, sim.y ?? 0, sim.z ?? 0));
  }

  private addChild(parentId: string): void {
    const sim = this.simNodes.find((n) => n.id === parentId);
    const base = sim ? { x: sim.x ?? 0, y: sim.y ?? 0, z: sim.z ?? 0 } : { x: 0, y: 0, z: 0 };
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
    const coords = sim
      ? this.graph.graph2ScreenCoords(sim.x ?? 0, sim.y ?? 0, sim.z ?? 0)
      : { x: 40, y: 40 };
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
  }
}
