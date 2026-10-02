import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectMeaning } from '../../../src/core/detectors/meaning.ts';

const FIXTURES = ['tests/fixtures/meaning/tabs.ts', 'tests/fixtures/meaning/usage.ts'];

function analyze(files: string[], options?: Parameters<typeof detectMeaning>[1]) {
  return detectMeaning(tableOf(files), options);
}

function tableOf(files: string[]) {
  return buildSymbolTable(files).project;
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

  it('skips trivial single-character literals by default, flags them with skipTrivial=false', () => {
    // fixtures contain 5+ single-char/string separators across two files? verify via synthetic options:
    // tabs.ts/usage.ts have no trivial literals; assert the default keeps working on real values
    const edges = analyze(FIXTURES);
    for (const e of edges) {
      const value = e.evidence.split(' ')[2];
      expect(value.length).toBeGreaterThanOrEqual(2);
    }
    // synthetic project: repeated '/' literals would be skipped by default
    const project = tableOf(['tests/fixtures/meaning/trivial.ts', 'tests/fixtures/meaning/trivial2.ts']);
    const skipped = detectMeaning(project);
    const flagged = detectMeaning(project, { skipTrivial: false, minCount: 3 });
    expect(skipped).toHaveLength(0);
    expect(flagged.length).toBeGreaterThan(0);
  });
});
