import { describe, it, expect } from 'vitest';
import { globMatch } from '../../src/core/scan.ts';
import { evaluateConfig } from '../../src/core/config.ts';
import { evaluateArchitecture } from '../../src/core/report/architecture.ts';
import type { ScanReport } from '../../src/core/scoring/score.ts';

describe('globMatch', () => {
  it('matches ** across directories and * within a segment', () => {
    expect(globMatch('**/*.test.ts', 'src/a/b/c.test.ts')).toBe(true);
    expect(globMatch('**/__tests__/**', 'src/a/__tests__/x.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(globMatch('**/*.test.ts', 'src/a/b.spec.ts')).toBe(false);
  });

  it('normalizes backslashes', () => {
    expect(globMatch('**/*.test.ts', 'src\\a\\b.test.ts')).toBe(true);
  });
});

describe('evaluateConfig', () => {
  const baseReport: ScanReport = {
    summary: { algorithm: 600, name: 10 },
    edges: [
      {
        nodeA: { id: 'a', kind: 'function', name: 'a', filePath: 'x.ts', startLine: 1 },
        nodeB: { id: 'b', kind: 'function', name: 'b', filePath: 'y.ts', startLine: 2 },
        connascenceType: 'algorithm',
        strength: 5,
        locality: 4,
        degree: 1,
        evidence: '',
      },
    ],
  };

  it('flags threshold breaches', () => {
    const v = evaluateConfig(baseReport, { thresholds: { algorithm: 500 } });
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('threshold');
    expect(v[0].message).toContain('algorithm');
  });

  it('passes when counts are under thresholds', () => {
    expect(evaluateConfig(baseReport, { thresholds: { algorithm: 1000 } })).toHaveLength(0);
  });

  it('gate fires only when both strength and locality are met', () => {
    const gate = { minStrength: 7, minLocality: 4 };
    expect(evaluateConfig(baseReport, { gate })).toHaveLength(0); // strength 5 < 7
    expect(evaluateConfig(baseReport, { gate: { minStrength: 5, minLocality: 4 } })).toHaveLength(1);
    expect(evaluateConfig(baseReport, { gate: { minStrength: 5, minLocality: 5 } })).toHaveLength(0);
  });

  it('missing types count as 0', () => {
    expect(evaluateConfig(baseReport, { thresholds: { timing: 0 } })).toHaveLength(0);
  });
});

describe('evaluateArchitecture', () => {
  const arch = {
    modules: [],
    tangles: [{ a: 'x', b: 'y', forward: {} as never, backward: {} as never }],
    dependencies: [],
    cycles: [['x', 'y', 'x']],
    mismatches: [{ name: 'm', files: ['a'], dirs: ['d1', 'd2'] }],
    clusters: 1,
    dependencyEdges: 1,
  } as never;

  it('passes with no architecture config', () => {
    expect(evaluateArchitecture(arch, {})).toHaveLength(0);
  });

  it('flags tangles, cycles, and mismatches over the configured bounds', () => {
    const violations = evaluateArchitecture(arch, {
      architecture: { maxTangles: 0, maxCycles: 0, maxMismatches: 0 },
    });
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.kind === 'architecture')).toBe(true);
  });

  it('passes when within bounds', () => {
    const violations = evaluateArchitecture(arch, {
      architecture: { maxTangles: 1, maxCycles: 1, maxMismatches: 1 },
    });
    expect(violations).toHaveLength(0);
  });
});
