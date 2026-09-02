import type { GraphState, MindEdge, MindNode } from './model';
import { emptyState } from './model';
import type { Snapshot } from './snapshot';

// v2 (bumped from v1 in F8): required { version, meta, nodes, edges } plus an
// OPTIONAL set that later tasks extend (F8 snapshots; F9 viewpoints/tours; F12
// mode). An absent optional section loads as its default (snapshots → []), so a
// v1 file — which has none of them — upgrades in memory with zero data loss.
// A present-but-malformed optional value still throws (fail-fast). Both v1 and
// v2 are accepted; any other version is rejected.
export const FILE_VERSION = 2;
export const SUPPORTED_VERSIONS = new Set([1, 2]);

export interface MapMeta {
  name: string;
  createdAt: string;
  modifiedAt: string;
}

export function serializeGraph(
  state: GraphState,
  meta: MapMeta,
  extras?: { snapshots?: Snapshot[] }
): string {
  return JSON.stringify(
    {
      version: FILE_VERSION,
      meta,
      nodes: [...state.nodes.values()],
      edges: [...state.edges.values()],
      snapshots: extras?.snapshots ?? []
    },
    null,
    2
  );
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkKeys(obj: Record<string, unknown>, allowed: Set<string>, ctx: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new Error(`${ctx}: unknown field "${k}"`);
  }
  for (const k of allowed) {
    if (!(k in obj)) throw new Error(`${ctx}: missing field "${k}"`);
  }
}

function str(v: unknown, ctx: string): string {
  if (typeof v !== 'string') throw new Error(`${ctx}: expected string, got ${typeof v}`);
  return v;
}

function strOrNull(v: unknown, ctx: string): string | null {
  if (v === null) return null;
  return str(v, ctx);
}

function numOrNull(v: unknown, ctx: string): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${ctx}: expected finite number or null`);
  return v;
}

const NODE_KEYS = new Set([
  'id', 'label', 'notes', 'color', 'tags', 'fx', 'fy', 'fz',
  'attachedFile', 'claudePrompt', 'claudeResult'
]);
const EDGE_KEYS = new Set(['id', 'source', 'target', 'label']);
const META_KEYS = new Set(['name', 'createdAt', 'modifiedAt']);
// The v2 top level: required keys always present; optional keys default when
// absent. Later tasks push into TOP_OPTIONAL (F9 viewpoints/tours, F12 mode).
const TOP_REQUIRED = new Set(['version', 'meta', 'nodes', 'edges']);
const TOP_OPTIONAL = new Set(['snapshots']);
const SNAPSHOT_KEYS = new Set(['id', 'name', 'createdAt', 'nodes', 'edges']);
const RESULT_KEYS = new Set(['text', 'timestamp']);

function parseNode(v: unknown, ctx: string): MindNode {
  if (!isObj(v)) throw new Error(`${ctx}: expected object`);
  const id = str(v['id'], `${ctx}.id`);
  const c = `${ctx} (id="${id}")`;
  checkKeys(v, NODE_KEYS, c);
  const tags = v['tags'];
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    throw new Error(`${c}: field "tags" must be an array of strings`);
  }
  const fx = numOrNull(v['fx'], `${c}.fx`);
  const fy = numOrNull(v['fy'], `${c}.fy`);
  const fz = numOrNull(v['fz'], `${c}.fz`);
  const nulls = [fx, fy, fz].filter((x) => x === null).length;
  if (nulls !== 0 && nulls !== 3) throw new Error(`${c}: fx/fy/fz must be all numbers or all null`);
  let claudeResult = null;
  if (v['claudeResult'] !== null) {
    if (!isObj(v['claudeResult'])) throw new Error(`${c}.claudeResult: expected object or null`);
    checkKeys(v['claudeResult'], RESULT_KEYS, `${c}.claudeResult`);
    claudeResult = {
      text: str(v['claudeResult']['text'], `${c}.claudeResult.text`),
      timestamp: str(v['claudeResult']['timestamp'], `${c}.claudeResult.timestamp`)
    };
  }
  return {
    id,
    label: str(v['label'], `${c}.label`),
    notes: str(v['notes'], `${c}.notes`),
    color: strOrNull(v['color'], `${c}.color`),
    tags: tags as string[],
    fx, fy, fz,
    attachedFile: strOrNull(v['attachedFile'], `${c}.attachedFile`),
    claudePrompt: strOrNull(v['claudePrompt'], `${c}.claudePrompt`),
    claudeResult
  };
}

function parseEdge(v: unknown, ctx: string, nodeIds: Set<string>): MindEdge {
  if (!isObj(v)) throw new Error(`${ctx}: expected object`);
  const id = str(v['id'], `${ctx}.id`);
  const c = `${ctx} (id="${id}")`;
  checkKeys(v, EDGE_KEYS, c);
  const source = str(v['source'], `${c}.source`);
  const target = str(v['target'], `${c}.target`);
  if (!nodeIds.has(source)) throw new Error(`${c}: source references missing node "${source}"`);
  if (!nodeIds.has(target)) throw new Error(`${c}: target references missing node "${target}"`);
  if (source === target) throw new Error(`${c}: self-loop not allowed`);
  return { id, source, target, label: strOrNull(v['label'], `${c}.label`) };
}

// A snapshot's edges reference the snapshot's OWN nodes, so validate them
// against that node set (not the live graph). Reuses parseNode/parseEdge for
// strict field checking.
function parseSnapshot(v: unknown, ctx: string): Snapshot {
  if (!isObj(v)) throw new Error(`${ctx}: expected object`);
  const id = str(v['id'], `${ctx}.id`);
  const c = `${ctx} (id="${id}")`;
  checkKeys(v, SNAPSHOT_KEYS, c);
  const name = str(v['name'], `${c}.name`);
  const createdAt = str(v['createdAt'], `${c}.createdAt`);
  if (!Array.isArray(v['nodes'])) throw new Error(`${c}: "nodes" must be an array`);
  if (!Array.isArray(v['edges'])) throw new Error(`${c}: "edges" must be an array`);
  const nodes: MindNode[] = [];
  const nodeIds = new Set<string>();
  v['nodes'].forEach((n, i) => {
    const node = parseNode(n, `${c}.nodes[${i}]`);
    if (nodeIds.has(node.id)) throw new Error(`${c}.nodes[${i}]: duplicate node id "${node.id}"`);
    nodeIds.add(node.id);
    nodes.push(node);
  });
  const edges: MindEdge[] = [];
  const edgeIds = new Set<string>();
  v['edges'].forEach((e, i) => {
    const edge = parseEdge(e, `${c}.edges[${i}]`, nodeIds);
    if (edgeIds.has(edge.id)) throw new Error(`${c}.edges[${i}]: duplicate edge id "${edge.id}"`);
    edgeIds.add(edge.id);
    edges.push(edge);
  });
  return { id, name, createdAt, nodes, edges };
}

// Top-level key check: reject anything outside required∪optional; require every
// required key. Optional keys may be absent (they default in deserializeGraph).
function checkTopKeys(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) {
    if (!TOP_REQUIRED.has(k) && !TOP_OPTIONAL.has(k)) {
      throw new Error(`mind3d file: unknown field "${k}"`);
    }
  }
  for (const k of TOP_REQUIRED) {
    if (!(k in obj)) throw new Error(`mind3d file: missing field "${k}"`);
  }
}

export function deserializeGraph(text: string): { state: GraphState; meta: MapMeta; snapshots: Snapshot[] } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`mind3d file is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(doc)) throw new Error('mind3d file: top level must be an object');
  checkTopKeys(doc);
  const version = doc['version'];
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.has(version)) {
    throw new Error(`mind3d file: version ${String(version)} not supported (expected 1 or 2)`);
  }
  if (!isObj(doc['meta'])) throw new Error('mind3d file: "meta" must be an object');
  checkKeys(doc['meta'], META_KEYS, 'meta');
  const meta: MapMeta = {
    name: str(doc['meta']['name'], 'meta.name'),
    createdAt: str(doc['meta']['createdAt'], 'meta.createdAt'),
    modifiedAt: str(doc['meta']['modifiedAt'], 'meta.modifiedAt')
  };
  if (!Array.isArray(doc['nodes'])) throw new Error('mind3d file: "nodes" must be an array');
  if (!Array.isArray(doc['edges'])) throw new Error('mind3d file: "edges" must be an array');
  const state = emptyState();
  doc['nodes'].forEach((n, i) => {
    const node = parseNode(n, `nodes[${i}]`);
    if (state.nodes.has(node.id)) throw new Error(`nodes[${i}]: duplicate node id "${node.id}"`);
    state.nodes.set(node.id, node);
  });
  const nodeIds = new Set(state.nodes.keys());
  doc['edges'].forEach((e, i) => {
    const edge = parseEdge(e, `edges[${i}]`, nodeIds);
    if (state.edges.has(edge.id)) throw new Error(`edges[${i}]: duplicate edge id "${edge.id}"`);
    state.edges.set(edge.id, edge);
  });
  // Optional in v2, absent in v1 → the in-memory upgrade default (empty list).
  // Present-but-not-an-array is a hard error (fail-fast); each snapshot is
  // validated strictly.
  let snapshots: Snapshot[] = [];
  if ('snapshots' in doc) {
    const raw = doc['snapshots'];
    if (!Array.isArray(raw)) throw new Error('mind3d file: "snapshots" must be an array');
    snapshots = raw.map((s, i) => parseSnapshot(s, `snapshots[${i}]`));
  }
  return { state, meta, snapshots };
}
