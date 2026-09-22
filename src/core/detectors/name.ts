import { IrNode, IrProject } from '../ir.js';

export interface NameDetectorOptions {
  /**
   * Skip references whose definition lives in the same innermost function scope
   * (e.g. local variable and parameter use) — trivially true for almost all code
   * and pure noise in reports. Default: true.
   */
  excludeSameFunctionScope?: boolean;
}

/** Innermost function scope key for a node, or undefined for module-level code. */
function innermostFunctionScope(node: IrNode): string | undefined {
  const seg = node.scopePath.find((s) => s.kind === 'function');
  return seg ? `${seg.kind}:${seg.name}` : undefined;
}

/**
 * Turns a reference→definition resolution map (produced by a language adapter)
 * into name-connascence edges. Pure function on the IR.
 */
export function detectName(
  project: IrProject,
  refIdToDefId: Map<string, string>,
  options: NameDetectorOptions = {},
): IrProject['edges'] {
  const excludeSameFunctionScope = options.excludeSameFunctionScope ?? true;
  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));
  const edges: IrProject['edges'] = [];
  for (const [refId, defId] of refIdToDefId) {
    const ref = byId.get(refId);
    const def = byId.get(defId);
    if (!ref || !def) continue;
    if (excludeSameFunctionScope && innermostFunctionScope(ref) !== undefined && innermostFunctionScope(ref) === innermostFunctionScope(def)) {
      continue;
    }
    edges.push({
      nodeA: refId,
      nodeB: defId,
      connascenceType: 'name',
      evidence: `reference to "${def.name}" at ${def.location.filePath}:${def.location.startLine}`,
    });
  }
  return edges;
}
