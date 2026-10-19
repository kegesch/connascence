// Human/agent rendering for the temporal co-change candidate channel. Kept out
// of cli.ts (size discipline) and out of findings.ts: these pairs are not
// connascence findings and never gate, so they get their own clearly-labelled
// section instead of being mixed into the accusation stream.

import type { CoChangePair } from '../cochange.js';

export function renderCoChange(
  pairs: CoChangePair[],
  rel: (p: string) => string,
  top: number,
): string[] {
  if (pairs.length === 0) return [];
  const lines = ['', 'temporal co-change candidates (git history; review, never gated):'];
  const listed = top > 0 ? pairs.slice(0, top) : pairs;
  for (const p of listed) {
    lines.push(
      `  ${rel(p.a)} <-> ${rel(p.b)} — ${p.support} shared commits, confidence ${p.ratio.toFixed(2)}, last ${p.last.slice(0, 8)}`,
    );
  }
  if (top > 0 && pairs.length > top) lines.push(`  ... ${pairs.length - top} more`);
  return lines;
}
