import { describe, it, expect } from 'vitest';
import { clusterFindings } from '../../../src/core/report/findings.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';

function identityEdge(defLine: number, useLine: number): ScoredEdge {
  return {
    nodeA: { id: `u${useLine}`, kind: 'reference', name: 'counter', filePath: 'mod.ts', startLine: useLine },
    nodeB: { id: `d${defLine}`, kind: 'variable', name: 'counter', filePath: 'mod.ts', startLine: defLine },
    connascenceType: 'identity',
    strength: 9,
    locality: 3,
    degree: 2,
    evidence: `shared mutable module state: "counter" (let/var at module scope, mod.ts:${defLine}) accessed from mod.ts:${useLine}`,
  };
}

describe('identity clustering', () => {
  it('groups all accesses to the same mutable variable into one finding', () => {
    const findings = clusterFindings([identityEdge(7, 19), identityEdge(7, 24), identityEdge(7, 31)]);
    expect(findings).toHaveLength(1);
    expect(findings[0].edgeCount).toBe(3);
    expect(findings[0].summary).toContain('accessed from 3 site(s)');
    expect(findings[0].members).toHaveLength(4); // def + 3 uses
  });

  it('separates findings for different variables', () => {
    const other = { ...identityEdge(8, 10) };
    other.nodeB = { ...other.nodeB, name: 'key', startLine: 8 };
    other.evidence = other.evidence.replace('counter', 'key').replace('mod.ts:8', 'mod.ts:8');
    const findings = clusterFindings([identityEdge(7, 19), other]);
    expect(findings).toHaveLength(2);
  });
});
