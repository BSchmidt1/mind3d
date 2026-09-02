export interface ClaudeResult {
  text: string;
  timestamp: string;
}

export interface MindNode {
  id: string;
  label: string;
  notes: string;
  color: string | null;
  tags: string[];
  fx: number | null;
  fy: number | null;
  fz: number | null;
  attachedFile: string | null;
  claudePrompt: string | null;
  claudeResult: ClaudeResult | null;
}

// A first-class edge relation (F10): a typed semantic role for an edge,
// rendered as link color/style and understood by Claude's proposal schema.
// 'none' is the neutral default that every pre-F10 edge upgrades to.
export type EdgeRelation = 'none' | 'supports' | 'refutes' | 'depends';
export const EDGE_RELATIONS: EdgeRelation[] = ['none', 'supports', 'refutes', 'depends'];

export interface MindEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
  relation: EdgeRelation;
}

export interface GraphState {
  nodes: Map<string, MindNode>;
  edges: Map<string, MindEdge>;
}

export function emptyState(): GraphState {
  return { nodes: new Map(), edges: new Map() };
}

export function createNode(label: string): MindNode {
  return {
    id: crypto.randomUUID(),
    label,
    notes: '',
    color: null,
    tags: [],
    fx: null,
    fy: null,
    fz: null,
    attachedFile: null,
    claudePrompt: null,
    claudeResult: null
  };
}

export function createEdge(
  source: string,
  target: string,
  label: string | null = null,
  relation: EdgeRelation = 'none'
): MindEdge {
  return { id: crypto.randomUUID(), source, target, label, relation };
}
