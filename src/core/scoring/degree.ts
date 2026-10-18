import { IrProject } from '../ir.js';

/**
 * Degree = per-node edge count, optionally filtered by connascence type.
 * Pure graph degree computation on the IR.
 */
export function degreeMap(project: IrProject, type?: IrProject['edges'][number]['connascenceType']): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const edge of project.edges) {
    if (type && edge.connascenceType !== type) continue;
    degrees.set(edge.nodeA, (degrees.get(edge.nodeA) ?? 0) + 1);
    degrees.set(edge.nodeB, (degrees.get(edge.nodeB) ?? 0) + 1);
  }
  return degrees;
}

export function degreeOf(degrees: Map<string, number>, nodeId: string): number {
  return degrees.get(nodeId) ?? 0;
}
