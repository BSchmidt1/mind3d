import type { GraphState, MindEdge } from './model';

export interface OutlineItem {
  nodeId: string;
  depth: number;
  kind: 'tree' | 'mirror';
  edgeId: string | null;
}

const MAX_OUTLINE_DEPTH = 5000;

export function projectOutline(state: GraphState, rootId: string | null): OutlineItem[] {
  if (rootId !== null && !state.nodes.has(rootId)) {
    throw new Error(`projectOutline: no such node "${rootId}"`);
  }
  const out = new Map<string, MindEdge[]>();
  for (const e of state.edges.values()) {
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }
  const items: OutlineItem[] = [];
  const visited = new Set<string>();
  const visit = (id: string, depth: number, edgeId: string | null): void => {
    if (depth > MAX_OUTLINE_DEPTH) {
      throw new Error(`projectOutline: depth exceeds ${MAX_OUTLINE_DEPTH} at node "${id}" — graph too deep to outline`);
    }
    visited.add(id);
    items.push({ nodeId: id, depth, kind: 'tree', edgeId });
    for (const e of out.get(id) ?? []) {
      if (visited.has(e.target)) {
        items.push({ nodeId: e.target, depth: depth + 1, kind: 'mirror', edgeId: e.id });
      } else {
        visit(e.target, depth + 1, e.id);
      }
    }
  };
  const roots: string[] = rootId !== null ? [rootId] : [];
  for (const id of state.nodes.keys()) {
    if (id !== rootId) roots.push(id);
  }
  for (const id of roots) {
    if (!visited.has(id)) visit(id, 0, null);
  }
  return items;
}
