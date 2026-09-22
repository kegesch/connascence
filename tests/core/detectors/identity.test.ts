import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectName } from '../../../src/core/detectors/name.ts';
import { detectIdentity } from '../../../src/core/detectors/identity.ts';

const FIXTURES = ['tests/fixtures/identity/state.ts', 'tests/fixtures/identity/consumer.ts'];

function analyze() {
  const table = buildSymbolTable(FIXTURES);
  const project = table.project;
  project.edges = detectName(project, table.refIdToDefId);
  return detectIdentity(project);
}

describe('detectIdentity', () => {
  it('flags cross-module access to mutable module state with evidence', () => {
    const edges = analyze();
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const counterEdges = edges.filter((e) => e.evidence.includes('"counter"'));
    expect(counterEdges.length).toBeGreaterThanOrEqual(1);
    expect(counterEdges[0].connascenceType).toBe('identity');
    expect(counterEdges[0].evidence).toContain('shared mutable module state');
  });

  it('does not flag immutable module constants', () => {
    const edges = analyze();
    expect(edges.some((e) => e.evidence.includes('"FIXED"'))).toBe(false);
  });
});
