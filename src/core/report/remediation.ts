import { Finding } from './findings.js';
import { shortPath } from '../paths.js';

/**
 * Static, per-connascence-type remediation advice. The report leads with this
 * so the reader (human or agent) gets the fix directly, without having to
 * interpret strength/locality/degree measurements first.
 */
const REMEDIATION: Record<string, string> = {
  name: 'Name coupling is informational: the sides must keep matching names — any rename must update both plus all references. No action needed unless the names only accidentally match.',
  type: 'Make both sides agree on one type: define a shared type/interface and annotate both the definition and the call sites.',
  position: 'Reduce positional coupling: give the callee named parameters (object destructuring) or reorder/trim parameters so callers stop relying on position.',
  meaning: 'Extract the repeated literal into one named constant (or config value) and import it everywhere it is used.',
  algorithm: 'Extract the duplicated logic into a single shared function/module and call it from all clone sites.',
  execution: 'Make control-flow explicit: order or gate the coupled operations explicitly at one call site instead of relying on implicit execution order.',
  timing: 'Make timing explicit: await/synchronize explicitly or pass the dependency as a value instead of relying on invocation timing.',
  value: 'Stop comparing against a magic value: create a predicate/helper (or named constant) that owns the comparison and use it at every site.',
  identity: 'Share a single source of truth (module-level constant, context object, or passed reference) instead of re-creating or re-reading the mutable state.',
};

/** Advice for a single connascence type, for edge-level outputs (e.g. diff --format=agent). */
export function remediationForType(type: string): string {
  return REMEDIATION[type] ?? 'Review the coupled sites and unify them behind one shared abstraction.';
}

/** One actionable line for a finding; a cluster-composed fix (with concrete
 *  function/location targets) takes precedence over the generic per-type advice. */
export function remediationFor(f: Finding): string {
  if (f.fix) return f.fix;
  const base = REMEDIATION[f.kind] ?? 'Review the coupled sites and unify them behind one shared abstraction.';
  const target = f.members[0];
  if (target) return `${base} Start at ${target.name} (${short(target.filePath)}:${target.startLine}).`;
  return base;
}

const short = shortPath;
