import { describe, expect, test } from 'vitest';
import { createNode } from '../src/renderer/src/core/model';
import { addNode } from '../src/renderer/src/core/commands';
import { GraphStore } from '../src/renderer/src/core/store';
import {
  parseVoiceResult,
  planFromVoiceResult,
  type VoiceResult
} from '../src/renderer/src/core/voiceOps';

describe('parseVoiceResult', () => {
  test('fenced json ok', () => {
    const text = 'Sure, here you go:\n```json\n{"ops":[],"summary":"noop"}\n```\nDone.';
    const result = parseVoiceResult(text);
    expect(result.summary).toBe('noop');
    expect(result.ops).toEqual([]);
  });

  test('bare json ok', () => {
    const text = '{"ops":[{"op":"node","tmp":"n1","label":"A"}],"summary":"add A"}';
    const result = parseVoiceResult(text);
    expect(result.ops).toHaveLength(1);
    expect(result.summary).toBe('add A');
  });

  test('prose-wrapped json extracted', () => {
    const text = 'Here is the result:\n{"ops":[],"summary":"noop"}\nHope that helps.';
    const result = parseVoiceResult(text);
    expect(result.summary).toBe('noop');
  });

  test('invalid json throws /valid JSON/', () => {
    expect(() => parseVoiceResult('{"ops": [')).toThrow(/valid JSON/);
  });

  test('missing summary throws', () => {
    expect(() => parseVoiceResult('{"ops":[]}')).toThrow(/summary/);
  });

  test('node op missing label throws naming index', () => {
    const text = '{"ops":[{"op":"node","tmp":"n1"}],"summary":"x"}';
    expect(() => parseVoiceResult(text)).toThrow(/op\[0\]/);
  });

  test('unknown op throws', () => {
    const text = '{"ops":[{"op":"delete","id":"n1"}],"summary":"x"}';
    expect(() => parseVoiceResult(text)).toThrow(/op\[0\]/);
  });

  test('unknown field on node op throws', () => {
    const text = '{"ops":[{"op":"node","tmp":"n1","label":"A","bogus":1}],"summary":"x"}';
    expect(() => parseVoiceResult(text)).toThrow(/bogus/);
  });

  test('edge op missing from/to throws naming index', () => {
    const text = '{"ops":[{"op":"edge","from":"n1"}],"summary":"x"}';
    expect(() => parseVoiceResult(text)).toThrow(/op\[0\]/);
  });
});

describe('planFromVoiceResult', () => {
  test('two nodes + parent -> composite applies 2 nodes + 1 edge, rootId = n1', () => {
    const store = new GraphStore();
    const result: VoiceResult = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B', parent: 'n1' }
      ],
      summary: 'x'
    };
    const plan = planFromVoiceResult(result, new Set());
    expect(plan.newNodeIds).toHaveLength(2);
    expect(plan.rootId).toBe(plan.newNodeIds[0]);

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

    const result: VoiceResult = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'edge', from: 'n1', to: existing.id }
      ],
      summary: 'x'
    };
    const plan = planFromVoiceResult(result, new Set([existing.id]));
    store.apply(plan.command);
    expect(store.state.edges.size).toBe(1);
    const edge = [...store.state.edges.values()][0]!;
    expect(edge.source).toBe(plan.newNodeIds[0]);
    expect(edge.target).toBe(existing.id);
  });

  test('ref to unknown id throws /unknown id/', () => {
    const result: VoiceResult = {
      ops: [{ op: 'edge', from: 'ghost', to: 'also-ghost' }],
      summary: 'x'
    };
    expect(() => planFromVoiceResult(result, new Set())).toThrow(/unknown id/);
  });

  test('duplicate tmp throws', () => {
    const result: VoiceResult = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n1', label: 'B' }
      ],
      summary: 'x'
    };
    expect(() => planFromVoiceResult(result, new Set())).toThrow(/duplicate/);
  });

  test('self-loop (edge n1->n1) throws', () => {
    const result: VoiceResult = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'edge', from: 'n1', to: 'n1' }
      ],
      summary: 'x'
    };
    expect(() => planFromVoiceResult(result, new Set())).toThrow(/self-loop/);
  });

  test('rootId falls back to first new node when all have parents or none is a clean root', () => {
    const result: VoiceResult = {
      ops: [
        { op: 'node', tmp: 'n1', label: 'A' },
        { op: 'node', tmp: 'n2', label: 'B' },
        { op: 'edge', from: 'n2', to: 'n1' }
      ],
      summary: 'x'
    };
    const plan = planFromVoiceResult(result, new Set());
    // n1 is a target of an edge, n2 is not -> n2 is root
    expect(plan.rootId).toBe(plan.newNodeIds[1]);
  });

  test('rootId is null when there are no node ops', () => {
    const store = new GraphStore();
    const existing = createNode('Existing');
    store.apply(addNode(existing));
    const other = createNode('Other');
    store.apply(addNode(other));

    const result: VoiceResult = {
      ops: [{ op: 'edge', from: existing.id, to: other.id }],
      summary: 'x'
    };
    const plan = planFromVoiceResult(result, new Set([existing.id, other.id]));
    expect(plan.rootId).toBeNull();
    expect(plan.newNodeIds).toEqual([]);
  });
});
