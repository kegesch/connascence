import { describe, it, expect } from 'vitest';
import {
  isReportable,
  rank,
  relPath,
  renderInjection,
  renderHealth,
  renderScanReport,
} from '../../plugin/payload.ts';
import type { EngineEdge } from '../../plugin/engine.ts';

const CWD = 'C:/proj';

function edge(overrides: Partial<EngineEdge> = {}): EngineEdge {
  return {
    nodeA: { id: 'a', kind: 'argument', name: '0', filePath: `${CWD}/src/a.ts`, startLine: 12 },
    nodeB: { id: 'b', kind: 'parameter', name: 'host', filePath: `${CWD}/src/b.ts`, startLine: 40 },
    connascenceType: 'position',
    strength: 4,
    locality: 2,
    degree: 3,
    evidence: 'argument slot 0',
    heuristic: false,
    ...overrides,
  };
}

describe('isReportable', () => {
  it('always excludes name connascence (informational)', () => {
    expect(isReportable(edge({ connascenceType: 'name', strength: 1 }), true)).toBe(false);
  });
  it('excludes heuristics unless included', () => {
    const h = edge({ connascenceType: 'identity', heuristic: true, strength: 9 });
    expect(isReportable(h, false)).toBe(false);
    expect(isReportable(h, true)).toBe(true);
  });
  it('includes deterministic detectors by default', () => {
    expect(isReportable(edge(), false)).toBe(true);
  });
});

describe('rank', () => {
  it('orders worst-first deterministically and does not mutate input', () => {
    const weak = edge({ strength: 2 });
    const strong = edge({ strength: 6 });
    const out = rank([weak, strong]);
    expect(out.map((e) => e.strength)).toEqual([6, 2]);
  });
  it('breaks strength ties by locality, then location', () => {
    const near = edge({ strength: 4, locality: 1, nodeA: { ...edge().nodeA, filePath: `${CWD}/z.ts` } });
    const far = edge({ strength: 4, locality: 3, nodeA: { ...edge().nodeA, filePath: `${CWD}/a.ts` } });
    expect(rank([near, far])).toEqual([far, near]);
  });
});

describe('relPath', () => {
  it('relativizes in-project paths and keeps outside paths absolute', () => {
    expect(relPath('C:/proj', 'C:/proj/src/a.ts')).toBe('src/a.ts');
    expect(relPath('C:/proj', 'C:/other/a.ts')).toBe('C:/other/a.ts');
  });
});

describe('renderInjection', () => {
  it('leads with counts and ships one fix hint per edge', () => {
    const text = renderInjection({
      added: [edge()],
      edgesBefore: 41,
      edgesAfter: 42,
      cwd: CWD,
      opts: { top: 5, budgetChars: 1500 },
    });
    expect(text).toContain('1 new coupling instance(s)');
    expect(text).toContain('edges 41 -> 42');
    expect(text).toContain('- position (s4 l2): src/a.ts:12 (0) <-> src/b.ts:40 (host)');
    expect(text).toContain('fix: Reduce positional coupling');
  });

  it('marks heuristic candidates', () => {
    const text = renderInjection({
      added: [edge({ connascenceType: 'identity', heuristic: true, strength: 9 })],
      edgesBefore: 1,
      edgesAfter: 2,
      cwd: CWD,
      opts: { top: 5, budgetChars: 1500 },
    });
    expect(text).toContain('[candidate - review]');
  });

  it('caps at top and says how many were hidden', () => {
    const added = [1, 2, 3].map((i) => edge({ nodeA: { ...edge().nodeA, name: String(i) } }));
    const text = renderInjection({
      added,
      edgesBefore: 3,
      edgesAfter: 6,
      cwd: CWD,
      opts: { top: 2, budgetChars: 1500 },
    });
    expect(text).toContain('... 1 more');
  });

  it('truncates at the character budget', () => {
    const added = Array.from({ length: 30 }, (_, i) =>
      edge({ nodeA: { ...edge().nodeA, name: String(i) }, strength: 9 - (i % 5) }),
    );
    const text = renderInjection({
      added,
      edgesBefore: 0,
      edgesAfter: 30,
      cwd: CWD,
      opts: { top: 30, budgetChars: 300 },
    });
    expect(text.length).toBeLessThanOrEqual(300 + 60);
    expect(text).toContain('payload truncated');
  });
});

describe('renderHealth', () => {
  it('shows totals, session delta, and hotspots', () => {
    const scan = {
      summary: { position: 2 },
      edges: [edge(), edge({ nodeB: { ...edge().nodeB, filePath: `${CWD}/src/a.ts` } })],
    };
    const text = renderHealth({ scan, edgesBefore: 2, cwd: CWD, opts: { top: 3, budgetChars: 1500 } });
    expect(text).toContain('2 edges (position 2)');
    expect(text).toContain('session delta: +0 edges since baseline');
    expect(text).toContain('src/a.ts (3)');
  });
  it('omits the delta line when no baseline exists', () => {
    const text = renderHealth({ scan: { summary: {}, edges: [] }, edgesBefore: null, cwd: CWD, opts: { top: 3, budgetChars: 1500 } });
    expect(text).not.toContain('delta');
    expect(text).toContain('0 edges (none)');
  });
});

describe('renderScanReport', () => {
  it('renders the actionable subset with a hidden-count footer', () => {
    const reportable = [edge(), edge({ strength: 2, nodeA: { ...edge().nodeA, name: '1' } })];
    const text = renderScanReport({
      scan: { summary: { position: 2 }, edges: reportable },
      reportable,
      cwd: CWD,
      opts: { top: 1, budgetChars: 1500 },
    });
    expect(text).toContain('2 edges total (position 2)');
    expect(text).toContain('2 actionable');
    expect(text).toContain('... 1 more actionable');
  });
});
