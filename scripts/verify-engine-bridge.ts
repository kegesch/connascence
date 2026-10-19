// Production-path check: import the plugin's engine bridge exactly as the
// opencode plugin runtime (Bun) would, and run a real scan. Run with:
//   bun run scripts/verify-engine-bridge.ts
import { runScan, runtimeBinary } from '../plugin/engine';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const entry = path.join(root, 'dist', 'cli.js');
const scan = await runScan({
  engineEntry: entry,
  cwd: root,
  globs: ['src/**/*.ts'],
  timeoutMs: 120_000,
});
console.log('runtime:', runtimeBinary(process.execPath));
console.log('summary:', JSON.stringify(scan.summary));
console.log('edges:', scan.edges.length);
if (scan.edges.length === 0) throw new Error('expected edges from src/ scan');
