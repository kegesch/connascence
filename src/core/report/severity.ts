import { ScoredEdge } from '../scoring/score.js';
import { pressureOf } from '../scoring/pressure.js';

export type Severity = 'high' | 'medium' | 'low';
const ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return ORDER[a] >= ORDER[b] ? a : b;
}

/**
 * Importance of a coupling instance, linter-style. Uses continuous pressure
 * instead of raw edge counts; a heuristic edge still needs cross-module
 * locality plus strong pressure to reach high.
 */
export function severityOf(e: ScoredEdge): Severity {
  const pressure = e.pressure ?? pressureOf(e);
  if (e.heuristic) {
    if (e.locality >= 4 && pressure >= 0.7) return 'high';
    if (pressure >= 0.35) return 'medium';
    return 'low';
  }
  // deterministic: strength x locality is the model, breadth only breaks ties
  if (e.strength >= 5 && e.locality >= 3) return 'high';
  if (pressure >= 0.35) return 'medium';
  return 'low';
}
