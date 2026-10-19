// M0 agent loop: session baseline -> per-turn session diff -> crude advisory
// payload, plus coupling_scan / coupling_health tools. This is the loop the
// two-week experiment validates; every branch appends to the observation log
// so "why did the agent ignore the signal" has data (PLAN.md §8 M0, §9).

import { Plugin } from '@opencode/plugin';
import { EngineScan, runScan } from './engine.js';
import { diffAdded } from './diff.js';
import { isReportable, renderHealth, renderInjection, renderScanReport } from './payload.js';
import { appendLog, writeSessionReport } from './log.js';
import { RawEvent, becameIdle, classifyEvent, isTracked } from './events.js';
import {
  Baseline,
  SensorState,
  adoptBaseline,
  createState,
  ensureBaseline,
  freshAdded,
  isStaleBaseline,
  markReported,
  sessionSummary,
} from './sensor.js';
import { BaselineStore, clearBaseline, loadBaseline, saveBaseline } from './baseline.js';
import { invalidateBaseline } from './rebaseline.js';
import { SensorOptions } from './options.js';

type Ctx = Parameters<Parameters<typeof Plugin.define>[0]['setup']>[0];

export interface LoopOptions extends SensorOptions {
  engineEntry: string;
  cwd: string;
  logDirAbs: string;
}

export const SENSOR_NOTE =
  'Coupling sensor active on this project. It measures structural coupling ' +
  '(connascence) and diffs it against this session baseline after each of your ' +
  'turns; new instances arrive as advisory messages with a fix hint. Fix the ' +
  'reported instances; do not rename entities or weaken the scan to silence ' +
  'them. Tools: coupling_scan (actionable findings), coupling_health (counts ' +
  '+ session delta).';

export interface Runtime {
  stateFor(sessionID: string): SensorState;
  peek(sessionID: string): SensorState | undefined;
  scanOnce(): Promise<EngineScan>;
  baselineFor(sessionID: string, state: SensorState): Promise<Baseline>;
  rebaseline(sessionID: string, state: SensorState, scan: EngineScan): Promise<Baseline>;
  forget(sessionID: string): Promise<void>;
  log(event: Record<string, unknown>): Promise<void>;
}

/** Delivers the advisory payload to the session (ctx.session.synthetic in prod). */
export type Deliver = (sessionID: string, text: string) => Promise<void>;

function createRuntime(opts: LoopOptions, store: BaselineStore): Runtime {
  const sessions = new Map<string, SensorState>();
  let pendingScan: Promise<EngineScan> | null = null;

  const stateFor = (sessionID: string): SensorState => {
    let state = sessions.get(sessionID);
    if (!state) {
      state = createState();
      sessions.set(sessionID, state);
    }
    return state;
  };

  const scanOnce = (): Promise<EngineScan> => {
    pendingScan ??= runScan({
      engineEntry: opts.engineEntry,
      cwd: opts.cwd,
      globs: opts.globs,
      timeoutMs: opts.timeoutMs,
    }).finally(() => {
      pendingScan = null;
    });
    return pendingScan;
  };

  const baselineFor = async (sessionID: string, state: SensorState): Promise<Baseline> => {
    if (state.baseline) return state.baseline;
    // A reload resets memory but not the session: restore the original
    // baseline instead of letting the next scan silently become it.
    const restored = await restore(store, sessionID, state, (event) => optsLog(opts, event));
    if (restored) return restored;
    const { baseline, created } = ensureBaseline(state, await scanOnce());
    if (created) {
      await persist(store, sessionID, baseline);
      await optsLog(opts, { event: 'baseline', sessionID, edges: baseline.count, baselineAt: baseline.at });
    }
    return baseline;
  };

  const rt: Runtime = {
    stateFor,
    peek: (id: string) => sessions.get(id),
    scanOnce,
    baselineFor,
    rebaseline: (id, state, scan) =>
      invalidateBaseline(id, state, scan, {
        persist: (b) => persist(store, id, b),
        log: (event) => optsLog(opts, event),
      }),
    forget: async (sessionID: string) => {
      sessions.delete(sessionID);
      await clear(store, sessionID);
    },
    log: (event) => optsLog(opts, event),
  };
  return rt;
}

/** Storage is best-effort: a failed read must not stall the loop. */
async function restore(
  store: BaselineStore,
  sessionID: string,
  state: SensorState,
  log: (event: Record<string, unknown>) => Promise<void>,
): Promise<Baseline | null> {
  let record: Baseline | null = null;
  try {
    record = await loadBaseline(store, sessionID);
  } catch {
    return null;
  }
  if (!record || !adoptBaseline(state, record)) return null;
  await log({ event: 'baseline_restored', sessionID, edges: record.count, baselineAt: record.at });
  return record;
}

async function persist(store: BaselineStore, sessionID: string, baseline: Baseline): Promise<void> {
  try {
    await saveBaseline(store, sessionID, baseline);
  } catch {
    // In-memory baseline still serves this instance.
  }
}

async function clear(store: BaselineStore, sessionID: string): Promise<void> {
  try {
    await clearBaseline(store, sessionID);
  } catch {
    // Nothing to do; the session is ending.
  }
}

function optsLog(opts: LoopOptions, event: Record<string, unknown>): Promise<void> {
  return appendLog(opts.logDirAbs, event);
}

async function runTurnDiff(
  deliver: Deliver,
  opts: LoopOptions,
  rt: Runtime,
  sessionID: string,
): Promise<void> {
  const state = rt.stateFor(sessionID);
  try {
    const before = await rt.baselineFor(sessionID, state);
    const after = await rt.scanOnce();
    if (isStaleBaseline(before, after)) {
      await rt.rebaseline(sessionID, state, after);
      await rt.log({ event: 'turn', sessionID, newEdges: 0, fresh: 0, injected: false, staleBaseline: true });
      return;
    }
    const added = diffAdded(before.keys, after.edges);
    const fresh = freshAdded(state, added.filter((e) => isReportable(e, opts.includeHeuristics)));
    if (!opts.inject || fresh.length === 0) {
      await rt.log({ event: 'turn', sessionID, newEdges: added.length, fresh: fresh.length, injected: false });
      return;
    }
    markReported(state, fresh);
    state.injections += 1;
    const text = renderInjection({
      added: fresh,
      edgesBefore: before.count,
      edgesAfter: after.edges.length,
      cwd: opts.cwd,
      opts,
    });
    await deliver(sessionID, text);
    await rt.log({ event: 'injected', sessionID, count: fresh.length, chars: text.length });
  } catch (err) {
    await rt.log({ event: 'scan_error', sessionID, error: String(err) });
  }
}

export function createHandlers(opts: LoopOptions, rt: Runtime, deliver: Deliver) {
  const busy = new Set<string>();
  const lastStatus = new Map<string, string>();

  async function onIdle(sessionID: string): Promise<void> {
    if (busy.has(sessionID)) {
      await rt.log({ event: 'turn_skipped_busy', sessionID });
      return;
    }
    busy.add(sessionID);
    try {
      await runTurnDiff(deliver, opts, rt, sessionID);
    } finally {
      busy.delete(sessionID);
    }
  }

  async function onDeleted(sessionID: string): Promise<void> {
    const state = rt.peek(sessionID);
    if (state) {
      await writeSessionReport(opts.logDirAbs, {
        sessionID,
        endedAt: new Date().toISOString(),
        summary: sessionSummary(state),
        finalEdges: null,
      });
    }
    // Drop the persisted baseline even if this instance never saw the session
    // (post-reload end): a deleted session must not leave storage behind.
    await rt.forget(sessionID);
  }

  async function handleEvent(ev: RawEvent): Promise<void> {
    const intent = classifyEvent(ev, opts.cwd);
    if (!intent) {
      // The directory filter is the branch that decides whether the agent ever
      // sees the signal; dropping a tracked event silently would make "no idle"
      // and "idle filtered out" indistinguishable (AGENTS.md).
      if (isTracked(ev.type)) {
        await rt.log({ event: 'event_skipped', type: ev.type, directory: ev.location?.directory ?? null });
      }
      return;
    }
    switch (intent.kind) {
      case 'created':
        void rt.baselineFor(intent.sessionID, rt.stateFor(intent.sessionID)).catch(() => undefined);
        return;
      case 'deleted':
        await onDeleted(intent.sessionID);
        return;
      case 'activity': {
        const previous = lastStatus.get(intent.sessionID);
        lastStatus.set(intent.sessionID, intent.state);
        // Scans are slow; never let one block the event stream. Diffs are always
        // against the session baseline, so a skipped busy turn is caught next turn.
        if (becameIdle(previous, intent.state)) await onIdle(intent.sessionID);
        return;
      }
    }
  }

  return { handleEvent };
}

type ToolEditor = Parameters<Parameters<Ctx['tool']['transform']>[0]>[0];

function registerTools(ctx: Ctx, opts: LoopOptions, rt: Runtime): Promise<unknown> {
  const emptyInput = { type: 'object', properties: {}, required: [], additionalProperties: false };
  return ctx.tool.transform((editor: ToolEditor) => {
    editor.namespace({
      name: 'coupling',
      description: 'Structural coupling (connascence) sensor for this project',
    });
    editor.add({
      name: 'scan',
      description:
        'Run the coupling scan now and list actionable connascence findings, worst first, each with a fix hint.',
      input: emptyInput,
      options: { namespace: 'coupling', codemode: true },
      execute: async (_input, context) => {
        const scan = await rt.scanOnce();
        const reportable = scan.edges.filter((e) => isReportable(e, opts.includeHeuristics));
        await rt.log({ event: 'tool_call', tool: 'scan', sessionID: context.sessionID });
        return { content: renderScanReport({ scan, reportable, cwd: opts.cwd, opts }) };
      },
    });
    editor.add({
      name: 'health',
      description:
        'Coupling summary for this project: edge counts by type, session delta vs baseline, most-coupled files.',
      input: emptyInput,
      options: { namespace: 'coupling', codemode: true },
      execute: async (_input, context) => {
        const scan = await rt.scanOnce();
        const state = rt.stateFor(context.sessionID);
        const baseline = await rt.baselineFor(context.sessionID, state);
        await rt.log({ event: 'tool_call', tool: 'health', sessionID: context.sessionID });
        return {
          content: renderHealth({
            scan,
            edgesBefore: baseline.count,
            cwd: opts.cwd,
            opts,
          }),
        };
      },
    });
  });
}

async function registerContextHook(ctx: Ctx, opts: LoopOptions, rt: Runtime): Promise<unknown> {
  return ctx.session.hook('context', (event) => {
    const state = rt.stateFor(event.sessionID);
    state.turns += 1;
    if (state.notified) return;
    state.notified = true;
    event.system.push({ type: 'text', text: SENSOR_NOTE });
    void rt.baselineFor(event.sessionID, state).catch(() => undefined);
  });
}

function subscribe(ctx: Ctx, opts: LoopOptions, rt: Runtime, stop: AbortController): void {
  const deliver: Deliver = async (sessionID, text) => {
    await ctx.session.synthetic({ sessionID, text });
  };
  const { handleEvent } = createHandlers(opts, rt, deliver);
  void (async () => {
    for await (const ev of ctx.event.subscribe({ signal: stop.signal })) {
      if (stop.signal.aborted) break;
      await handleEvent(ev as RawEvent);
    }
  })().catch(() => undefined);
}

export function createLoop(ctx: Ctx, opts: LoopOptions) {
  const stop = new AbortController();
  // opencode storage takes effect's Schema.Json; BaselineRecord is JSON-shaped
  // but has no index signature, so the narrowing is safe and kept local.
  const store: BaselineStore = {
    get: (key) => ctx.storage.get(key),
    set: (key, value) => ctx.storage.set(key, value as unknown as Parameters<typeof ctx.storage.set>[1]),
    remove: (key) => ctx.storage.remove(key),
  };
  const rt = createRuntime(opts, store);
  return {
    registerTools: () => registerTools(ctx, opts, rt),
    registerContextHook: () => registerContextHook(ctx, opts, rt),
    start: () => subscribe(ctx, opts, rt, stop),
    cleanup: () => stop.abort(),
  };
}

