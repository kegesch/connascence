// Generic Kosaraju strongly-connected components over a deterministic graph.
// Core-only (no language types): callers build the adjacency map from IR-derived
// edges. Determinism is engineered: nodes and neighbours are sorted before every
// traversal, so the component order does not depend on Map/Set iteration order.

export type Adjacency = Map<string, ReadonlySet<string>>;

/** All nodes mentioned as a source or a target, sorted. */
function allNodes(adjacency: Adjacency): string[] {
  const nodes = new Set<string>();
  for (const [from, targets] of adjacency) {
    nodes.add(from);
    for (const to of targets) nodes.add(to);
  }
  return [...nodes].sort();
}

/** Finish order of a depth-first post-order walk (iterative: no call-stack limit). */
function finishOrder(adjacency: Adjacency, nodes: string[]): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: { node: string; next: number }[] = [{ node: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = [...(adjacency.get(frame.node) ?? [])].sort();
      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next++];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ node: next, next: 0 });
        }
      } else {
        order.push(frame.node);
        stack.pop();
      }
    }
  }
  return order;
}

function reversed(adjacency: Adjacency, nodes: string[]): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  for (const [from, targets] of adjacency) {
    for (const to of targets) reverse.get(to)?.add(from);
  }
  return reverse;
}

/**
 * Kosaraju SCCs. Each component's members are sorted; components are returned
 * longest-first, then by first member. Singletons are included, so callers can
 * decide whether a one-node component is a cycle (self-loop) or just a node.
 */
export function stronglyConnected(adjacency: Adjacency): string[][] {
  const nodes = allNodes(adjacency);
  const order = finishOrder(adjacency, nodes);
  const reverse = reversed(adjacency, nodes);
  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const start = order[i];
    if (assigned.has(start)) continue;
    const members: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length > 0) {
      const node = stack.pop()!;
      members.push(node);
      for (const next of reverse.get(node) ?? []) {
        if (!assigned.has(next)) {
          assigned.add(next);
          stack.push(next);
        }
      }
    }
    components.push(members.sort());
  }
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}
