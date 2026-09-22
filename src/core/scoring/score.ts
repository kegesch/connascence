import { IrProject, IrEdge, IrNode } from '../ir.js';
import { strengthOf } from './strength.js';
import { localityOf } from './locality.js';
import { degreeMap, degreeOf } from './degree.js';

export interface ScoredEdge {
  nodeA: EdgeEndpoint;
  nodeB: EdgeEndpoint;
  connascenceType: IrEdge['connascenceType'];
  strength: number;
  locality: number;
  degree: number;
  evidence: string;
}

export interface EdgeEndpoint {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  startLine: number;
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
    return {
      id,
      kind: node?.kind ?? 'unknown',
      name: node?.name ?? id,
      filePath: node?.location.filePath ?? '?',
      startLine: node?.location.startLine ?? 0,
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
