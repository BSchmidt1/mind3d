import { describe, expect, test } from 'vitest';
import { createEdge, createNode, emptyState } from '../src/renderer/src/core/model';
import { projectOutline } from '../src/renderer/src/core/outline';
import type { GraphState } from '../src/renderer/src/core/model';

function build(labels: string[], edgePairs: [number, number][]): { s: GraphState; ids: string[] } {
  const s = emptyState();
  const ids = labels.map((l) => {
    const n = createNode(l);
    s.nodes.set(n.id, n);
    return n.id;
  });
  for (const [a, b] of edgePairs) {
    const e = createEdge(ids[a]!, ids[b]!);
    s.edges.set(e.id, e);
  }
  return { s, ids };
}

describe('projectOutline', () => {
  test('chain renders as nested preorder', () => {
    const { s, ids } = build(['a', 'b', 'c'], [[0, 1], [1, 2]]);
    const items = projectOutline(s, ids[0]!);
    expect(items.map((i) => [i.nodeId, i.depth, i.kind])).toEqual([
      [ids[0], 0, 'tree'], [ids[1], 1, 'tree'], [ids[2], 2, 'tree']
    ]);
  });

  test('cycle: back-edge becomes mirror', () => {
    const { s, ids } = build(['a', 'b'], [[0, 1], [1, 0]]);
    const items = projectOutline(s, ids[0]!);
    expect(items.map((i) => [i.nodeId, i.depth, i.kind])).toEqual([
      [ids[0], 0, 'tree'], [ids[1], 1, 'tree'], [ids[0], 2, 'mirror']
    ]);
  });

  test('diamond: second in-edge becomes mirror', () => {
    const { s, ids } = build(['a', 'b', 'c', 'd'], [[0, 1], [0, 2], [1, 3], [2, 3]]);
    const items = projectOutline(s, ids[0]!);
    const kinds = items.map((i) => [i.nodeId, i.kind]);
    expect(kinds).toEqual([
      [ids[0], 'tree'], [ids[1], 'tree'], [ids[3], 'tree'], [ids[2], 'tree'], [ids[3], 'mirror']
    ]);
  });

  test('disconnected components each get a root', () => {
    const { s, ids } = build(['a', 'b', 'c'], [[0, 1]]);
    const items = projectOutline(s, null);
    expect(items.map((i) => [i.nodeId, i.depth])).toEqual([
      [ids[0], 0], [ids[1], 1], [ids[2], 0]
    ]);
  });

  test('explicit root shows other components after it', () => {
    const { s, ids } = build(['a', 'b'], []);
    const items = projectOutline(s, ids[1]!);
    expect(items.map((i) => i.nodeId)).toEqual([ids[1], ids[0]]);
  });

  test('unknown root throws; empty graph returns []', () => {
    const { s } = build([], []);
    expect(projectOutline(s, null)).toEqual([]);
    expect(() => projectOutline(s, 'ghost')).toThrow(/no such node/);
  });
});
