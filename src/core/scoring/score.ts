import { IrProject, IrEdge, IrNode } from '../ir.js';
import type { FileCycle } from '../report/cycles.js';
import type { Levelization } from '../report/levelization.js';
import type { CoChangePair } from '../cochange.js';
import { strengthOf } from './strength.js';
import { localityOf } from './locality.js';
import { degreeByType, degreeOf } from './degree.js';
import { pressureOf, pressureSummary, type PressureSummary } from './pressure.js';

export type { PressureSummary } from './pressure.js';

/** Detectors that produce candidates rather than certainties. */
export const HEURISTIC_TYPES: ReadonlySet<string> = new Set(['meaning', 'value', 'identity']);

export interface ScoredEdge {
  nodeA: EdgeEndpoint;
  nodeB: EdgeEndpoint;
  connascenceType: IrEdge['connascenceType'];
  strength: number;
  locality: number;
  /** breadth among edges of the SAME connascence type (name imports cannot inflate identity edges) */
  degree: number;
  /** continuous coupling pressure, 0..1 (strength x locality x same-type breadth) */
  pressure?: number;
  evidence: string;
  /** true for heuristic detectors (meaning/value/identity): candidates, not certainties */
  heuristic: boolean;
  /** adapter resolved the endpoints through symbols/types, not by name (cycle findings require it) */
  resolved?: boolean;
}

export interface EdgeEndpoint {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  startLine: number;
  /** innermost enclosing function scope, if any (from the IR scopePath) — lets
   *  core-level analyses reconstruct a call graph without language types */
  ownerName?: string;
  /** move/rename-stable identity for diff keying (adapter-computed) */
  identityHash?: string;
}

export interface ScanReport {
  summary: Record<string, number>;
  /** continuous coupling pressure over all scored edges */
  pressure?: PressureSummary;
  edges: ScoredEdge[];
  /** file-level SCCs over resolved dependencies (computed by the scan pipeline) */
  cycles?: FileCycle[];
  /** Lakos dependency-chain depth over the resolved file graph (scan pipeline) */
  levelization?: Levelization;
  /** temporal co-change candidates from git history (optional, never gate-eligible) */
  coChange?: CoChangePair[];
}

export function scoreProject(project: IrProject): ScanReport {
  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));
  const degreesByType = degreeByType(project);

  function endpoint(id: string): EdgeEndpoint {
    const node = byId.get(id);
    const owner = node?.scopePath.find((s) => s.kind === 'function');
    return {
      id,
      kind: node?.kind ?? 'unknown',
      name: node?.name ?? id,
      filePath: node?.location.filePath ?? '?',
      startLine: node?.location.startLine ?? 0,
      ownerName: owner?.name,
      identityHash: node?.identityHash,
    };
  }

  const edges: ScoredEdge[] = project.edges.map((edge) => {
    const a = byId.get(edge.nodeA);
    const b = byId.get(edge.nodeB);
    const degrees = degreesByType.get(edge.connascenceType);
    const strength = strengthOf(edge.connascenceType);
    const locality = a && b ? localityOf(a, b) : 99;
    const degree = Math.min(
      degreeOf(degrees ?? new Map(), edge.nodeA),
      degreeOf(degrees ?? new Map(), edge.nodeB),
    );
    return {
      nodeA: endpoint(edge.nodeA),
      nodeB: endpoint(edge.nodeB),
      connascenceType: edge.connascenceType,
      strength,
      locality,
      degree,
      pressure: pressureOf({ strength, locality, degree }),
      evidence: edge.evidence,
      heuristic: HEURISTIC_TYPES.has(edge.connascenceType),
      resolved: edge.resolved,
    };
  });

  // worst coupling first: continuous pressure, then the raw model fields
  edges.sort(
    (x, y) =>
      (y.pressure ?? 0) - (x.pressure ?? 0) ||
      y.strength - x.strength ||
      y.locality - x.locality ||
      y.degree - x.degree,
  );

  const summary: Record<string, number> = {};
  for (const edge of edges) {
    summary[edge.connascenceType] = (summary[edge.connascenceType] ?? 0) + 1;
  }

  return { summary, pressure: pressureSummary(edges), edges };
}
