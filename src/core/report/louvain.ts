import { KEY_SEP } from '../paths.js';

/** Modularity resolution: >1 splits more aggressively (more, smaller modules). */
const RESOLUTION = 2;

/** undirected weight key for two node ids */
export const wkey = (a: string, b: string): string => (a < b ? `${a}${KEY_SEP}${b}` : `${b}${KEY_SEP}${a}`);

/** immutable graph snapshot used during one local-moving phase */
interface Graph {
  totalWeight: number;
  degree: Map<string, number>;
  neighbors: Map<string, Set<string>>;
  weightBetween: (a: string, b: string) => number;
}

function buildGraph(nodes: string[], weight: Map<string, number>): Graph {
  const degree = new Map<string, number>();
  const neighbors = new Map<string, Set<string>>();
  for (const [key, w] of weight) {
    const [a, b] = key.split(KEY_SEP);
    degree.set(a, (degree.get(a) ?? 0) + w);
    degree.set(b, (degree.get(b) ?? 0) + w);
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  }
  return {
    totalWeight: [...weight.values()].reduce((a, b) => a + b, 0),
    degree,
    neighbors,
    weightBetween: (a, b) => weight.get(`${a}${KEY_SEP}${b}`) ?? weight.get(`${b}${KEY_SEP}${a}`) ?? 0,
  };
}

/** per-node gain evaluation context */
interface GainCtx {
  graph: Graph;
  community: Map<string, number>;
  linksInto: Map<number, number>;
  node: string;
}

/** modularity gain of moving `node` into community `c` */
function gainOf(c: number, ctx: GainCtx): number {
  const links = ctx.linksInto.get(c) ?? 0;
  return links - (RESOLUTION * (ctx.graph.degree.get(ctx.node) ?? 0) * sumTot(c, ctx.graph, ctx.community)) / (2 * ctx.graph.totalWeight);
}

function sumTot(c: number, graph: Graph, community: Map<string, number>): number {
  let total = 0;
  for (const [n, degree] of graph.degree) {
    if (community.get(n) === c) total += degree;
  }
  return total;
}

/** links from `node` into each neighboring community (including its own) */
function linksIntoCommunities(
  node: string,
  graph: Graph,
  community: Map<string, number>,
): Map<number, number> {
  const kIn = new Map<number, number>();
  for (const nb of graph.neighbors.get(node) ?? []) {
    const c = community.get(nb)!;
    kIn.set(c, (kIn.get(c) ?? 0) + graph.weightBetween(node, nb));
  }
  return kIn;
}

/** best (highest-gain) community for `node`; stays put on ties to prevent oscillation */
function bestCommunityFor(node: string, graph: Graph, community: Map<string, number>): number {
  const old = community.get(node)!;
  const ctx: GainCtx = { graph, community, linksInto: linksIntoCommunities(node, graph, community), node };
  let best = old;
  let bestGain = gainOf(old, ctx) - 1e-9;
  for (const c of ctx.linksInto.keys()) {
    if (c === old) continue;
    const gain = gainOf(c, ctx);
    if (gain > bestGain) {
      bestGain = gain;
      best = c;
    }
  }
  return best;
}

/** one full local-moving sweep; returns true if any node changed community */
function sweep(nodes: string[], graph: Graph, community: Map<string, number>): boolean {
  let moved = false;
  for (const node of nodes) {
    const best = bestCommunityFor(node, graph, community);
    if (best !== community.get(node)) {
      community.set(node, best);
      moved = true;
    }
  }
  return moved;
}

/**
 * Partitions graph nodes into communities maximizing weighted modularity.
 * Deterministic sweep order; no random restarts — good enough for module
 * detection, fully reproducible output. Self-contained, no dependencies.
 */
export function louvainCommunities(nodes: string[], weight: Map<string, number>): Map<string, number> {
  const community = new Map<string, number>();
  nodes.forEach((n, i) => community.set(n, i));
  if (weight.size === 0) return community;

  const graph = buildGraph(nodes, weight);
  if (graph.totalWeight === 0) return community;
  const MAX_SWEEPS = 10; // convergence guard; single-level local moving converges long before this
  let moved = true;
  let sweeps = 0;
  while (moved && sweeps < MAX_SWEEPS) {
    sweeps += 1;
    moved = sweep(nodes, graph, community);
  }
  return community;
}
