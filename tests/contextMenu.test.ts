import { describe, expect, test } from 'vitest';
import { buildMenuItems, type MenuActions } from '../src/renderer/src/ui/contextMenu';
import { EDGE_RELATIONS } from '../src/renderer/src/core/model';

// A MenuActions stub that records every call, so we can assert an item's run()
// dispatches to the right action with the right arguments.
function recorder(): { actions: MenuActions; calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const rec = (name: string) => (...args: unknown[]): void => {
    calls.push([name, ...args]);
  };
  const actions: MenuActions = {
    addChild: rec('addChild'),
    linkFrom: rec('linkFrom'),
    askAbout: rec('askAbout'),
    attachFile: rec('attachFile'),
    togglePin: rec('togglePin'),
    deleteNode: rec('deleteNode'),
    editEdgeLabel: rec('editEdgeLabel'),
    setRelation: rec('setRelation'),
    deleteEdge: rec('deleteEdge'),
    newNodeAt: rec('newNodeAt'),
    importText: rec('importText')
  };
  return { actions, calls };
}

describe('buildMenuItems', () => {
  test('node target: expected items, Pin label, and run dispatch with the node id', () => {
    const { actions, calls } = recorder();
    const items = buildMenuItems({ kind: 'node', id: 'n1', pinned: false }, actions);
    expect(items.map((i) => i.label)).toEqual([
      'Add child',
      'Link from here',
      'Ask about this…',
      'Attach file…',
      'Pin',
      'Delete node'
    ]);
    for (const i of items) i.run();
    expect(calls).toEqual([
      ['addChild', 'n1'],
      ['linkFrom', 'n1'],
      ['askAbout', 'n1'],
      ['attachFile', 'n1'],
      ['togglePin', 'n1'],
      ['deleteNode', 'n1']
    ]);
  });

  test('node target: pinned shows "Unpin"', () => {
    const { actions } = recorder();
    const items = buildMenuItems({ kind: 'node', id: 'n1', pinned: true }, actions);
    expect(items.map((i) => i.label)).toContain('Unpin');
    expect(items.map((i) => i.label)).not.toContain('Pin');
  });

  test('edge target: label/relation-submenu/delete; submenu covers every relation', () => {
    const { actions, calls } = recorder();
    const items = buildMenuItems({ kind: 'edge', id: 'e1' }, actions);
    expect(items.map((i) => i.label)).toEqual(['Edit label…', 'Set relation', 'Delete edge']);

    const setRel = items[1]!;
    expect(setRel.submenu?.map((i) => i.label)).toEqual(EDGE_RELATIONS);
    // The parent row does nothing on its own; the leaves apply a relation.
    setRel.run();
    expect(calls).toEqual([]);
    for (const leaf of setRel.submenu!) leaf.run();
    expect(calls).toEqual(EDGE_RELATIONS.map((r) => ['setRelation', 'e1', r]));

    items[0]!.run();
    items[2]!.run();
    expect(calls.at(-2)).toEqual(['editEdgeLabel', 'e1']);
    expect(calls.at(-1)).toEqual(['deleteEdge', 'e1']);
  });

  test('background target: new node passes the cursor point; import has no args', () => {
    const { actions, calls } = recorder();
    const items = buildMenuItems({ kind: 'background', clientX: 42, clientY: 99 }, actions);
    expect(items.map((i) => i.label)).toEqual(['New node here', 'Import text / file / URL…']);
    for (const i of items) i.run();
    expect(calls).toEqual([
      ['newNodeAt', 42, 99],
      ['importText']
    ]);
  });
});
