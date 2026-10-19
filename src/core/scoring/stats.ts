// Project-level metrics for the score's equality/redundancy axes. Kept as a
// separate projection of the IR so scoreProject stays focused on edges.

import type { IrNode } from '../ir.js';

/** Kinds that represent behavior/abstraction a module can own. */
const DEFINITION_KINDS: ReadonlySet<IrNode['kind']> = new Set(['function', 'method', 'class']);

export interface ProjectStats {
  /** every file that contributed at least one IR node, sorted */
  files: string[];
  /** behavior definitions per file; keys sorted for deterministic JSON */
  definitionsByFile: Record<string, number>;
  /** total function/method/class definitions */
  definitions: number;
  /** definitions that carry a structural hash (clone comparison unit) */
  hashableDefinitions: number;
  /** definitions redundant with at least one structural twin (n-1 per group) */
  duplicateDefinitions: number;
}

export function projectStats(nodes: IrNode[]): ProjectStats {
  const files = [...new Set(nodes.map((n) => n.location.filePath))].sort();
  const byFile = new Map<string, number>();
  const byHash = new Map<string, number>();
  let definitions = 0;
  let hashableDefinitions = 0;

  for (const node of nodes) {
    if (DEFINITION_KINDS.has(node.kind)) {
      definitions += 1;
      byFile.set(node.location.filePath, (byFile.get(node.location.filePath) ?? 0) + 1);
    }
    if (node.structureHash) {
      hashableDefinitions += 1;
      byHash.set(node.structureHash, (byHash.get(node.structureHash) ?? 0) + 1);
    }
  }

  let duplicateDefinitions = 0;
  for (const count of byHash.values()) {
    if (count > 1) duplicateDefinitions += count - 1;
  }

  return {
    files,
    definitionsByFile: Object.fromEntries([...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))),
    definitions,
    hashableDefinitions,
    duplicateDefinitions,
  };
}
