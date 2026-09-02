import { describe, expect, test } from 'vitest';
import { buildVoicePrompt } from '../src/renderer/src/core/voicePrompt';

describe('buildVoicePrompt', () => {
  test('includes transcript and schema keyword; (empty map) and (none) when empty', () => {
    const prompt = buildVoicePrompt({
      transcript: 'add three children under the selected node',
      nodes: [],
      selectedId: null
    });
    expect(prompt).toContain('add three children under the selected node');
    expect(prompt).toContain('"ops"');
    expect(prompt).toContain('(empty map)');
    expect(prompt).toContain('(none)');
    expect(prompt).not.toContain('SOURCE DOCUMENT');
    // transcript is fenced between delimiters so dictated text can't blur prompt structure
    expect(prompt).toMatch(/<<<INSTRUCTION\nadd three children under the selected node\nINSTRUCTION>>>/);
  });

  test('includes each existing label and the selected id', () => {
    const prompt = buildVoicePrompt({
      transcript: 'x',
      nodes: [
        { id: 'id-1', label: 'Funding strategy' },
        { id: 'id-2', label: 'Grants' }
      ],
      selectedId: 'id-1'
    });
    expect(prompt).toContain('Funding strategy');
    expect(prompt).toContain('Grants');
    expect(prompt).toContain('id-1');
  });

  test('includes doc text only when provided', () => {
    const withDoc = buildVoicePrompt({
      transcript: 'x',
      nodes: [],
      selectedId: null,
      docText: 'Section 1: Intro\nSection 2: Body'
    });
    expect(withDoc).toContain('SOURCE DOCUMENT');
    expect(withDoc).toContain('Section 1: Intro');

    const withoutDocField = buildVoicePrompt({
      transcript: 'x',
      nodes: [],
      selectedId: null
    });
    expect(withoutDocField).not.toContain('SOURCE DOCUMENT');

    const withNullDoc = buildVoicePrompt({
      transcript: 'x',
      nodes: [],
      selectedId: null,
      docText: null
    });
    expect(withNullDoc).not.toContain('SOURCE DOCUMENT');
  });
});
