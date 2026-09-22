import { ScoredEdge } from '../scoring/score.js';

export type Severity = 'high' | 'medium' | 'low';
const ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return ORDER[a] >= ORDER[b] ? a : b;
}

/**
 * Importance of a coupling instance, linter-style.
 * Deterministic detectors can reach high; heuristic detectors cap at
 * high only with strong corroborating signal (cross-directory + degree),
 * otherwise they rank as medium/low candidates.
 */
export function severityOf(e: ScoredEdge): Severity {
  if (e.heuristic) {
    if (e.locality >= 4 && e.degree >= 4) return 'high';
    if (e.locality >= 4 || e.degree >= 4) return 'medium';
    return 'low';
  }
  if ((e.strength >= 5 && e.locality >= 3) || e.degree >= 8) return 'high';
  if (e.locality >= 3 || e.degree >= 3) return 'medium';
  return 'low';
}
