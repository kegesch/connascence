#!/usr/bin/env node
import { scan } from './scan.js';

function usage(): never {
  console.error('usage: connascence scan <path-glob...> [--min-strength=<1-9>] [--format=json|summary]');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] !== 'scan') usage();

const patterns: string[] = [];
let minStrength = 0;
let format = 'summary';
for (const arg of args.slice(1)) {
  if (arg.startsWith('--min-strength=')) minStrength = Number(arg.split('=')[1]);
  else if (arg.startsWith('--format=')) format = arg.split('=')[1];
  else patterns.push(arg);
}
if (patterns.length === 0) usage();

const report = scan(patterns);
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
}
