// Crude payload rendering (M0). The real feedback-payload spec (token budget,
// top-N, cluster dedup, vector output) is a first-class M4 deliverable; this
// file is intentionally minimal — its job is to make the loop testable, and
// its failure modes (too big, wrong top-N, noisy) are M0 experiment data.
//
// Fix hints are imported from the engine's remediation table (single source of
// truth — the plugin never re-states engine advice).

import path from 'node:path';
import { remediationForType } from '../dist/core/report/remediation.js';
import { EngineEdge, EngineScan } from './engine.js';
import { SensorOptions } from './options.js';

/** name connascence is permanent import-by-name coupling: informational only. */
const INFORMATIONAL = new Set(['name']);

export function isReportable(e: EngineEdge, includeHeuristics: boolean): boolean {
  if (INFORMATIONAL.has(e.connascenceType)) return false;
  return includeHeuristics || !e.heuristic;
}

/** Deterministic worst-first order: strength, locality, degree, then location. */
export function rank(edges: EngineEdge[]): EngineEdge[] {
  const loc = (e: EngineEdge) =>
    `${e.nodeA.filePath}:${e.nodeA.startLine}|${e.nodeB.filePath}:${e.nodeB.startLine}`;
  return [...edges].sort(
    (a, b) =>
      b.strength - a.strength ||
      b.locality - a.locality ||
      b.degree - a.degree ||
      loc(a).localeCompare(loc(b)),
  );
}

export function relPath(cwd: string, p: string): string {
  const rel = path.relative(cwd, p).replace(/\\/g, '/');
  return rel.startsWith('..') || rel === '' ? p.replace(/\\/g, '/') : rel;
}

function endpoint(cwd: string, n: EngineEdge['nodeA']): string {
  return `${relPath(cwd, n.filePath)}:${n.startLine} (${n.name})`;
}

function edgeLine(cwd: string, e: EngineEdge): string {
  const candidate = e.heuristic ? ' [candidate - review]' : '';
  return [
    `- ${e.connascenceType}${candidate} (s${e.strength} l${e.locality}): ${endpoint(cwd, e.nodeA)} <-> ${endpoint(cwd, e.nodeB)}`,
    `  fix: ${remediationForType(e.connascenceType)}`,
  ].join('\n');
}

function truncate(text: string, budgetChars: number): string {
  if (text.length <= budgetChars) return text;
  const cut = text.slice(0, budgetChars);
  const lastBreak = cut.lastIndexOf('\n');
  return `${cut.slice(0, lastBreak > 0 ? lastBreak : budgetChars)}\n... (payload truncated at ${budgetChars} chars)`;
}

export interface InjectionInput {
  added: EngineEdge[];
  edgesBefore: number;
  edgesAfter: number;
  cwd: string;
  opts: Pick<SensorOptions, 'top' | 'budgetChars'>;
}

export function renderInjection(input: InjectionInput): string {
  const ranked = rank(input.added);
  const shown = ranked.slice(0, Math.max(1, input.opts.top));
  const lines = [
    `coupling sensor: ${input.added.length} new coupling instance(s) this session ` +
      `(edges ${input.edgesBefore} -> ${input.edgesAfter}). Advisory: fix the new instances; keep the fix local.`,
  ];
  for (const e of shown) lines.push(edgeLine(input.cwd, e));
  if (ranked.length > shown.length) {
    lines.push(`... ${ranked.length - shown.length} more — call coupling_scan for the full list.`);
  }
  return truncate(lines.join('\n'), input.opts.budgetChars);
}

export function summaryLine(summary: Record<string, number>): string {
  const parts = Object.entries(summary)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} ${count}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

export interface HealthInput {
  scan: EngineScan;
  edgesBefore: number | null;
  cwd: string;
  opts: Pick<SensorOptions, 'top' | 'budgetChars'>;
}

export function renderHealth(input: HealthInput): string {
  const { scan, edgesBefore } = input;
  const total = scan.edges.length;
  const lines = [`coupling sensor: ${total} edges (${summaryLine(scan.summary)})`];
  if (edgesBefore !== null) {
    const delta = total - edgesBefore;
    lines.push(`session delta: ${delta >= 0 ? '+' : ''}${delta} edges since baseline`);
  }
  const hotspots = fileHotspots(scan.edges, input.opts.top, input.cwd);
  if (hotspots.length > 0) {
    lines.push(`most-coupled files: ${hotspots.join(', ')}`);
  }
  return truncate(lines.join('\n'), input.opts.budgetChars);
}

function fileHotspots(edges: EngineEdge[], top: number, cwd: string): string[] {
  const counts = new Map<string, number>();
  for (const e of edges) {
    counts.set(e.nodeA.filePath, (counts.get(e.nodeA.filePath) ?? 0) + 1);
    counts.set(e.nodeB.filePath, (counts.get(e.nodeB.filePath) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, top))
    .map(([file, count]) => `${relPath(cwd, file)} (${count})`);
}

export interface ScanReportInput {
  scan: EngineScan;
  reportable: EngineEdge[];
  cwd: string;
  opts: Pick<SensorOptions, 'top' | 'budgetChars'>;
}

export function renderScanReport(input: ScanReportInput): string {
  const ranked = rank(input.reportable);
  const shown = ranked.slice(0, Math.max(1, input.opts.top));
  const lines = [
    `${input.scan.edges.length} edges total (${summaryLine(input.scan.summary)}); ` +
      `${ranked.length} actionable:`,
  ];
  for (const e of shown) lines.push(edgeLine(input.cwd, e));
  if (ranked.length > shown.length) {
    lines.push(`... ${ranked.length - shown.length} more actionable instances.`);
  }
  return truncate(lines.join('\n'), input.opts.budgetChars);
}
