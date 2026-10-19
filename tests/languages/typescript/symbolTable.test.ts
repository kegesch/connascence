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

describe('structural identity (M3a)', () => {
  const table = buildSymbolTable([FIXTURE]);
  const nodes = table.project.nodes;
  const helper = nodes.find((n) => n.kind === 'function' && n.name === 'helper')!;
  const inner = nodes.find((n) => n.kind === 'function' && n.name === 'inner')!;

  it('gives function definitions a structure-based identity', () => {
    expect(helper.identityHash).toBe(helper.structureHash);
    expect(helper.identityHash).toBeTruthy();
  });

  it('derives parameter identity from the owner and slot', () => {
    const params = nodes.filter((n) => n.kind === 'parameter' && n.parentId === helper.id);
    expect(params.map((p) => p.identityHash)).toEqual([
      `${helper.identityHash}#p0`,
      `${helper.identityHash}#p1`,
    ]);
  });

  it('derives argument identity from the callee identity and slot', () => {
    const args = nodes
      .filter((n) => n.kind === 'argument')
      .sort((a, b) => a.location.startLine - b.location.startLine || a.location.startColumn - b.location.startColumn);
    expect(args.length).toBeGreaterThanOrEqual(2);
    expect(args[0].identityHash).toBe(`${helper.identityHash}#a0`);
    expect(args[1].identityHash).toBe(`${helper.identityHash}#a1`);
  });

  it('derives reference identity from the enclosing definition', () => {
    const ref = nodes.find((n) => n.kind === 'reference' && n.name === 'helper' && n.ownerDefId === inner.id);
    expect(ref?.identityHash).toBe(`ref@${inner.identityHash}`);
  });

  it('drops identity for structurally identical definitions (ambiguity rule)', () => {
    // `helper` and `renamedHelper` are clones; keying them by structure would
    // collapse their edges and hide coupling added inside the new clone
    const both = buildSymbolTable([FIXTURE, 'tests/fixtures/symboltable/renamed.ts']);
    const defs = both.project.nodes.filter(
      (n) => n.kind === 'function' && (n.name === 'helper' || n.name === 'renamedHelper'),
    );
    expect(defs).toHaveLength(2);
    expect(defs.map((n) => n.identityHash)).toEqual([undefined, undefined]);
    const params = both.project.nodes.filter((n) => n.kind === 'parameter' && n.name === 'a');
    expect(params.length).toBe(2);
    expect(params.every((p) => p.identityHash === undefined)).toBe(true);
  });

  it('keeps the identity stable when the function is renamed', () => {
    // structureHash abstracts identifiers, so a different name in a different
    // file yields the same identity (the documented clone-collision property)
    const renamed = buildSymbolTable(['tests/fixtures/symboltable/renamed.ts']);
    const alias = renamed.project.nodes.find((n) => n.kind === 'function')!;
    expect(alias.name).toBe('renamedHelper');
    expect(alias.identityHash).toBe(helper.identityHash);
  });
});
