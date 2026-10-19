// `diff` rendering and gate decision, split out of cli.ts to keep that file
// under the size limit (AGENTS.md) and to make the gate rule testable:
// heuristic edges are shown but never decide the exit code; resolved dependency
// cycles and confirmed edges do.

import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { DiffResult } from './core/diff.js';
import { ConnascenceConfig, filterHeuristics, gateableEdges } from './core/config.js';
import { HEURISTIC_TYPES } from './core/scoring/score.js';
import { remediationForType } from './core/report/remediation.js';
import { renderSarif } from './core/report/sarif.js';
import type { FileCycle } from './core/report/cycles.js';
import type { ResolvedBase } from './core/gitBase.js';

export interface DiffReportOptions {
  result: DiffResult;
  config: ConnascenceConfig;
  repoPath: string;
  base: ResolvedBase;
  head?: string;
  format: string;
  outFile?: string;
  top: number;
  minStrength: number;
  types: string[];
  filePattern?: string;
}

const rel = (p: string): string => p.replace(/\\/g, '/').replace(/^.*\/(src|lib|app)\//, '$1/');

function filteredAdded(opts: DiffReportOptions): DiffResult['added'] {
  let added = filterHeuristics(opts.result.added, opts.config);
  if (opts.minStrength > 0) added = added.filter((e) => e.strength >= opts.minStrength);
  if (opts.types.length > 0) added = added.filter((e) => opts.types.includes(e.connascenceType));
  if (opts.filePattern) {
    const p = opts.filePattern.replace(/\\/g, '/').toLowerCase();
    added = added.filter(
      (e) => e.nodeA.filePath.toLowerCase().includes(p) || e.nodeB.filePath.toLowerCase().includes(p),
    );
  }
  return added;
}

/** Cycle path for humans/agents; the closing member makes the loop explicit. */
function cyclePath(c: FileCycle): string {
  return [...c.files.map(rel), rel(c.files[0])].join(' -> ');
}

function renderJson(opts: DiffReportOptions, added: DiffResult['added'], confirmed: DiffResult['added']): void {
  const { result, base, repoPath, outFile } = opts;
  const payload = opts.format === 'sarif'
    ? renderSarif({ edges: added, repoRoot: path.resolve(repoPath), cycles: result.addedCycles })
    : JSON.stringify(
      {
        base: base.ref,
        baseSource: base.source,
        addedCount: added.length,
        confirmedCount: confirmed.length + result.addedCycles.length,
        addedCycleCount: result.addedCycles.length,
        removedCycleCount: result.removedCycles.length,
        removedCount: result.removed.length,
        summaryBefore: result.baseSummary,
        summaryAfter: result.headSummary,
        added,
        removed: result.removed,
        addedCycles: result.addedCycles,
        removedCycles: result.removedCycles,
      },
      null,
      2,
    );
  if (outFile) {
    writeFileSync(outFile, payload, 'utf8');
    console.log(`wrote diff report to ${outFile}`);
  } else {
    console.log(payload);
  }
}

function printCycle(c: FileCycle): void {
  console.log(`- cycle: ${c.files.map(rel).join(' <-> ')}`);
  console.log(
    `  fix: break the cycle by moving the shared definition into a third module (or invert one dependency with an interface) so the members depend one way only`,
  );
}

function printEdge(e: DiffResult['added'][number], candidate: boolean): void {
  const label = candidate ? ' [candidate - review]' : '';
  console.log(
    `- ${e.connascenceType}${label}: ${rel(e.nodeA.filePath)}:${e.nodeA.startLine} (${e.nodeA.name}) <-> ${rel(e.nodeB.filePath)}:${e.nodeB.startLine} (${e.nodeB.name})`,
  );
  console.log(`  fix: ${remediationForType(e.connascenceType)}`);
}

interface AgentDiff {
  added: DiffResult['added'];
  confirmed: DiffResult['added'];
  cycles: FileCycle[];
  top: number;
}

function renderAgent({ added, confirmed, cycles, top }: AgentDiff): void {
  if (added.length === 0 && cycles.length === 0) {
    console.log('OK: no new coupling introduced.');
    return;
  }
  if (cycles.length > 0) {
    console.log(`WARNING: ${cycles.length} new dependency cycle(s) introduced:`);
    for (const c of cycles) printCycle(c);
  }
  if (confirmed.length > 0) {
    console.log(`WARNING: ${confirmed.length} new confirmed coupling instance(s) introduced:`);
    for (const e of (top > 0 ? confirmed.slice(0, top) : confirmed)) printEdge(e, false);
  }
  const candidates = added.filter((e) => HEURISTIC_TYPES.has(e.connascenceType));
  if (candidates.length > 0) {
    console.log(`NOTE: ${candidates.length} heuristic candidate(s), not gate-eligible:`);
    for (const e of (top > 0 ? candidates.slice(0, top) : candidates)) printEdge(e, true);
  }
  if (top > 0 && added.length > top) console.log(`- ... ${added.length - top} more`);
}

function renderSummary(opts: DiffReportOptions, added: DiffResult['added'], confirmed: DiffResult['added']): void {
  const { base, head, result, top } = opts;
  const baseLabel = base.source === 'explicit --base' ? base.ref : `${base.source} (${base.ref.slice(0, 8)})`;
  console.log(`connascence diff ${baseLabel}..${head ?? 'working'}`);
  console.log(`  summary before: ${JSON.stringify(result.baseSummary)}`);
  console.log(`  summary after:  ${JSON.stringify(result.headSummary)}`);
  if (result.addedCycles.length > 0) {
    console.log(`\nnew dependency cycles (${result.addedCycles.length}):`);
    for (const c of result.addedCycles) console.log(`  + ${cyclePath(c)}`);
  }
  if (result.removedCycles.length > 0) {
    console.log(`\nresolved dependency cycles (${result.removedCycles.length}):`);
    for (const c of result.removedCycles) console.log(`  - ${cyclePath(c)}`);
  }
  console.log(`\nadded (${added.length}; ${confirmed.length} confirmed, ${added.length - confirmed.length} candidates):`);
  for (const e of (top > 0 ? added.slice(0, top) : added)) {
    console.log(
      `  + [${e.connascenceType} s${e.strength} l${e.locality}] ${rel(e.nodeA.filePath)}:${e.nodeA.startLine} <-> ${rel(e.nodeB.filePath)}:${e.nodeB.startLine} — ${e.evidence.slice(0, 140)}`,
    );
  }
  console.log(`\nremoved (${result.removed.length})`);
}

/** Render the diff in the requested format; returns the process exit code. */
export function renderDiff(opts: DiffReportOptions): number {
  const added = filteredAdded(opts);
  const confirmed = gateableEdges(added);
  const cycles = opts.result.addedCycles;
  if (opts.format === 'json' || opts.outFile) renderJson(opts, added, confirmed);
  else if (opts.format === 'agent') renderAgent({ added, confirmed, cycles, top: opts.top });
  else renderSummary(opts, added, confirmed);
  return confirmed.length + cycles.length > 0 ? 1 : 0;
}
