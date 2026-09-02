import { describe, expect, test } from 'vitest';
import { createEdge, createNode, emptyState, type GraphState } from '../src/renderer/src/core/model';
import { createSnapshot, diffStates, snapshotToState } from '../src/renderer/src/core/snapshot';

function sample(): GraphState {
  const s = emptyState();
  const a = createNode('a');
  a.notes = 'note a';
  a.color = '#ff0000';
  a.tags = ['x'];
  a.fx = 1; a.fy = 2; a.fz = 3;
  const b = createNode('b');
  s.nodes.set(a.id, a);
  s.nodes.set(b.id, b);
  const e = createEdge(a.id, b.id);
  e.label = 'rel';
  s.edges.set(e.id, e);
  return s;
}

describe('snapshot', () => {
  test('createSnapshot deep-copies: mutating the store after does not change the snapshot', () => {
    const s = sample();
    const [a] = [...s.nodes.values()];
    const snap = createSnapshot('cp1', s);
    // Mutate the live state after taking the snapshot.
    a!.label = 'a-mutated';
    a!.tags.push('y');
    const e = [...s.edges.values()][0]!;
    e.label = 'rel-mutated';
    const snapA = snap.nodes.find((n) => n.id === a!.id)!;
    expect(snapA.label).toBe('a');
    expect(snapA.tags).toEqual(['x']);
    expect(snap.edges[0]!.label).toBe('rel');
  });

  test('createSnapshot sets id/name/createdAt', () => {
    const snap = createSnapshot('checkpoint', sample());
    expect(typeof snap.id).toBe('string');
    expect(snap.id.length).toBeGreaterThan(0);
    expect(snap.name).toBe('checkpoint');
    expect(() => new Date(snap.createdAt).toISOString()).not.toThrow();
  });

  test('snapshotToState round-trips to an equal, independent state', () => {
    const s = sample();
    const snap = createSnapshot('cp', s);
    const state = snapshotToState(snap);
    expect([...state.nodes.keys()]).toEqual([...s.nodes.keys()]);
    expect([...state.edges.keys()]).toEqual([...s.edges.keys()]);
    expect(state.nodes).toEqual(s.nodes);
    expect(state.edges).toEqual(s.edges);
    // Independent: editing the restored state does not touch the snapshot.
    const first = [...state.nodes.values()][0]!;
    first.label = 'changed';
    expect(snap.nodes.find((n) => n.id === first.id)!.label).toBe('a');
  });

  test('diffStates: added and removed nodes by id', () => {
    const before = sample();
    const after = snapshotToState(createSnapshot('x', before));
    const [a, b] = [...after.nodes.values()];
    // remove b, add c
    after.nodes.delete(b!.id);
    // also drop the edge that referenced b so state stays coherent
    for (const [eid, e] of after.edges) if (e.source === b!.id || e.target === b!.id) after.edges.delete(eid);
    const c = createNode('c');
    after.nodes.set(c.id, c);
    const diff = diffStates(before, after);
    expect(diff.nodesAdded).toEqual([c.id]);
    expect(diff.nodesRemoved).toEqual([b!.id]);
    expect(diff.nodesChanged).toEqual([]);
    // a unchanged → absent everywhere
    expect(diff.nodesChanged).not.toContain(a!.id);
  });

  test('diffStates: nodesChanged on label/notes/color/tags/position difference; unchanged absent', () => {
    const before = sample();
    const [aId] = [...before.nodes.keys()];
    // label change
    let after = snapshotToState(createSnapshot('x', before));
    [...after.nodes.values()][0]!.label = 'A!';
    expect(diffStates(before, after).nodesChanged).toEqual([aId]);
    // notes change
    after = snapshotToState(createSnapshot('x', before));
    [...after.nodes.values()][0]!.notes = 'different';
    expect(diffStates(before, after).nodesChanged).toEqual([aId]);
    // color change
    after = snapshotToState(createSnapshot('x', before));
    [...after.nodes.values()][0]!.color = '#00ff00';
    expect(diffStates(before, after).nodesChanged).toEqual([aId]);
    // tags change
    after = snapshotToState(createSnapshot('x', before));
    [...after.nodes.values()][0]!.tags = ['x', 'z'];
    expect(diffStates(before, after).nodesChanged).toEqual([aId]);
    // position change
    after = snapshotToState(createSnapshot('x', before));
    [...after.nodes.values()][0]!.fx = 99;
    expect(diffStates(before, after).nodesChanged).toEqual([aId]);
    // no change → empty
    after = snapshotToState(createSnapshot('x', before));
    const clean = diffStates(before, after);
    expect(clean.nodesChanged).toEqual([]);
    expect(clean.nodesAdded).toEqual([]);
    expect(clean.nodesRemoved).toEqual([]);
    expect(clean.edgesChanged).toEqual([]);
  });

  test('diffStates: edges added/removed/changed by endpoints or label', () => {
    const before = sample();
    const [eId] = [...before.edges.keys()];
    // label change on the existing edge
    let after = snapshotToState(createSnapshot('x', before));
    [...after.edges.values()][0]!.label = 'other';
    expect(diffStates(before, after).edgesChanged).toEqual([eId]);
    // endpoint (source) change
    after = snapshotToState(createSnapshot('x', before));
    const nodes = [...after.nodes.keys()];
    [...after.edges.values()][0]!.source = nodes[1]!; // flip so source=b, target=a? keep coherent
    [...after.edges.values()][0]!.target = nodes[0]!;
    expect(diffStates(before, after).edgesChanged).toEqual([eId]);
    // add a new edge
    after = snapshotToState(createSnapshot('x', before));
    const c = createNode('c');
    after.nodes.set(c.id, c);
    const newEdge = createEdge(nodes[0]!, c.id);
    after.edges.set(newEdge.id, newEdge);
    const dAdd = diffStates(before, after);
    expect(dAdd.edgesAdded).toEqual([newEdge.id]);
    expect(dAdd.edgesChanged).toEqual([]);
    // remove the edge
    after = snapshotToState(createSnapshot('x', before));
    after.edges.delete(eId!);
    expect(diffStates(before, after).edgesRemoved).toEqual([eId]);
  });
});
