// Per-session sensor state: baseline, turn accounting, injection dedupe.
// Baseline keys are captured at session start and persisted through plugin
// reloads (see baseline.ts); the rest stays in plugin memory.
//
// M3a's structural edge identity is in place (diff.ts): keys survive renames
// and file moves. The baseline is still the session-start working tree; the CI
// gate recomputes its baseline from the merge-base instead.

import { EngineEdge, EngineScan } from './engine.js';
import { edgeKey } from './diff.js';

export interface Baseline {
  /** ISO time the baseline scan was captured */
  at: string;
  /** number of edges in the baseline scan */
  count: number;
  /** edge keys — set membership is all a later scan diff needs */
  keys: string[];
  /** score formula/config stamp; a mismatch means the baseline is not comparable */
  scoreVersion?: number;
  configHash?: string;
  score?: number;
}

export interface SensorState {
  /** scan captured at session start; null until the first scan lands */
  baseline: Baseline | null;
  /** the agent was told the sensor exists (one system note per session) */
  notified: boolean;
  turns: number;
  injections: number;
  /** edge keys already injected — dedupes repeat reports of the same edge */
  reported: Set<string>;
}

export function createState(): SensorState {
  return { baseline: null, notified: false, turns: 0, injections: 0, reported: new Set() };
}

export function baselineFromScan(scan: EngineScan, at = new Date().toISOString()): Baseline {
  const quality = scan.quality;
  return {
    at,
    count: scan.edges.length,
    keys: scan.edges.map(edgeKey),
    scoreVersion: quality?.scoreVersion,
    configHash: quality?.configHash,
    score: quality?.score,
  };
}

/** A formula or config change makes the persisted baseline incomparable. */
export function isStaleBaseline(baseline: Baseline, scan: EngineScan): boolean {
  const quality = scan.quality;
  if (!quality) return false;
  return baseline.scoreVersion !== quality.scoreVersion || baseline.configHash !== quality.configHash;
}

/** Replace the session baseline after an invalidating score/config change. */
export async function replaceBaseline(
  state: SensorState,
  scan: EngineScan,
  persist: (baseline: Baseline) => Promise<void>,
): Promise<Baseline> {
  const baseline = baselineFromScan(scan);
  state.baseline = baseline;
  await persist(baseline);
  return baseline;
}

/** Store the baseline scan; first write wins. */
export interface BaselineResult {
  baseline: Baseline;
  created: boolean;
}

export function ensureBaseline(state: SensorState, scan: EngineScan): BaselineResult {
  if (state.baseline) return { baseline: state.baseline, created: false };
  state.baseline = baselineFromScan(scan);
  return { baseline: state.baseline, created: true };
}

/** Adopt a persisted baseline after a reload; first write wins. */
export function adoptBaseline(state: SensorState, baseline: Baseline): boolean {
  if (state.baseline) return false;
  state.baseline = baseline;
  return true;
}

/** Added edges not yet reported for this session. */
export function freshAdded(state: SensorState, added: EngineEdge[]): EngineEdge[] {
  return added.filter((e) => !state.reported.has(edgeKey(e)));
}

/** Record edges as reported — call BEFORE delivering the payload. */
export function markReported(state: SensorState, edges: EngineEdge[]): void {
  for (const e of edges) state.reported.add(edgeKey(e));
}

/** Final summary for the observation log / session report. */
export function sessionSummary(state: SensorState): Record<string, unknown> {
  return {
    turns: state.turns,
    injections: state.injections,
    baselineEdges: state.baseline ? state.baseline.count : null,
    baselineAt: state.baseline ? state.baseline.at : null,
    baselineScore: state.baseline?.score ?? null,
    scoreVersion: state.baseline?.scoreVersion ?? null,
    configHash: state.baseline?.configHash ?? null,
  };
}
