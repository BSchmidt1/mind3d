import { createEdge, createNode } from './model';
import { addEdge, addNode, composite } from './commands';
import type { Command } from './commands';

export interface VoiceNodeOp {
  op: 'node';
  tmp: string;
  label: string;
  notes?: string;
  parent?: string;
}

export interface VoiceEdgeOp {
  op: 'edge';
  from: string;
  to: string;
}

export type VoiceOp = VoiceNodeOp | VoiceEdgeOp;

export interface VoiceResult {
  ops: VoiceOp[];
  summary: string;
}

export interface VoicePlan {
  command: Command;
  newNodeIds: string[];
  rootId: string | null;
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return text;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateNodeOp(o: Record<string, unknown>, i: number): VoiceNodeOp {
  const allowed = new Set(['op', 'tmp', 'label', 'notes', 'parent']);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) throw new Error(`voice: op[${i}] has unknown field "${k}"`);
  }
  if (typeof o.tmp !== 'string' || o.tmp === '') {
    throw new Error(`voice: op[${i}] (node) missing string "tmp"`);
  }
  if (typeof o.label !== 'string' || o.label === '') {
    throw new Error(`voice: op[${i}] (node) missing non-empty string "label"`);
  }
  if (o.notes !== undefined && typeof o.notes !== 'string') {
    throw new Error(`voice: op[${i}] (node) "notes" must be a string`);
  }
  if (o.parent !== undefined && typeof o.parent !== 'string') {
    throw new Error(`voice: op[${i}] (node) "parent" must be a string`);
  }
  const node: VoiceNodeOp = { op: 'node', tmp: o.tmp, label: o.label };
  if (o.notes !== undefined) node.notes = o.notes as string;
  if (o.parent !== undefined) node.parent = o.parent as string;
  return node;
}

function validateEdgeOp(o: Record<string, unknown>, i: number): VoiceEdgeOp {
  const allowed = new Set(['op', 'from', 'to']);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) throw new Error(`voice: op[${i}] has unknown field "${k}"`);
  }
  if (typeof o.from !== 'string' || o.from === '') {
    throw new Error(`voice: op[${i}] (edge) missing string "from"`);
  }
  if (typeof o.to !== 'string' || o.to === '') {
    throw new Error(`voice: op[${i}] (edge) missing string "to"`);
  }
  return { op: 'edge', from: o.from, to: o.to };
}

function validateOp(raw: unknown, i: number): VoiceOp {
  if (!isPlainObject(raw)) {
    throw new Error(`voice: op[${i}] is not an object`);
  }
  if (raw.op === 'node') return validateNodeOp(raw, i);
  if (raw.op === 'edge') return validateEdgeOp(raw, i);
  throw new Error(`voice: op[${i}] has unknown "op" value ${JSON.stringify(raw.op)}`);
}

export function parseVoiceResult(text: string): VoiceResult {
  const jsonText = extractJsonText(text);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`voice: Claude did not return valid JSON: ${msg}`);
  }
  if (!isPlainObject(raw)) {
    throw new Error('voice: response is not a JSON object');
  }
  if (!Array.isArray(raw.ops)) {
    throw new Error('voice: response missing "ops" array');
  }
  if (typeof raw.summary !== 'string') {
    throw new Error('voice: response missing string "summary"');
  }
  const ops = raw.ops.map((op, i) => validateOp(op, i));
  return { ops, summary: raw.summary };
}

export function planFromVoiceResult(
  result: VoiceResult,
  existingNodeIds: Set<string>
): VoicePlan {
  const nodeOps = result.ops.filter((o): o is VoiceNodeOp => o.op === 'node');
  const edgeOps = result.ops.filter((o): o is VoiceEdgeOp => o.op === 'edge');

  if (nodeOps.length === 0 && edgeOps.length === 0) {
    throw new Error('voice: nothing to create (no operations)');
  }

  const tmpToId = new Map<string, string>();
  const newNodeIds: string[] = [];
  const addNodeCmds: Command[] = [];

  for (const op of nodeOps) {
    if (tmpToId.has(op.tmp)) {
      throw new Error(`voice: duplicate tmp id "${op.tmp}"`);
    }
    const node = createNode(op.label);
    if (op.notes !== undefined) node.notes = op.notes;
    tmpToId.set(op.tmp, node.id);
    newNodeIds.push(node.id);
    addNodeCmds.push(addNode(node));
  }

  function resolve(ref: string): string {
    const tmpId = tmpToId.get(ref);
    if (tmpId !== undefined) return tmpId;
    if (existingNodeIds.has(ref)) return ref;
    throw new Error(`voice: op references unknown id "${ref}"`);
  }

  const addEdgeCmds: Command[] = [];
  const edgeTargets = new Set<string>();

  for (const op of nodeOps) {
    if (op.parent === undefined) continue;
    const newId = tmpToId.get(op.tmp)!;
    const parentId = resolve(op.parent);
    if (parentId === newId) throw new Error(`voice: self-loop on "${newId}"`);
    addEdgeCmds.push(addEdge(createEdge(parentId, newId)));
    edgeTargets.add(newId);
  }

  for (const op of edgeOps) {
    const from = resolve(op.from);
    const to = resolve(op.to);
    if (from === to) throw new Error(`voice: self-loop on "${from}"`);
    addEdgeCmds.push(addEdge(createEdge(from, to)));
    edgeTargets.add(to);
  }

  let rootId: string | null = null;
  for (const op of nodeOps) {
    const id = tmpToId.get(op.tmp)!;
    if (op.parent === undefined && !edgeTargets.has(id)) {
      rootId = id;
      break;
    }
  }
  if (rootId === null && newNodeIds.length > 0) {
    rootId = newNodeIds[0]!;
  }

  const command = composite('voice', [...addNodeCmds, ...addEdgeCmds]);
  return { command, newNodeIds, rootId };
}
