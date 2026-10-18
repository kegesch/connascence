// M0 agent loop: session baseline -> per-turn session diff -> crude advisory
// payload, plus coupling_scan / coupling_health tools. This is the loop the
// two-week experiment validates; every branch appends to the observation log
// so "why did the agent ignore the signal" has data (PLAN.md §8 M0, §9).

import { Plugin } from '@opencode/plugin';
import { EngineScan, countEdges, runScan } from './engine.js';
import { diffEdges } from './diff.js';
import { isReportable, renderHealth, renderInjection, renderScanReport } from './payload.js';
import { appendLog, writeSessionReport } from './log.js';
import {
  SensorState,
  createState,
  ensureBaseline,
  freshAdded,
  markReported,
  sessionSummary,
} from './sensor.js';
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

function sameDir(a: string | undefined, b: string): boolean {
  if (!a) return true;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

interface Runtime {
  stateFor(sessionID: string): SensorState;
  peek(sessionID: string): SensorState | undefined;
  scanOnce(): Promise<EngineScan>;
  baselineFor(sessionID: string, state: SensorState): Promise<EngineScan>;
  log(event: Record<string, unknown>): Promise<void>;
}

function createRuntime(opts: LoopOptions): Runtime {
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

  const baselineFor = async (sessionID: string, state: SensorState): Promise<EngineScan> => {
    const scan = state.baseline ?? (await scanOnce());
    const { baseline, created } = ensureBaseline(state, scan);
    if (created) await optsLog(opts, { event: 'baseline', sessionID, edges: countEdges(baseline) });
    return baseline;
  };

  return { stateFor, peek: (id: string) => sessions.get(id), scanOnce, baselineFor, log: (event) => optsLog(opts, event) };
}

function optsLog(opts: LoopOptions, event: Record<string, unknown>): Promise<void> {
  return appendLog(opts.logDirAbs, event);
}

async function runTurnDiff(ctx: Ctx, opts: LoopOptions, rt: Runtime, sessionID: string): Promise<void> {
  const state = rt.stateFor(sessionID);
  try {
    const before = await rt.baselineFor(sessionID, state);
    const after = await rt.scanOnce();
    const { added } = diffEdges(before.edges, after.edges);
    const fresh = freshAdded(state, added.filter((e) => isReportable(e, opts.includeHeuristics)));
    if (!opts.inject || fresh.length === 0) {
      await rt.log({ event: 'turn', sessionID, newEdges: added.length, fresh: fresh.length, injected: false });
      return;
    }
    markReported(state, fresh);
    state.injections += 1;
    const text = renderInjection({
      added: fresh,
      edgesBefore: countEdges(before),
      edgesAfter: countEdges(after),
      cwd: opts.cwd,
      opts,
    });
    await ctx.session.synthetic({ sessionID, text });
    await rt.log({ event: 'injected', sessionID, count: fresh.length, chars: text.length });
  } catch (err) {
    await rt.log({ event: 'scan_error', sessionID, error: String(err) });
  }
}

function createHandlers(ctx: Ctx, opts: LoopOptions, rt: Runtime) {
  const busy = new Set<string>();

  async function onIdle(sessionID: string): Promise<void> {
    if (busy.has(sessionID)) {
      await rt.log({ event: 'turn_skipped_busy', sessionID });
      return;
    }
    busy.add(sessionID);
    try {
      await runTurnDiff(ctx, opts, rt, sessionID);
    } finally {
      busy.delete(sessionID);
    }
  }

  async function onDeleted(sessionID: string): Promise<void> {
    const state = rt.peek(sessionID);
    if (!state) return;
    await writeSessionReport(opts.logDirAbs, {
      sessionID,
      endedAt: new Date().toISOString(),
      summary: sessionSummary(state),
      finalEdges: null,
    });
  }

  async function handleEvent(ev: {
    type: string;
    location?: { directory?: string };
    data?: unknown;
  }): Promise<void> {
    if (ev.location && !sameDir(ev.location.directory, opts.cwd)) return;
    const sessionID = (ev.data ?? {}) as { sessionID?: string };
    if (!sessionID.sessionID) return;
    const id = sessionID.sessionID;
    // Scans are slow; never let one block the event stream. Diffs are always
    // against the session baseline, so a skipped busy turn is caught next turn.
    if (ev.type === 'session.created') void rt.baselineFor(id, rt.stateFor(id)).catch(() => undefined);
    else if (ev.type === 'session.idle') void onIdle(id);
    else if (ev.type === 'session.deleted') await onDeleted(id);
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
        const baseline = rt.stateFor(context.sessionID).baseline;
        await rt.log({ event: 'tool_call', tool: 'health', sessionID: context.sessionID });
        return {
          content: renderHealth({
            scan,
            edgesBefore: baseline ? countEdges(baseline) : null,
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
  const { handleEvent } = createHandlers(ctx, opts, rt);
  void (async () => {
    for await (const ev of ctx.event.subscribe({ signal: stop.signal })) {
      if (stop.signal.aborted) break;
      await handleEvent(ev as { type: string; location?: { directory?: string }; data?: unknown });
    }
  })().catch(() => undefined);
}

export function createLoop(ctx: Ctx, opts: LoopOptions) {
  const stop = new AbortController();
  const rt = createRuntime(opts);
  return {
    registerTools: () => registerTools(ctx, opts, rt),
    registerContextHook: () => registerContextHook(ctx, opts, rt),
    start: () => subscribe(ctx, opts, rt, stop),
    cleanup: () => stop.abort(),
  };
}
