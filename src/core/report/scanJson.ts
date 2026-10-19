// Single definition of the machine-readable scan payload, so --out and stdout
// cannot drift (and so cli.ts stays under the size limit).

import type { ScanReport, ScoredEdge } from '../scoring/score.js';

export function scanJson(report: ScanReport, edges: ScoredEdge[]): string {
  return JSON.stringify(
    {
      summary: report.summary,
      cycles: report.cycles ?? [],
      levelization: report.levelization ?? null,
      coChange: report.coChange ?? [],
      edges,
    },
    null,
    2,
  );
}
