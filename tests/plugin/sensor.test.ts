import { describe, it, expect } from 'vitest';
import {
  adoptBaseline,
  baselineFromScan,
  createState,
  ensureBaseline,
  freshAdded,
  isStaleBaseline,
  markReported,
  sessionSummary,
} from '../../plugin/sensor.ts';
import { parseOptions } from '../../plugin/options.ts';
import type { EngineEdge, EngineQuality, EngineScan } from '../../plugin/engine.ts';

function edge(name: string): EngineEdge {
  return {
    nodeA: { id: `a-${name}`, kind: 'argument', name, filePath: 'src/a.ts', startLine: 12 },
    nodeB: { id: 'b', kind: 'parameter', name: 'host', filePath: 'src/b.ts', startLine: 40 },
    connascenceType: 'position',
    strength: 4,
    locality: 2,
    degree: 3,
    evidence: 'argument slot',
    heuristic: false,
  };
}

function quality(over: Partial<EngineQuality> = {}): EngineQuality {
  return {
    scoreVersion: 1,
    configHash: 'config-a',
    score: 5000,
    components: [],
    ...over,
  };
}

function scan(edges: EngineEdge[], q?: EngineQuality): EngineScan {
  return { summary: { position: edges.length }, edges, quality: q };
}

describe('ensureBaseline', () => {
  it('first write wins; later scans do not overwrite', () => {
    const state = createState();
    const first = ensureBaseline(state, scan([edge('0')]));
    expect(first.created).toBe(true);
    const second = ensureBaseline(state, scan([]));
    expect(second.created).toBe(false);
    expect(second.baseline).toBe(first.baseline);
    expect(state.baseline?.keys).toHaveLength(1);
    expect(state.baseline?.count).toBe(1);
    expect(state.baseline?.at).toEqual(expect.any(String));
  });

  it('keeps edge keys, not full edges, so a persisted baseline is compact', () => {
    const state = createState();
    const { baseline } = ensureBaseline(state, scan([edge('0')]));
    // this fixture edge carries no identityHash, so the fallback key applies
    expect(baseline.keys).toEqual([expect.stringContaining('position|p:src/a.ts:0|p:src/b.ts:host')]);
  });

  it('stamps score version and config hash on the baseline', () => {
    const { baseline } = ensureBaseline(createState(), scan([edge('0')], quality({ score: 6200 })));
    expect(baseline).toMatchObject({ scoreVersion: 1, configHash: 'config-a', score: 6200 });
  });
});

describe('isStaleBaseline', () => {
  it('rejects a baseline from a different formula or config', () => {
    const baseline = baselineFromScan(scan([], quality()));
    expect(isStaleBaseline(baseline, scan([], quality()))).toBe(false);
    expect(isStaleBaseline(baseline, scan([], quality({ scoreVersion: 2 })))).toBe(true);
    expect(isStaleBaseline(baseline, scan([], quality({ configHash: 'config-b' })))).toBe(true);
  });

  it('does not invalidate when an older engine emits no score', () => {
    const baseline = baselineFromScan(scan([]));
    expect(isStaleBaseline(baseline, scan([]))).toBe(false);
  });
});

describe('adoptBaseline', () => {
  it('restores a persisted baseline when memory is empty after a reload', () => {
    const state = createState();
    const persisted = { at: '2026-10-19T00:00:00.000Z', count: 2, keys: ['a', 'b'] };
    expect(adoptBaseline(state, persisted)).toBe(true);
    expect(state.baseline).toEqual(persisted);
  });

  it('never overwrites a baseline captured by this instance', () => {
    const state = createState();
    ensureBaseline(state, scan([edge('0')]));
    const adopted = adoptBaseline(state, { at: 'x', count: 0, keys: [] });
    expect(adopted).toBe(false);
    expect(state.baseline?.count).toBe(1);
  });
});

describe('freshAdded / markReported', () => {
  it('returns only unreported edges and dedupes after reporting', () => {
    const state = createState();
    ensureBaseline(state, scan([]));
    const added = [edge('0'), edge('1')];
    expect(freshAdded(state, added)).toHaveLength(2);
    markReported(state, [added[0]]);
    expect(freshAdded(state, added).map((e) => e.nodeA.name)).toEqual(['1']);
  });
});

describe('sessionSummary', () => {
  it('exposes the loop-experiment counters', () => {
    const state = createState();
    state.turns = 3;
    state.injections = 1;
    ensureBaseline(state, scan([edge('0')]));
    const summary = sessionSummary(state);
    expect(summary).toMatchObject({ turns: 3, injections: 1, baselineEdges: 1 });
  });
});

describe('parseOptions', () => {
  it('applies defaults when no options are given', () => {
    const opts = parseOptions(undefined);
    expect(opts.top).toBe(5);
    expect(opts.inject).toBe(true);
    expect(opts.includeHeuristics).toBe(false);
    expect(opts.globs).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
  });
  it('overrides with valid values and rejects invalid ones', () => {
    const opts = parseOptions({
      top: 3,
      budgetChars: -5,
      inject: false,
      globs: ['lib/**/*.ts', ''],
      includeHeuristics: 'yes',
    });
    expect(opts.top).toBe(3);
    expect(opts.budgetChars).toBe(1500); // invalid -> default
    expect(opts.inject).toBe(false);
    expect(opts.globs).toEqual(['lib/**/*.ts']);
    expect(opts.includeHeuristics).toBe(false);
  });
});
