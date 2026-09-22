import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectValue } from '../../../src/core/detectors/value.ts';

const FIXTURES = ['tests/fixtures/value/server.ts', 'tests/fixtures/value/client.ts'];

describe('detectValue', () => {
  it('flags constants sharing a literal value across files', () => {
    const table = buildSymbolTable(FIXTURES);
    const edges = detectValue(table.project);
    expect(edges.length).toBeGreaterThanOrEqual(2); // 3 and 5432 pairs
    for (const e of edges) {
      expect(e.connascenceType).toBe('value');
      expect(e.evidence).toContain('must co-vary');
    }
    const names = edges.map((e) => e.evidence).join(' ');
    expect(names).toContain('MAX_RETRIES');
    expect(names).toContain('RETRY_LIMIT');
    expect(names).toContain('DEFAULT_PORT');
  });

  it('ignores unique values and same-file pairs', () => {
    const table = buildSymbolTable(['tests/fixtures/value/server.ts']);
    expect(detectValue(table.project)).toHaveLength(0); // single file, minFiles=2
  });
});
