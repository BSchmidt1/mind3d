import { describe, expect, test } from 'vitest';
import { emptyState, createNode, type GraphState } from '../src/renderer/src/core/model';
import { collectTags, nodesWithAnyTag, tagColor } from '../src/renderer/src/core/tags';

function stateWith(nodes: { label: string; tags?: string[] }[]): {
  state: GraphState;
  ids: string[];
} {
  const state = emptyState();
  const ids: string[] = [];
  for (const spec of nodes) {
    const n = createNode(spec.label);
    n.tags = spec.tags ?? [];
    state.nodes.set(n.id, n);
    ids.push(n.id);
  }
  return { state, ids };
}

describe('collectTags', () => {
  test('returns sorted unique tags across all nodes', () => {
    const { state } = stateWith([
      { label: 'a', tags: ['beta', 'alpha'] },
      { label: 'b', tags: ['alpha', 'gamma'] },
      { label: 'c', tags: [] }
    ]);
    expect(collectTags(state)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('empty graph yields no tags', () => {
    expect(collectTags(emptyState())).toEqual([]);
  });
});

describe('nodesWithAnyTag', () => {
  test('returns exactly the nodes carrying any active tag', () => {
    const { state, ids } = stateWith([
      { label: 'a', tags: ['x'] },
      { label: 'b', tags: ['y'] },
      { label: 'c', tags: ['x', 'z'] }
    ]);
    const hit = nodesWithAnyTag(state, new Set(['x']));
    expect(hit).toEqual(new Set([ids[0], ids[2]]));
  });

  test('a node passes if it carries ANY of several active tags', () => {
    const { state, ids } = stateWith([
      { label: 'a', tags: ['x'] },
      { label: 'b', tags: ['y'] },
      { label: 'c', tags: ['w'] }
    ]);
    const hit = nodesWithAnyTag(state, new Set(['x', 'y']));
    expect(hit).toEqual(new Set([ids[0], ids[1]]));
  });

  test('empty active set matches nothing', () => {
    const { state } = stateWith([{ label: 'a', tags: ['x'] }]);
    expect(nodesWithAnyTag(state, new Set())).toEqual(new Set());
  });
});

describe('tagColor', () => {
  test('is deterministic: same tag -> same color across calls', () => {
    expect(tagColor('research')).toBe(tagColor('research'));
    expect(tagColor('todo')).toBe(tagColor('todo'));
  });

  test('yields a parseable hsl() string', () => {
    expect(tagColor('anything')).toMatch(/^hsl\(\d+, 65%, 62%\)$/);
  });

  test('different tags generally get different hues', () => {
    // Not a hard guarantee (hashes can collide mod 360), but these three must
    // differ — a sanity check that the hash actually varies with input.
    const colors = new Set(['alpha', 'beta', 'gamma'].map(tagColor));
    expect(colors.size).toBe(3);
  });
});
