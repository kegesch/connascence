import { describe, it, expect } from 'vitest';
import { clusterFindings, fileHotspots } from '../../../src/core/report/findings.ts';
import type { ScoredEdge } from '../../src/core/scoring/score.ts';

function edge(a: Partial<ScoredEdge['nodeA']>, b: Partial<ScoredEdge['nodeB']>, over: Partial<ScoredEdge> = {}): ScoredEdge {
  return {
    nodeA: { id: 'a', kind: 'function', name: 'f', filePath: 'a.ts', startLine: 1, ...a },
    nodeB: { id: 'b', kind: 'function', name: 'g', filePath: 'b.ts', startLine: 2, ...b },
    connascenceType: 'name',
    strength: 1,
    locality: 3,
    degree: 1,
    evidence: 'test',
    heuristic: false,
    ...over,
  };
}

describe('clusterFindings', () => {
  it('collapses meaning edges sharing a literal value into one finding', () => {
    const mk = (i: number): ScoredEdge =>
      edge(
        { filePath: `f${i}.ts`, startLine: i, name: 'x' },
        { filePath: `g${i}.ts`, startLine: i, name: 'y' },
        {
          connascenceType: 'meaning',
          strength: 3,
          evidence: `magic literal 'id' repeated at 43 call sites across 21 files (candidate — x)`,
        },
      );
    const findings = clusterFindings([mk(1), mk(2), mk(3)]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('meaning');
    expect(findings[0].edgeCount).toBe(3);
    expect(findings[0].summary).toContain("'id'");
  });

  it('collapses a clone star into a single group finding with all members', () => {
    const mk = (other: string, line: number): ScoredEdge =>
      edge(
        { filePath: 'avatar.tsx', startLine: 6, name: 'Avatar' },
        { filePath: other, startLine: line, name: 'CommandList' },
        { connascenceType: 'algorithm', strength: 5, evidence: `clone Avatar vs CommandList at ${other}` },
      );
    const findings = clusterFindings([mk('c1.tsx', 1), mk('c2.tsx', 2), mk('c3.tsx', 3)]);
    expect(findings).toHaveLength(1);
    expect(findings[0].members.length).toBe(4); // Avatar + 3 others
  });

  it('clusters position edges by callee signature (same params merge across call sites)', () => {
    const findings = clusterFindings([
      edge({ filePath: 'a.ts', startLine: 1 }, { filePath: 'b.ts', startLine: 10 }, { connascenceType: 'position', strength: 4, evidence: 'slot0' }),
      edge({ filePath: 'a.ts', startLine: 1 }, { filePath: 'b.ts', startLine: 11 }, { connascenceType: 'position', strength: 4, evidence: 'slot1' }),
      edge({ filePath: 'c.ts', startLine: 5 }, { filePath: 'b.ts', startLine: 10 }, { connascenceType: 'position', strength: 4, evidence: 'same params, other call site' }),
      edge({ filePath: 'c.ts', startLine: 5 }, { filePath: 'b.ts', startLine: 11 }, { connascenceType: 'position', strength: 4, evidence: 'same params, other call site slot1' }),
    ]);
    expect(findings).toHaveLength(1); // both call sites bind the same params (b.ts:10, b.ts:11) -> one callee
    expect(findings[0].kind).toBe('position');
    expect(findings[0].edgeCount).toBe(4);
    expect(findings[0].members.length).toBe(4); // 2 call sites + 2 params
  });

  it('dedupes repeated identical name edges', () => {
    const findings = clusterFindings([
      edge({ filePath: 'a.ts', startLine: 1 }, { filePath: 'b.ts', startLine: 2 }, { connascenceType: 'name', strength: 1, evidence: 'r1' }),
      edge({ filePath: 'a.ts', startLine: 1 }, { filePath: 'b.ts', startLine: 2 }, { connascenceType: 'name', strength: 1, evidence: 'r1' }),
    ]);
    expect(findings).toHaveLength(1);
  });
});

describe('fileHotspots', () => {
  it('aggregates edge count, max degree and worst strength per file', () => {
    const hs = fileHotspots([
      edge({ filePath: 'a.ts' }, { filePath: 'b.ts' }, { strength: 1, degree: 2 }),
      edge({ filePath: 'a.ts' }, { filePath: 'c.ts' }, { strength: 5, degree: 7 }),
    ]);
    const a = hs.find((h) => h.filePath === 'a.ts')!;
    expect(a.edgeCount).toBe(2);
    expect(a.maxDegree).toBe(7);
    expect(a.worstStrength).toBe(5);
  });
});
