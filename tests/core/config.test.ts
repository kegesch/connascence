import { describe, it, expect } from 'vitest';
import { globMatch } from '../../src/core/paths.ts';
import { coChangeOptions, configHash, evaluateConfig, gateableEdges } from '../../src/core/config.ts';
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

  it('lets **/ match zero directories (src/**/*.ts matches src/a.ts)', () => {
    expect(globMatch('src/**/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatch('src/**/*.ts', 'src/core/a.ts')).toBe(true);
    expect(globMatch('**/*.test.ts', 'a.test.ts')).toBe(true);
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

describe('gateableEdges', () => {
  it('never gates on heuristic candidates', () => {
    const edges = [
      { connascenceType: 'name' },
      { connascenceType: 'meaning' },
      { connascenceType: 'value' },
      { connascenceType: 'identity' },
      { connascenceType: 'position' },
      { connascenceType: 'algorithm' },
    ];
    expect(gateableEdges(edges).map((e) => e.connascenceType)).toEqual(['position', 'algorithm']);
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
    levelization: { entries: [], depth: 3, components: 1, cyclic: false },
  } as never;

  it('passes with no architecture config', () => {
    expect(evaluateArchitecture(arch, {})).toHaveLength(0);
  });

  it('flags tangles, cycles, mismatches, and levelization depth over bounds', () => {
    const violations = evaluateArchitecture(arch, {
      architecture: { maxTangles: 0, maxCycles: 0, maxMismatches: 0, maxLevelizationDepth: 2 },
    });
    expect(violations).toHaveLength(4);
    expect(violations.every((v) => v.kind === 'architecture')).toBe(true);
    expect(violations.some((v) => v.message.includes('depth 3'))).toBe(true);
  });

  it('passes when within bounds', () => {
    const violations = evaluateArchitecture(arch, {
      architecture: { maxTangles: 1, maxCycles: 1, maxMismatches: 1, maxLevelizationDepth: 3 },
    });
    expect(violations).toHaveLength(0);
  });
});

describe('coChangeOptions', () => {
  it('uses config values and lets explicit flags override them', () => {
    const config = {
      coChange: { minSupport: 5, minRatio: 0.7, maxCommits: 100, maxFilesPerCommit: 10 },
    };
    const options = coChangeOptions(config, { minSupport: 2, maxCommits: 50 });
    expect(options?.minSupport).toBe(2);
    expect(options?.minRatio).toBe(0.7);
    expect(options?.maxCommits).toBe(50);
    expect(options?.maxFilesPerCommit).toBe(10);
  });

  it('skips the channel when disabled or explicitly off', () => {
    expect(coChangeOptions({ coChange: { enabled: false } })).toBeNull();
    expect(coChangeOptions({}, { minSupport: 0 })).toBeNull();
  });

  it('lets an explicit threshold re-enable a disabled config', () => {
    expect(coChangeOptions({ coChange: { enabled: false } }, { minSupport: 3 })?.minSupport).toBe(3);
  });
});

describe('configHash', () => {
  it('is independent of key order and undefined fields', () => {
    expect(configHash({ thresholds: { name: 1, position: 2 } })).toBe(
      configHash({ thresholds: { position: 2, name: 1 } }),
    );
    expect(configHash({ ignore: ['a'], coChange: undefined })).toBe(configHash({ ignore: ['a'] }));
  });

  it('changes when any effective value changes', () => {
    const base = configHash({ thresholds: { name: 1 }, gate: { minStrength: 7, minLocality: 4 } });
    const changed = configHash({ thresholds: { name: 2 }, gate: { minStrength: 7, minLocality: 4 } });
    expect(changed).not.toBe(base);
  });
});
