// Event dispatch contract fixtures. This is the branch that decides whether
// the agent ever sees the signal, so it gets true-positive AND true-negative
// coverage. The positive case is the event the opencode stream actually
// delivers (`session.step.ended` + finish 'stop'); the negatives are the
// near-misses that must NOT schedule a diff: a step that continues the turn
// (finish 'tool-calls'), other directories, missing session ids, and
// unrelated event types.
import { describe, it, expect } from 'vitest';
import { classifyEvent, becameIdle, sameDir, isTracked } from '../../plugin/events.ts';

const CWD = 'C:\\Users\\mail\\workspace\\connscence';

const ended = (finish: string, extra: Record<string, unknown> = {}) => ({
  type: 'session.step.ended',
  data: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish, ...extra },
});

describe('classifyEvent', () => {
  it('ends a turn when a step finishes with stop (observed v2 turn boundary)', () => {
    expect(classifyEvent(ended('stop'), CWD)).toEqual({
      kind: 'activity',
      sessionID: 'ses_1',
      state: 'idle',
    });
  });

  it.each(['tool-calls', 'length', 'content-filter', 'error', 'unknown'])(
    'keeps the turn active when a step finishes with %s',
    (finish) => {
      expect(classifyEvent(ended(finish), CWD)).toEqual({
        kind: 'activity',
        sessionID: 'ses_1',
        state: 'active',
      });
    },
  );

  it('treats a missing finish as active, not as a turn end', () => {
    expect(classifyEvent({ type: 'session.step.ended', data: { sessionID: 'ses_1' } }, CWD)).toEqual({
      kind: 'activity',
      sessionID: 'ses_1',
      state: 'active',
    });
  });

  it('treats step start as activity', () => {
    expect(classifyEvent({ type: 'session.step.started', data: { sessionID: 'ses_1' } }, CWD)).toEqual({
      kind: 'activity',
      sessionID: 'ses_1',
      state: 'active',
    });
  });

  it('keeps session.status and session.idle as fallbacks for other builds', () => {
    expect(
      classifyEvent({ type: 'session.status', data: { sessionID: 'ses_1', status: { type: 'idle' } } }, CWD),
    ).toEqual({ kind: 'activity', sessionID: 'ses_1', state: 'idle' });
    expect(classifyEvent({ type: 'session.idle', data: { sessionID: 'ses_1' } }, CWD)).toEqual({
      kind: 'activity',
      sessionID: 'ses_1',
      state: 'idle',
    });
    expect(
      classifyEvent({ type: 'session.status', data: { sessionID: 'ses_1', status: { type: 'busy' } } }, CWD),
    ).toEqual({ kind: 'activity', sessionID: 'ses_1', state: 'active' });
  });

  it('maps created and deleted', () => {
    expect(classifyEvent({ type: 'session.created', data: { sessionID: 'ses_1' } }, CWD)).toEqual({
      kind: 'created',
      sessionID: 'ses_1',
    });
    expect(classifyEvent({ type: 'session.deleted', data: { sessionID: 'ses_1' } }, CWD)).toEqual({
      kind: 'deleted',
      sessionID: 'ses_1',
    });
  });

  it('ignores unrelated event types', () => {
    expect(classifyEvent({ type: 'session.text.delta', data: { sessionID: 'ses_1' } }, CWD)).toBeNull();
    expect(classifyEvent({ type: 'session.tool.success', data: { sessionID: 'ses_1' } }, CWD)).toBeNull();
    expect(classifyEvent({ type: 'location.shutdown', data: {} }, CWD)).toBeNull();
  });

  it('ignores events with no session id', () => {
    expect(classifyEvent(ended('stop', { sessionID: undefined }), CWD)).toBeNull();
    expect(classifyEvent({ type: 'session.step.ended' }, CWD)).toBeNull();
  });

  it('ignores events from another directory', () => {
    const ev = { ...ended('stop'), location: { directory: 'C:\\Users\\mail\\workspace\\other-project' } };
    expect(classifyEvent(ev, CWD)).toBeNull();
  });

  it('accepts same-directory events regardless of case, slash style or trailing slash', () => {
    const ev = { ...ended('stop'), location: { directory: 'c:/users/mail/workspace/connscence/' } };
    expect(classifyEvent(ev, CWD)).toEqual({ kind: 'activity', sessionID: 'ses_1', state: 'idle' });
  });
});

describe('becameIdle', () => {
  it('fires only on the transition into idle', () => {
    expect(becameIdle(undefined, 'idle')).toBe(true);
    expect(becameIdle('active', 'idle')).toBe(true);
    expect(becameIdle('idle', 'idle')).toBe(false);
    expect(becameIdle('idle', 'active')).toBe(false);
  });

  it('does not re-run a turn when two signals report idle in a row', () => {
    let previous: string | undefined;
    const turns: boolean[] = [];
    for (const state of ['active', 'idle', 'idle', 'active', 'idle']) {
      turns.push(becameIdle(previous, state));
      previous = state;
    }
    expect(turns).toEqual([false, true, false, false, true]);
  });
});

describe('sameDir', () => {
  it('treats a missing directory as matching (no location = no scoping)', () => {
    expect(sameDir(undefined, CWD)).toBe(true);
  });
  it('normalizes separators, case and trailing slashes', () => {
    expect(sameDir('c:/users/mail/workspace/connscence', CWD)).toBe(true);
    expect(sameDir('C:\\Users\\mail\\workspace\\connscence\\', CWD)).toBe(true);
    expect(sameDir('C:\\Users\\mail\\workspace', CWD)).toBe(false);
  });
});

describe('isTracked', () => {
  it('marks the events whose loss must be observable', () => {
    expect(isTracked('session.status')).toBe(true);
    expect(isTracked('session.idle')).toBe(true);
    expect(isTracked('session.created')).toBe(true);
    expect(isTracked('session.deleted')).toBe(true);
    expect(isTracked('session.text.delta')).toBe(false);
  });
});
