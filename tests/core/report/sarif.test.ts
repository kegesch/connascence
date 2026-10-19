import { describe, it, expect } from 'vitest';
import { renderSarif } from '../../../src/core/report/sarif.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';
import type { FileCycle } from '../../../src/core/report/cycles.ts';

function edge(strength: number, type: ScoredEdge['connascenceType']): ScoredEdge {
  return {
    nodeA: { id: 'a', kind: 'function', name: 'fa', filePath: 'C:/repo/src/a.ts', startLine: 10 },
    nodeB: { id: 'b', kind: 'variable', name: 'fb', filePath: 'C:\\repo\\lib\\b.ts', startLine: 20 },
    connascenceType: type,
    strength,
    locality: 4,
    degree: 3,
    evidence: 'some <evidence> text',
  };
}

describe('renderSarif', () => {
  const edges = [edge(9, 'identity'), edge(5, 'position'), edge(1, 'name')];
  const sarif = JSON.parse(renderSarif({ edges, repoRoot: 'C:/repo' }));

  it('produces valid SARIF 2.1.0 structure', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('connascence');
    expect(sarif.runs[0].results).toHaveLength(3);
  });

  it('maps strength to level (>=7 error, >=4 warning, else note)', () => {
    const levels = sarif.runs[0].results.map((r: { level: string }) => r.level);
    expect(levels).toEqual(['error', 'warning', 'note']);
  });

  it('uses repo-relative posix URIs and start lines', () => {
    const loc = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toBe('src/a.ts');
    expect(loc.region.startLine).toBe(10);
    const loc2 = sarif.runs[0].results[0].locations[1].physicalLocation;
    expect(loc2.artifactLocation.uri).toBe('lib/b.ts');
  });

  it('declares one rule per connascence type plus cycle, with heuristic flags', () => {
    const rules = sarif.runs[0].tool.driver.rules;
    expect(rules).toHaveLength(10);
    const meaning = rules.find((r: { id: string }) => r.id === 'meaning');
    expect(meaning.properties.heuristic).toBe(true);
    const position = rules.find((r: { id: string }) => r.id === 'position');
    expect(position.properties.heuristic).toBe(false);
    expect(rules.some((r: { id: string }) => r.id === 'cycle')).toBe(true);
  });

  it('emits cycle results with every member location', () => {
    const cycle: FileCycle = {
      files: ['C:/repo/src/a.ts', 'C:/repo/src/b.ts'],
      members: [
        { filePath: 'C:/repo/src/a.ts', startLine: 3, name: 'a' },
        { filePath: 'C:/repo/src/b.ts', startLine: 7, name: 'b' },
      ],
      edges: [],
      worst: edge(1, 'name'),
    };
    const parsed = JSON.parse(renderSarif({ edges: [], repoRoot: 'C:/repo', cycles: [cycle] }));
    const result = parsed.runs[0].results[0];
    expect(result.ruleId).toBe('cycle');
    expect(result.level).toBe('error');
    expect(result.locations).toHaveLength(2);
    expect(result.locations[1].physicalLocation.artifactLocation.uri).toBe('src/b.ts');
  });

  it('escapes nothing manually — JSON.stringify handles content safely', () => {
    expect(sarif.runs[0].results[0].message.text).toContain('some <evidence> text');
  });
});
