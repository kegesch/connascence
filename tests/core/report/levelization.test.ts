// Lakos levelization fixtures: the metric is the longest dependency chain, not
// the sum of dependencies (a diamond is three levels, not four) and not
// Ousterhout depth. Cycles collapse to one SCC with one shared level.
import { describe, it, expect } from 'vitest';
import { fileLevelization, levelize } from '../../../src/core/report/levelization.ts';
import { renderLevelization } from '../../../src/core/report/levelizationRender.ts';
import type { Adjacency } from '../../../src/core/report/scc.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';

function graph(entries: Record<string, string[]>): Adjacency {
  return new Map(
    Object.entries(entries).map(([name, deps]) => [name, new Set(deps)]),
  );
}

function edge(
  from: string,
  to: string,
  opts: { type?: ScoredEdge['connascenceType']; resolved?: boolean } = {},
): ScoredEdge {
  return {
    nodeA: { id: `${from}:ref`, kind: 'reference', name: 'ref', filePath: from, startLine: 1 },
    nodeB: { id: `${to}:def`, kind: 'function', name: 'def', filePath: to, startLine: 1 },
    connascenceType: opts.type ?? 'name',
    strength: 1,
    locality: 1,
    degree: 1,
    evidence: 'test',
    heuristic: false,
    resolved: opts.resolved ?? true,
  };
}

describe('levelize', () => {
  it('assigns 1 + max(dependency level), foundation first', () => {
    const result = levelize(graph({ app: ['core'], core: ['shared'], shared: [] }));
    expect(result.depth).toBe(3);
    expect(result.components).toBe(3);
    expect(result.cyclic).toBe(false);
    expect(result.entries).toEqual([
      { name: 'app', level: 3 },
      { name: 'core', level: 2 },
      { name: 'shared', level: 1 },
    ]);
  });

  it('uses the longest chain in a diamond, not the number of dependencies', () => {
    const result = levelize(
      graph({ app: ['api', 'store'], api: ['model'], store: ['model'], model: [] }),
    );
    expect(result.depth).toBe(3);
    expect(Object.fromEntries(result.entries.map((e) => [e.name, e.level]))).toEqual({
      app: 3,
      api: 2,
      model: 1,
      store: 2,
    });
  });

  it('collapses a cycle into one component and marks it cyclic', () => {
    const result = levelize(graph({ a: ['b'], b: ['a', 'c'], c: [] }));
    expect(result.cyclic).toBe(true);
    expect(result.components).toBe(2);
    expect(result.depth).toBe(2);
    expect(Object.fromEntries(result.entries.map((e) => [e.name, e.level]))).toEqual({
      a: 2,
      b: 2,
      c: 1,
    });
  });

  it('ignores self-references (not a structural cycle)', () => {
    const result = levelize(graph({ a: ['a', 'b'], b: [] }));
    expect(result.cyclic).toBe(false);
    expect(result.depth).toBe(2);
    expect(result.entries).toEqual([
      { name: 'a', level: 2 },
      { name: 'b', level: 1 },
    ]);
  });

  it('is deterministic for equal levels', () => {
    const result = levelize(graph({ z: [], b: [], a: [] }));
    expect(result.entries.map((e) => e.name)).toEqual(['a', 'b', 'z']);
  });

  it('returns an empty report for an empty graph', () => {
    expect(levelize(new Map())).toEqual({
      entries: [],
      depth: 0,
      components: 0,
      cyclic: false,
    });
  });
});

describe('fileLevelization', () => {
  it('uses only adapter-resolved name edges', () => {
    const result = fileLevelization([
      edge('src/a.ts', 'src/b.ts'),
      edge('src/b.ts', 'src/c.ts'),
      edge('src/a.ts', 'src/c.ts', { resolved: false }),
      edge('src/c.ts', 'src/a.ts', { type: 'position' }),
    ]);
    expect(result.depth).toBe(3);
    expect(result.entries.map((e) => e.name)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });

  it('collapses a file cycle and reports cyclic', () => {
    const result = fileLevelization([
      edge('src/a.ts', 'src/b.ts'),
      edge('src/b.ts', 'src/a.ts'),
    ]);
    expect(result.cyclic).toBe(true);
    expect(result.components).toBe(1);
    expect(result.depth).toBe(1);
  });
});

describe('renderLevelization', () => {
  it('leads with depth and lists the deepest components', () => {
    const lines = renderLevelization(
      {
        entries: [
          { name: 'a', level: 3 },
          { name: 'b', level: 2 },
          { name: 'c', level: 1 },
        ],
        depth: 3,
        components: 3,
        cyclic: false,
      },
      (p) => p,
      2,
    );
    expect(lines[0]).toContain('depth 3');
    expect(lines[1]).toContain('a (3)');
    expect(lines[1]).toContain('…');
  });
});
