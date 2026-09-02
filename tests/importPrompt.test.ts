import { describe, expect, test } from 'vitest';
import {
  IMPORT_TRUNCATE,
  buildImportPrompt,
  truncateSource
} from '../src/renderer/src/core/importPrompt';

describe('truncateSource', () => {
  test('returns short text unchanged', () => {
    expect(truncateSource('hello world')).toBe('hello world');
  });

  test('text exactly at the bound is unchanged', () => {
    const exact = 'x'.repeat(IMPORT_TRUNCATE);
    expect(truncateSource(exact)).toBe(exact);
  });

  test('caps long text near the truncation bound and drops the tail', () => {
    const long = 'x'.repeat(IMPORT_TRUNCATE + 5000);
    const out = truncateSource(long);
    // The kept source is capped at IMPORT_TRUNCATE, plus a short marker.
    expect(out.length).toBeLessThanOrEqual(IMPORT_TRUNCATE + 64);
    expect(out.length).toBeLessThan(long.length);
  });
});

describe('buildImportPrompt', () => {
  test('embeds the proposal schema and the source snippet', () => {
    const out = buildImportPrompt('Chapter 1: Photosynthesis\nLight reactions convert light...');
    expect(out).toContain('"ops"'); // schema block
    expect(out).toContain('Photosynthesis'); // source snippet verbatim
  });

  test('truncates a source longer than IMPORT_TRUNCATE — a sentinel past the cutoff is absent', () => {
    const sentinel = 'SENTINEL_PAST_CUTOFF';
    const src = 'A'.repeat(IMPORT_TRUNCATE) + sentinel;
    const out = buildImportPrompt(src);
    expect(out).not.toContain(sentinel);
  });
});
