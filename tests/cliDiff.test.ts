// Gate rule (the part CI depends on): confirmed edges and resolved cycles fail
// the build; name edges (imports) and heuristic candidates never do. Rendering
// is covered indirectly — the exit code is the contract.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderDiff } from '../src/cliDiff.ts';
import type { DiffResult } from '../src/core/diff.ts';
import type { FileCycle } from '../src/core/report/cycles.ts';
import type { ScoredEdge } from '../src/core/scoring/score.ts';

function edge(type: ScoredEdge['connascenceType'], evidence = 'e'): ScoredEdge {
  return {
    nodeA: { id: 'a', kind: 'reference', name: 'a', filePath: 'src/a.ts', startLine: 1 },
    nodeB: { id: 'b', kind: 'function', name: 'b', filePath: 'src/b.ts', startLine: 2 },
    connascenceType: type,
    strength: type === 'name' ? 1 : 4,
    locality: 3,
    degree: 1,
    evidence,
    heuristic: type === 'meaning' || type === 'value' || type === 'identity',
  };
}

const cycle: FileCycle = {
  files: ['src/a.ts', 'src/b.ts'],
  members: [
    { filePath: 'src/a.ts', startLine: 1, name: 'a' },
    { filePath: 'src/b.ts', startLine: 2, name: 'b' },
  ],
  edges: [edge('name')],
  worst: edge('name'),
};

function run(result: Partial<DiffResult>): number {
  return renderDiff({
    result: {
      added: [],
      removed: [],
      addedCycles: [],
      removedCycles: [],
      baseSummary: {},
      headSummary: {},
      ...result,
    },
    config: {},
    repoPath: '.',
    base: { ref: 'HEAD', source: 'explicit --base' },
    format: 'agent',
    top: 0,
    minStrength: 0,
    types: [],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderDiff gate', () => {
  it('fails on a resolved dependency cycle even with no gate-eligible edges', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(run({ addedCycles: [cycle] })).toBe(1);
  });

  it('does not fail on name edges or heuristic candidates alone', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(run({ added: [edge('name'), edge('meaning'), edge('identity')] })).toBe(0);
  });

  it('fails on a confirmed positional edge', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(run({ added: [edge('position')] })).toBe(1);
  });
});
