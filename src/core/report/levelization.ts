// Lakos levelization (PLAN.md §M3a): dependency-chain depth, not Ousterhout
// depth. A component's level is `1 + max(level of its dependencies)`, so the
// number of levels is the longest dependency chain. Foundation = 1.
//
// Cycles are collapsed with the same deterministic SCC helper used by the cycle
// findings. That keeps the metric defined for a cyclic graph (all members of a
// cycle share one level) while `cyclic: true` records that the graph was not
// acyclic. A self-reference is not a structural cycle and does not change a
// level, matching `findFileCycles`.

import type { ScoredEdge } from '../scoring/score.js';
import { stronglyConnected, type Adjacency } from './scc.js';

export interface LevelEntry {
  /** file path (file graph) or module label (module graph) */
  name: string;
  /** 1 = foundation, higher = further from the foundation */
  level: number;
}

export interface Levelization {
  /** deepest first, then name — deterministic, independent of Map order */
  entries: LevelEntry[];
  /** number of levels; 0 for an empty graph */
  depth: number;
  /** number of SCCs after collapsing cycles */
  components: number;
  /** at least one SCC contains more than one node */
  cyclic: boolean;
}

/** Cross-component dependencies after SCC contraction (internal edges dropped). */
function componentDependencies(
  adjacency: Adjacency,
  componentOf: Map<string, string>,
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  for (const id of componentOf.values()) deps.set(id, new Set());
  for (const [from, targets] of adjacency) {
    const fromComponent = componentOf.get(from);
    if (!fromComponent) continue;
    for (const to of targets) {
      const toComponent = componentOf.get(to);
      if (toComponent && toComponent !== fromComponent) {
        deps.get(fromComponent)!.add(toComponent);
      }
    }
  }
  return deps;
}

/** Kahn over the acyclic condensation: level = 1 + max(dependency levels). */
function assignLevels(deps: Map<string, Set<string>>): Map<string, number> {
  const dependents = new Map<string, Set<string>>();
  const pending = new Map<string, number>();
  for (const [id, dependencies] of deps) {
    pending.set(id, dependencies.size);
    for (const dependency of dependencies) {
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency)!.add(id);
    }
  }

  const level = new Map<string, number>();
  const queue = [...deps.keys()].filter((id) => pending.get(id) === 0).sort();
  while (queue.length > 0) {
    const id = queue.shift()!;
    const dependencyLevel = [...deps.get(id)!].reduce(
      (max, dependency) => Math.max(max, level.get(dependency) ?? 0),
      0,
    );
    level.set(id, dependencyLevel + 1);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (pending.get(dependent) ?? 0) - 1;
      pending.set(dependent, remaining);
      if (remaining === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }
  if (level.size !== deps.size) {
    throw new Error('levelization: SCC condensation was not acyclic');
  }
  return level;
}

/**
 * Lakos levels over a directed dependency graph. `adjacency` maps a component
 * to the components it depends on (edge direction: from -> its dependency).
 */
export function levelize(adjacency: Adjacency): Levelization {
  const components = stronglyConnected(adjacency);
  if (components.length === 0) {
    return { entries: [], depth: 0, components: 0, cyclic: false };
  }

  const componentOf = new Map<string, string>();
  for (const members of components) {
    for (const member of members) componentOf.set(member, members[0]);
  }

  const levels = assignLevels(componentDependencies(adjacency, componentOf));
  const entries = [...componentOf.entries()]
    .map(([name, id]) => ({ name, level: levels.get(id)! }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  return {
    entries,
    // reduce, not Math.max(...values): a graph can have more SCCs than the
    // engine's argument limit
    depth: [...levels.values()].reduce((max, value) => Math.max(max, value), 0),
    components: components.length,
    cyclic: components.some((component) => component.length > 1),
  };
}

/**
 * File-level levelization over resolved dependency edges. Only adapter-resolved
 * `name` edges are used, matching the certainty rule for cycle findings.
 */
export function fileLevelization(edges: ScoredEdge[]): Levelization {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.connascenceType !== 'name' || edge.resolved !== true) continue;
    const from = edge.nodeA.filePath;
    const to = edge.nodeB.filePath;
    if (from === to) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  }
  return levelize(adjacency);
}
