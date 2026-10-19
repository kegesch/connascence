// Handler-level loop fixtures. This is the wiring that failed in production:
// classifyEvent -> becameIdle -> onIdle -> runTurnDiff -> synthetic payload.
// The unit tests cover the pieces; these cover the seam, with a scripted scan
// so no engine is spawned.
import { describe, it, expect } from 'vitest';
import { Deliver, LoopOptions, Runtime, createHandlers } from '../../plugin/loop.ts';
import { SensorState, createState } from '../../plugin/sensor.ts';
import { parseOptions } from '../../plugin/options.ts';
import type { EngineEdge, EngineScan } from '../../plugin/engine.ts';

function edge(overrides: Partial<EngineEdge> = {}): EngineEdge {
  return {
    nodeA: { id: 'a', kind: 'argument', name: '0', filePath: 'src/a.ts', startLine: 12 },
    nodeB: { id: 'b', kind: 'parameter', name: 'host', filePath: 'src/b.ts', startLine: 40 },
    connascenceType: 'position',
    strength: 4,
    locality: 2,
    degree: 3,
    evidence: 'argument slot 0',
    heuristic: false,
    ...overrides,
  };
}

const opts: LoopOptions = {
  ...parseOptions(undefined),
  engineEntry: 'unused',
  cwd: 'C:/proj',
  logDirAbs: 'C:/proj/.coupling',
};

const stepEnded = (finish: string) => ({
  type: 'session.step.ended',
  data: { sessionID: 'ses_1', finish },
});

interface Harness {
  events: Record<string, unknown>[];
  delivered: string[];
  handle: (ev: unknown) => Promise<void>;
}

/** A turn is scan(edges) after the baseline; failures are injected as an Error. */
function harness(
  edges: EngineEdge[] | Error,
  overrides: Partial<LoopOptions> = {},
  state: SensorState = createState(),
): Harness {
  const events: Record<string, unknown>[] = [];
  const delivered: string[] = [];
  const scan: EngineScan = { summary: { position: edges.length }, edges: [] };
  const rt: Runtime = {
    stateFor: () => state,
    peek: () => state,
    scanOnce: async () => {
      if (edges instanceof Error) throw edges;
      return { ...scan, edges };
    },
    baselineFor: async () => ({ at: '2026-10-19T00:00:00.000Z', count: 0, keys: [] }),
    forget: async () => undefined,
    log: async (e) => {
      events.push(e);
    },
  };
  const deliver: Deliver = async (_sessionID, text) => {
    delivered.push(text);
  };
  const { handleEvent } = createHandlers({ ...opts, ...overrides }, rt, deliver);
  return { events, delivered, handle: (ev) => handleEvent(ev as never) };
}

describe('turn handler', () => {
  it('injects newly added coupling once when a turn ends', async () => {
    const h = harness([edge()]);
    await h.handle(stepEnded('stop'));
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]).toContain('1 new coupling instance(s)');
    expect(h.delivered[0]).toContain('fix: Reduce positional coupling');
    expect(h.events).toContainEqual({
      event: 'injected',
      sessionID: 'ses_1',
      count: 1,
      chars: expect.any(Number),
    });
  });

  it('does nothing mid-turn (a step that asks for tools continues the turn)', async () => {
    const h = harness([edge()]);
    await h.handle(stepEnded('tool-calls'));
    expect(h.delivered).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('does not re-run on a duplicate stop signal', async () => {
    const h = harness([edge()]);
    await h.handle(stepEnded('stop'));
    await h.handle(stepEnded('stop'));
    expect(h.delivered).toHaveLength(1);
    expect(h.events.filter((e) => e.event === 'injected')).toHaveLength(1);
  });

  it('reports the turn without injecting when nothing is fresh', async () => {
    const h = harness([]);
    await h.handle(stepEnded('stop'));
    expect(h.delivered).toHaveLength(0);
    expect(h.events).toContainEqual({
      event: 'turn',
      sessionID: 'ses_1',
      newEdges: 0,
      fresh: 0,
      injected: false,
    });
  });

  it('never re-injects an edge already reported in an earlier turn', async () => {
    const h = harness([edge()]);
    await h.handle(stepEnded('stop'));
    await h.handle(stepEnded('tool-calls'));
    await h.handle(stepEnded('stop'));
    expect(h.delivered).toHaveLength(1);
    expect(h.events.filter((e) => e.event === 'turn')).toContainEqual({
      event: 'turn',
      sessionID: 'ses_1',
      newEdges: 1,
      fresh: 0,
      injected: false,
    });
  });

  it('treats informational name coupling as non-actionable but still logs the turn', async () => {
    const h = harness([edge({ connascenceType: 'name' })]);
    await h.handle(stepEnded('stop'));
    expect(h.delivered).toHaveLength(0);
    expect(h.events).toContainEqual(expect.objectContaining({ event: 'turn', newEdges: 1, fresh: 0 }));
  });

  it('honors inject:false while still recording the diff', async () => {
    const h = harness([edge()], { inject: false });
    await h.handle(stepEnded('stop'));
    expect(h.delivered).toHaveLength(0);
    expect(h.events).toContainEqual(expect.objectContaining({ event: 'turn', newEdges: 1, fresh: 1 }));
  });

  it('logs scan_error instead of throwing out of the event loop', async () => {
    const h = harness(new Error('engine blew up'));
    await expect(h.handle(stepEnded('stop'))).resolves.toBeUndefined();
    expect(h.events).toContainEqual({
      event: 'scan_error',
      sessionID: 'ses_1',
      error: 'Error: engine blew up',
    });
    expect(h.delivered).toHaveLength(0);
  });

  it('skips events for another directory', async () => {
    const h = harness([edge()]);
    await h.handle({ ...stepEnded('stop'), location: { directory: 'C:/somewhere/else' } });
    expect(h.events).toHaveLength(0);
    expect(h.delivered).toHaveLength(0);
  });
});
