import type { MindEdge } from './model';

export function nHopNeighborhood(edges: Iterable<MindEdge>, startId: string, hops: number): Set<string> {
  const edgeList = [...edges];
  const result = new Set<string>([startId]);
  let frontier = new Set<string>([startId]);
  for (let i = 0; i < hops && frontier.size > 0; i++) {
    const next = new Set<string>();
    for (const e of edgeList) {
      if (frontier.has(e.source) && !result.has(e.target)) next.add(e.target);
      if (frontier.has(e.target) && !result.has(e.source)) next.add(e.source);
    }
    for (const id of next) result.add(id);
    frontier = next;
  }
  return result;
}
