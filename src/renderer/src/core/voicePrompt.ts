const SCHEMA = `{ "ops": [
    {"op":"node","tmp":"n1","label":"Funding strategy","notes":"optional markdown"},
    {"op":"node","tmp":"n2","label":"Grants","parent":"n1"},
    {"op":"edge","from":"n1","to":"<existing-node-id>"}
  ], "summary":"one sentence" }`;

export function buildVoicePrompt(opts: {
  transcript: string;
  nodes: { id: string; label: string }[];
  selectedId: string | null;
  docText?: string | null;
}): string {
  const lines: string[] = [
    'You are extending a 3D mindmap. Given the user instruction below, reply with ONLY a JSON object matching this schema — no prose, no markdown fences:',
    SCHEMA,
    '"tmp" ids are batch-local; "parent"/"from"/"to" resolve to either a "tmp" in this batch or an existing node id listed below. A "parent" on a node implies an edge parent -> node.',
    'Prefer attaching new nodes to the selected node (or other existing ids) when the instruction implies it. Keep labels short; put longer detail in "notes".',
    '',
    'EXISTING NODES:'
  ];
  if (opts.nodes.length === 0) {
    lines.push('(empty map)');
  } else {
    for (const n of opts.nodes) {
      lines.push(`${n.id}\t${n.label}`);
    }
  }
  lines.push('');
  lines.push(`SELECTED NODE: ${opts.selectedId ?? '(none)'}`);
  if (opts.docText) {
    lines.push('');
    lines.push('SOURCE DOCUMENT:');
    lines.push('---');
    lines.push(opts.docText);
    lines.push('---');
  }
  lines.push('');
  lines.push('USER INSTRUCTION:');
  lines.push(opts.transcript);
  return lines.join('\n');
}
