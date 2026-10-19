// Schema validation for .connascence.yml. YAML is data, not a type system:
// without this, typos and strings silently change gate behavior (e.g.
// `minStrength: "7"` or `maxCycles: -1`). Fail fast with the file and key.

import type { ConnascenceConfig } from './config.js';
import { CONNASCENCE_TYPES, type ConnascenceType } from './ir.js';

const TYPES: ReadonlySet<string> = new Set(CONNASCENCE_TYPES);

const TOP_KEYS = new Set([
  'thresholds',
  'ignore',
  'gate',
  'heuristicFindings',
  'architecture',
  'coChange',
]);

const GATE_KEYS = new Set(['minStrength', 'minLocality']);
const ARCH_KEYS = new Set([
  'maxTangles',
  'maxCycles',
  'maxMismatches',
  'maxLevelizationDepth',
]);
const CO_CHANGE_KEYS = new Set([
  'enabled',
  'minSupport',
  'minRatio',
  'maxCommits',
  'maxFilesPerCommit',
]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function fail(where: string, message: string): never {
  throw new ConfigError(`${where}: ${message}`);
}

function mapping(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'must be a mapping');
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`${where}.${key}`, `unknown key (allowed: ${[...allowed].sort().join(', ')})`);
    }
  }
}

function integer(value: unknown, where: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail(where, `must be an integer >= ${min}`);
  }
  return value;
}

function ratio(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(where, 'must be a number between 0 and 1');
  }
  return value;
}

function boolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') fail(where, 'must be true or false');
  return value;
}

function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) fail(where, 'must be a list of glob strings');
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail(`${where}[${index}]`, 'must be a non-empty string');
    }
    return entry;
  });
}

function thresholds(
  value: unknown,
  where: string,
): Partial<Record<ConnascenceType, number>> {
  const raw = mapping(value, where);
  const result: Partial<Record<ConnascenceType, number>> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!TYPES.has(key)) fail(`${where}.${key}`, 'unknown connascence type');
    result[key as ConnascenceType] = integer(entry, `${where}.${key}`, 0);
  }
  return result;
}

function gate(value: unknown, where: string): NonNullable<ConnascenceConfig['gate']> {
  const raw = mapping(value, where);
  onlyKeys(raw, GATE_KEYS, where);
  if (raw.minStrength === undefined) fail(where, 'minStrength is required');
  if (raw.minLocality === undefined) fail(where, 'minLocality is required');
  const minStrength = integer(raw.minStrength, `${where}.minStrength`, 1);
  const minLocality = integer(raw.minLocality, `${where}.minLocality`, 1);
  if (minStrength > 9) fail(`${where}.minStrength`, 'must be <= 9');
  if (minLocality > 5) fail(`${where}.minLocality`, 'must be <= 5');
  return { minStrength, minLocality };
}

function architecture(
  value: unknown,
  where: string,
): NonNullable<ConnascenceConfig['architecture']> {
  const raw = mapping(value, where);
  onlyKeys(raw, ARCH_KEYS, where);
  const result: NonNullable<ConnascenceConfig['architecture']> = {};
  for (const key of ARCH_KEYS) {
    if (raw[key] !== undefined) {
      result[key as keyof typeof result] = integer(raw[key], `${where}.${key}`, 0);
    }
  }
  return result;
}

function coChange(
  value: unknown,
  where: string,
): NonNullable<ConnascenceConfig['coChange']> {
  const raw = mapping(value, where);
  onlyKeys(raw, CO_CHANGE_KEYS, where);
  const result: NonNullable<ConnascenceConfig['coChange']> = {};
  if (raw.enabled !== undefined) result.enabled = boolean(raw.enabled, `${where}.enabled`);
  if (raw.minSupport !== undefined) {
    result.minSupport = integer(raw.minSupport, `${where}.minSupport`, 1);
  }
  if (raw.minRatio !== undefined) {
    result.minRatio = ratio(raw.minRatio, `${where}.minRatio`);
  }
  if (raw.maxCommits !== undefined) {
    result.maxCommits = integer(raw.maxCommits, `${where}.maxCommits`, 1);
  }
  if (raw.maxFilesPerCommit !== undefined) {
    result.maxFilesPerCommit = integer(raw.maxFilesPerCommit, `${where}.maxFilesPerCommit`, 1);
  }
  return result;
}

function heuristic(value: unknown, where: string): 'include' | 'exclude' {
  if (value !== 'include' && value !== 'exclude') {
    fail(where, 'must be "include" or "exclude"');
  }
  return value;
}

/** Validate and normalize a parsed config document. Unknown keys are errors. */
export function validateConfig(
  value: unknown,
  source = '.connascence.yml',
): ConnascenceConfig {
  if (value === undefined || value === null) return {};
  const raw = mapping(value, source);
  onlyKeys(raw, TOP_KEYS, source);

  const config: ConnascenceConfig = {};
  if (raw.thresholds !== undefined) {
    config.thresholds = thresholds(raw.thresholds, `${source}.thresholds`);
  }
  if (raw.ignore !== undefined) config.ignore = strings(raw.ignore, `${source}.ignore`);
  if (raw.gate !== undefined) config.gate = gate(raw.gate, `${source}.gate`);
  if (raw.heuristicFindings !== undefined) {
    config.heuristicFindings = heuristic(raw.heuristicFindings, `${source}.heuristicFindings`);
  }
  if (raw.architecture !== undefined) {
    config.architecture = architecture(raw.architecture, `${source}.architecture`);
  }
  if (raw.coChange !== undefined) {
    config.coChange = coChange(raw.coChange, `${source}.coChange`);
  }
  return config;
}
