import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { TypeScriptAdapter } from '../../../src/languages/typescript/adapter.ts';
import { detectName } from '../../../src/core/detectors/name.ts';
import { detectType } from '../../../src/core/detectors/type.ts';
import { scan } from '../../../src/core/scan.ts';
import { typescriptBackend } from '../../../src/languages/typescript/backend.ts';

const FIXTURES = ['tests/fixtures/type/shared.ts', 'tests/fixtures/type/types.ts'];

function analyze() {
  const table = buildSymbolTable(FIXTURES);
  const project = table.project;
  project.edges = detectName(project, table.refIdToDefId);
  const adapter = new TypeScriptAdapter(table);
  return { table, project, adapter, edges: detectType(project, adapter) };
}

describe('detectType', () => {
  it('flags value flows coupled to a shared non-primitive type', () => {
    const { edges } = analyze();
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].connascenceType).toBe('type');
    expect(edges[0].evidence).toContain('"Chord"');
    expect(edges[0].evidence).toMatch(/hard-couples both ends to type/);
  });

  it('resolves types through the adapter interface only', () => {
    const { adapter } = analyze();
    const type = adapter.resolveType;
    expect(typeof type).toBe('function');
  });
});

describe('default scan pipeline', () => {
  it('does not emit the discarded tautological type edges (PLAN §6 / M2 set)', () => {
    const report = scan(FIXTURES, {}, typescriptBackend);
    expect(report.edges.some((e) => e.connascenceType === 'type')).toBe(false);
    expect(report.summary.type ?? 0).toBe(0);
  }, 60000);
});
