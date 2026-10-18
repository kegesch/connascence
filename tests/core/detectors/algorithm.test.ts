import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectAlgorithm } from '../../../src/core/detectors/algorithm.ts';

const CLONES = 'tests/fixtures/algorithm/clones.ts';
const UNIQUE = 'tests/fixtures/algorithm/unique.ts';

function analyze(files: string[]) {
  const table = buildSymbolTable(files);
  return detectAlgorithm(table.project);
}

describe('detectAlgorithm', () => {
  it('flags structurally identical function bodies', () => {
    const edges = analyze([CLONES]);
    expect(edges).toHaveLength(1);
    expect(edges[0].connascenceType).toBe('algorithm');
    expect(edges[0].evidence).toContain('structurally identical');
    expect(edges[0].evidence).toContain('sumCents');
    expect(edges[0].evidence).toContain('addMinutes');
  });

  it('does not flag files with unique structures', () => {
    expect(analyze([UNIQUE])).toHaveLength(0);
  });

  it('ignores tiny (< minLines) matches', () => {
    const table = buildSymbolTable([CLONES]);
    const edges = detectAlgorithm(table.project, { minLines: 50 });
    expect(edges).toHaveLength(0);
  });
});
