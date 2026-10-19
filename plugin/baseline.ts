// Durable per-session baseline (PLAN.md §11 open item).
//
// The plugin reloads whenever a plugin source file changes, which resets
// in-memory state. Without persistence the next scan silently becomes the new
// baseline, so every edit made before the reload vanishes from the session
// diff and the "session start" baseline moves mid-session.
//
// The record lives in opencode's plugin storage, outside the monitored
// project, so the optimizing agent cannot read or edit it with project tools.
// Only edge keys are stored: the diff needs set membership, not full edges.

export interface BaselineRecord {
  /** ISO time the baseline scan was captured */
  at: string;
  /** number of edges in the baseline scan */
  count: number;
  /** edge keys, used to diff later scans */
  keys: string[];
  /** formula version and config hash: changed values invalidate the baseline */
  scoreVersion?: number;
  configHash?: string;
}

/** The subset of ctx.storage the plugin needs (fake-able in fixtures). */
export interface BaselineStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: BaselineRecord): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Bump when the edge-key scheme changes. The version is part of the storage
 * key, so a baseline captured under an older scheme is simply not found; the
 * session re-baselines instead of reporting every edge as newly added.
 */
export const BASELINE_KEY_VERSION = 2;

export function baselineKey(sessionID: string): string {
  return `baseline/v${BASELINE_KEY_VERSION}/${sessionID}`;
}

/** Storage is user-writable, so treat a malformed record as "no baseline". */
export function isBaselineRecord(value: unknown): value is BaselineRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BaselineRecord>;
  return (
    typeof v.at === 'string' &&
    typeof v.count === 'number' &&
    Number.isInteger(v.count) &&
    v.count >= 0 &&
    Array.isArray(v.keys) &&
    v.keys.every((k) => typeof k === 'string') &&
    v.count === v.keys.length &&
    (v.scoreVersion === undefined || typeof v.scoreVersion === 'number') &&
    (v.configHash === undefined || typeof v.configHash === 'string')
  );
}

export async function loadBaseline(
  store: BaselineStore,
  sessionID: string,
): Promise<BaselineRecord | null> {
  const value = await store.get(baselineKey(sessionID));
  return isBaselineRecord(value) ? value : null;
}

export async function saveBaseline(
  store: BaselineStore,
  sessionID: string,
  record: BaselineRecord,
): Promise<void> {
  await store.set(baselineKey(sessionID), record);
}

export async function clearBaseline(store: BaselineStore, sessionID: string): Promise<void> {
  await store.remove(baselineKey(sessionID));
}
