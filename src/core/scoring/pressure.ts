// Continuous coupling pressure (M3b.1).
//
// The old ranking multiplied a binary severity by a raw edge count. Two edges
// of the same type then compared only by degree, so a name import (strength 1)
// sharing an endpoint with an identity write (strength 9) inflated the write's
// rank. Pressure keeps the connascence model (strength x locality) and adds
// breadth from the *same-type* degree, normalized to 0..1.
//
// Breadth grows logarithmically: the first few uses matter most, and a utility
// imported 100 times must not drown out a single strong semantic coupling.

import type { ScoredEdge } from './score.js';

export interface PressureSummary {
  total: number;
  mean: number;
  max: number;
  /** pressure mass by connascence type */
  byType: Record<string, number>;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** normalized 0..1 for one scored edge */
export function pressureOf(
  edge: Pick<ScoredEdge, 'strength' | 'locality' | 'degree'>,
): number {
  const strength = Math.max(0, Math.min(9, edge.strength)) / 9;
  const locality = Math.max(0, Math.min(5, edge.locality)) / 5;
  const degree = Number.isFinite(edge.degree) ? Math.max(0, edge.degree) : 0;
  const breadth = 1 + Math.log2(1 + degree) / 3;
  return round4(Math.min(1, strength * locality * breadth));
}

/** Aggregate pressure for the machine-readable report. */
export function pressureSummary(
  edges: ReadonlyArray<{ connascenceType: string; pressure?: number }>,
): PressureSummary {
  const summary: PressureSummary = { total: 0, mean: 0, max: 0, byType: {} };
  for (const edge of edges) {
    const p = edge.pressure ?? 0;
    summary.total += p;
    summary.max = Math.max(summary.max, p);
    summary.byType[edge.connascenceType] = (summary.byType[edge.connascenceType] ?? 0) + p;
  }
  summary.total = round4(summary.total);
  summary.max = round4(summary.max);
  summary.mean = edges.length > 0 ? round4(summary.total / edges.length) : 0;
  for (const type of Object.keys(summary.byType)) {
    summary.byType[type] = round4(summary.byType[type]);
  }
  return summary;
}
