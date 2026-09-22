import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import type { IrNode } from '../../../src/core/ir.ts';

const FIXTURE = 'tests/fixtures/symboltable/basic.ts';

describe('symbolTable', () => {
  const table = buildSymbolTable([FIXTURE]);
  const nodes = table.project.nodes;

  function find(pred: (n: IrNode) => boolean): IrNode[] {
    return nodes.filter(pred);
  }

  it('records function definitions with scope', () => {
    const defs = find((n) => n.kind === 'function' && n.name === 'helper');
    expect(defs).toHaveLength(1);
    expect(defs[0].scopePath.map((s) => s.kind)).toEqual(['module', 'package']);
  });

  it('records nested function definitions with innermost-first scope chain', () => {
    const defs = find((n) => n.kind === 'function' && n.name === 'inner');
    expect(defs).toHaveLength(1);
    expect(defs[0].scopePath.map((s) => [s.kind, s.name])).toEqual([
      ['function', 'outer'],
      ['module', expect.stringContaining('basic.ts')],
      ['package', expect.anything()],
    ]);
  });

  it('records parameter definitions', () => {
    const defs = find((n) => n.kind === 'parameter' && n.name === 'a');
    expect(defs).toHaveLength(1);
  });

  it('records references and resolves them to symbols', () => {
    const refs = find((n) => n.kind === 'reference' && n.name === 'helper');
    expect(refs.length).toBeGreaterThanOrEqual(1);
    for (const ref of refs) {
      expect(table.refIdToSymbol.has(ref.id)).toBe(true);
    }
  });

  it('does not record property-access names as plain references', () => {
    const refs = find((n) => n.kind === 'reference' && n.name === 'method');
    expect(refs).toHaveLength(0);
  });

  it('has no edges yet', () => {
    expect(table.project.edges).toHaveLength(0);
  });
});
