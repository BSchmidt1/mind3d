import type { GraphState, MindEdge } from './model';
import { nHopNeighborhood } from './neighborhood';

// Serialize a graph (or a focused slice of it) into a compact, deterministic
// text block Claude can read as context for "Ask the map" (F4) — id\tlabel
// node lines and `source -> target ["label"]` edge lines, with a leading
// FOCUS line when a focus set exists. Pure: insertion-order stable, no I/O.

export type AskScope = 'all' | 'selection' | 'neighborhood';

const NOTES_EXCERPT = 80;

export function serializeGraphContext(
  state: GraphState,
  opts: { scope: AskScope; focusId?: string | null; hops?: number }
): string {
  const { scope } = opts;
  const focusId = opts.focusId ?? null;

  let nodeIds: Set<string>;
  let hasFocus = false;

  if (scope === 'all') {
    nodeIds = new Set(state.nodes.keys());
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

  lines.push('EDGES:');
  for (const e of state.edges.values()) {
    if (!includeEdge(e, nodeIds)) continue;
    lines.push(
      e.label !== null && e.label !== ''
        ? `${e.source} -> ${e.target} "${e.label}"`
        : `${e.source} -> ${e.target}`
    );
  }

  return lines.join('\n');
}

function includeEdge(e: MindEdge, nodeIds: Set<string>): boolean {
  return nodeIds.has(e.source) && nodeIds.has(e.target);
}
