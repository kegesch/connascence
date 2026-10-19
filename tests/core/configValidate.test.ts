// Config is an input boundary: a typo or a quoted number must fail with the key
// path, not silently change whether CI/gates fire.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigError, loadConfig, validateConfig } from '../../src/core/config.ts';

describe('validateConfig', () => {
  it('normalizes a fully specified config', () => {
    expect(
      validateConfig(
        {
          thresholds: { algorithm: 10, name: 0 },
          ignore: ['**/*.test.ts'],
          gate: { minStrength: 7, minLocality: 4 },
          heuristicFindings: 'exclude',
          architecture: {
            maxTangles: 0,
            maxCycles: 0,
            maxMismatches: 2,
            maxLevelizationDepth: 5,
          },
          coChange: {
            enabled: true,
            minSupport: 4,
            minRatio: 0.6,
            maxCommits: 200,
            maxFilesPerCommit: 10,
          },
        },
        'cfg.yml',
      ),
    ).toEqual({
      thresholds: { algorithm: 10, name: 0 },
      ignore: ['**/*.test.ts'],
      gate: { minStrength: 7, minLocality: 4 },
      heuristicFindings: 'exclude',
      architecture: {
        maxTangles: 0,
        maxCycles: 0,
        maxMismatches: 2,
        maxLevelizationDepth: 5,
      },
      coChange: {
        enabled: true,
        minSupport: 4,
        minRatio: 0.6,
        maxCommits: 200,
        maxFilesPerCommit: 10,
      },
    });
  });

  it('accepts an empty document', () => {
    expect(validateConfig(null)).toEqual({});
  });

  const invalid: Array<[string, unknown]> = [
    ['unknown top-level key', { typo: 1 }],
    ['unknown threshold type', { thresholds: { nope: 1 } }],
    ['negative threshold', { thresholds: { name: -1 } }],
    ['fractional threshold', { thresholds: { name: 1.5 } }],
    ['non-string ignore entry', { ignore: ['ok', 3] }],
    ['partial gate', { gate: { minStrength: 7 } }],
    ['gate strength above 9', { gate: { minStrength: 10, minLocality: 4 } }],
    ['gate locality above 5', { gate: { minStrength: 7, minLocality: 6 } }],
    ['unknown heuristic mode', { heuristicFindings: 'sometimes' }],
    ['negative architecture bound', { architecture: { maxCycles: -1 } }],
    ['co-change ratio above 1', { coChange: { minRatio: 1.5 } }],
    ['zero co-change support', { coChange: { minSupport: 0 } }],
    ['non-boolean co-change enabled', { coChange: { enabled: 'no' } }],
    ['root list', []],
  ];

  for (const [label, value] of invalid) {
    it(`rejects ${label}`, () => {
      expect(() => validateConfig(value, 'cfg.yml')).toThrow(ConfigError);
    });
  }

  it('includes the failing key path in the message', () => {
    expect(() =>
      validateConfig({ gate: { minStrength: 10, minLocality: 4 } }, 'cfg.yml'),
    ).toThrow('cfg.yml.gate.minStrength');
  });
});

describe('loadConfig', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'connascence-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty config when the default file is absent', () => {
    expect(loadConfig(join(dir, 'missing.yml'))).toEqual({});
  });

  it('fails when an explicitly requested config is absent', () => {
    expect(() => loadConfig(join(dir, 'missing.yml'), true)).toThrow(ConfigError);
  });

  it('loads and validates YAML from disk', () => {
    const file = join(dir, 'config.yml');
    writeFileSync(
      file,
      ['thresholds:', '  algorithm: 10', 'coChange:', '  minSupport: 4', ''].join('\n'),
      'utf8',
    );
    expect(loadConfig(file)).toEqual({
      thresholds: { algorithm: 10 },
      coChange: { minSupport: 4 },
    });
  });

  it('wraps YAML syntax errors with the file path', () => {
    const file = join(dir, 'broken.yml');
    writeFileSync(file, 'thresholds: [\n', 'utf8');
    expect(() => loadConfig(file)).toThrow(ConfigError);
    expect(() => loadConfig(file)).toThrow(file);
  });

  it('keeps the checked-in example valid', () => {
    expect(() => loadConfig('.connascence.yml.example')).not.toThrow();
  });
});
