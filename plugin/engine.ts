// Engine bridge: the archived engine is used strictly as-is (M0 discipline).
// The plugin spawns the built CLI (`dist/cli.js`) and consumes its
// `--format=json` output; nothing here re-implements engine behavior.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Mirrors the engine's ScoredEdge (src/core/scoring/score.ts) JSON shape. */
export interface EdgeEndpoint {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  startLine: number;
  ownerName?: string;
}

export interface EngineEdge {
  nodeA: EdgeEndpoint;
  nodeB: EdgeEndpoint;
  connascenceType: string;
  strength: number;
  locality: number;
  degree: number;
  evidence: string;
  heuristic: boolean;
}

/** The engine CLI `scan --format=json` output. */
export interface EngineScan {
  summary: Record<string, number>;
  edges: EngineEdge[];
}

export interface ScanRequest {
  /** absolute path to the engine's dist/cli.js */
  engineEntry: string;
  /** working directory = monitored project root; globs resolve against it */
  cwd: string;
  globs: string[];
  timeoutMs: number;
}

export function parseScan(stdout: string): EngineScan {
  const parsed = JSON.parse(stdout) as EngineScan;
  if (!parsed || !Array.isArray(parsed.edges) || typeof parsed.summary !== 'object') {
    throw new Error('engine produced unexpected output (expected { summary, edges })');
  }
  return parsed;
}

/**
 * Pick the binary that runs dist/cli.js. Inside an opencode plugin,
 * process.execPath is opencode itself (a compiled Bun binary) — spawning it
 * would re-enter the opencode CLI. When execPath is a real JS runtime, use
 * it; otherwise fall back to `node` on PATH.
 */
export function runtimeBinary(execPath: string): string {
  const base = path.basename(execPath).toLowerCase().replace(/\.exe$/, '');
  return /^(node|bun|deno)$/.test(base) ? execPath : 'node';
}

export async function runScan(req: ScanRequest): Promise<EngineScan> {
  const args = [req.engineEntry, 'scan', ...req.globs, '--format=json'];
  const { stdout } = await execFileP(runtimeBinary(process.execPath), args, {
    cwd: req.cwd,
    timeout: req.timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return parseScan(stdout);
}

export function countEdges(scan: EngineScan): number {
  return scan.edges.length;
}
