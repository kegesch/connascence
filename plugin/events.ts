// Event dispatch contract (PLAN.md §8 M0). Maps a raw opencode event to the
// sensor branch it should trigger. Pure and opencode-independent so the
// contract is fixture-testable; loop.ts owns the I/O.
//
// Observed v2 surface (2.0.26, measured — see .coupling/sensor-log.jsonl):
// the plugin stream delivers `session.step.*`, `session.tool.*` and the
// `session.execution.*` family, but NOT `session.idle` / `session.status`,
// even though both are in the schema. The reliable end-of-turn signal is
// therefore `session.step.ended` with `finish === 'stop'` (the model stopped
// without asking for more tools). `session.status`/`session.idle` are kept as
// fallbacks for builds that do emit them.
//
// Turn boundaries: a step that ends with `tool-calls` continues the turn, so
// it maps to 'active' and schedules nothing. Only the transition into 'idle'
// runs a diff, which also dedupes duplicate signals from fallback events.

export interface RawEvent {
  type: string;
  location?: { directory?: string };
  data?: unknown;
}

export interface EventData {
  sessionID?: string;
  status?: { type?: string };
  finish?: string;
}

export type SensorIntent =
  | { kind: 'created'; sessionID: string }
  | { kind: 'deleted'; sessionID: string }
  | { kind: 'activity'; sessionID: string; state: 'idle' | 'active' };

/**
 * Events whose loss must be observable. AGENTS.md: if a code path can affect
 * whether the agent sees the signal, it must show up in the observation log —
 * so a tracked event dropped by the directory filter is logged, not ignored.
 */
export const TRACKED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'session.created',
  'session.deleted',
  'session.status',
  'session.idle',
]);

/** Step finishes that mean "the agent is done with this turn". */
const TURN_END_FINISHES: ReadonlySet<string> = new Set(['stop']);

export function sameDir(a: string | undefined, b: string): boolean {
  if (!a) return true;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

export function isTracked(type: string): boolean {
  return TRACKED_EVENT_TYPES.has(type);
}

export function classifyEvent(ev: RawEvent, cwd: string): SensorIntent | null {
  if (ev.location && !sameDir(ev.location.directory, cwd)) return null;
  const data = (ev.data ?? {}) as EventData;
  if (!data.sessionID) return null;
  switch (ev.type) {
    case 'session.created':
      return { kind: 'created', sessionID: data.sessionID };
    case 'session.deleted':
      return { kind: 'deleted', sessionID: data.sessionID };
    case 'session.status':
      return activity(data.sessionID, data.status?.type === 'idle' ? 'idle' : 'active');
    case 'session.idle':
      return activity(data.sessionID, 'idle');
    case 'session.step.started':
      return activity(data.sessionID, 'active');
    case 'session.step.ended':
      return activity(
        data.sessionID,
        data.finish && TURN_END_FINISHES.has(data.finish) ? 'idle' : 'active',
      );
    default:
      return null;
  }
}

function activity(sessionID: string, state: 'idle' | 'active'): SensorIntent {
  return { kind: 'activity', sessionID, state };
}

/** True only on the transition into idle, so repeated signals do not re-run a turn. */
export function becameIdle(previous: string | undefined, state: string): boolean {
  return state === 'idle' && previous !== 'idle';
}
