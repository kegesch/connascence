#!/usr/bin/env node
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { scan } from './scan.js';
import { explain } from './explain.js';
import { loadConfig, evaluateConfig } from './config.js';
import { clusterFindings, fileHotspots } from './report/findings.js';

function usage(): never {
  console.error('usage: connascence scan <path-glob...> [options]');
  console.error('  --min-strength=<1-9>   only show edges at/above this strength');
  console.error('  --type=<t>             only show this connascence type (comma-separated ok)');
  console.error('  --file=<pattern>       only edges touching files whose path contains this substring');
  console.error('  --min-degree=<n>       only edges with degree >= n');
  console.error('  --top=<n>              limit listed edges (default 20, 0 = all)');
  console.error('  --format=json|summary|findings');
  console.error('  --out=<file>           write JSON report to file (UTF-8) instead of stdout');
  console.error('  --config=<file>        config file (default .connascence.yml if present)');
  console.error('       connascence explain <scan-glob...> -- <file>:<line>');
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
if (command !== 'scan' && command !== 'explain') usage();

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
  else if (!fileLine) patterns.push(arg);
}
if (patterns.length === 0) usage();

const config = loadConfig(configPath);
const report = scan(patterns, config);

let edges = report.edges;
if (minStrength > 0) edges = edges.filter((e) => e.strength >= minStrength);
if (types.length > 0) edges = edges.filter((e) => types.includes(e.connascenceType));
if (minDegree > 0) edges = edges.filter((e) => e.degree >= minDegree);
if (filePattern) {
  const p = filePattern.replace(/\\/g, '/').toLowerCase();
  edges = edges.filter(
    (e) => e.nodeA.filePath.replace(/\\/g, '/').toLowerCase().includes(p) || e.nodeB.filePath.replace(/\\/g, '/').toLowerCase().includes(p),
  );
}

const rel = (p: string) => p.replace(/\\/g, '/').replace(/^.*chordel\/app\//, '');

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

if (outFile) {
  writeFileSync(outFile, JSON.stringify({ summary: report.summary, edges }, null, 2), 'utf8');
  console.log(`wrote ${edges.length} edges to ${outFile}`);
} else if (format === 'json') {
  console.log(JSON.stringify({ summary: report.summary, edges }, null, 2));
} else if (format === 'findings') {
  const findings = clusterFindings(edges);
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
} else {
  console.log('connascence scan summary');
  for (const [type, count] of Object.entries(report.summary)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\ntop edges (of ${edges.length}):`);
  const listed = top > 0 ? edges.slice(0, top) : edges;
  for (const e of listed) {
    console.log(
      `  [${e.connascenceType} s${e.strength} l${e.locality} d${e.degree}] ${rel(e.nodeA.filePath)}:${e.nodeA.startLine} <-> ${rel(e.nodeB.filePath)}:${e.nodeB.startLine} — ${e.evidence}`,
    );
  }
}

const violations = evaluateConfig(report, config);
if (violations.length > 0) {
  console.error('\nconfig violations:');
  for (const v of violations) console.error(`  [${v.kind}] ${v.message}`);
  process.exit(1);
}
