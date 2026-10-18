// Per-session sensor state: baseline, turn accounting, injection dedupe.
// State lives in plugin memory only — the optimizing agent cannot read or
// edit it (the plan's M3a replaces the crude working-tree baseline with a
// git-derived one; in-memory is this milestone's equivalent stance).

import { EngineEdge, EngineScan } from './engine.js';
import { edgeKey } from './diff.js';

export interface SensorState {
  /** scan captured at session start; null until the first scan lands */
  baseline: EngineScan | null;
  baselineAt: string | null;
  /** the agent was told the sensor exists (one system note per session) */
  notified: boolean;
  turns: number;
  injections: number;
  /** edge keys already injected — dedupes repeat reports of the same edge */
  reported: Set<string>;
}

export function createState(): SensorState {
  return { baseline: null, baselineAt: null, notified: false, turns: 0, injections: 0, reported: new Set() };
}

/** Store the baseline scan; first write wins. */
export interface BaselineResult {
  baseline: EngineScan;
  created: boolean;
}

export function ensureBaseline(state: SensorState, scan: EngineScan): BaselineResult {
  if (state.baseline) return { baseline: state.baseline, created: false };
  state.baseline = scan;
  state.baselineAt = new Date().toISOString();
  return { baseline: scan, created: true };
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
    baselineEdges: state.baseline ? state.baseline.edges.length : null,
    baselineAt: state.baselineAt,
  };
}
