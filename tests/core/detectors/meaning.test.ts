import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectMeaning } from '../../../src/core/detectors/meaning.ts';

const FIXTURES = ['tests/fixtures/meaning/tabs.ts', 'tests/fixtures/meaning/usage.ts'];

function analyze(files: string[], options?: Parameters<typeof detectMeaning>[1]) {
  const table = buildSymbolTable(files);
  return detectMeaning(table.project, options);
}

describe('detectMeaning', () => {
  it('flags literals repeated across call sites in multiple files with evidence', () => {
    const edges = analyze(FIXTURES);
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].connascenceType).toBe('meaning');
    expect(edges[0].evidence).toContain('magic literal');
    expect(edges[0].evidence).toContain('candidate');
  });

  it('respects minCount and minFiles thresholds', () => {
    expect(analyze(FIXTURES, { minCount: 99 })).toHaveLength(0);
    expect(analyze(FIXTURES, { minFiles: 5 })).toHaveLength(0);
    // 'home' appears at 5 call sites in usage.ts alone -> passes count but fails default file spread
    const twoFile = analyze(FIXTURES, { minFiles: 1, minCount: 5 });
    expect(twoFile.length).toBeGreaterThan(0);
  });

  it('returns nothing for a single small file', () => {
    expect(analyze(['tests/fixtures/meaning/tabs.ts'])).toHaveLength(0);
  });
});
