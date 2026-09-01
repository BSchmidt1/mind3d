import type { GraphState, MindEdge, MindNode, ClaudeResult } from './model';

export type ChangeKind = 'structure' | 'props';

export interface Command {
  name: string;
  kind: ChangeKind;
  ids: string[];
  execute(s: GraphState): void;
  undo(s: GraphState): void;
}

function reqNode(s: GraphState, id: string): MindNode {
  const n = s.nodes.get(id);
  if (!n) throw new Error(`no such node: "${id}"`);
  return n;
}

function reqEdge(s: GraphState, id: string): MindEdge {
  const e = s.edges.get(id);
  if (!e) throw new Error(`no such edge: "${id}"`);
  return e;
}

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`undo before execute: ${what}`);
  return v;
}

export function addNode(node: MindNode): Command {
  return {
    name: 'addNode',
    kind: 'structure',
    ids: [node.id],
    execute(s) {
      if (s.nodes.has(node.id)) throw new Error(`node "${node.id}" already exists`);
      s.nodes.set(node.id, node);
    },
    undo(s) {
      s.nodes.delete(node.id);
    }
  };
}

export function deleteNode(id: string): Command {
  let removedNode: MindNode | undefined;
  let removedEdges: MindEdge[] = [];
  let edgeOrder: string[] = [];
  return {
    name: 'deleteNode',
    kind: 'structure',
    ids: [id],
    execute(s) {
      removedNode = reqNode(s, id);
      edgeOrder = [...s.edges.keys()];
      removedEdges = [...s.edges.values()].filter((e) => e.source === id || e.target === id);
      s.nodes.delete(id);
      for (const e of removedEdges) s.edges.delete(e.id);
    },
    undo(s) {
      s.nodes.set(id, must(removedNode, 'deleteNode'));
      const byId = new Map(removedEdges.map((e) => [e.id, e]));
      const rebuilt = new Map<string, MindEdge>();
      for (const eid of edgeOrder) {
        const e = byId.get(eid) ?? s.edges.get(eid);
        if (e) rebuilt.set(eid, e);
      }
      s.edges.clear();
      for (const [k, v] of rebuilt) s.edges.set(k, v);
    }
  };
}

export function addEdge(edge: MindEdge): Command {
  return {
    name: 'addEdge',
    kind: 'structure',
    ids: [edge.id],
    execute(s) {
      if (s.edges.has(edge.id)) throw new Error(`edge "${edge.id}" already exists`);
      if (!s.nodes.has(edge.source)) throw new Error(`edge source: no such node "${edge.source}"`);
      if (!s.nodes.has(edge.target)) throw new Error(`edge target: no such node "${edge.target}"`);
      if (edge.source === edge.target) throw new Error(`self-loop on "${edge.source}" not allowed`);
      s.edges.set(edge.id, edge);
    },
    undo(s) {
      s.edges.delete(edge.id);
    }
  };
}

export function deleteEdge(id: string): Command {
  let removed: MindEdge | undefined;
  return {
    name: 'deleteEdge',
    kind: 'structure',
    ids: [id],
    execute(s) {
      removed = reqEdge(s, id);
      s.edges.delete(id);
    },
    undo(s) {
      const e = must(removed, 'deleteEdge');
      s.edges.set(e.id, e);
    }
  };
}

function propCommand<T>(
  name: string,
  id: string,
  get: (n: MindNode) => T,
  set: (n: MindNode, v: T) => void,
  value: T
): Command {
  let prev: T | undefined;
  let hadPrev = false;
  return {
    name,
    kind: 'props',
    ids: [id],
    execute(s) {
      const n = reqNode(s, id);
      prev = get(n);
      hadPrev = true;
      set(n, value);
    },
    undo(s) {
      if (!hadPrev) throw new Error(`undo before execute: ${name}`);
      set(reqNode(s, id), prev as T);
    }
  };
}

export function setLabel(id: string, label: string): Command {
  return propCommand('setLabel', id, (n) => n.label, (n, v) => { n.label = v; }, label);
}

export function setNotes(id: string, notes: string): Command {
  return propCommand('setNotes', id, (n) => n.notes, (n, v) => { n.notes = v; }, notes);
}

export function setColor(id: string, color: string | null): Command {
  return propCommand('setColor', id, (n) => n.color, (n, v) => { n.color = v; }, color);
}

export function setTags(id: string, tags: string[]): Command {
  return propCommand('setTags', id, (n) => n.tags, (n, v) => { n.tags = v; }, [...tags]);
}

export function setAttachedFile(id: string, path: string | null): Command {
  return propCommand('setAttachedFile', id, (n) => n.attachedFile, (n, v) => { n.attachedFile = v; }, path);
}

export function setClaudePrompt(id: string, prompt: string | null): Command {
  return propCommand('setClaudePrompt', id, (n) => n.claudePrompt, (n, v) => { n.claudePrompt = v; }, prompt);
}

export function setClaudeResult(id: string, result: ClaudeResult | null): Command {
  return propCommand('setClaudeResult', id, (n) => n.claudeResult, (n, v) => { n.claudeResult = v; }, result);
}

export function setPosition(
  id: string,
  fx: number | null,
  fy: number | null,
  fz: number | null
): Command {
  const nulls = [fx, fy, fz].filter((v) => v === null).length;
  if (nulls !== 0 && nulls !== 3) {
    throw new Error(`setPosition("${id}"): fx/fy/fz must be all numbers or all null`);
  }
  let prev: [number | null, number | null, number | null] | undefined;
  return {
    name: 'setPosition',
    kind: 'props',
    ids: [id],
    execute(s) {
      const n = reqNode(s, id);
      prev = [n.fx, n.fy, n.fz];
      n.fx = fx;
      n.fy = fy;
      n.fz = fz;
    },
    undo(s) {
      const n = reqNode(s, id);
      const p = must(prev, 'setPosition');
      [n.fx, n.fy, n.fz] = p;
    }
  };
}

export function reparent(edgeId: string, newSource: string): Command {
  let prev: string | undefined;
  return {
    name: 'reparent',
    kind: 'structure',
    ids: [edgeId, newSource],
    execute(s) {
      const e = reqEdge(s, edgeId);
      if (!s.nodes.has(newSource)) throw new Error(`reparent: no such node "${newSource}"`);
      if (newSource === e.target) throw new Error(`reparent: would create self-loop on "${e.target}"`);
      prev = e.source;
      e.source = newSource;
    },
    undo(s) {
      reqEdge(s, edgeId).source = must(prev, 'reparent');
    }
  };
}

export function composite(name: string, cmds: Command[]): Command {
  if (cmds.length === 0) throw new Error(`composite "${name}": empty command list`);
  const kind: ChangeKind = cmds.some((c) => c.kind === 'structure') ? 'structure' : 'props';
  return {
    name,
    kind,
    ids: [...new Set(cmds.flatMap((c) => c.ids))],
    execute(s) {
      for (const c of cmds) c.execute(s);
    },
    undo(s) {
      for (const c of [...cmds].reverse()) c.undo(s);
    }
  };
}

export function freezeAll(
  state: GraphState,
  positions: Map<string, { x: number; y: number; z: number }>
): Command {
  const cmds: Command[] = [];
  for (const n of state.nodes.values()) {
    if (n.fx !== null) continue;
    const p = positions.get(n.id);
    if (!p) throw new Error(`freezeAll: no live position for unpinned node "${n.id}"`);
    cmds.push(setPosition(n.id, p.x, p.y, p.z));
  }
  if (cmds.length === 0) throw new Error('freezeAll: no unpinned nodes');
  return composite('freezeAll', cmds);
}

export function releaseAll(state: GraphState): Command {
  const pinned = [...state.nodes.values()].filter((n) => n.fx !== null);
  if (pinned.length === 0) throw new Error('releaseAll: no pinned nodes');
  return composite('releaseAll', pinned.map((n) => setPosition(n.id, null, null, null)));
}
