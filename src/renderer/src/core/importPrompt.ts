import { PROPOSAL_SCHEMA } from './proposal';

// Import → map (F5): build the Claude extraction prompt from arbitrary source
// text (pasted, a file's contents, or a fetched URL). Pure — no I/O, no DOM.
// Reuses the single-source-of-truth PROPOSAL_SCHEMA so the extracted op-set
// parses through the same `parseProposal`/`planProposal` engine as Ask/Voice.

// Hard cap on how much source text is embedded in the prompt. A large document
// would otherwise blow the model's context window; 12k chars is enough to
// extract a useful skeleton and keep the one-shot call fast.
export const IMPORT_TRUNCATE = 12000;

// Cap source text at `max` chars, appending a short marker when it was cut so
// the model knows the tail is missing. Text at or under the bound is returned
// verbatim.
export function truncateSource(text: string, max: number = IMPORT_TRUNCATE): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[…source truncated at ${max} chars…]`;
}

export function buildImportPrompt(sourceText: string): string {
  return [
    'You are extracting a mind map from a source document. Read the SOURCE below and produce a concise node/edge structure that captures its key concepts and how they relate.',
    'Reply with ONLY a JSON object matching this schema — no prose outside the JSON, no markdown fences:',
    PROPOSAL_SCHEMA,
    'Use short node labels and put longer detail in "notes". "tmp" ids are batch-local; a "parent" on a node implies an edge parent -> node, so use "parent" to build the hierarchy. Use "edge" ops (with a short "label") for cross-links between concepts that are not strict parent/child. Summarize what you extracted in one sentence in "summary". Leave "answer" empty unless the source cannot be turned into a map (then explain why in "answer" and return an empty "ops" array).',
    '',
    'SOURCE:',
    '<<<SOURCE',
    truncateSource(sourceText),
    'SOURCE>>>'
  ].join('\n');
}
