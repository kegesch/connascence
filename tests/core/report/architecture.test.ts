import { describe, it, expect } from 'vitest';
import {
  architectureReport,
  fileClusters,
  architectureLevels,
  layering,
} from '../../../src/core/report/architecture.ts';
import {
  renderArchitecture,
  renderArchitectureLevels,
} from '../../../src/core/report/architectureRender.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';

function dep(fromFile: string, toFile: string, opts: { strength?: number; type?: ScoredEdge['connascenceType']; heuristic?: boolean } = {}): ScoredEdge {
  return {
    nodeA: { id: fromFile + ':ref', kind: 'reference', name: 'ref', filePath: fromFile, startLine: 1 },
    nodeB: { id: toFile + ':def', kind: 'function', name: 'def', filePath: toFile, startLine: 2 },
    connascenceType: opts.type ?? 'name',
    strength: opts.strength ?? 1,
    locality: 5,
    degree: 1,
    evidence: 'reference',
    heuristic: opts.heuristic ?? false,
  };
}

describe('fileClusters', () => {
  it('groups densely connected files into one module, disconnected ones into another', () => {
    // module A: three files with mutual references (weight 4)
    // module B: two files referencing each other (weight 2); no A<->B edges
    const edges = [
      dep('src/a/one.ts', 'src/a/two.ts'),
      dep('src/a/two.ts', 'src/a/three.ts'),
      dep('src/a/three.ts', 'src/a/one.ts'),
      dep('src/a/one.ts', 'src/a/two.ts'),
      dep('src/b/x.ts', 'src/b/y.ts'),
      dep('src/b/y.ts', 'src/b/x.ts'),
    ];
    const clusters = fileClusters(edges);
    expect(clusters).toHaveLength(2);
    const names = clusters.map((c) => c.name).sort();
    expect(names).toEqual(['src/a', 'src/b']);
    const a = clusters.find((c) => c.name === 'src/a')!;
    expect(a.files).toHaveLength(3);
  });

  it('merges a weakly-linked chain and flags it as a structure mismatch', () => {
    // entry -> core chain with a single weak edge to an out-of-place file
    const edges = [
      dep('app/ui.ts', 'app/logic.ts', { strength: 3 }),
      dep('app/logic.ts', 'app/ui.ts', { strength: 3 }),
      dep('app/logic.ts', 'domain/model.ts', { strength: 1 }),
    ];
    const r = architectureReport(edges);
    // the chain forms one connected module that spans two directories:
    // the graph reveals domain/model.ts does not belong where the folders say
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0].files).toContain('domain/model.ts');
    expect(r.cycles).toHaveLength(0);
  });

  it('flags a module that spans multiple directories (structure mismatch)', () => {
    // one dense module deliberately spread over two folders
    const edges = [
      dep('src/handlers/create.ts', 'src/core/order.ts', { strength: 3 }),
      dep('src/core/order.ts', 'src/handlers/create.ts', { strength: 3 }),
      dep('src/handlers/create.ts', 'src/core/pricing.ts', { strength: 3 }),
      dep('src/core/pricing.ts', 'src/handlers/create.ts', { strength: 3 }),
    ];
    const clusters = fileClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].dirs.length).toBe(2);
    expect(clusters[0].name).toBe('src+…');
  });

  it('ignores heuristic-only edges as structure evidence', () => {
    const e = dep('a/x.ts', 'b/y.ts', { type: 'value', heuristic: true });
    expect(fileClusters([e, e, e])).toHaveLength(0);
  });

  it('returns no clusters for an empty edge list', () => {
    expect(fileClusters([])).toHaveLength(0);
  });
});

describe('architectureReport', () => {
  it('aggregates cross-module dependencies weighted by strength', () => {
    const edges = [
      // two dense modules with cross edges app -> core
      dep('app/main.ts', 'app/boot.ts', { strength: 5 }),
      dep('app/boot.ts', 'app/main.ts', { strength: 5 }),
      dep('core/engine.ts', 'core/util.ts', { strength: 5 }),
      dep('core/util.ts', 'core/engine.ts', { strength: 5 }),
      dep('app/main.ts', 'core/engine.ts', { strength: 2 }),
      dep('app/main.ts', 'core/util.ts'),
    ];
    const r = architectureReport(edges);
    expect(r.clusters).toBe(2);
    expect(r.dependencies).toHaveLength(1);
    expect(r.dependencies[0].edges).toBe(2);
    expect(r.dependencies[0].weight).toBe(3);
  });

  it('detects tangles: modules coupled in both directions', () => {
    const edges = [
      // dense intra-module triangles keep the two modules internally cohesive
      dep('a/x.ts', 'a/z.ts', { strength: 5 }),
      dep('a/z.ts', 'a/y.ts', { strength: 5 }),
      dep('a/y.ts', 'a/x.ts', { strength: 5 }),
      dep('b/x.ts', 'b/z.ts', { strength: 5 }),
      dep('b/z.ts', 'b/y.ts', { strength: 5 }),
      dep('b/y.ts', 'b/x.ts', { strength: 5 }),
      // cross edges in both directions
      dep('a/x.ts', 'b/y.ts'),
      dep('a/x.ts', 'b/y.ts'),
      dep('b/y.ts', 'a/x.ts'),
    ];
    const r = architectureReport(edges);
    expect(r.tangles).toHaveLength(1);
    const t = r.tangles[0];
    expect(new Set([t.a, t.b]).size).toBe(2);
    expect(t.forward.edges).toBe(2);
    expect(t.backward.edges).toBe(1);
  });

  it('detects longer module dependency cycles', () => {
    const edges = [
      // three internally-dense modules with a cross-module cycle a -> b -> c -> a
      dep('a/1.ts', 'a/2.ts', { strength: 9 }), dep('a/2.ts', 'a/1.ts', { strength: 9 }),
      dep('b/1.ts', 'b/2.ts', { strength: 9 }), dep('b/2.ts', 'b/1.ts', { strength: 9 }),
      dep('c/1.ts', 'c/2.ts', { strength: 9 }), dep('c/2.ts', 'c/1.ts', { strength: 9 }),
      dep('a/1.ts', 'b/1.ts', { strength: 1 }),
      dep('b/1.ts', 'c/1.ts', { strength: 1 }),
      dep('c/1.ts', 'a/1.ts', { strength: 1 }),
    ];
    const r = architectureReport(edges);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]).toHaveLength(4); // a -> b -> c -> a
    expect(r.tangles).toHaveLength(0); // no direct two-way pair
  });

  it('reports a two-module loop as a tangle, not a separate cycle', () => {
    const edges = [
      dep('a/x.ts', 'a/z.ts', { strength: 5 }),
      dep('a/z.ts', 'a/y.ts', { strength: 5 }),
      dep('a/y.ts', 'a/x.ts', { strength: 5 }),
      dep('b/x.ts', 'b/z.ts', { strength: 5 }),
      dep('b/z.ts', 'b/y.ts', { strength: 5 }),
      dep('b/y.ts', 'b/x.ts', { strength: 5 }),
      dep('a/x.ts', 'b/y.ts'),
      dep('b/y.ts', 'a/x.ts'),
    ];
    const r = architectureReport(edges);
    expect(r.tangles).toHaveLength(1);
    expect(r.cycles).toHaveLength(0);
    // the tangle still blocks layering
    expect(layering(r)).toBeNull();
  });

  it('reports no cycles for a strictly layered dependency direction', () => {
    const edges = [
      dep('ui/view.ts', 'app/controller.ts'),
      dep('app/controller.ts', 'domain/model.ts'),
      dep('domain/model.ts', 'shared/util.ts'),
    ];
    const r = architectureReport(edges);
    expect(r.cycles).toHaveLength(0);
    expect(r.tangles).toHaveLength(0);
  });

  it('flags structure mismatches: detected modules spanning multiple directories', () => {
    const edges = [
      dep('src/handlers/create.ts', 'src/core/order.ts', { strength: 3 }),
      dep('src/core/order.ts', 'src/handlers/create.ts', { strength: 3 }),
      dep('src/handlers/create.ts', 'src/core/pricing.ts', { strength: 3 }),
      dep('src/core/pricing.ts', 'src/handlers/create.ts', { strength: 3 }),
      // a healthy single-dir module
      dep('src/cli/run.ts', 'src/cli/args.ts', { strength: 3 }),
      dep('src/cli/args.ts', 'src/cli/run.ts', { strength: 3 }),
    ];
    const r = architectureReport(edges);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0].files.sort()).toEqual(
      ['src/core/order.ts', 'src/core/pricing.ts', 'src/handlers/create.ts'].sort(),
    );
  });
});

describe('architectureLevels (submodule hierarchy)', () => {
  it('detects submodules the coarse level merges away, and reports each level separately', () => {
    // two dense modules (a: one/two, b: one/two) with weak cross traffic BOTH ways:
    // fine level sees modules a and b with a tangle; contracted level merges
    // them into one macro-module where the tangle disappears
    const edges = [
      dep('src/a/one.ts', 'src/a/two.ts', { strength: 9 }), dep('src/a/two.ts', 'src/a/one.ts', { strength: 9 }),
      dep('src/b/one.ts', 'src/b/two.ts', { strength: 9 }), dep('src/b/two.ts', 'src/b/one.ts', { strength: 9 }),
      dep('src/a/one.ts', 'src/b/one.ts'), dep('src/b/one.ts', 'src/a/one.ts'),
    ];
    const levels = architectureLevels(edges);
    expect(levels.length).toBeGreaterThanOrEqual(2);
    const fine = levels[0];
    expect(fine.clusters).toBe(2);
    expect(fine.tangles).toHaveLength(1); // submodule-level tangle is visible here
    const coarse = levels[levels.length - 1];
    expect(coarse.clusters).toBe(1);
    expect(coarse.tangles).toHaveLength(0); // merged away at macro level
  });

  it('renders every level with the same rules applied', () => {
    const edges = [
      dep('src/a/one.ts', 'src/a/two.ts', { strength: 9 }), dep('src/a/two.ts', 'src/a/one.ts', { strength: 9 }),
      dep('src/b/one.ts', 'src/b/two.ts', { strength: 9 }), dep('src/b/two.ts', 'src/b/one.ts', { strength: 9 }),
      dep('src/a/one.ts', 'src/b/one.ts'), dep('src/b/one.ts', 'src/a/one.ts'),
    ];
    const lines = renderArchitectureLevels(architectureLevels(edges), (p) => p);
    expect(lines.some((l) => l.includes('top level'))).toBe(true);
    expect(lines.filter((l) => l.includes('submodule level')).length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.startsWith('verdict:'))).toBe(true);
  });
});

describe('layering', () => {
  // four internally-dense modules with strictly one-way deps: cli -> app -> core -> shared
  function layered(): ScoredEdge[] {
    return [
      dep('cli/run.ts', 'cli/args.ts', { strength: 9 }), dep('cli/args.ts', 'cli/run.ts', { strength: 9 }),
      dep('app/main.ts', 'app/boot.ts', { strength: 9 }), dep('app/boot.ts', 'app/main.ts', { strength: 9 }),
      dep('core/engine.ts', 'core/util.ts', { strength: 9 }), dep('core/util.ts', 'core/engine.ts', { strength: 9 }),
      dep('shared/a.ts', 'shared/b.ts', { strength: 9 }), dep('shared/b.ts', 'shared/a.ts', { strength: 9 }),
      dep('cli/run.ts', 'app/main.ts'),
      dep('app/main.ts', 'core/engine.ts'),
      dep('app/main.ts', 'shared/a.ts'),
      dep('core/engine.ts', 'shared/a.ts'),
    ];
  }

  it('orders acyclic modules into dependency layers, foundation first', () => {
    const layers = layering(architectureReport(layered()));
    expect(layers).not.toBeNull();
    expect(layers).toEqual([['shared'], ['core'], ['app'], ['cli']]);
  });

  it('returns null when cycles make layering impossible', () => {
    const edges = [
      ...layered(),
      dep('shared/a.ts', 'cli/run.ts'), // foundation reaching back to the top breaks the layering
    ];
    expect(layering(architectureReport(edges))).toBeNull();
  });
});

describe('renderArchitecture', () => {
  it('renders an OK line for a healthy graph', () => {
    const r = architectureReport([
      dep('a/1.ts', 'a/2.ts', { strength: 9 }), dep('a/2.ts', 'a/1.ts', { strength: 9 }),
      dep('b/1.ts', 'b/2.ts', { strength: 9 }), dep('b/2.ts', 'b/1.ts', { strength: 9 }),
      dep('a/1.ts', 'b/1.ts'),
    ]);
    const lines = renderArchitecture(r, (p) => p);
    expect(lines[0]).toMatch(/^verdict: layered architecture/);
    expect(lines.some((l) => l.startsWith('layering'))).toBe(true);
    expect(lines.some((l) => l.startsWith('OK:'))).toBe(true);
  });

  it('renders a no-layering verdict when cycles exist', () => {
    const edges = [
      dep('a/1.ts', 'a/2.ts', { strength: 9 }), dep('a/2.ts', 'a/1.ts', { strength: 9 }),
      dep('b/1.ts', 'b/2.ts', { strength: 9 }), dep('b/2.ts', 'b/1.ts', { strength: 9 }),
      dep('a/1.ts', 'b/1.ts'), dep('b/1.ts', 'a/1.ts'),
    ];
    const lines = renderArchitecture(architectureReport(edges), (p) => p);
    expect(lines[0]).toMatch(/^verdict: NO layering possible/);
    expect(lines.some((l) => l.includes('tangles'))).toBe(true);
  });

  it('lists tangles and cycles with fix-style detail', () => {
    const edges = [
      dep('a/1.ts', 'a/2.ts', { strength: 9 }), dep('a/2.ts', 'a/1.ts', { strength: 9 }),
      dep('b/1.ts', 'b/2.ts', { strength: 9 }), dep('b/2.ts', 'b/1.ts', { strength: 9 }),
      dep('c/1.ts', 'c/2.ts', { strength: 9 }), dep('c/2.ts', 'c/1.ts', { strength: 9 }),
      dep('a/1.ts', 'b/1.ts'), dep('b/1.ts', 'a/1.ts'),
      dep('b/1.ts', 'c/1.ts'), dep('c/1.ts', 'a/1.ts'),
    ];
    const lines = renderArchitecture(architectureReport(edges), (p) => p);
    expect(lines.some((l) => l.includes('tangles'))).toBe(true);
    expect(lines.some((l) => l.includes('dependency cycles'))).toBe(true);
    expect(lines.some((l) => l.includes('<->'))).toBe(true);
  });

  it('suggests co-locating files for structure mismatches', () => {
    const edges = [
      dep('src/handlers/create.ts', 'src/core/order.ts', { strength: 3 }),
      dep('src/core/order.ts', 'src/handlers/create.ts', { strength: 3 }),
    ];
    const lines = renderArchitecture(architectureReport(edges), (p) => p);
    expect(lines.some((l) => l.includes('structure mismatches'))).toBe(true);
    expect(lines.some((l) => l.includes('co-locate'))).toBe(true);
  });
});
