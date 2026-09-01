import { describe, expect, test } from 'vitest';
import { createEdge } from '../src/renderer/src/core/model';
import type { MindEdge } from '../src/renderer/src/core/model';
import { nHopNeighborhood } from '../src/renderer/src/core/neighborhood';

function chain(ids: string[]): MindEdge[] {
  const edges: MindEdge[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    edges.push(createEdge(ids[i]!, ids[i + 1]!));
  }
  return edges;
}

describe('nHopNeighborhood', () => {
  test('chain a-b-c-d: 2 hops from a stays within 2 hops (excludes d)', () => {
    const edges = chain(['a', 'b', 'c', 'd']);
    const result = nHopNeighborhood(edges, 'a', 2);
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  test('chain a-b-c-d: 2 hops from c traverses edges in both directions', () => {
    const edges = chain(['a', 'b', 'c', 'd']);
    const result = nHopNeighborhood(edges, 'c', 2);
    expect(result).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  test('diamond + cycle: 1 hop stays at the near ring, 2 hops reaches the far node exactly once', () => {
    // a-b, a-c, b-d, c-d forms a 4-cycle (diamond): two equal-length paths from a to d.
    const edges: MindEdge[] = [
      createEdge('a', 'b'),
      createEdge('a', 'c'),
      createEdge('b', 'd'),
      createEdge('c', 'd')
    ];
    expect(nHopNeighborhood(edges, 'a', 1)).toEqual(new Set(['a', 'b', 'c']));
    expect(nHopNeighborhood(edges, 'a', 2)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  test('0 hops returns only the start node', () => {
    const edges = chain(['a', 'b', 'c']);
    expect(nHopNeighborhood(edges, 'a', 0)).toEqual(new Set(['a']));
  });
});
