import { expect, test } from 'vitest';
import { fuzzyScore } from '../src/renderer/src/core/fuzzy';

test('matches subsequence case-insensitively', () => {
  expect(fuzzyScore('asi', 'ASI prevention')).not.toBeNull();
  expect(fuzzyScore('xq', 'ASI prevention')).toBeNull();
});

test('contiguous match scores higher than spread match', () => {
  expect(fuzzyScore('pre', 'prevention')!).toBeGreaterThan(fuzzyScore('pre', 'power renewal')!);
});
