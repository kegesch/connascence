import { IrNode, IrProject } from '../ir.js';

export const DEFAULT_POSITION_PARAM_THRESHOLD = 3;

function buildParamsByParent(project: IrProject): Map<string, IrNode[]> {
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
  return paramsByParent;
}

/** Immutable context shared by all slot resolutions in one detectPosition run. */
interface PositionContext {
  byId: Map<string, IrNode>;
  paramsByParent: Map<string, IrNode[]>;
  project: IrProject;
  threshold: number;
}

/** Resolves the parameter node the given argument slot binds into, if any. */
function slotParam(
  arg: IrNode,
  ctx: PositionContext,
): { call: IrNode; param: IrNode; slot: number; paramCount: number } | undefined {
  if (arg.kind !== 'argument' || !arg.parentId) return undefined;
  const call = ctx.byId.get(arg.parentId);
  if (!call || !call.parentId) return undefined;

  // resolve the callee: the call's parent reference (or the definition itself for internal calls)
  const calleeDefId = findResolvedDef(ctx.project, call.parentId);
  if (!calleeDefId) return undefined;

  const params = ctx.paramsByParent.get(calleeDefId) ?? [];
  if (params.length <= ctx.threshold) return undefined;

  const slot = Number(arg.name);
  if (!Number.isInteger(slot) || slot >= params.length) return undefined;
  return { call, param: params[slot], slot, paramCount: params.length };
}

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
  const ctx: PositionContext = {
    byId: new Map<string, IrNode>(project.nodes.map((n) => [n.id, n])),
    paramsByParent: buildParamsByParent(project),
    project,
    threshold,
  };
  const edges: IrProject['edges'] = [];

  for (const arg of project.nodes) {
    const match = slotParam(arg, ctx);
    if (!match) continue;
    edges.push({
      nodeA: arg.id,
      nodeB: match.param.id,
      connascenceType: 'position',
      evidence: `argument slot ${match.slot} bound positionally into ${match.paramCount}-parameter signature "${match.call.name}" (${match.param.name})`,
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
