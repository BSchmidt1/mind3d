import { describe, expect, test } from 'vitest';
import { ASK_PRESETS, buildAskPrompt } from '../src/renderer/src/core/askPrompts';

describe('ASK_PRESETS', () => {
  test('has at least 5 presets with unique ids', () => {
    expect(ASK_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = ASK_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each preset has a non-empty title and instruction', () => {
    for (const p of ASK_PRESETS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.instruction.length).toBeGreaterThan(0);
    }
  });
});

describe('buildAskPrompt', () => {
  test('embeds the proposal schema, the instruction, and the context', () => {
    const context = 'NODES:\nx\tHello\nEDGES:';
    const out = buildAskPrompt({ instruction: 'What am I missing?', context });
    expect(out).toContain('"ops"'); // schema block
    expect(out).toContain('What am I missing?'); // instruction
    expect(out).toContain(context); // graph context verbatim
  });
});
