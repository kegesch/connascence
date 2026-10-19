// Cycle findings are accusations, so the fixtures pin the §7 rule: only
// adapter-resolved name edges may form a cycle. A name-matched (unresolved)
// graph must produce nothing, or every `render`/`handle` collision becomes a
// phantom dependency cycle.
import { describe, it, expect } from 'vitest';
import { findFileCycles } from '../../../src/core/report/cycles.ts';
import { stronglyConnected } from '../../../src/core/report/scc.ts';
import { clusterFindings } from '../../../src/core/report/findings.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';

function dep(
  from: string,
  to: string,
  opts: { resolved?: boolean; type?: ScoredEdge['connascenceType'] } = {},
): ScoredEdge {
  return {
    nodeA: { id: `${from}->${to}:ref`, kind: 'reference', name: `${to}-ref`, filePath: from, startLine: 10 },
    nodeB: { id: `${to}:def`, kind: 'function', name: `${to}-def`, filePath: to, startLine: 20 },
    connascenceType: opts.type ?? 'name',
    strength: 1,
    locality: 5,
    degree: 1,
    evidence: 'reference',
    heuristic: false,
    resolved: opts.resolved ?? true,
  };
}

describe('findFileCycles', () => {
  it('reports a two-file cycle once, with one member per file', () => {
    const cycles = findFileCycles([dep('a.ts', 'b.ts'), dep('b.ts', 'a.ts')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].files).toEqual(['a.ts', 'b.ts']);
    expect(cycles[0].edges).toHaveLength(2);
    expect(cycles[0].members).toHaveLength(2);
    expect(cycles[0].worst.nodeB.filePath).toMatch(/^[ab]\.ts$/);
  });

  it('reports a three-file cycle as one SCC, closed for readability', () => {
    const cycles = findFileCycles([dep('a.ts', 'b.ts'), dep('b.ts', 'c.ts'), dep('c.ts', 'a.ts')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('collapses overlapping loops into the same component', () => {
    // a<->b and b<->c and c<->a are three back-edge loops but one SCC
    const cycles = findFileCycles([
      dep('a.ts', 'b.ts'), dep('b.ts', 'a.ts'),
      dep('b.ts', 'c.ts'), dep('c.ts', 'b.ts'),
      dep('c.ts', 'a.ts'), dep('a.ts', 'c.ts'),
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('does not report a one-way dependency chain', () => {
    expect(findFileCycles([dep('a.ts', 'b.ts'), dep('b.ts', 'c.ts'), dep('c.ts', 'd.ts')])).toEqual([]);
  });

  it('ignores unresolved name edges and non-name edges', () => {
    const unresolved = [dep('a.ts', 'b.ts', { resolved: false }), dep('b.ts', 'a.ts', { resolved: false })];
    expect(findFileCycles(unresolved)).toEqual([]);
    const positional = [
      dep('a.ts', 'b.ts', { type: 'position', resolved: true }),
      dep('b.ts', 'a.ts', { type: 'position', resolved: true }),
    ];
    expect(findFileCycles(positional)).toEqual([]);
  });

  it('ignores a file referencing its own definitions', () => {
    expect(findFileCycles([dep('a.ts', 'a.ts')])).toEqual([]);
  });

  it('is deterministic regardless of edge order', () => {
    const edges = [dep('b.ts', 'c.ts'), dep('a.ts', 'b.ts'), dep('c.ts', 'a.ts'), dep('x.ts', 'y.ts')];
    const first = findFileCycles(edges);
    const second = findFileCycles([...edges].reverse());
    expect(second).toEqual(first);
  });

  it('orders multiple cycles widest first', () => {
    const cycles = findFileCycles([
      dep('a.ts', 'b.ts'), dep('b.ts', 'a.ts'),
      dep('x.ts', 'y.ts'), dep('y.ts', 'z.ts'), dep('z.ts', 'x.ts'),
    ]);
    expect(cycles.map((c) => c.files.length)).toEqual([3, 2]);
  });
});

describe('stronglyConnected', () => {
  it('includes singleton components and sorts members', () => {
    const components = stronglyConnected(new Map([
      ['b', new Set(['a'])],
      ['a', new Set(['b'])],
      ['c', new Set()],
    ]));
    expect(components).toEqual([['a', 'b'], ['c']]);
  });
});

describe('cycle findings', () => {
  it('becomes a high-severity finding with a concrete fix', () => {
    const edges = [dep('src/a.ts', 'src/b.ts'), dep('src/b.ts', 'src/a.ts')];
    const findings = clusterFindings(edges, findFileCycles(edges));
    const cycle = findings.find((f) => f.kind === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle!.severity).toBe('high');
    expect(cycle!.summary).toContain('<->');
    expect(cycle!.fix).toContain('break the cycle');
    expect(cycle!.members.map((m) => m.filePath).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('demotes a cycle that only involves test files', () => {
    const edges = [dep('a.test.ts', 'b.test.ts'), dep('b.test.ts', 'a.test.ts')];
    const cycle = clusterFindings(edges, findFileCycles(edges)).find((f) => f.kind === 'cycle');
    expect(cycle!.severity).toBe('low');
  });
});
