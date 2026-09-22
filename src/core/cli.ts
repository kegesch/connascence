#!/usr/bin/env node
import path from 'node:path';
import { scan } from './scan.js';
import { explain } from './explain.js';
import { loadConfig, evaluateConfig } from './config.js';

function usage(): never {
  console.error('usage: connascence scan <path-glob...> [--min-strength=<1-9>] [--format=json|summary] [--config=<file>]');
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
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--') fileLine = args[i + 1];
  else if (arg.startsWith('--min-strength=')) minStrength = Number(arg.split('=')[1]);
  else if (arg.startsWith('--format=')) format = arg.split('=')[1];
  else if (arg.startsWith('--config=')) configPath = arg.split('=').slice(1).join('=');
  else if (!fileLine) patterns.push(arg);
}
if (patterns.length === 0) usage();

const config = loadConfig(configPath);
const report = scan(patterns, config);

if (command === 'explain') {
  if (!fileLine) usage();
  const edges = explain(report, path.resolve(fileLine));
  if (edges.length === 0) {
    console.log(`no connascence edges touch ${fileLine}`);
    process.exit(0);
  }
  console.log(`edges touching ${fileLine}:`);
  for (const e of edges) {
    console.log(
      `  [${e.connascenceType} strength=${e.strength} locality=${e.locality} degree=${e.degree}]`,
    );
    console.log(`    A: ${e.nodeA.filePath}:${e.nodeA.startLine} (${e.nodeA.kind} ${e.nodeA.name})`);
    console.log(`    B: ${e.nodeB.filePath}:${e.nodeB.startLine} (${e.nodeB.kind} ${e.nodeB.name})`);
    console.log(`    ${e.evidence}`);
  }
  process.exit(0);
}

const edges = minStrength > 0 ? report.edges.filter((e) => e.strength >= minStrength) : report.edges;

if (format === 'json') {
  console.log(JSON.stringify({ summary: report.summary, edges }, null, 2));
} else {
  console.log('connascence scan summary');
  for (const [type, count] of Object.entries(report.summary)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\ntop edges (of ${edges.length}):`);
  for (const e of edges.slice(0, 20)) {
    console.log(
      `  [${e.connascenceType} s${e.strength} l${e.locality} d${e.degree}] ${e.nodeA.filePath.split(/[\\/]/).pop()}:${e.nodeA.startLine} <-> ${e.nodeB.filePath.split(/[\\/]/).pop()}:${e.nodeB.startLine} — ${e.evidence}`,
    );
  }

  const violations = evaluateConfig(report, config);
  if (violations.length > 0) {
    console.error('\nconfig violations:');
    for (const v of violations) console.error(`  [${v.kind}] ${v.message}`);
    process.exit(1);
  }
}
