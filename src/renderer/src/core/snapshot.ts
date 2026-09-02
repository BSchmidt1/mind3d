import type { GraphState, MindEdge, MindNode } from './model';
import { emptyState } from './model';

// A named checkpoint of the whole graph, saved WITH the map file (v2 format).
// A snapshot is plain data — deep-copied node/edge arrays, not a live
// GraphState — so it is trivially serializable and immune to later store
// mutations. Restoring one goes through `store.loadState(snapshotToState(...))`
// (clears history, like Open); it is NOT command-tracked.
export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  nodes: MindNode[];
  edges: MindEdge[];
}

// Capture the current graph as a snapshot. Deep-copies so mutating the store
// afterwards never changes the stored checkpoint.
export function createSnapshot(name: string, state: GraphState): Snapshot {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    nodes: structuredClone([...state.nodes.values()]),
    edges: structuredClone([...state.edges.values()])
  };
}

// Materialize a snapshot back into a fresh, independent GraphState. Deep-copies
// again so that editing the restored (now-live) state does not reach back into
// the snapshot still held by the session.
export function snapshotToState(snap: Snapshot): GraphState {
  const state = emptyState();
  for (const n of structuredClone(snap.nodes)) state.nodes.set(n.id, n);
  for (const e of structuredClone(snap.edges)) state.edges.set(e.id, e);
  return state;
}

export interface GraphDiff {
  nodesAdded: string[];
  nodesRemoved: string[];
  nodesChanged: string[];
  edgesAdded: string[];
  edgesRemoved: string[];
  edgesChanged: string[];
}

// Compared node fields. Position and content, not the per-node claude runner
// state (prompt/result) — a re-run of Claude is not a "change" for diff
// purposes. Tags compared by value+order.
function nodeTuple(n: MindNode): string {
  return JSON.stringify([n.label, n.notes, n.color, n.tags, n.fx, n.fy, n.fz, n.attachedFile]);
}

// Compared edge fields. A normalized tuple (endpoints + label) so F10's
// `relation` slots in here defensively once the field exists.
function edgeTuple(e: MindEdge): string {
  return JSON.stringify([e.source, e.target, e.label]);
}

// Diff two graph states by id: added = in `after` only, removed = in `before`
// only, changed = same id but a differing field tuple. Unchanged ids appear in
// no list.
export function diffStates(before: GraphState, after: GraphState): GraphDiff {
  const diff: GraphDiff = {
    nodesAdded: [], nodesRemoved: [], nodesChanged: [],
    edgesAdded: [], edgesRemoved: [], edgesChanged: []
  };
  for (const [id, n] of after.nodes) {
    const b = before.nodes.get(id);
    if (!b) diff.nodesAdded.push(id);
    else if (nodeTuple(b) !== nodeTuple(n)) diff.nodesChanged.push(id);
  }
  for (const id of before.nodes.keys()) {
    if (!after.nodes.has(id)) diff.nodesRemoved.push(id);
  }
  for (const [id, e] of after.edges) {
    const b = before.edges.get(id);
    if (!b) diff.edgesAdded.push(id);
    else if (edgeTuple(b) !== edgeTuple(e)) diff.edgesChanged.push(id);
  }
  for (const id of before.edges.keys()) {
    if (!after.edges.has(id)) diff.edgesRemoved.push(id);
  }
  return diff;
}
