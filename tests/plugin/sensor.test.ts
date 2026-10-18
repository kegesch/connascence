import { describe, it, expect } from 'vitest';
import {
  createState,
  ensureBaseline,
  freshAdded,
  markReported,
  sessionSummary,
} from '../../plugin/sensor.ts';
import { parseOptions } from '../../plugin/options.ts';
import type { EngineEdge, EngineScan } from '../../plugin/engine.ts';

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

function scan(edges: EngineEdge[]): EngineScan {
  return { summary: { position: edges.length }, edges };
}

describe('ensureBaseline', () => {
  it('first write wins; later scans do not overwrite', () => {
    const state = createState();
    const first = ensureBaseline(state, scan([edge('0')]));
    expect(first.created).toBe(true);
    const second = ensureBaseline(state, scan([]));
    expect(second.created).toBe(false);
    expect(second.baseline).toBe(first.baseline);
    expect(state.baseline?.edges).toHaveLength(1);
    expect(state.baselineAt).not.toBeNull();
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
