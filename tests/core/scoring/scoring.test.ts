import { describe, it, expect } from 'vitest';
import { strengthOf } from '../../../src/core/scoring/strength.ts';
import { localityOf } from '../../../src/core/scoring/locality.ts';
import { degreeMap } from '../../../src/core/scoring/degree.ts';
import { pressureOf } from '../../../src/core/scoring/pressure.ts';
import { scoreProject } from '../../../src/core/scoring/score.ts';
import { severityOf } from '../../../src/core/report/severity.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';
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

  it('different modules, same directory (package) = 4', () => {
    const pkg = { kind: 'package' as const, name: 'src/a' };
    const a = node([{ kind: 'module', name: 'a.ts' }, pkg]);
    const b = node([{ kind: 'module', name: 'b.ts' }, pkg]);
    expect(localityOf(a, b)).toBe(4);
  });

  it('different packages (directories) = 5', () => {
    const a = node([{ kind: 'module', name: 'a.ts' }, { kind: 'package', name: 'src/a' }]);
    const b = node([{ kind: 'module', name: 'b.ts' }, { kind: 'package', name: 'src/b' }]);
    expect(localityOf(a, b)).toBe(5);
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

  it('scores degree within the same connascence type', () => {
    const a = node([{ kind: 'function', name: 'a' }, modA], 'a');
    const b = node([{ kind: 'function', name: 'b' }, modA], 'b');
    const c = node([{ kind: 'function', name: 'c' }, modA], 'c');
    const project: IrProject = {
      nodes: [a, b, c],
      edges: [
        { nodeA: 'a', nodeB: 'b', connascenceType: 'identity', evidence: '' },
        { nodeA: 'a', nodeB: 'c', connascenceType: 'name', evidence: '' },
        { nodeA: 'b', nodeB: 'c', connascenceType: 'name', evidence: '' },
      ],
    };
    const report = scoreProject(project);
    const identity = report.edges.find((e) => e.connascenceType === 'identity')!;
    const name = report.edges.find((e) => e.connascenceType === 'name')!;
    expect(identity.degree).toBe(1);
    expect(name.degree).toBe(1);
    expect(report.pressure?.total).toBeGreaterThan(0);
    expect(report.pressure?.byType.identity).toBeGreaterThan(0);
  });
});

describe('pressure', () => {
  const base = { strength: 4, locality: 4, degree: 1 };

  it('rises with strength, locality, and same-type breadth', () => {
    expect(pressureOf({ ...base, strength: 9 })).toBeGreaterThan(pressureOf(base));
    expect(pressureOf({ ...base, locality: 5 })).toBeGreaterThan(pressureOf(base));
    expect(pressureOf({ ...base, degree: 10 })).toBeGreaterThan(pressureOf(base));
  });

  it('stays normalized even for a strong, broad edge', () => {
    expect(pressureOf({ strength: 9, locality: 5, degree: 100 })).toBe(1);
  });
});

describe('severityOf', () => {
  const edge = (over: Partial<ScoredEdge>): ScoredEdge => ({
    nodeA: { id: 'a', kind: 'function', name: 'f', filePath: 'a.ts', startLine: 1 },
    nodeB: { id: 'b', kind: 'function', name: 'g', filePath: 'b.ts', startLine: 2 },
    connascenceType: 'name',
    strength: 1,
    locality: 3,
    degree: 1,
    evidence: '',
    heuristic: false,
    ...over,
  });

  it('does not let a broad name import make a weak edge high', () => {
    expect(severityOf(edge({ strength: 1, locality: 5, degree: 20 }))).toBe('low');
  });

  it('keeps deterministic strength/locality high and heuristic pressure capped', () => {
    expect(severityOf(edge({ connascenceType: 'algorithm', strength: 5, locality: 3 }))).toBe('high');
    expect(
      severityOf(
        edge({ connascenceType: 'identity', strength: 9, locality: 5, degree: 1, heuristic: true }),
      ),
    ).toBe('high');
    expect(
      severityOf(
        edge({ connascenceType: 'meaning', strength: 3, locality: 4, degree: 2, heuristic: true }),
      ),
    ).toBe('medium');
  });
});
