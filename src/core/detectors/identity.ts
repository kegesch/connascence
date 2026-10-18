import { IrNode, IrProject } from '../ir.js';

/**
 * Connascence of Identity (heuristic): flags reads/writes of mutable
 * module-level variables from other scopes — coupling through shared,
 * mutable identity rather than through an interface or message.
 * Candidates only; evidence is required for reviewer sanity-checks.
 */
export function detectIdentity(project: IrProject): IrProject['edges'] {
  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));
  const edges: IrProject['edges'] = [];

  for (const edge of project.edges) {
    if (edge.connascenceType !== 'name') continue;
    const def = byId.get(edge.nodeB);
    if (!def || def.kind !== 'variable' || !def.mutable) continue;
    // module-level only: no enclosing function/class scope (module + package segments are fine)
    if (def.scopePath.some((s) => s.kind === 'function' || s.kind === 'class')) continue;
    const ref = byId.get(edge.nodeA);
    if (!ref) continue;
    // same innermost module code is still fine to flag if ref is inside a function (cross-scope)
    edges.push({
      nodeA: edge.nodeA,
      nodeB: edge.nodeB,
      connascenceType: 'identity',
      evidence: `shared mutable module state: "${def.name}" (let/var at module scope, ${def.location.filePath}:${def.location.startLine}) accessed from ${ref.location.filePath}:${ref.location.startLine}`,
    });
  }
  return edges;
}
