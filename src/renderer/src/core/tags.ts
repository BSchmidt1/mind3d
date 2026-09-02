import type { GraphState } from './model';

// Tag utilities (F11). Pure helpers over the graph's node tags (a `string[]`
// per node that until now was only editable in the detail panel, never used).
// The tag FILTER state itself (which tags are active, and dim-vs-hide mode) is
// VIEW state and lives in the TagBar UI, not here and not in the map file — a
// filter is not a graph mutation and does not go through the command store.

// The distinct tags in use across all nodes, sorted (codepoint order) so the
// tag bar renders the same chip order every time.
export function collectTags(state: GraphState): string[] {
  const set = new Set<string>();
  for (const n of state.nodes.values()) {
    for (const t of n.tags) set.add(t);
  }
  return [...set].sort();
}

// The ids of nodes carrying at least one of `tags`. This IS the filter's
// "passing set": with the filter on, a node passes iff it is in this set, and
// the view dims (or hides) every node NOT in it. An empty `tags` set matches
// nothing — the caller reads that as "filter off" and clears the dim instead.
export function nodesWithAnyTag(state: GraphState, tags: Set<string>): Set<string> {
  const out = new Set<string>();
  if (tags.size === 0) return out;
  for (const n of state.nodes.values()) {
    if (n.tags.some((t) => tags.has(t))) out.add(n.id);
  }
  return out;
}

// A deterministic tag -> color mapping: hash the tag string to a hue and return
// a stable `hsl()` string. Same tag always yields the same color, independent
// of call order or which other tags exist, so color-by-tag is consistent across
// nodes and across sessions. Saturation/lightness are fixed for legible,
// evenly-bright labels on the dark canvas.
export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    // FNV-ish rolling hash, kept in 32-bit range via `| 0`.
    h = (Math.imul(h, 31) + tag.charCodeAt(i)) | 0;
  }
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 62%)`;
}
