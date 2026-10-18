import { describe, it, expect } from 'vitest';
import { renderSarif } from '../../../src/core/report/sarif.ts';
import type { ScoredEdge } from '../../../src/core/scoring/score.ts';

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
  const sarif = JSON.parse(renderSarif(edges, 'C:/repo'));

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

  it('declares one rule per connascence type with heuristic flags', () => {
    const rules = sarif.runs[0].tool.driver.rules;
    expect(rules).toHaveLength(9);
    const meaning = rules.find((r: { id: string }) => r.id === 'meaning');
    expect(meaning.properties.heuristic).toBe(true);
    const position = rules.find((r: { id: string }) => r.id === 'position');
    expect(position.properties.heuristic).toBe(false);
  });

  it('escapes nothing manually — JSON.stringify handles content safely', () => {
    expect(sarif.runs[0].results[0].message.text).toContain('some <evidence> text');
  });
});
