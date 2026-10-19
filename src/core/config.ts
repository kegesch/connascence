import { parse } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ConnascenceType } from './ir.js';
import { HEURISTIC_TYPES, type ScanReport } from './scoring/score.js';
import { strengthOf } from './scoring/strength.js';
import type { CoChangeOptions } from './cochange.js';
import { ConfigError, validateConfig } from './configValidate.js';

export { ConfigError, validateConfig } from './configValidate.js';

export interface ConnascenceConfig {
  /** fail the run when a type's total count exceeds this */
  thresholds?: Partial<Record<ConnascenceType, number>>;
  /** file glob patterns (matched against forward-slash paths) whose files are excluded from the scan */
  ignore?: string[];
  /** fail when any edge has strength >= minStrength AND locality >= minLocality */
  gate?: {
    minStrength: number;
    minLocality: number;
  };
  /** 'exclude' drops heuristic detectors (meaning/value/identity) from all output. Default 'include'. */
  heuristicFindings?: 'include' | 'exclude';
  /** fail the run when the architecture report (graph-detected modules) exceeds these */
  architecture?: {
    maxTangles?: number;
    maxCycles?: number;
    /** modules spanning more directories than this (structure/folder mismatch) */
    maxMismatches?: number;
    /** maximum SCC-collapsed dependency-chain depth (module levelization) */
    maxLevelizationDepth?: number;
  };
  /** temporal co-change candidate options (never gate; CLI flags override) */
  coChange?: {
    /** default true; false skips the git-history channel */
    enabled?: boolean;
    /** minimum shared commits (default 3) */
    minSupport?: number;
    /** minimum confidence, 0..1 (default 0.5) */
    minRatio?: number;
    /** commits of history inspected (default 500) */
    maxCommits?: number;
    /** mass edits touching more files than this are skipped (default 25) */
    maxFilesPerCommit?: number;
  };
}

/** Stable hash of the effective config: key order does not change it. */
export function configHash(config: ConnascenceConfig): string {
  const stable = (value: unknown): string => {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  };
  return createHash('sha256').update(stable(config)).digest('hex').slice(0, 16);
}

export function loadConfig(path = '.connascence.yml', required = false): ConnascenceConfig {
  if (!existsSync(path)) {
    if (required) throw new ConfigError(`${path}: config file not found`);
    return {};
  }
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${path}: ${(error as Error).message}`);
  }
  return validateConfig(raw, path);
}

/**
 * Config/default co-change options for the CLI. Explicit `--co-change=<n>`
 * overrides config; `--co-change=off` (0) disables it even when config enables
 * it. Returns null when the channel should be skipped.
 */
export function coChangeOptions(
  config: ConnascenceConfig,
  overrides: { minSupport?: number; maxCommits?: number } = {},
): CoChangeOptions | null {
  const c = config.coChange;
  if (overrides.minSupport === 0) return null;
  if (overrides.minSupport === undefined && c?.enabled === false) return null;
  return {
    minSupport: overrides.minSupport ?? c?.minSupport,
    minRatio: c?.minRatio,
    maxCommits: overrides.maxCommits ?? c?.maxCommits,
    maxFilesPerCommit: c?.maxFilesPerCommit,
  };
}

export interface Violation {
  kind: 'threshold' | 'gate' | 'architecture';
  message: string;
}

/** Drop heuristic-detector edges when configured (they are candidates, not certainties). */
export function filterHeuristics<T extends { connascenceType: string }>(edges: T[], config: ConnascenceConfig): T[] {
  return config.heuristicFindings === 'exclude' ? edges.filter((e) => !HEURISTIC_TYPES.has(e.connascenceType)) : edges;
}

/** name connascence is permanent import-by-name coupling: informational only. */
const INFORMATIONAL = new Set(['name']);

/**
 * Edges a CI diff gate may fail on. Heuristic detectors are candidates for a
 * human/agent to review; letting them fail the build turns a noisy guess into
 * an accusation (§6 discipline) and teaches the agent to stop trusting the
 * gate. Name edges are imports: every new dependency would fail the build even
 * though no design choice can avoid them.
 */
export function gateableEdges<T extends { connascenceType: string }>(edges: T[]): T[] {
  return edges.filter((e) => !INFORMATIONAL.has(e.connascenceType) && !HEURISTIC_TYPES.has(e.connascenceType));
}

/** Evaluate a scored report against the config. Pure function. */
export function evaluateConfig(report: ScanReport, config: ConnascenceConfig): Violation[] {
  const violations: Violation[] = [];
  for (const [type, max] of Object.entries(config.thresholds ?? {})) {
    const count = report.summary[type] ?? 0;
    if (count > (max as number)) {
      violations.push({ kind: 'threshold', message: `${type}: ${count} exceeds threshold ${max}` });
    }
  }
  if (config.gate) {
    const { minStrength, minLocality } = config.gate;
    const offenders = report.edges.filter(
      (e) => e.strength >= minStrength && e.locality >= minLocality,
    );
    if (offenders.length > 0) {
      violations.push({
        kind: 'gate',
        message: `${offenders.length} edge(s) at strength>=${minStrength} with locality>=${minLocality}`,
      });
    }
  }
  return violations;
}


