import { describe, expect, test } from 'vitest';
import { createNode } from '../src/renderer/src/core/model';
import { addNode } from '../src/renderer/src/core/commands';
import { GraphStore } from '../src/renderer/src/core/store';
import { parseProposal, planProposal, type ProposalOpSet } from '../src/renderer/src/core/proposal';

const labelOfNone = (): string => '';

describe('parseProposal', () => {
  test('fenced json ok', () => {
    const text = 'Sure, here you go:\n```json\n{"ops":[],"summary":"noop"}\n```\nDone.';
    const result = parseProposal(text);
    expect(result.summary).toBe('noop');
    expect(result.ops).toEqual([]);
  });

  test('bare json ok', () => {
    const text = '{"ops":[{"op":"node","tmp":"n1","label":"A"}],"summary":"add A"}';
    const result = parseProposal(text);
    expect(result.ops).toHaveLength(1);
    expect(result.summary).toBe('add A');
  });

  test('prose-wrapped json extracted', () => {
    const text = 'Here is the result:\n{"ops":[],"summary":"noop"}\nHope that helps.';
    const result = parseProposal(text);
    expect(result.summary).toBe('noop');
  });

  test('invalid json throws /valid JSON/', () => {
    expect(() => parseProposal('{"ops": [')).toThrow(/valid JSON/);
  });

  test('missing summary throws', () => {
    expect(() => parseProposal('{"ops":[]}')).toThrow(/summary/);
  });

  test('node op missing label throws naming index', () => {
    const text = '{"ops":[{"op":"node","tmp":"n1"}],"summary":"x"}';
    expect(() => parseProposal(text)).toThrow(/op\[0\]/);
  });

  test('unknown op throws', () => {
    const text = '{"ops":[{"op":"delete","id":"n1"}],"summary":"x"}';
    expect(() => parseProposal(text)).toThrow(/op\[0\]/);
  });

  test('unknown field on node op throws', () => {
    const text = '{"ops":[{"op":"node","tmp":"n1","label":"A","bogus":1}],"summary":"x"}';
    expect(() => parseProposal(text)).toThrow(/bogus/);
  });

  test('edge op missing from/to throws naming index', () => {
    const text = '{"ops":[{"op":"edge","from":"n1"}],"summary":"x"}';
    expect(() => parseProposal(text)).toThrow(/op\[0\]/);
  });

  // (a) top-level `answer` is preserved; non-string `answer` throws /answer/
  test('top-level answer string is preserved', () => {
    const text = '{"ops":[],"summary":"noop","answer":"the answer is 42"}';
    const result = parseProposal(text);
    expect(result.answer).toBe('the answer is 42');
  });

  test('omitted answer leaves it undefined', () => {
    const result = parseProposal('{"ops":[],"summary":"noop"}');
    expect(result.answer).toBeUndefined();
  });

  test('non-string answer throws /answer/', () => {
    const text = '{"ops":[],"summary":"noop","answer":42}';
    expect(() => parseProposal(text)).toThrow(/answer/);
  });

  // (b) edge `label` is parsed
  test('edge op with label parses ok', () => {
    const text = '{"ops":[{"op":"edge","from":"a","to":"b","label":"supports"}],"summary":"x"}';
    const result = parseProposal(text);
    expect(result.ops).toHaveLength(1);
    const op = result.ops[0]!;
    expect(op.op).toBe('edge');
    expect(op.op === 'edge' && op.label).toBe('supports');
  });

  test('non-string edge label throws naming index', () => {
    const text = '{"ops":[{"op":"edge","from":"a","to":"b","label":1}],"summary":"x"}';
    expect(() => parseProposal(text)).toThrow(/op\[0\]/);
  });

  // F10: edge `relation` is optional and must be one of EDGE_RELATIONS.
  test('edge op with a valid relation parses ok', () => {
    const text = '{"ops":[{"op":"edge","from":"a","to":"b","relation":"refutes"}],"summary":"x"}';
    const op = parseProposal(text).ops[0]!;
    expect(op.op === 'edge' && op.relation).toBe('refutes');
  });

  test('edge op with an invalid relation throws naming index', () => {
    const text = '{"ops":[{"op":"edge","from":"a","to":"b","relation":"maybe"}],"summary":"x"}';
    expect(() => parseProposal(text)).toThrow(/op\[0\]/);
  });
});

describe('planProposal', () => {
  test('two nodes + parent -> composite applies 2 nodes + 1 edge, rootId = n1', () => {
    const store = new GraphStore();
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B', parent: 'n1' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    expect(plan.newNodeIds).toHaveLength(2);
    expect(plan.rootId).toBe(plan.newNodeIds[0]);
    expect(plan.newNodes).toEqual([
      { id: plan.newNodeIds[0], label: 'A' },
      { id: plan.newNodeIds[1], label: 'B' }
    ]);
    expect(plan.summary).toBe('x');

    store.apply(plan.command);
    expect(store.state.nodes.size).toBe(2);
    expect(store.state.edges.size).toBe(1);
    const edge = [...store.state.edges.values()][0]!;
    expect(edge.source).toBe(plan.newNodeIds[0]);
    expect(edge.target).toBe(plan.newNodeIds[1]);

    store.undo();
    expect(store.state.nodes.size).toBe(0);
    expect(store.state.edges.size).toBe(0);
  });

  test('edge to an existing id resolves via provided set', () => {
    const store = new GraphStore();
    const existing = createNode('Existing');
    store.apply(addNode(existing));

    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'edge', from: 'n1', to: existing.id }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set([existing.id]), labelOfNone);
    store.apply(plan.command);
    expect(store.state.edges.size).toBe(1);
    const edge = [...store.state.edges.values()][0]!;
    expect(edge.source).toBe(plan.newNodeIds[0]);
    expect(edge.target).toBe(existing.id);
  });

  test('ref to unknown id throws /unknown id/', () => {
    const opSet: ProposalOpSet = {
      ops: [{ op: 'edge', from: 'ghost', to: 'also-ghost' }],
      summary: 'x'
    };
    expect(() => planProposal(opSet, new Set(), labelOfNone)).toThrow(/unknown id/);
  });

  test('duplicate tmp throws', () => {
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n1', label: 'B' }
      ],
      summary: 'x'
    };
    expect(() => planProposal(opSet, new Set(), labelOfNone)).toThrow(/duplicate/);
  });

  test('self-loop (edge n1->n1) throws', () => {
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'edge', from: 'n1', to: 'n1' }
      ],
      summary: 'x'
    };
    expect(() => planProposal(opSet, new Set(), labelOfNone)).toThrow(/self-loop/);
  });

  test('rootId falls back to first new node when all have parents or none is a clean root', () => {
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n2', to: 'n1' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    expect(plan.rootId).toBe(plan.newNodeIds[1]);
  });

  test('empty ops (no nodes, no edges) throws /nothing to create/', () => {
    const opSet: ProposalOpSet = { ops: [], summary: 'x' };
    expect(() => planProposal(opSet, new Set(), labelOfNone)).toThrow(/nothing to create/);
  });

  test('rootId is null when there are no node ops', () => {
    const store = new GraphStore();
    const existing = createNode('Existing');
    store.apply(addNode(existing));
    const other = createNode('Other');
    store.apply(addNode(other));

    const opSet: ProposalOpSet = {
      ops: [{ op: 'edge', from: existing.id, to: other.id }],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set([existing.id, other.id]), labelOfNone);
    expect(plan.rootId).toBeNull();
    expect(plan.newNodeIds).toEqual([]);
  });

  // (e) answer-only, empty ops: parseProposal is fine, planProposal throws
  test('answer-only opSet parses ok but planProposal throws /nothing to create/', () => {
    const text = '{"ops":[],"summary":"x","answer":"the answer"}';
    const opSet = parseProposal(text);
    expect(opSet.answer).toBe('the answer');
    expect(() => planProposal(opSet, new Set(), labelOfNone)).toThrow(/nothing to create/);
  });

  // (b) edge label lands on the created edge
  test('edge label lands on the created edge', () => {
    const store = new GraphStore();
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n1', to: 'n2', label: 'supports' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    store.apply(plan.command);
    const edge = [...store.state.edges.values()][0]!;
    expect(edge.label).toBe('supports');
  });

  test('edge without label defaults to null on the created edge', () => {
    const store = new GraphStore();
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n1', to: 'n2' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    store.apply(plan.command);
    const edge = [...store.state.edges.values()][0]!;
    expect(edge.label).toBeNull();
  });

  // (c) humanOps contains readable node/edge lines
  test('humanOps describes a two-node + edge set', () => {
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n1', to: 'n2' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    expect(plan.humanOps).toContain('+ node "A"');
    expect(plan.humanOps).toContain('+ node "B"');
    expect(plan.humanOps).toContain('+ edge "A" → "B"');
  });

  test('humanOps shows parent attachment and edge label, resolving existing-node labels', () => {
    const existing = createNode('Root');
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'Child', parent: existing.id },
        { op: 'edge', from: 'n1', to: existing.id, label: 'relates to' }
      ],
      summary: 'x'
    };
    const labelOf = (id: string): string => (id === existing.id ? existing.label : '');
    const plan = planProposal(opSet, new Set([existing.id]), labelOf);
    expect(plan.humanOps).toContain('+ node "Child" under "Root"');
    expect(plan.humanOps).toContain('+ edge "Child" → "Root" "relates to"');
  });

  // (d) newEdges carries resolved source/target ids and a real edge id
  test('newEdges carries resolved source/target ids and a real edge id', () => {
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B', parent: 'n1' },
        { op: 'edge', from: 'n2', to: 'n1', label: 'back' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    expect(plan.newEdges).toHaveLength(2);
    for (const e of plan.newEdges) {
      expect(typeof e.id).toBe('string');
      expect(e.id).not.toBe('');
    }
    expect(plan.newEdges[0]).toEqual({
      id: plan.newEdges[0]!.id,
      source: plan.newNodeIds[0],
      target: plan.newNodeIds[1]
    });
    expect(plan.newEdges[1]).toEqual({
      id: plan.newEdges[1]!.id,
      source: plan.newNodeIds[1],
      target: plan.newNodeIds[0]
    });
  });

  // F10: a proposal edge relation flows onto the created edge and into humanOps.
  test('edge relation lands on the created edge and appears in humanOps', () => {
    const store = new GraphStore();
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n1', to: 'n2', label: 'backs', relation: 'supports' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    store.apply(plan.command);
    const edge = [...store.state.edges.values()][0]!;
    expect(edge.relation).toBe('supports');
    expect(edge.label).toBe('backs');
    expect(plan.humanOps.some((l) => l.includes('supports'))).toBe(true);
  });

  test('edge without relation defaults to none on the created edge', () => {
    const store = new GraphStore();
    const opSet: ProposalOpSet = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n1', to: 'n2' }
      ],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    store.apply(plan.command);
    expect([...store.state.edges.values()][0]!.relation).toBe('none');
  });

  test('opSet is carried through unchanged on the Proposal', () => {
    const opSet: ProposalOpSet = {
      ops: [{ op: 'node', tmp: 'n1', label: 'A' }],
      summary: 'x'
    };
    const plan = planProposal(opSet, new Set(), labelOfNone);
    expect(plan.opSet).toBe(opSet);
  });
});
