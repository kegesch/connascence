#!/usr/bin/env node
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { scan } from './core/scan.js';
import { explain } from './core/explain.js';
import { loadConfig, evaluateConfig, filterHeuristics } from './core/config.js';
import { clusterFindings, fileHotspots } from './core/report/findings.js';
import { remediationFor } from './core/report/remediation.js';
import { dirCohesion, cohesionFix, fileSplits } from './core/report/cohesion.js';
import { evaluateArchitecture, architectureLevels } from './core/report/architecture.js';
import { renderArchitectureLevels } from './core/report/architectureRender.js';
import { toPosix } from './core/paths.js';
import { HEURISTIC_TYPES } from './core/scoring/score.js';
import type { ScoredEdge } from './core/scoring/score.js';
import { renderHtml } from './core/report/html.js';
import { renderSarif } from './core/report/sarif.js';
import { diffScan } from './core/diff.js';
import { resolveBaseRef } from './core/gitBase.js';
import { readCoChange } from './core/cochange.js';
import { renderCoChange } from './core/report/cochangeRender.js';
import { renderLevelization } from './core/report/levelizationRender.js';
import { scanJson } from './core/report/scanJson.js';
import { renderDiff } from './cliDiff.js';
import { typescriptBackend } from './languages/typescript/backend.js';

const OUTPUT_ENCODING: BufferEncoding = 'utf8';

function usage(): never {
  console.error('usage: connascence scan <path-glob...> [options]');
  console.error('  --min-strength=<1-9>   only show edges at/above this strength');
  console.error('  --type=<t>             only show this connascence type (comma-separated ok)');
  console.error('  --file=<pattern>       only edges touching files whose path contains this substring');
  console.error('  --min-degree=<n>       only edges with degree >= n');
  console.error('  --top=<n>              limit listed items (default 20, 0 = all)');
  console.error('  --format=summary|findings|architecture|json|html|sarif|agent  --out=<file> (JSON/HTML)');
  console.error('  --config=<file>        config file (default .connascence.yml if present)');
  console.error('  --co-change=<n|off>    temporal co-change candidate threshold (default 3 shared commits)');
  console.error('  --history=<n>          commits of git history to inspect (default 500)');
  console.error('       connascence explain <scan-glob...> -- <file>:<line>');
  console.error('       connascence diff <glob...> --repo=<path> [--base=<ref>] [--head=<ref>]');
  console.error('  (diff refs: --head omitted = working tree, --base omitted = merge-base with origin/HEAD/default; --format=agent = harness feedback)');
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
if (command !== 'scan' && command !== 'explain' && command !== 'diff') usage();

const patterns: string[] = [];
let minStrength = 0;
let format = 'summary';
let fileLine: string | undefined;
let configPath: string | undefined;
let outFile: string | undefined;
let top = 20;
let minDegree = 0;
let types: string[] = [];
let filePattern: string | undefined;
let repoPath: string | undefined;
let baseRef: string | undefined;
let headRef: string | undefined;
let minSeverity: 'low' | 'medium' | 'high' = 'medium';
let coChangeMin = 3;
let historyDepth = 500;

let v: string | undefined;
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  const opt = (name: string) => arg.startsWith(`--${name}=`) ? arg.split('=').slice(1).join('=') : undefined;
  if (arg === '--') fileLine = args[++i];
  else if ((v = opt('min-strength')) !== undefined) minStrength = Number(v);
  else if ((v = opt('format')) !== undefined) format = v;
  else if ((v = opt('out')) !== undefined) outFile = v;
  else if ((v = opt('config')) !== undefined) configPath = v;
  else if ((v = opt('top')) !== undefined) top = Number(v);
  else if ((v = opt('min-degree')) !== undefined) minDegree = Number(v);
  else if ((v = opt('type')) !== undefined) types = v.split(',').map((t) => t.trim());
  else if ((v = opt('file')) !== undefined) filePattern = v;
  else if ((v = opt('repo')) !== undefined) repoPath = v;
  else if ((v = opt('base')) !== undefined) baseRef = v;
  else if ((v = opt('head')) !== undefined) headRef = v;
  else if ((v = opt('min-severity')) !== undefined) minSeverity = v as 'low' | 'medium' | 'high';
  else if ((v = opt('co-change')) !== undefined) coChangeMin = v === 'off' ? 0 : Number(v);
  else if ((v = opt('history')) !== undefined) historyDepth = Number(v);
  else if (!fileLine) patterns.push(arg);
}
if (patterns.length === 0) usage();

const config = loadConfig(configPath);

// ---- diff command: coupling introduced/removed between git refs ----
if (command === 'diff') {
  if (!repoPath) usage();
  const base = resolveBaseRef(repoPath, baseRef);
  if (!base) {
    console.error('error: could not derive a base ref (no origin/HEAD or default branch); pass --base=<ref>');
    process.exit(1);
  }
  const result = diffScan({ scanFn: scan, backend: typescriptBackend, repoPath, base: base.ref, head: headRef, globs: patterns, config });
  process.exit(renderDiff({
    result,
    config,
    repoPath,
    base,
    head: headRef,
    format,
    outFile,
    top,
    minStrength,
    types,
    filePattern,
  }));
}

const report = scan(patterns, config, typescriptBackend);
if (command === 'scan' && coChangeMin > 0) {
  report.coChange = readCoChange(process.cwd(), {
    globs: patterns,
    ignore: config.ignore,
    minSupport: coChangeMin,
    maxCommits: historyDepth,
  });
}

let edges = filterHeuristics(report.edges, config);
if (minStrength > 0) edges = edges.filter((e) => e.strength >= minStrength);
if (types.length > 0) edges = edges.filter((e) => types.includes(e.connascenceType));
if (minDegree > 0) edges = edges.filter((e) => e.degree >= minDegree);
if (filePattern) {
  const p = filePattern.replace(/\\/g, '/').toLowerCase();
  edges = edges.filter(
    (e) => e.nodeA.filePath.replace(/\\/g, '/').toLowerCase().includes(p) || e.nodeB.filePath.replace(/\\/g, '/').toLowerCase().includes(p),
  );
}

const rel = (p: string) => {
  const r = path.relative('.', p).replace(/\\/g, '/');
  return r.startsWith('..') ? p.replace(/\\/g, '/') : r || '.';
};

const printLevelization = (): void => {
  const lines = renderLevelization(report.levelization, rel, 5);
  if (lines.length > 0) console.log(`\n${lines.join('\n')}`);
};

if (command === 'explain') {
  if (!fileLine) usage();
  const hits = explain(report, path.resolve(fileLine));
  if (hits.length === 0) {
    console.log(`no connascence edges touch ${fileLine}`);
  } else {
    console.log(`edges touching ${fileLine}:`);
    for (const e of hits) {
      console.log(`  [${e.connascenceType} strength=${e.strength} locality=${e.locality} degree=${e.degree}]`);
      console.log(`    A: ${rel(e.nodeA.filePath)}:${e.nodeA.startLine} (${e.nodeA.kind} ${e.nodeA.name})`);
      console.log(`    B: ${rel(e.nodeB.filePath)}:${e.nodeB.startLine} (${e.nodeB.kind} ${e.nodeB.name})`);
      console.log(`    ${e.evidence}`);
    }
  }
  process.exit(0);
}

if (format === 'summary') {
  // default linter-style report: clustered, severity-ranked, human/agent readable
  let findings = clusterFindings(edges, report.cycles ?? []);
  // name connascence is import-by-name coupling — permanent, unavoidable, no action
  // possible. Show it only when explicitly requested; the edges stay in --format=json.
  if (!types.includes('name')) findings = findings.filter((f) => f.kind !== 'name');
  const SEV_ORDER = { high: 2, medium: 1, low: 0 };
  const cutoff = SEV_ORDER[minSeverity];
  const shown = findings.filter((f) => SEV_ORDER[f.severity] >= cutoff);
  const hiddenLow = findings.length - shown.length;

  // fix-first report: each finding ships with its remediation; raw measurements
  // (strength/locality/degree/counts) stay out of the default view — --format=json has them
  if (shown.length === 0) {
    console.log(`OK: no coupling findings at severity >= ${minSeverity}.`);
    printLevelization();
    for (const line of renderCoChange(report.coChange ?? [], rel, top)) console.log(line);
    process.exit(0);
  }
  for (const sev of ['high', 'medium', 'low'] as const) {
    const group = shown.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    console.log(`\n${sev.toUpperCase()} (${group.length})${sev === 'low' ? ' — candidates, review before acting' : ''}`);
    const listed = top > 0 ? group.slice(0, top) : group;
    for (const f of listed) {
      console.log(`  ${f.kind} x${f.edgeCount} — ${f.summary.slice(0, 240)}`);
      console.log(`    fix: ${remediationFor(f)}`);
      for (const m of f.members.slice(0, 5)) {
        console.log(`      ${rel(m.filePath)}:${m.startLine} (${m.name})`);
      }
      if (f.members.length > 5) console.log(`      ... +${f.members.length - 5} more locations`);
    }
    if (top > 0 && group.length > top) console.log(`  ... ${group.length - top} more ${sev} findings`);
  }
  if (hiddenLow > 0) console.log(`\n${hiddenLow} lower-severity finding(s) hidden — use --min-severity=low to see them`);
  const hotspots = fileHotspots(edges).slice(0, 5);
  if (hotspots.length > 0) {
    console.log('\nfix these files first (most coupling):');
    for (const h of hotspots) console.log(`  ${rel(h.filePath)}  (${h.edgeCount} edges)`);
  }
  printLevelization();
  const cohesion = dirCohesion(edges).slice(0, 5);
  const relDir = (d: string) => toPosix(path.relative('.', d)) || '.';
  if (cohesion.length > 0) {
    console.log('\nmodule structure (directory cohesion):');
    for (const c of cohesion) {
      console.log(`  ${relDir(c.dir)} — ${c.files} files, ${c.internalEdges} internal / ${c.externalEdges} external edges`);
      for (const fix of cohesionFix(c).map((l) => l.split(c.dir).join(relDir(c.dir)))) {
        console.log(`    fix: ${fix}`);
      }
    }
  }
  const splits = fileSplits(edges).slice(0, 3);
  if (splits.length > 0) {
    console.log('\nsplit candidates (files with independent function groups):');
    for (const s of splits) {
      console.log(`  ${rel(s.file)} — ${s.groups.length} independent function groups:`);
      console.log(
        `    fix: split into separate modules: ${s.groups.slice(0, 3).map((g) => `[${g.slice(0, 5).map((f) => `${f.name}:${f.startLine}`).join(', ')}${g.length > 5 ? ', …' : ''}]`).join(' ')}`,
      );
    }
  }
  for (const line of renderCoChange(report.coChange ?? [], rel, top)) console.log(line);
  process.exit(0);
}

if (format === 'architecture') {
  const levels = architectureLevels(edges);
  for (const line of renderArchitectureLevels(levels, rel)) console.log(line);
  // gate at every level of the module hierarchy � submodules must be clean too
  const archViolations = levels.flatMap((lvl, i) =>
    evaluateArchitecture(lvl, config).map((v) => ({ ...v, message: `level ${i + 1}: ${v.message}` })),
  );
  if (archViolations.length > 0) {
    console.error('\narchitecture violations:');
    for (const v of archViolations) console.error(`  [${v.kind}] ${v.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (format === 'html') {
  const html = renderHtml({ summary: report.summary, edges });
  if (outFile) {
    writeFileSync(outFile, html, OUTPUT_ENCODING);
    console.log(`wrote HTML report to ${outFile}`);
  } else {
    process.stdout.write(html);
  }
} else if (format === 'sarif') {
  const sarif = renderSarif({
    edges,
    repoRoot: path.resolve('.'),
    cycles: report.cycles ?? [],
    coChange: report.coChange ?? [],
  });
  if (outFile) {
    writeFileSync(outFile, sarif, OUTPUT_ENCODING);
    console.log(`wrote SARIF report to ${outFile}`);
  } else {
    console.log(sarif);
  }
} else if (outFile) {
  writeFileSync(outFile, scanJson(report, edges), OUTPUT_ENCODING);
  console.log(`wrote ${edges.length} edges to ${outFile}`);
} else if (format === 'json') {
  console.log(scanJson(report, edges));
} else if (format === 'findings') {
  const findings = clusterFindings(edges, report.cycles ?? []);
  console.log(`clustered ${edges.length} edges into ${findings.length} findings:\n`);
  const listedFindings = top > 0 ? findings.slice(0, top) : findings;
  for (const f of listedFindings) {
    console.log(`  [${f.kind} s${f.worst.strength} x${f.members.length} members] ${f.summary.slice(0, 160)}`);
    for (const m of f.members.slice(0, 5)) {
      console.log(`      - ${rel(m.filePath)}:${m.startLine} (${m.name})`);
    }
    if (f.members.length > 5) console.log(`      - ... ${f.members.length - 5} more`);
  }
  console.log(`\nfile hotspots (worst first):`);
  for (const h of fileHotspots(edges).slice(0, 12)) {
    console.log(`  ${String(h.edgeCount).padStart(4)} edges  max-degree ${String(h.maxDegree).padStart(3)}  ${rel(h.filePath)}`);
  }
  printLevelization();
  for (const line of renderCoChange(report.coChange ?? [], rel, top)) console.log(line);
} else {
  console.log('connascence scan summary');
  for (const [type, count] of Object.entries(report.summary)) {
    console.log(`  ${type}${HEURISTIC_TYPES.has(type) ? ' (heuristic)' : ''}: ${count}`);
  }

  // certainty-adjusted default view: deterministic findings first, heuristic candidates after
  const confirmed = edges.filter((e) => !e.heuristic);
  const candidates = edges.filter((e) => e.heuristic);

  const printEdges = (label: string, list: ScoredEdge[]): void => {
    console.log(`\n${label} (of ${list.length}):`);
    const listed = top > 0 ? list.slice(0, top) : list;
    if (listed.length === 0) console.log('  (none)');
    for (const e of listed) {
      console.log(
        `  [${e.connascenceType} s${e.strength} l${e.locality} d${e.degree}] ${rel(e.nodeA.filePath)}:${e.nodeA.startLine} <-> ${rel(e.nodeB.filePath)}:${e.nodeB.startLine} — ${e.evidence}`,
      );
    }
  };
  printEdges('top confirmed edges', confirmed);
  printEdges('top candidates (heuristic — review before acting)', candidates);
  printLevelization();
  for (const line of renderCoChange(report.coChange ?? [], rel, top)) console.log(line);
}

const violations = evaluateConfig(report, config);
if (violations.length > 0) {
  console.error('\nconfig violations:');
  for (const v of violations) console.error(`  [${v.kind}] ${v.message}`);
  process.exit(1);
}
