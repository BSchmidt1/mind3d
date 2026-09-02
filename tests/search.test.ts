import { describe, expect, test } from 'vitest';
import { emptyState, createNode, type GraphState } from '../src/renderer/src/core/model';
import { searchNodes } from '../src/renderer/src/core/search';

function stateWith(nodes: { label: string; notes?: string }[]): {
  state: GraphState;
  ids: string[];
} {
  const state = emptyState();
  const ids: string[] = [];
  for (const spec of nodes) {
    const n = createNode(spec.label);
    n.notes = spec.notes ?? '';
    state.nodes.set(n.id, n);
    ids.push(n.id);
  }
  return { state, ids };
}

describe('searchNodes', () => {
  test('finds a node whose match is only in its notes, not its label', () => {
    const { state, ids } = stateWith([{ label: 'Banana bread', notes: 'quantum entanglement notes' }]);
    const hits = searchNodes(state, 'quantum');
    expect(hits.map((h) => h.id)).toEqual([ids[0]]);
  });

  test('label match outranks a notes-only match for the same query', () => {
    // both nodes match "alpha"; one in its label, the other only in notes.
    const { state, ids } = stateWith([
      { label: 'zeta', notes: 'alpha lives only here' }, // notes-only match
      { label: 'alpha', notes: '' } // label match
    ]);
    const hits = searchNodes(state, 'alpha');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.id).toBe(ids[1]); // the label match ranks first
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  test('non-matching query returns []', () => {
    const { state } = stateWith([{ label: 'alpha', notes: 'beta gamma' }]);
    expect(searchNodes(state, 'zzzzz')).toEqual([]);
  });

  test('ranks by fuzzy score, descending', () => {
    const { state, ids } = stateWith([
      { label: 'prevention' }, // contiguous "pre"
      { label: 'power renewal' } // spread "p..r..e"
    ]);
    const hits = searchNodes(state, 'pre');
    expect(hits.map((h) => h.id)).toEqual([ids[0], ids[1]]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  test('empty query returns [] (no query = no results)', () => {
    const { state } = stateWith([{ label: 'alpha' }, { label: 'beta' }]);
    expect(searchNodes(state, '')).toEqual([]);
    expect(searchNodes(state, '   ')).toEqual([]);
  });
});
