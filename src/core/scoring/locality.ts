import { IrNode, ScopeKind } from '../ir.js';

/**
 * Locality = scope distance between the two nodes' enclosing scopes,
 * computed by walking to the nearest common ancestor.
 * 1 = same function scope, 2 = same class, 3 = same module, 4+ = cross-module (one per level).
 */
export function localityOf(a: IrNode, b: IrNode): number {
  const rank: Record<ScopeKind, number> = { function: 1, class: 2, module: 3, package: 4 };
  const pathA = a.scopePath;
  const pathB = b.scopePath;
  const scopesA = new Map(pathA.map((s) => [`${s.kind}:${s.name}`, s]));

  // The locality level is the rank of the nearest common ancestor scope.
  for (const segment of pathB) {
    const common = scopesA.get(`${segment.kind}:${segment.name}`);
    if (common) return rank[common.kind];
  }
  // no common scope: fully separated
  return 4;
}
