import { parse } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';
import { ConnascenceType, IrProject } from './ir.js';
import { ScanReport } from './scoring/score.js';
import { strengthOf } from './scoring/strength.js';

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
}

export function loadConfig(path = '.connascence.yml'): ConnascenceConfig {
  if (!existsSync(path)) return {};
  return (parse(readFileSync(path, 'utf8')) as ConnascenceConfig) ?? {};
}

/** Simple glob match: ** crosses directories, * matches within one segment, ? one char. */
export function globMatch(pattern: string, pathValue: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/\u0000/g, '.*') +
      '$',
  );
  return re.test(pathValue.replace(/\\/g, '/'));
}

/** Drop IR nodes belonging to ignored files (edges referencing them fall away in detectors). */
export function applyIgnores(project: IrProject, ignore: string[] | undefined): void {
  if (!ignore || ignore.length === 0) return;
  project.nodes = project.nodes.filter(
    (n) => !ignore.some((pattern) => globMatch(pattern, n.location.filePath)),
  );
}

export interface Violation {
  kind: 'threshold' | 'gate';
  message: string;
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
