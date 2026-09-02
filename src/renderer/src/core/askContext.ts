import type { GraphState, MindEdge } from './model';
import { nHopNeighborhood } from './neighborhood';

// Serialize a graph (or a focused slice of it) into a compact, deterministic
// text block Claude can read as context for "Ask the map" (F4) — id\tlabel
// node lines and `source -> target ["label"]` edge lines, with a leading
// FOCUS line when a focus set exists. Pure: insertion-order stable, no I/O.

export type AskScope = 'all' | 'selection' | 'neighborhood';

const NOTES_EXCERPT = 80;

// The 'all' scope serializes the whole graph, so cap the node count: a large
// map dumped whole makes a huge, slow, costly Claude call that can blow the
// context window. When over the cap we keep the first-N nodes by insertion
// order (deterministic and cheap) and mark the context as partial. The
// neighborhood/selection scopes are already bounded (by hops / incident
// edges), so only 'all' needs this.
export const ALL_SCOPE_NODE_CAP = 200;

export function serializeGraphContext(
  state: GraphState,
  opts: { scope: AskScope; focusId?: string | null; hops?: number }
): string {
  const { scope } = opts;
  const focusId = opts.focusId ?? null;

  let nodeIds: Set<string>;
  let hasFocus = false;
  let truncation: { shown: number; total: number } | null = null;

  if (scope === 'all') {
    const allIds = [...state.nodes.keys()];
    if (allIds.length > ALL_SCOPE_NODE_CAP) {
      nodeIds = new Set(allIds.slice(0, ALL_SCOPE_NODE_CAP));
      truncation = { shown: ALL_SCOPE_NODE_CAP, total: allIds.length };
    } else {
      nodeIds = new Set(allIds);
    }
  } else {
    // Both selection and neighborhood need a focus node — fail fast if absent.
    if (focusId === null) {
      throw new Error(`serializeGraphContext: scope "${scope}" requires a focus id, got null`);
    }
    if (!state.nodes.has(focusId)) {
      throw new Error(`serializeGraphContext: focus id "${focusId}" not in graph`);
    }
    hasFocus = true;
    if (scope === 'neighborhood') {
      nodeIds = nHopNeighborhood(state.edges.values(), focusId, opts.hops ?? 2);
    } else {
      // selection: the focus node plus the nodes its incident edges touch.
      nodeIds = new Set<string>([focusId]);
      for (const e of state.edges.values()) {
        if (e.source === focusId) nodeIds.add(e.target);
        if (e.target === focusId) nodeIds.add(e.source);
      }
    }
  }

  const lines: string[] = [];
  if (hasFocus) lines.push(`FOCUS: ${focusId}`);

  lines.push('NODES:');
  for (const [id, node] of state.nodes) {
    if (!nodeIds.has(id)) continue;
    const notes = node.notes.replace(/\s+/g, ' ').trim();
    if (notes !== '') {
      const excerpt = notes.length > NOTES_EXCERPT ? notes.slice(0, NOTES_EXCERPT) : notes;
      lines.push(`${id}\t${node.label} :: ${excerpt}`);
    } else {
      lines.push(`${id}\t${node.label}`);
    }
  }
  if (truncation !== null) {
    lines.push(`… (${truncation.shown} of ${truncation.total} nodes shown)`);
  }

  lines.push('EDGES:');
  for (const e of state.edges.values()) {
    if (!includeEdge(e, nodeIds)) continue;
    // Include the typed relation (F10) so Ask/Import can see existing
    // supports/refutes/depends edges — the proposal schema asks Claude to emit
    // relations, so it needs to know what is already there. Shape:
    // `source -> target [relation] "label"`, each trailing part only when set.
    const parts = [`${e.source} -> ${e.target}`];
    if (e.relation !== 'none') parts.push(`[${e.relation}]`);
    if (e.label !== null && e.label !== '') parts.push(`"${e.label}"`);
    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}

function includeEdge(e: MindEdge, nodeIds: Set<string>): boolean {
  return nodeIds.has(e.source) && nodeIds.has(e.target);
}
