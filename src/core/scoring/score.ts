import { IrProject, IrEdge, IrNode } from '../ir.js';
import { strengthOf } from './strength.js';
import { localityOf } from './locality.js';
import { degreeMap, degreeOf } from './degree.js';

/** All connascence types in canonical (strength) order — single source of truth. */
export const CONNASCENCE_TYPES = [
  'name',
  'type',
  'meaning',
  'position',
  'algorithm',
  'execution',
  'timing',
  'value',
  'identity',
] as const;

/** Detectors that produce candidates rather than certainties. */
export const HEURISTIC_TYPES: ReadonlySet<string> = new Set(['meaning', 'value', 'identity']);

export interface ScoredEdge {
  nodeA: EdgeEndpoint;
  nodeB: EdgeEndpoint;
  connascenceType: IrEdge['connascenceType'];
  strength: number;
  locality: number;
  degree: number;
  evidence: string;
  /** true for heuristic detectors (meaning/value/identity): candidates, not certainties */
  heuristic: boolean;
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
  edges: ScoredEdge[];
}

export function scoreProject(project: IrProject): ScanReport {
  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));
  const degrees = degreeMap(project);

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
    return {
      nodeA: endpoint(edge.nodeA),
      nodeB: endpoint(edge.nodeB),
      connascenceType: edge.connascenceType,
      strength: strengthOf(edge.connascenceType),
      locality: a && b ? localityOf(a, b) : 99,
      degree: Math.min(degreeOf(degrees, edge.nodeA), degreeOf(degrees, edge.nodeB)),
      evidence: edge.evidence,
      heuristic: HEURISTIC_TYPES.has(edge.connascenceType),
    };
  });

  // worst coupling first: strongest type, worst locality, highest degree
  edges.sort(
    (x, y) => y.strength - x.strength || y.locality - x.locality || y.degree - x.degree,
  );

  const summary: Record<string, number> = {};
  for (const edge of edges) {
    summary[edge.connascenceType] = (summary[edge.connascenceType] ?? 0) + 1;
  }

  return { summary, edges };
}
