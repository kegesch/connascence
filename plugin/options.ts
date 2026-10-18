// Plugin option parsing with defaults. All options come from the
// `plugins: [{ package: ..., options: {...} }]` block in opencode.json(c).

export interface SensorOptions {
  /** scan globs, relative to the monitored project root */
  globs: string[];
  /** max coupling instances per injected payload */
  top: number;
  /** hard character budget for any injected payload (M4 will formalize this) */
  budgetChars: number;
  /** include heuristic-detector candidates (meaning/value/identity) in payloads */
  includeHeuristics: boolean;
  /** inject the session-diff payload into the loop after each turn */
  inject: boolean;
  /** path to the engine CLI; defaults to ../dist/cli.js relative to this plugin */
  engineEntry?: string;
  /** where observation logs go, relative to the project root (M0 evidence) */
  logDir: string;
  /** engine scan timeout in ms */
  timeoutMs: number;
}

export const DEFAULT_GLOBS = ['src/**/*.ts', 'src/**/*.tsx'];

export const DEFAULT_OPTIONS: SensorOptions = {
  globs: DEFAULT_GLOBS,
  top: 5,
  budgetChars: 1500,
  includeHeuristics: false,
  inject: true,
  logDir: '.coupling',
  timeoutMs: 120_000,
};

function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function bool(raw: Record<string, unknown>, key: string): boolean | undefined {
  const v = raw[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function parseOptions(raw: Record<string, unknown> | undefined): SensorOptions {
  const opts = { ...DEFAULT_OPTIONS };
  if (!raw) return opts;
  const globs = raw['globs'];
  if (Array.isArray(globs)) {
    const list = globs.filter((g): g is string => typeof g === 'string' && g.length > 0);
    if (list.length > 0) opts.globs = list;
  }
  return {
    ...opts,
    top: num(raw, 'top') ?? opts.top,
    budgetChars: num(raw, 'budgetChars') ?? opts.budgetChars,
    timeoutMs: num(raw, 'timeoutMs') ?? opts.timeoutMs,
    includeHeuristics: bool(raw, 'includeHeuristics') ?? opts.includeHeuristics,
    inject: bool(raw, 'inject') ?? opts.inject,
    engineEntry: str(raw, 'engineEntry'),
    logDir: str(raw, 'logDir') ?? opts.logDir,
  };
}
