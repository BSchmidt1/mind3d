import type { GraphState, MindEdge, MindNode } from './model';
import { emptyState } from './model';

export const FILE_VERSION = 1;

export interface MapMeta {
  name: string;
  createdAt: string;
  modifiedAt: string;
}

export function serializeGraph(state: GraphState, meta: MapMeta): string {
  return JSON.stringify(
    {
      version: FILE_VERSION,
      meta,
      nodes: [...state.nodes.values()],
      edges: [...state.edges.values()]
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
const TOP_KEYS = new Set(['version', 'meta', 'nodes', 'edges']);
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

export function deserializeGraph(text: string): { state: GraphState; meta: MapMeta } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`mind3d file is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(doc)) throw new Error('mind3d file: top level must be an object');
  checkKeys(doc, TOP_KEYS, 'mind3d file');
  if (doc['version'] !== FILE_VERSION) {
    throw new Error(`mind3d file: version ${String(doc['version'])} not supported (expected ${FILE_VERSION})`);
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
  return { state, meta };
}
