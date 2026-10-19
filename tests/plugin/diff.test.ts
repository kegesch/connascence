import { describe, it, expect } from 'vitest';
import { edgeKey, diffEdges, diffAdded } from '../../plugin/diff.ts';
import type { EngineEdge } from '../../plugin/engine.ts';

function edge(overrides: Partial<EngineEdge> = {}): EngineEdge {
  return {
    nodeA: { id: 'a', kind: 'argument', name: '0', filePath: 'src/a.ts', startLine: 12 },
    nodeB: { id: 'b', kind: 'parameter', name: 'host', filePath: 'src/b.ts', startLine: 40 },
    connascenceType: 'position',
    strength: 4,
    locality: 2,
    degree: 3,
    evidence: 'argument slot 0',
    heuristic: false,
    ...overrides,
  };
}

describe('edgeKey', () => {
  it('normalizes path separators so the same edge keys identically across OSes', () => {
    const win = edge({ nodeA: { ...edge().nodeA, filePath: 'src\\a.ts' } });
    const posix = edge();
    expect(edgeKey(win)).toBe(edgeKey(posix));
  });

  it('ignores line numbers (structure-level keying, not line-level)', () => {
    const shifted = edge({ nodeA: { ...edge().nodeA, startLine: 99 } });
    expect(edgeKey(shifted)).toBe(edgeKey(edge()));
  });

  it('distinguishes edges by type and endpoint names', () => {
    expect(edgeKey(edge({ connascenceType: 'algorithm' }))).not.toBe(edgeKey(edge()));
    expect(
      edgeKey(edge({ nodeB: { ...edge().nodeB, name: 'port' } })),
    ).not.toBe(edgeKey(edge()));
  });

  it('keys by structural identity, so a rename + move is not a new edge (M3a)', () => {
    const before = edge({
      nodeA: { ...edge().nodeA, identityHash: 'h1#a0', filePath: 'src/old/a.ts' },
      nodeB: { ...edge().nodeB, identityHash: 'h1#p0', filePath: 'src/old/b.ts', name: 'host' },
    });
    const after = edge({
      nodeA: { ...edge().nodeA, identityHash: 'h1#a0', filePath: 'src/lib/a.ts' },
      nodeB: { ...edge().nodeB, identityHash: 'h1#p0', filePath: 'src/lib/b.ts', name: 'renamed' },
    });
    expect(edgeKey(after)).toBe(edgeKey(before));
    expect(diffEdges([before], [after])).toEqual({ added: [], removed: [] });
  });

  it('falls back to file/name for endpoints without identity (older scans)', () => {
    const before = edge();
    const after = edge({ nodeB: { ...before.nodeB, name: 'port' } });
    expect(edgeKey(after)).not.toBe(edgeKey(before));
  });
});

describe('diffAdded', () => {
  it('finds new edges against baseline keys only (the persisted form)', () => {
    const before = [edge()];
    const after = [edge(), edge({ connascenceType: 'algorithm', strength: 6 })];
    const added = diffAdded(before.map(edgeKey), after);
    expect(added).toHaveLength(1);
    expect(added[0].connascenceType).toBe('algorithm');
  });

  it('accepts a Set as well as an array', () => {
    expect(diffAdded(new Set([edgeKey(edge())]), [edge()])).toEqual([]);
  });

  it('matches diffEdges added when given the same before keys', () => {
    const before = [edge(), edge({ connascenceType: 'identity', strength: 9 })];
    const after = [before[1], edge({ connascenceType: 'value', strength: 2 })];
    expect(diffAdded(before.map(edgeKey), after)).toEqual(diffEdges(before, after).added);
  });
});

describe('diffEdges', () => {
  it('reports edges present only after as added', () => {
    const before = [edge()];
    const after = [edge(), edge({ connascenceType: 'algorithm', strength: 6 })];
    const { added, removed } = diffEdges(before, after);
    expect(added).toHaveLength(1);
    expect(added[0].connascenceType).toBe('algorithm');
    expect(removed).toHaveLength(0);
  });

  it('reports edges present only before as removed', () => {
    const before = [edge(), edge({ connascenceType: 'algorithm', strength: 6 })];
    const after = [edge()];
    const { added, removed } = diffEdges(before, after);
    expect(added).toHaveLength(0);
    expect(removed).toHaveLength(1);
  });

  it('is empty for identical scans', () => {
    const list = [edge(), edge({ connascenceType: 'identity', heuristic: true, strength: 9 })];
    expect(diffEdges(list, list)).toEqual({ added: [], removed: [] });
  });
});
