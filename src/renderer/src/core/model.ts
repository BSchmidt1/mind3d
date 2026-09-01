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

export interface MindEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
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

export function createEdge(source: string, target: string): MindEdge {
  return { id: crypto.randomUUID(), source, target, label: null };
}
