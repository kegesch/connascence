import { IrNode, IrProject } from '../ir.js';

export interface AlgorithmDetectorOptions {
  /** minimum structural size a clone must have (approximate by source lines) to be flagged. Default 3. */
  minLines?: number;
}

/**
 * Connascence of Algorithm: flags structurally identical function bodies
 * (same normalized subtree hash — identifiers and literals abstracted away).
 * Pure function on the IR; relies on the language adapter to fill structureHash.
 * Evidence strings explain the clone pair (heuristic candidate, may need review).
 */
export function detectAlgorithm(
  project: IrProject,
  options: AlgorithmDetectorOptions = {},
): IrProject['edges'] {
  const minLines = options.minLines ?? 3;
  const byHash = new Map<string, IrNode[]>();
  for (const node of project.nodes) {
    if (!node.structureHash) continue;
    if (node.location.endLine - node.location.startLine + 1 < minLines) continue;
    const group = byHash.get(node.structureHash) ?? [];
    group.push(node);
    byHash.set(node.structureHash, group);
  }

  const edges: IrProject['edges'] = [];
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        edges.push({
          nodeA: a.id,
          nodeB: b.id,
          connascenceType: 'algorithm',
          evidence: `structurally identical function bodies (normalized clone): "${a.name}" (${a.location.filePath}:${a.location.startLine}) and "${b.name}" (${b.location.filePath}:${b.location.startLine})`,
        });
      }
    }
  }
  return edges;
}
