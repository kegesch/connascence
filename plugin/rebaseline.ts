// Baseline invalidation is its own seam so the loop runtime stays small: a
// score-version or config-hash mismatch replaces the session baseline instead
// of diffing incomparable edge sets.

import type { EngineScan } from './engine.js';
import type { Baseline, SensorState } from './sensor.js';
import { replaceBaseline } from './sensor.js';

export interface RebaselineHooks {
  persist: (baseline: Baseline) => Promise<void>;
  log: (event: Record<string, unknown>) => Promise<void>;
}

export async function invalidateBaseline(
  sessionID: string,
  state: SensorState,
  scan: EngineScan,
  hooks: RebaselineHooks,
): Promise<Baseline> {
  const baseline = await replaceBaseline(state, scan, hooks.persist);
  await hooks.log({
    event: 'baseline_invalidated',
    sessionID,
    edges: baseline.count,
    scoreVersion: baseline.scoreVersion,
    configHash: baseline.configHash,
  });
  return baseline;
}
