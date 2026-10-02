import { describe, it, expect } from 'vitest';
import { dirCohesion, cohesionFix, DirCohesion } from '../../../src/core/report/cohesion.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';

function dep(fromFile: string, toFile: string): ScoredEdge {
  return {
    nodeA: { id: fromFile + ':ref', kind: 'function', name: 'ref', filePath: fromFile, startLine: 1 },
    nodeB: { id: toFile + ':def', kind: 'function', name: 'def', filePath: toFile, startLine: 2 },
    connascenceType: 'name',
    strength: 1,
    locality: 5,
    degree: 1,
    evidence: 'reference',
    heuristic: false,
  };
}

describe('dirCohesion', () => {
  it('flags a junk-drawer directory reached into from many directories', () => {
    const edges = [
      // three outside directories referencing into shared/
      dep('app/a/x.ts', 'shared/util.ts'),
      dep('app/b/y.ts', 'shared/util.ts'),
      dep('app/c/z.ts', 'shared/format.ts'),
      dep('app/d/w.ts', 'shared/encode.ts'),
      // internal edges
      dep('shared/util.ts', 'shared/format.ts'),
      dep('shared/format.ts', 'shared/encode.ts'),
    ];
    const result = dirCohesion(edges);
    const shared = result.find((c) => c.dir === 'shared');
    expect(shared).toBeDefined();
    expect(shared!.externalFanIn).toBe(4);
    expect(shared!.externalEdges).toBe(4);
    expect(shared!.internalEdges).toBe(2);
  });

  it('detects disconnected clusters inside one directory as split candidates', () => {
    const edges = [
      // cluster 1: fetch + history reference each other
      dep('mod/fetch.ts', 'mod/history.ts'),
      dep('mod/history.ts', 'mod/fetch.ts'),
      // cluster 2: parse + emit reference each other, but never cluster 1
      dep('mod/parse.ts', 'mod/emit.ts'),
      dep('mod/emit.ts', 'mod/parse.ts'),
      // enough external traffic to be report-worthy (3 distinct directories reach in)
      dep('out/one.ts', 'mod/fetch.ts'),
      dep('out2/two.ts', 'mod/parse.ts'),
      dep('out3/three.ts', 'mod/emit.ts'),
    ];
    const result = dirCohesion(edges);
    const mod = result.find((c) => c.dir === 'mod');
    expect(mod).toBeDefined();
    expect(mod!.clusters.length).toBe(2);
    const fix = cohesionFix(mod!);
    expect(fix.some((l) => l.includes('disconnected file groups'))).toBe(true);
    expect(fix.some((l) => l.includes('reach into'))).toBe(true);
  });

  it('ignores small directories and well-connected single-cluster modules', () => {
    const edges = [
      dep('tiny/a.ts', 'tiny/b.ts'),
      dep('ok/a.ts', 'ok/b.ts'),
      dep('ok/b.ts', 'ok/c.ts'),
      dep('out/x.ts', 'ok/a.ts'),
    ];
    expect(dirCohesion(edges)).toHaveLength(0);
  });

  it('ignores heuristic-only edges as structure evidence', () => {
    const e: ScoredEdge = {
      ...dep('app/a/x.ts', 'shared/util.ts'),
      connascenceType: 'meaning',
      heuristic: true,
    };
    expect(dirCohesion([e, e, e, e])).toHaveLength(0);
  });
});

describe('cohesionFix', () => {
  it('yields no advice for a healthy module', () => {
    const c: DirCohesion = {
      dir: 'mod', files: 5, internalEdges: 10, externalEdges: 2, externalFanIn: 1,
      clusters: [['mod/a.ts', 'mod/b.ts']],
    };
    expect(cohesionFix(c)).toHaveLength(0);
  });
});
