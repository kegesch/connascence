import { describe, it, expect } from 'vitest';
import {
  SCORE_VERSION,
  gini,
  moduleDepth,
  qualityScore,
  type ScoreAxisKey,
} from '../../../src/core/scoring/quality.ts';
import type { ScanReport, ScoredEdge, ProjectStats } from '../../../src/core/scoring/score.ts';
import { scan, type ScanBackend } from '../../../src/core/scan.ts';

function edge(from: string, to: string, over: Partial<ScoredEdge> = {}): ScoredEdge {
  const [fromFile, fromName] = from.split(':');
  const [toFile, toName] = to.split(':');
  return {
    nodeA: { id: `ref:${from}:${to}`, kind: 'reference', name: fromName, filePath: fromFile, startLine: 1 },
    nodeB: { id: `def:${to}`, kind: 'function', name: toName, filePath: toFile, startLine: 1 },
    connascenceType: 'name',
    strength: 1,
    locality: 5,
    degree: 1,
    pressure: 0.1,
    evidence: '',
    heuristic: false,
    ...over,
  };
}

function report(edges: ScoredEdge[], over: Partial<ScanReport> = {}): ScanReport {
  return {
    summary: {},
    edges,
    cycles: [],
    levelization: { entries: [], depth: 1, components: 1, cyclic: false },
    ...over,
  };
}

function stats(over: Partial<ProjectStats> = {}): ProjectStats {
  return {
    files: [],
    definitionsByFile: {},
    definitions: 0,
    hashableDefinitions: 0,
    duplicateDefinitions: 0,
    ...over,
  };
}

function axis(r: ScanReport, key: ScoreAxisKey) {
  return qualityScore(r, 'test').components.find((c) => c.key === key)!;
}

describe('gini', () => {
  it('is 0 for equal values and rises with concentration', () => {
    expect(gini([2, 2, 2, 2])).toBe(0);
    expect(gini([0, 0, 0, 10])).toBeGreaterThan(0.5);
    expect(gini([])).toBe(0);
  });
});

describe('qualityScore', () => {
  it('is deterministic and spans seven normalized axes', () => {
    const r = report([]);
    const a = qualityScore(r, 'h');
    const b = qualityScore(r, 'h');
    expect(a).toEqual(b);
    expect(a.scoreVersion).toBe(SCORE_VERSION);
    expect(a.components.map((c) => c.key)).toEqual([
      'acyclicity',
      'levelization',
      'encapsulation',
      'equality',
      'redundancy',
      'cohesion',
      'coupling',
    ]);
    expect(a.score).toBe(10000);
    expect(a.components.every((c) => c.value >= 0 && c.value <= 1)).toBe(true);
  });

  it('is same-input-same-score regardless of edge insertion order', () => {
    const edges = [
      edge('a1:x', 'a2:y', { strength: 9 }),
      edge('a2:y', 'a1:x', { strength: 9 }),
      edge('b1:x', 'b2:y', { strength: 9 }),
      edge('b1:x', 'a1:x', { strength: 1 }),
    ];
    expect(qualityScore(report(edges), 'h')).toEqual(qualityScore(report([...edges].reverse()), 'h'));
  });

  it('tanks the scalar when a resolved cycle exists', () => {
    const cycle = { files: ['a', 'b'], members: [], edges: [], worst: edge('a:x', 'b:y') };
    const r = report([], { cycles: [cycle] as never });
    const q = qualityScore(r, 'h');
    expect(axis(r, 'acyclicity').value).toBe(0);
    expect(q.score).toBe(0);
  });

  it('normalizes levelization depth against the worst chain', () => {
    const r = report([], {
      levelization: { entries: [], depth: 3, components: 5, cyclic: false },
    });
    expect(axis(r, 'levelization').value).toBeCloseTo(0.5, 4);
  });

});

describe('quality axes', () => {
  it('pairs gini with a level term so uniform complexity is not perfect equality', () => {
    const small = report([], {
      stats: stats({
        files: ['a', 'b', 'c', 'd'],
        definitionsByFile: { a: 1, b: 1, c: 1, d: 1 },
        definitions: 4,
      }),
    });
    const huge = report([], {
      stats: stats({
        files: ['a', 'b', 'c', 'd'],
        definitionsByFile: { a: 10, b: 10, c: 10, d: 10 },
        definitions: 40,
      }),
    });
    expect(axis(small, 'equality').value).toBeGreaterThan(axis(huge, 'equality').value);
    expect(axis(huge, 'equality').value).toBeCloseTo(0.5, 4);
    expect(axis(huge, 'equality').value).toBeLessThan(1);
  });

  it('reports duplicate structural definitions as redundancy', () => {
    const r = report([], {
      stats: stats({ hashableDefinitions: 10, duplicateDefinitions: 2 }),
    });
    expect(axis(r, 'redundancy').value).toBeCloseTo(0.8, 4);
  });

  it('scores the internal share of dependency mass in the Louvain partition', () => {
    const twoCliques = report([
      edge('a1:x', 'a2:y', { strength: 9 }),
      edge('a2:y', 'a1:x', { strength: 9 }),
      edge('b1:x', 'b2:y', { strength: 9 }),
      edge('b2:y', 'b1:x', { strength: 9 }),
      edge('a1:x', 'b1:x', { strength: 1 }),
    ]);
    const oneBlock = report([
      edge('a1:x', 'a2:y'),
      edge('a2:y', 'b1:x'),
      edge('b1:x', 'b2:y'),
      edge('b2:y', 'a1:x'),
    ]);
    expect(axis(twoCliques, 'cohesion').value).toBeGreaterThan(axis(oneBlock, 'cohesion').value);
    expect(axis(twoCliques, 'cohesion').value).toBeLessThanOrEqual(1);
  });

  it('uses the worst decile so weak name imports cannot dilute severe edges', () => {
    const weak = report(Array.from({ length: 20 }, (_, i) => edge(`a${i}:x`, `b${i}:y`, { pressure: 0.05 })));
    const severe = report([
      ...Array.from({ length: 20 }, (_, i) => edge(`a${i}:x`, `b${i}:y`, { pressure: 0.05 })),
      edge('bad:x', 'bad:y', { pressure: 0.9, heuristic: true }),
    ]);
    expect(axis(severe, 'coupling').value).toBeLessThan(axis(weak, 'coupling').value);
  });

  it('does not let outgoing dependencies widen a module interface', () => {
    const dep = [
      edge('m/a.ts:caller', 'm/b.ts:helper'),
      edge('outside:caller', 'm/b.ts:api', { strength: 1 }),
    ];
    const depth = moduleDepth(['m/a.ts', 'm/b.ts'], dep.map((e) => ({ ...e, connascenceType: 'name' })));
    expect(depth.value).toBeGreaterThan(0);
    expect(depth.value).toBeLessThan(0.5);
  });

  it('lowers depth as the exported interface gets stronger or more used', () => {
    const privateHelper = edge('m/a.ts:caller', 'm/b.ts:helper');
    const weakApi = edge('outside:caller', 'm/b.ts:api', { strength: 1 });
    const strongApi = edge('outside:caller', 'm/b.ts:api', { strength: 9 });
    const files = ['m/a.ts', 'm/b.ts'];
    const weak = moduleDepth(files, [privateHelper, weakApi]);
    const strong = moduleDepth(files, [privateHelper, strongApi]);
    expect(strong.value).toBeLessThan(weak.value);
  });

  it('counts only private behavior as functionality', () => {
    const dep = [
      edge('outside:caller', 'm/b.ts:helper'),
      edge('m/a.ts:caller', 'm/b.ts:helper'),
    ];
    const depth = moduleDepth(['m/a.ts', 'm/b.ts'], dep);
    expect(depth.value).toBe(0);
  });
});

describe('scan integration', () => {
  const backend: ScanBackend = {
    build: () => ({
      project: { nodes: [], edges: [] },
      refIdToDefId: new Map(),
      adapter: { resolveType: () => undefined, isStringUnionMember: () => false },
    }),
  };

  it('attaches the score and stamps the effective config hash', () => {
    const clean = scan([], {}, backend);
    const configured = scan([], { thresholds: { name: 1 } }, backend);
    expect(clean.quality).toMatchObject({ scoreVersion: SCORE_VERSION, score: 10000 });
    expect(clean.stats).toMatchObject({ files: [], definitions: 0 });
    expect(configured.quality?.configHash).not.toBe(clean.quality?.configHash);
  });
});

