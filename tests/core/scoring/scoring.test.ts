import { describe, it, expect } from 'vitest';
import { strengthOf } from '../../../src/core/scoring/strength.ts';
import { localityOf } from '../../../src/core/scoring/locality.ts';
import { degreeMap } from '../../../src/core/scoring/degree.ts';
import type { IrNode, IrProject } from '../../../src/core/ir.ts';

const modA = { kind: 'module', name: 'a.ts' };
const modB = { kind: 'module', name: 'b.ts' };

function node(scopePath: IrNode['scopePath'], id = 'n'): IrNode {
  return {
    id,
    kind: 'function',
    name: id,
    scopePath,
    location: { filePath: scopePath[scopePath.length - 1].name, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
  };
}

describe('strength', () => {
  it('ranks name weakest and identity strongest', () => {
    expect(strengthOf('name')).toBeLessThan(strengthOf('position'));
    expect(strengthOf('position')).toBeLessThan(strengthOf('identity'));
  });
});

describe('locality', () => {
  it('same function scope = 1', () => {
    const a = node([{ kind: 'function', name: 'f' }, modA]);
    const b = node([{ kind: 'function', name: 'f' }, modA]);
    expect(localityOf(a, b)).toBe(1);
  });

  it('same module, different functions = 3', () => {
    const a = node([{ kind: 'function', name: 'f' }, modA]);
    const b = node([{ kind: 'function', name: 'g' }, modA]);
    expect(localityOf(a, b)).toBe(3);
  });

  it('different modules = 4 or more', () => {
    const a = node([modA]);
    const b = node([modB]);
    expect(localityOf(a, b)).toBeGreaterThanOrEqual(4);
  });
});

describe('degree', () => {
  it('counts edges per node', () => {
    const project: IrProject = {
      nodes: [],
      edges: [
        { nodeA: 'x', nodeB: 'y', connascenceType: 'name', evidence: '' },
        { nodeA: 'z', nodeB: 'x', connascenceType: 'name', evidence: '' },
        { nodeA: 'x', nodeB: 'w', connascenceType: 'position', evidence: '' },
      ],
    };
    expect(degreeMap(project).get('x')).toBe(3);
    expect(degreeMap(project, 'position').get('x')).toBe(1);
    expect(degreeMap(project, 'position').get('y')).toBeUndefined();
  });
});
