import type { GraphState } from './model';
import { fuzzyScore } from './fuzzy';

export interface SearchHit {
  id: string;
  score: number;
}

// A small penalty applied to notes-only matches so that, all else equal, a hit
// in a node's label outranks a hit buried in its notes.
const NOTES_PENALTY = 1;

/**
 * Rank nodes by a fuzzy match over BOTH label and notes, best first.
 * A node is a hit if the query fuzzy-matches its label OR its notes; its score
 * is the better of the label score and the (penalised) notes score.
 * An empty/whitespace query yields no results (the caller shows nothing).
 */
export function searchNodes(state: GraphState, query: string): SearchHit[] {
  const q = query.trim();
  if (q === '') return [];
  const hits: SearchHit[] = [];
  for (const node of state.nodes.values()) {
    const labelScore = fuzzyScore(q, node.label);
    const notesScore = fuzzyScore(q, node.notes);
    if (labelScore === null && notesScore === null) continue;
    const score = Math.max(
      labelScore ?? Number.NEGATIVE_INFINITY,
      (notesScore ?? Number.NEGATIVE_INFINITY) - NOTES_PENALTY
    );
    hits.push({ id: node.id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}
