import { createEdge, createNode } from './model';
import { addEdge, addNode, composite } from './commands';
import type { Command } from './commands';

// Shared Claude "proposal" engine: parse Claude's JSON op-set, then plan it
// into a single composite Command. Map-level Ask (F4), Import (F5), and
// Voice (F6, via voiceOps.ts's thin delegation) all reuse this.

export interface ProposalNodeOp {
  op: 'node';
  tmp: string;
  label: string;
  notes?: string;
  parent?: string;
}

export interface ProposalEdgeOp {
  op: 'edge';
  from: string;
  to: string;
  label?: string;
}

export type ProposalOp = ProposalNodeOp | ProposalEdgeOp;

export interface ProposalOpSet {
  ops: ProposalOp[];
  summary: string;
  answer?: string;
}

// The canonical proposal JSON schema example. Embedded verbatim in every
// prompt that asks Claude for an op-set (voice F6, ask F4, import F5) so all
// callers agree on the exact shape `parseProposal` accepts. `answer` and edge
// `label` are optional — voice simply never fills them.
export const PROPOSAL_SCHEMA = `{ "ops": [
    {"op":"node","tmp":"n1","label":"Funding strategy","notes":"optional markdown detail"},
    {"op":"node","tmp":"n2","label":"Grants","parent":"n1"},
    {"op":"edge","from":"n1","to":"<existing-node-id>","label":"optional edge label"}
  ], "summary":"one sentence", "answer":"optional short text reply" }`;

export interface Proposal {
  opSet: ProposalOpSet;
  command: Command;
  newNodes: { id: string; label: string }[];
  newNodeIds: string[];
  newEdges: { id: string; source: string; target: string }[];
  rootId: string | null;
  summary: string;
  humanOps: string[];
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

function validateNodeOp(o: Record<string, unknown>, i: number): ProposalNodeOp {
  const allowed = new Set(['op', 'tmp', 'label', 'notes', 'parent']);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) throw new Error(`proposal: op[${i}] has unknown field "${k}"`);
  }
  if (typeof o.tmp !== 'string' || o.tmp === '') {
    throw new Error(`proposal: op[${i}] (node) missing string "tmp"`);
  }
  if (typeof o.label !== 'string' || o.label === '') {
    throw new Error(`proposal: op[${i}] (node) missing non-empty string "label"`);
  }
  if (o.notes !== undefined && typeof o.notes !== 'string') {
    throw new Error(`proposal: op[${i}] (node) "notes" must be a string`);
  }
  if (o.parent !== undefined && typeof o.parent !== 'string') {
    throw new Error(`proposal: op[${i}] (node) "parent" must be a string`);
  }
  const node: ProposalNodeOp = { op: 'node', tmp: o.tmp, label: o.label };
  if (o.notes !== undefined) node.notes = o.notes as string;
  if (o.parent !== undefined) node.parent = o.parent as string;
  return node;
}

function validateEdgeOp(o: Record<string, unknown>, i: number): ProposalEdgeOp {
  const allowed = new Set(['op', 'from', 'to', 'label']);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) throw new Error(`proposal: op[${i}] has unknown field "${k}"`);
  }
  if (typeof o.from !== 'string' || o.from === '') {
    throw new Error(`proposal: op[${i}] (edge) missing string "from"`);
  }
  if (typeof o.to !== 'string' || o.to === '') {
    throw new Error(`proposal: op[${i}] (edge) missing string "to"`);
  }
  if (o.label !== undefined && typeof o.label !== 'string') {
    throw new Error(`proposal: op[${i}] (edge) "label" must be a string`);
  }
  const edge: ProposalEdgeOp = { op: 'edge', from: o.from, to: o.to };
  if (o.label !== undefined) edge.label = o.label as string;
  return edge;
}

function validateOp(raw: unknown, i: number): ProposalOp {
  if (!isPlainObject(raw)) {
    throw new Error(`proposal: op[${i}] is not an object`);
  }
  if (raw.op === 'node') return validateNodeOp(raw, i);
  if (raw.op === 'edge') return validateEdgeOp(raw, i);
  throw new Error(`proposal: op[${i}] has unknown "op" value ${JSON.stringify(raw.op)}`);
}

export function parseProposal(text: string): ProposalOpSet {
  const jsonText = extractJsonText(text);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`proposal: Claude did not return valid JSON: ${msg}`);
  }
  if (!isPlainObject(raw)) {
    throw new Error('proposal: response is not a JSON object');
  }
  if (!Array.isArray(raw.ops)) {
    throw new Error('proposal: response missing "ops" array');
  }
  if (typeof raw.summary !== 'string') {
    throw new Error('proposal: response missing string "summary"');
  }
  if (raw.answer !== undefined && typeof raw.answer !== 'string') {
    throw new Error('proposal: response "answer" must be a string');
  }
  const ops = raw.ops.map((op, i) => validateOp(op, i));
  const result: ProposalOpSet = { ops, summary: raw.summary };
  if (raw.answer !== undefined) result.answer = raw.answer as string;
  return result;
}

export function planProposal(
  opSet: ProposalOpSet,
  existingNodeIds: Set<string>,
  labelOf: (id: string) => string
): Proposal {
  const nodeOps = opSet.ops.filter((o): o is ProposalNodeOp => o.op === 'node');
  const edgeOps = opSet.ops.filter((o): o is ProposalEdgeOp => o.op === 'edge');

  if (nodeOps.length === 0 && edgeOps.length === 0) {
    throw new Error('proposal: nothing to create (no operations)');
  }

  const tmpToId = new Map<string, string>();
  const newNodeIds: string[] = [];
  const newNodes: { id: string; label: string }[] = [];
  const idToNewLabel = new Map<string, string>();
  const addNodeCmds: Command[] = [];

  for (const op of nodeOps) {
    if (tmpToId.has(op.tmp)) {
      throw new Error(`proposal: duplicate tmp id "${op.tmp}"`);
    }
    const node = createNode(op.label);
    if (op.notes !== undefined) node.notes = op.notes;
    tmpToId.set(op.tmp, node.id);
    newNodeIds.push(node.id);
    newNodes.push({ id: node.id, label: node.label });
    idToNewLabel.set(node.id, node.label);
    addNodeCmds.push(addNode(node));
  }

  function resolve(ref: string): string {
    const tmpId = tmpToId.get(ref);
    if (tmpId !== undefined) return tmpId;
    if (existingNodeIds.has(ref)) return ref;
    throw new Error(`proposal: op references unknown id "${ref}"`);
  }

  function resolveLabel(ref: string): string {
    const id = resolve(ref);
    return idToNewLabel.get(id) ?? labelOf(id);
  }

  const humanOps: string[] = [];
  for (const op of nodeOps) {
    const label = idToNewLabel.get(tmpToId.get(op.tmp)!)!;
    if (op.parent === undefined) {
      humanOps.push(`+ node "${label}"`);
    } else {
      humanOps.push(`+ node "${label}" under "${resolveLabel(op.parent)}"`);
    }
  }

  const addEdgeCmds: Command[] = [];
  const newEdges: { id: string; source: string; target: string }[] = [];
  const edgeTargets = new Set<string>();

  for (const op of nodeOps) {
    if (op.parent === undefined) continue;
    const newId = tmpToId.get(op.tmp)!;
    const parentId = resolve(op.parent);
    if (parentId === newId) throw new Error(`proposal: self-loop on "${newId}"`);
    const edge = createEdge(parentId, newId);
    addEdgeCmds.push(addEdge(edge));
    newEdges.push({ id: edge.id, source: edge.source, target: edge.target });
    edgeTargets.add(newId);
  }

  for (const op of edgeOps) {
    const from = resolve(op.from);
    const to = resolve(op.to);
    if (from === to) throw new Error(`proposal: self-loop on "${from}"`);
    const edge = createEdge(from, to);
    edge.label = op.label ?? null;
    addEdgeCmds.push(addEdge(edge));
    newEdges.push({ id: edge.id, source: edge.source, target: edge.target });
    edgeTargets.add(to);
    const fromLabel = resolveLabel(op.from);
    const toLabel = resolveLabel(op.to);
    humanOps.push(
      op.label !== undefined
        ? `+ edge "${fromLabel}" → "${toLabel}" "${op.label}"`
        : `+ edge "${fromLabel}" → "${toLabel}"`
    );
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

  const command = composite('proposal', [...addNodeCmds, ...addEdgeCmds]);
  return {
    opSet,
    command,
    newNodes,
    newNodeIds,
    newEdges,
    rootId,
    summary: opSet.summary,
    humanOps
  };
}
