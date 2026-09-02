import { describe, expect, test } from 'vitest';
import { createEdge, createNode, emptyState } from '../src/renderer/src/core/model';
import { deserializeGraph, serializeGraph, type MapMeta } from '../src/renderer/src/core/serialize';
import { createSnapshot } from '../src/renderer/src/core/snapshot';

const meta: MapMeta = { name: 'm', createdAt: '2026-09-01T00:00:00Z', modifiedAt: '2026-09-01T00:00:00Z' };

function sampleState() {
  const s = emptyState();
  const a = createNode('a');
  a.fx = 1; a.fy = 2; a.fz = 3;
  a.notes = '# hi';
  a.color = '#ff0000';
  a.tags = ['x', 'y'];
  a.attachedFile = '/tmp/f.md';
  a.claudePrompt = 'summarize';
  a.claudeResult = { text: 'done', timestamp: '2026-09-01T00:00:00Z' };
  const b = createNode('b');
  s.nodes.set(a.id, a);
  s.nodes.set(b.id, b);
  const e1 = createEdge(a.id, b.id);
  const e2 = createEdge(b.id, a.id); // cycle
  s.edges.set(e1.id, e1);
  s.edges.set(e2.id, e2);
  return s;
}

describe('serialize', () => {
  test('round-trip preserves everything incl. pins, attachments, cycles', () => {
    const s = sampleState();
    const out = deserializeGraph(serializeGraph(s, meta));
    expect(out.meta).toEqual(meta);
    expect([...out.state.nodes.keys()]).toEqual([...s.nodes.keys()]);
    expect([...out.state.edges.keys()]).toEqual([...s.edges.keys()]);
    expect(out.state.nodes).toEqual(s.nodes);
    expect(out.state.edges).toEqual(s.edges);
  });

  test('rejects wrong version', () => {
    const bad = JSON.stringify({ version: 3, meta, nodes: [], edges: [] });
    expect(() => deserializeGraph(bad)).toThrow(/version 3.*expected 1 or 2/s);
  });

  test('accepts a v1 file (no snapshots) and upgrades to empty snapshots', () => {
    // A minimal v1 doc — exactly the shape existing/demo maps are saved in:
    // version 1, required keys only, no optional sections.
    const s = sampleState();
    const v1 = JSON.stringify({
      version: 1,
      meta,
      nodes: [...s.nodes.values()],
      edges: [...s.edges.values()]
    });
    const out = deserializeGraph(v1);
    expect(out.meta).toEqual(meta);
    expect([...out.state.nodes.keys()]).toEqual([...s.nodes.keys()]);
    expect([...out.state.edges.keys()]).toEqual([...s.edges.keys()]);
    expect(out.state.nodes).toEqual(s.nodes);
    expect(out.state.edges).toEqual(s.edges);
    expect(out.snapshots).toEqual([]);
  });

  test('round-trips snapshots (v2)', () => {
    const s = sampleState();
    const snap = createSnapshot('checkpoint 1', s);
    const out = deserializeGraph(serializeGraph(s, meta, { snapshots: [snap] }));
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0]!.id).toBe(snap.id);
    expect(out.snapshots[0]!.name).toBe('checkpoint 1');
    expect(out.snapshots[0]!.createdAt).toBe(snap.createdAt);
    expect(out.snapshots[0]!.nodes).toEqual(snap.nodes);
    expect(out.snapshots[0]!.edges).toEqual(snap.edges);
  });

  test('two-arg serialize omits snapshots → deserialize defaults to []', () => {
    const out = deserializeGraph(serializeGraph(sampleState(), meta));
    expect(out.snapshots).toEqual([]);
  });

  test('rejects a malformed snapshot (fail-fast), naming it', () => {
    const doc = JSON.parse(serializeGraph(sampleState(), meta, { snapshots: [createSnapshot('c', sampleState())] }));
    doc.snapshots[0].bogus = 1;
    expect(() => deserializeGraph(JSON.stringify(doc))).toThrow(/snapshots\[0\].*bogus/s);
  });

  test('rejects unknown node field, naming node and field', () => {
    const doc = JSON.parse(serializeGraph(sampleState(), meta));
    doc.nodes[0].bogus = 1;
    expect(() => deserializeGraph(JSON.stringify(doc))).toThrow(/nodes\[0\].*bogus/s);
  });

  test('rejects dangling edge endpoint', () => {
    const doc = JSON.parse(serializeGraph(sampleState(), meta));
    doc.edges[0].target = 'ghost';
    expect(() => deserializeGraph(JSON.stringify(doc))).toThrow(/ghost/);
  });

  test('rejects duplicate node id', () => {
    const doc = JSON.parse(serializeGraph(sampleState(), meta));
    doc.nodes[1].id = doc.nodes[0].id;
    expect(() => deserializeGraph(JSON.stringify(doc))).toThrow(/duplicate node id/);
  });

  test('rejects mixed pin fields', () => {
    const doc = JSON.parse(serializeGraph(sampleState(), meta));
    doc.nodes[0].fy = null;
    expect(() => deserializeGraph(JSON.stringify(doc))).toThrow(/all numbers or all null/);
  });

  test('rejects non-JSON and non-object', () => {
    expect(() => deserializeGraph('not json')).toThrow(/not valid JSON/);
    expect(() => deserializeGraph('42')).toThrow(/top level/);
  });
});
