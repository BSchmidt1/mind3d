import { PROPOSAL_SCHEMA } from './proposal';

// The prompt library for "Ask the map" (F4): a set of ready-made analytical
// asks plus the builder that wraps any instruction with the shared proposal
// JSON schema and the serialized graph context. Pure — no I/O, no DOM.

export interface AskPreset {
  id: string;
  title: string;
  instruction: string;
}

export const ASK_PRESETS: AskPreset[] = [
  {
    id: 'missing',
    title: 'What am I missing?',
    instruction:
      'Analyze this mind map and identify important concepts, considerations, or sub-topics that are absent. Propose new nodes (and edges connecting them to the most relevant existing nodes) that fill those gaps. Summarize what you added in one sentence.'
  },
  {
    id: 'connect',
    title: 'Connect unconnected nodes',
    instruction:
      'Look for existing nodes that are conceptually related but not yet linked. Propose edges — using existing node ids in "from"/"to" — that capture those relationships, giving each a short "label". Do not create new nodes unless strictly necessary.'
  },
  {
    id: 'cluster',
    title: 'Cluster / group these',
    instruction:
      'Identify natural thematic clusters among the existing nodes. For each cluster, propose a new grouping node and connect its members to it via edges. Keep grouping labels short.'
  },
  {
    id: 'steelman',
    title: 'Steelman this branch',
    instruction:
      'Take the focused part of the map and build the strongest possible version of its argument or plan. Propose new supporting nodes (evidence, reasoning, prerequisites) attached to the relevant existing nodes.'
  },
  {
    id: 'contradictions',
    title: 'Find contradictions',
    instruction:
      'Examine the map for tensions, contradictions, or claims in conflict. Report what you find in "answer" as a short prose reply. Only propose structural changes ("ops") if adding a node would help capture an unresolved tension; otherwise return an empty "ops" array.'
  }
];

export function buildAskPrompt(opts: { instruction: string; context: string }): string {
  return [
    'You are analyzing a 3D mind map. Reply with ONLY a JSON object matching this schema — no prose outside the JSON, no markdown fences:',
    PROPOSAL_SCHEMA,
    '"tmp" ids are batch-local; "parent"/"from"/"to" resolve to either a "tmp" in this batch or an existing node id from the graph context below. A "parent" on a node implies an edge parent -> node. Keep labels short and put longer detail in "notes".',
    'You MAY include a short "answer" string with a text reply, and you MAY return an empty "ops" array when you are only answering a question (no structural change).',
    '',
    'GRAPH CONTEXT:',
    opts.context,
    '',
    'TASK:',
    '<<<TASK',
    opts.instruction,
    'TASK>>>'
  ].join('\n');
}
