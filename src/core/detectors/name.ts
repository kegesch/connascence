import { IrNode, IrProject } from '../ir.js';

/**
 * Turns a reference→definition resolution map (produced by a language adapter)
 * into name-connascence edges. Pure function on the IR.
 */
export function detectName(project: IrProject, refIdToDefId: Map<string, string>): IrProject['edges'] {
  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));
  const edges: IrProject['edges'] = [];
  for (const [refId, defId] of refIdToDefId) {
    const ref = byId.get(refId);
    const def = byId.get(defId);
    if (!ref || !def) continue;
    edges.push({
      nodeA: refId,
      nodeB: defId,
      connascenceType: 'name',
      evidence: `reference to "${def.name}" at ${def.location.filePath}:${def.location.startLine}`,
    });
  }
  return edges;
}
