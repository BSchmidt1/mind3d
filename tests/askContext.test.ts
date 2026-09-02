import { describe, expect, test } from 'vitest';
import { serializeGraphContext } from '../src/renderer/src/core/askContext';
import { createEdge, createNode, type GraphState } from '../src/renderer/src/core/model';

function build(): { state: GraphState; a: string; b: string; c: string } {
  const na = createNode('Alpha');
  na.notes = 'the first node with some notes here';
  const nb = createNode('Beta');
  const nc = createNode('Gamma');
  const eab = createEdge(na.id, nb.id);
  eab.label = 'relates to';
  const ebc = createEdge(nb.id, nc.id);
  const state: GraphState = {
    nodes: new Map([
      [na.id, na],
      [nb.id, nb],
      [nc.id, nc]
    ]),
    edges: new Map([
      [eab.id, eab],
      [ebc.id, ebc]
    ])
  };
  return { state, a: na.id, b: nb.id, c: nc.id };
}

describe('serializeGraphContext', () => {
  test('scope all includes all labels and an edge line', () => {
    const { state } = build();
    const out = serializeGraphContext(state, { scope: 'all' });
    expect(out).toContain('NODES:');
    expect(out).toContain('EDGES:');
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    expect(out).toContain('Gamma');
    expect(out).toContain('->');
  });

  test('notes excerpt appears', () => {
    const { state } = build();
    const out = serializeGraphContext(state, { scope: 'all' });
    expect(out).toContain('the first node with some notes here');
  });

  test('edge label appears', () => {
    const { state } = build();
    const out = serializeGraphContext(state, { scope: 'all' });
    expect(out).toContain('"relates to"');
  });

  test('neighborhood hops:1 excludes a 2-hop node and marks focus', () => {
    const { state, a } = build();
    const out = serializeGraphContext(state, { scope: 'neighborhood', focusId: a, hops: 1 });
    expect(out).toContain(`FOCUS: ${a}`);
    expect(out).toContain('Alpha'); // focus
    expect(out).toContain('Beta'); // 1 hop from Alpha
    expect(out).not.toContain('Gamma'); // 2 hops away — excluded
  });

  test('neighborhood with null focus throws /focus/', () => {
    const { state } = build();
    expect(() =>
      serializeGraphContext(state, { scope: 'neighborhood', focusId: null, hops: 2 })
    ).toThrow(/focus/);
  });

  test('selection scope keeps the focus node and its incident edges', () => {
    const { state, a, b, c } = build();
    const out = serializeGraphContext(state, { scope: 'selection', focusId: b });
    // b is connected to a and c via one edge each — all three appear.
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    expect(out).toContain('Gamma');
    expect(out).toContain(`FOCUS: ${b}`);
    // both incident edge lines present
    expect(out).toContain(`${a} -> ${b}`);
    expect(out).toContain(`${b} -> ${c}`);
  });
});
