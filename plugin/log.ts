// M0 observation log. Every sensor event relevant to the loop experiment is
// appended to .coupling/sensor-log.jsonl in the monitored project: baselines,
// turn scans, injections, suppressions, tool calls, session end. This file is
// the raw material for the M0 exit criteria ("documented behavior-change
// cases, or documented reasons the signal was ignored").
//
// Known M0 weakness: the log lives in the project the agent controls, so it
// is evidence, not enforcement. CI-side enforcement arrives with the M3a
// git-derived baseline; forging this log is itself experiment data.

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOG_FILE = 'sensor-log.jsonl';

/** Serialize appends so concurrent events cannot interleave partial lines. */
let chain: Promise<void> = Promise.resolve();

async function appendLine(logDir: string, event: Record<string, unknown>): Promise<void> {
  await mkdir(logDir, { recursive: true });
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
  await appendFile(path.join(logDir, LOG_FILE), line, 'utf8');
}

export function appendLog(
  logDir: string,
  event: Record<string, unknown>,
): Promise<void> {
  const run = chain.then(() => appendLine(logDir, event));
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface SessionReport {
  sessionID: string;
  endedAt: string;
  summary: Record<string, unknown>;
  finalEdges: number | null;
}

export async function writeSessionReport(
  logDir: string,
  report: SessionReport,
): Promise<string> {
  await mkdir(logDir, { recursive: true });
  const file = path.join(logDir, `session-${report.sessionID.slice(-8)}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}
