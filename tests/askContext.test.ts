import { describe, expect, test } from 'vitest';
import { ALL_SCOPE_NODE_CAP, serializeGraphContext } from '../src/renderer/src/core/askContext';
import { createEdge, createNode, type GraphState, type MindNode } from '../src/renderer/src/core/model';

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

  test('edge relation appears as [relation] when not none', () => {
    const { state, a, b, c } = build();
    // a->b already has label "relates to"; give it a relation too, and give the
    // unlabelled b->c edge a relation to prove [relation] shows without a label.
    for (const e of state.edges.values()) {
      if (e.source === a && e.target === b) e.relation = 'supports';
      if (e.source === b && e.target === c) e.relation = 'depends';
    }
    const out = serializeGraphContext(state, { scope: 'all' });
    expect(out).toContain(`${a} -> ${b} [supports] "relates to"`);
    expect(out).toContain(`${b} -> ${c} [depends]`);
  });

  test('an edge with relation none omits the bracket', () => {
    const { state, b, c } = build();
    // b->c is default relation 'none' and unlabelled — a bare arrow line.
    const out = serializeGraphContext(state, { scope: 'all' });
    expect(out).toContain(`${b} -> ${c}`);
    expect(out).not.toContain('[none]');
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

  test('all scope caps a large graph and marks the truncation', () => {
    const nodes = new Map<string, MindNode>();
    const total = ALL_SCOPE_NODE_CAP + 50;
    for (let i = 0; i < total; i++) {
      const n = createNode(`Node ${i}`);
      nodes.set(n.id, n);
    }
    const state: GraphState = { nodes, edges: new Map() };
    const out = serializeGraphContext(state, { scope: 'all' });
    // Node lines are the tab-delimited ones; there should be exactly the cap.
    const nodeLines = out.split('\n').filter((l) => l.includes('\t'));
    expect(nodeLines.length).toBe(ALL_SCOPE_NODE_CAP);
    expect(out).toContain(`${ALL_SCOPE_NODE_CAP} of ${total} nodes shown`);
  });

  test('all scope under the cap has no truncation marker', () => {
    const { state } = build();
    const out = serializeGraphContext(state, { scope: 'all' });
    expect(out).not.toContain('nodes shown');
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
