import { IrNode, IrProject } from '../ir.js';

export const DEFAULT_POSITION_PARAM_THRESHOLD = 3;

/**
 * Connascence of Position: flags call-site arguments bound positionally into
 * signatures with more than `threshold` parameters (arg-slot ↔ param-slot).
 * Pure function on the IR; relies on reference→definition resolution being
 * materialized as name edges (see detectName).
 */
export function detectPosition(
  project: IrProject,
  threshold: number = DEFAULT_POSITION_PARAM_THRESHOLD,
): IrProject['edges'] {
  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));
  const edges: IrProject['edges'] = [];

  // index parameter definitions by their parent definition (ordered by source position)
  const paramsByParent = new Map<string, IrNode[]>();
  for (const node of project.nodes) {
    if (node.kind !== 'parameter' || !node.parentId) continue;
    const list = paramsByParent.get(node.parentId) ?? [];
    list.push(node);
    paramsByParent.set(node.parentId, list);
  }
  for (const list of paramsByParent.values()) {
    list.sort(
      (a, b) => a.location.startLine - b.location.startLine || a.location.startColumn - b.location.startColumn,
    );
  }

  for (const arg of project.nodes) {
    if (arg.kind !== 'argument' || !arg.parentId) continue;
    const call = byId.get(arg.parentId);
    if (!call || !call.parentId) continue;

    // resolve the callee: the call's parent reference (or the definition itself for internal calls)
    const calleeRefId = call.parentId;
    const calleeDefId = findResolvedDef(project, calleeRefId);
    if (!calleeDefId) continue;

    const params = paramsByParent.get(calleeDefId) ?? [];
    if (params.length <= threshold) continue;

    const slot = Number(arg.name);
    if (!Number.isInteger(slot) || slot >= params.length) continue;
    const param = params[slot];

    edges.push({
      nodeA: arg.id,
      nodeB: param.id,
      connascenceType: 'position',
      evidence: `argument slot ${slot} bound positionally into ${params.length}-parameter signature "${call.name}" (${param.name})`,
    });
  }

  return edges;
}

function findResolvedDef(project: IrProject, refId: string): string | undefined {
  for (const edge of project.edges) {
    if (edge.connascenceType === 'name' && edge.nodeA === refId) return edge.nodeB;
  }
  return undefined;
}
