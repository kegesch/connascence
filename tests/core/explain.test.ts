import { describe, it, expect } from 'vitest';
import { explain } from '../../src/core/explain.ts';
import type { ScanReport, ScoredEdge } from '../../src/core/scoring/score.ts';

function edge(aFile: string, aLine: number, bFile: string, bLine: number): ScoredEdge {
  return {
    nodeA: { id: 'a', kind: 'function', name: 'a', filePath: aFile, startLine: aLine },
    nodeB: { id: 'b', kind: 'function', name: 'b', filePath: bFile, startLine: bLine },
    connascenceType: 'name',
    strength: 1,
    locality: 3,
    degree: 2,
    evidence: 'test',
  };
}

const report: ScanReport = {
  summary: { name: 2 },
  edges: [
    edge('src/components/Foo.tsx', 10, 'src/lib/bar.ts', 5),
    edge('src\\components\\Foo.tsx', 20, 'src/lib/bar.ts', 5),
  ],
};

describe('explain', () => {
  it('finds edges touching a file:line (posix paths)', () => {
    expect(explain(report, 'src/components/Foo.tsx:10')).toHaveLength(1);
  });

  it('normalizes windows path separators', () => {
    expect(explain(report, 'src/components/Foo.tsx:20')).toHaveLength(1);
  });

  it('matches by suffix so absolute or relative inputs both work', () => {
    expect(explain(report, 'C:/project/src/components/Foo.tsx:10')).toHaveLength(1);
  });

  it('returns empty when nothing touches the line', () => {
    expect(explain(report, 'src/components/Foo.tsx:99')).toHaveLength(0);
  });

  it('rejects malformed arguments', () => {
    expect(() => explain(report, 'not-a-fileline')).toThrow(/invalid file:line/);
  });
});
