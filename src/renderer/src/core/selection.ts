// The current selection. Two independent, mutually-exclusive selection slots:
// a node id and an edge id (F10). At most one is non-null at a time — selecting
// a node clears any selected edge and vice versa — so a surface that shows node
// detail (DetailPanel) clears when an edge is picked, and the edge highlight
// clears when a node is picked.
//
// The node API (`get`/`set`/`subscribe`) is unchanged from v1 so every existing
// caller keeps working; the edge API (`getEdge`/`setEdge`/`subscribeEdge`) is
// additive. main.ts reconciles BOTH against the store on structure events
// (clearing a selection left dangling on a deleted node or edge).
export class Selection {
  private nodeId: string | null = null;
  private edgeId: string | null = null;
  private nodeListeners = new Set<(id: string | null) => void>();
  private edgeListeners = new Set<(id: string | null) => void>();

  get(): string | null {
    return this.nodeId;
  }

  getEdge(): string | null {
    return this.edgeId;
  }

  set(id: string | null): void {
    // Selecting a (non-null) node clears any co-selected edge.
    const clearEdge = id !== null && this.edgeId !== null;
    if (id === this.nodeId) {
      if (clearEdge) {
        this.edgeId = null;
        this.emitEdge(null);
      }
      return;
    }
    this.nodeId = id;
    if (clearEdge) this.edgeId = null;
    this.emitNode(id);
    if (clearEdge) this.emitEdge(null);
  }

  setEdge(id: string | null): void {
    // Selecting a (non-null) edge clears any co-selected node.
    const clearNode = id !== null && this.nodeId !== null;
    if (id === this.edgeId) {
      if (clearNode) {
        this.nodeId = null;
        this.emitNode(null);
      }
      return;
    }
    this.edgeId = id;
    if (clearNode) this.nodeId = null;
    this.emitEdge(id);
    if (clearNode) this.emitNode(null);
  }

  subscribe(fn: (id: string | null) => void): () => void {
    this.nodeListeners.add(fn);
    return () => this.nodeListeners.delete(fn);
  }

  subscribeEdge(fn: (id: string | null) => void): () => void {
    this.edgeListeners.add(fn);
    return () => this.edgeListeners.delete(fn);
  }

  private emitNode(id: string | null): void {
    for (const fn of this.nodeListeners) fn(id);
  }

  private emitEdge(id: string | null): void {
    for (const fn of this.edgeListeners) fn(id);
  }
}
