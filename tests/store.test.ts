import { describe, expect, test } from 'vitest';
import { createEdge, createNode, emptyState } from '../src/renderer/src/core/model';
import {
  addEdge, addNode, composite, deleteEdge, deleteNode, freezeAll,
  releaseAll, reparent, setEdgeLabel, setEdgeRelation, setLabel, setPosition
} from '../src/renderer/src/core/commands';
import { GraphStore, type ChangeEvent } from '../src/renderer/src/core/store';

function storeWith(labels: string[]): { store: GraphStore; ids: string[] } {
  const store = new GraphStore();
  const ids = labels.map((l) => {
    const n = createNode(l);
    store.apply(addNode(n));
    return n.id;
  });
  return { store, ids };
}

describe('GraphStore', () => {
  test('addNode / setLabel / undo / redo', () => {
    const { store, ids } = storeWith(['a']);
    store.apply(setLabel(ids[0]!, 'b'));
    expect(store.state.nodes.get(ids[0]!)!.label).toBe('b');
    expect(store.undo()).toBe(true);
    expect(store.state.nodes.get(ids[0]!)!.label).toBe('a');
    expect(store.redo()).toBe(true);
    expect(store.state.nodes.get(ids[0]!)!.label).toBe('b');
  });

  test('apply clears redo stack', () => {
    const { store, ids } = storeWith(['a']);
    store.apply(setLabel(ids[0]!, 'b'));
    store.undo();
    store.apply(setLabel(ids[0]!, 'c'));
    expect(store.redo()).toBe(false);
  });

  test('addNode rejects duplicate id', () => {
    const store = new GraphStore();
    const n = createNode('a');
    store.apply(addNode(n));
    expect(() => store.apply(addNode(n))).toThrow(/already exists/);
  });

  test('setLabel on missing node throws', () => {
    const store = new GraphStore();
    expect(() => store.apply(setLabel('nope', 'x'))).toThrow(/no such node: "nope"/);
  });

  test('addEdge validates endpoints and forbids self-loop', () => {
    const { store, ids } = storeWith(['a', 'b']);
    expect(() => store.apply(addEdge(createEdge(ids[0]!, 'ghost')))).toThrow(/ghost/);
    expect(() => store.apply(addEdge(createEdge(ids[0]!, ids[0]!)))).toThrow(/self-loop/);
    store.apply(addEdge(createEdge(ids[0]!, ids[1]!)));
    expect(store.state.edges.size).toBe(1);
  });

  test('deleteNode cascades incident edges; undo restores edge order', () => {
    const { store, ids } = storeWith(['a', 'b', 'c']);
    const e1 = createEdge(ids[0]!, ids[1]!);
    const e2 = createEdge(ids[1]!, ids[2]!);
    const e3 = createEdge(ids[2]!, ids[0]!);
    for (const e of [e1, e2, e3]) store.apply(addEdge(e));
    store.apply(deleteNode(ids[1]!));
    expect(store.state.nodes.size).toBe(2);
    expect([...store.state.edges.keys()]).toEqual([e3.id]);
    store.undo();
    expect([...store.state.edges.keys()]).toEqual([e1.id, e2.id, e3.id]);
  });

  test('setPosition pins, all-null unpins, mixed throws', () => {
    const { store, ids } = storeWith(['a']);
    store.apply(setPosition(ids[0]!, 1, 2, 3));
    const n = store.state.nodes.get(ids[0]!)!;
    expect([n.fx, n.fy, n.fz]).toEqual([1, 2, 3]);
    store.apply(setPosition(ids[0]!, null, null, null));
    expect(n.fx).toBeNull();
    expect(() => setPosition(ids[0]!, 1, null, null)).toThrow(/all numbers or all null/);
  });

  test('reparent moves edge source and undoes', () => {
    const { store, ids } = storeWith(['a', 'b', 'c']);
    const e = createEdge(ids[0]!, ids[2]!);
    store.apply(addEdge(e));
    store.apply(reparent(e.id, ids[1]!));
    expect(store.state.edges.get(e.id)!.source).toBe(ids[1]);
    store.undo();
    expect(store.state.edges.get(e.id)!.source).toBe(ids[0]);
  });

  test('composite undoes in reverse; freezeAll/releaseAll', () => {
    const { store, ids } = storeWith(['a', 'b']);
    const positions = new Map([
      [ids[0]!, { x: 1, y: 1, z: 1 }],
      [ids[1]!, { x: 2, y: 2, z: 2 }]
    ]);
    store.apply(freezeAll(store.state, positions));
    expect(store.state.nodes.get(ids[1]!)!.fz).toBe(2);
    store.apply(releaseAll(store.state));
    expect(store.state.nodes.get(ids[0]!)!.fx).toBeNull();
    store.undo();
    expect(store.state.nodes.get(ids[0]!)!.fx).toBe(1);
    expect(() => composite('empty', [])).toThrow(/empty/);
    store.apply(releaseAll(store.state));
    expect(() => releaseAll(store.state)).toThrow(/no pinned nodes/);
  });

  test('events carry kind and ids', () => {
    const store = new GraphStore();
    const events: ChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    const n = createNode('a');
    store.apply(addNode(n));
    store.apply(setLabel(n.id, 'b'));
    store.undo();
    expect(events.map((e) => e.kind)).toEqual(['structure', 'props', 'props']);
    expect(events[1]!.ids).toEqual([n.id]);
  });

  test('loadState replaces state and clears history', () => {
    const { store } = storeWith(['a']);
    const fresh = emptyState();
    store.loadState(fresh);
    expect(store.state.nodes.size).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  test('composite atomicity: rollback on partial failure', () => {
    const store = new GraphStore();
    const n1 = createNode('a');
    const n2 = createNode('b');
    store.apply(addNode(n1));
    store.apply(addNode(n2));
    const initialCanUndo = store.canUndo;
    const n = createNode('c');
    const ghostId = 'nonexistent-ghost-id';
    const badEdge = createEdge(ghostId, n1.id); // source never exists
    expect(() => {
      store.apply(composite('bad', [addNode(n), addEdge(badEdge)]));
    }).toThrow();
    expect(store.state.nodes.has(n.id)).toBe(false);
    expect(store.canUndo).toBe(initialCanUndo);
  });

  test('setEdgeLabel sets/undoes/redoes and emits a structure event', () => {
    const { store, ids } = storeWith(['a', 'b']);
    const e = createEdge(ids[0]!, ids[1]!);
    store.apply(addEdge(e));
    const events: ChangeEvent[] = [];
    store.subscribe((ev) => events.push(ev));
    store.apply(setEdgeLabel(e.id, 'supports argument'));
    expect(store.state.edges.get(e.id)!.label).toBe('supports argument');
    expect(events[0]!.kind).toBe('structure'); // forces link rebuild/repaint
    expect(store.undo()).toBe(true);
    expect(store.state.edges.get(e.id)!.label).toBeNull();
    expect(store.redo()).toBe(true);
    expect(store.state.edges.get(e.id)!.label).toBe('supports argument');
  });

  test('setEdgeLabel on missing edge throws', () => {
    const store = new GraphStore();
    expect(() => store.apply(setEdgeLabel('nope', 'x'))).toThrow(/no such edge: "nope"/);
  });

  test('setEdgeRelation sets/undoes/redoes; default relation is none', () => {
    const { store, ids } = storeWith(['a', 'b']);
    const e = createEdge(ids[0]!, ids[1]!);
    store.apply(addEdge(e));
    expect(store.state.edges.get(e.id)!.relation).toBe('none');
    store.apply(setEdgeRelation(e.id, 'refutes'));
    expect(store.state.edges.get(e.id)!.relation).toBe('refutes');
    expect(store.undo()).toBe(true);
    expect(store.state.edges.get(e.id)!.relation).toBe('none');
    expect(store.redo()).toBe(true);
    expect(store.state.edges.get(e.id)!.relation).toBe('refutes');
  });

  test('deleteEdge undo restores edge order', () => {
    const { store, ids } = storeWith(['a', 'b']);
    const e1 = createEdge(ids[0]!, ids[1]!);
    const e2 = createEdge(ids[1]!, ids[0]!);
    const e3 = createEdge(ids[0]!, ids[1]!);
    for (const e of [e1, e2, e3]) store.apply(addEdge(e));
    store.apply(deleteEdge(e2.id));
    expect([...store.state.edges.keys()]).toEqual([e1.id, e3.id]);
    store.undo();
    expect([...store.state.edges.keys()]).toEqual([e1.id, e2.id, e3.id]);
  });
});
