import path from 'node:path';
import { ScoredEdge } from '../scoring/score.js';
import { toPosix } from '../paths.js';
import { ConnascenceConfig, Violation } from '../config.js';

/** Dependency edge types reliable enough to infer module structure from. */
const DEP_TYPES = new Set(['name', 'type']);

/** Minimum aggregate strength for a cross-cluster pair to be reported. */
const MIN_PAIR_STRENGTH = 6;

/** Modularity resolution: >1 splits more aggressively (more, smaller modules). */
const RESOLUTION = 2;

/** a cluster must span at least this many directories to count as a folder mismatch */
const MISMATCH_DIRS = 2;

/** maximum hierarchy depth (levels of submodules) to detect */
const MAX_LEVELS = 4;

function dirOf(filePath: string): string {
  return path.posix.dirname(toPosix(filePath));
}

// ---- community detection (single-level Louvain local moving) ----

/**
 * Partitions graph nodes into communities maximizing weighted modularity.
 * Deterministic sweep order; no random restarts — good enough for module
 * detection, fully reproducible output. Self-contained, no dependencies.
 */
function louvainCommunities(nodes: string[], weight: Map<string, number>): Map<string, number> {
  const m = [...weight.values()].reduce((a, b) => a + b, 0);
  const community = new Map<string, number>();
  nodes.forEach((n, i) => community.set(n, i));
  if (m === 0) return community;

  const k = new Map<string, number>(); // weighted degree
  const neighbors = new Map<string, Set<string>>();
  for (const [key, w] of weight) {
    const [a, b] = key.split('\u0000');
    k.set(a, (k.get(a) ?? 0) + w);
    k.set(b, (k.get(b) ?? 0) + w);
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  }

  const wBetween = (a: string, b: string): number =>
    weight.get(`${a}\u0000${b}`) ?? weight.get(`${b}\u0000${a}`) ?? 0;

  const MAX_SWEEPS = 10; // convergence guard; single-level local moving converges long before this
  let moved = true;
  let sweeps = 0;
  while (moved && sweeps < MAX_SWEEPS) {
    sweeps += 1;
    moved = false;
    for (const node of nodes) {
      const old = community.get(node)!;
      // community -> total weighted degree
      const sumTot = new Map<number, number>();
      for (const n of nodes) {
        const c = community.get(n)!;
        sumTot.set(c, (sumTot.get(c) ?? 0) + (k.get(n) ?? 0));
      }
      // links from node into each neighboring community (including its own)
      const kIn = new Map<number, number>();
      for (const nb of neighbors.get(node) ?? []) {
        const c = community.get(nb)!;
        kIn.set(c, (kIn.get(c) ?? 0) + wBetween(node, nb));
      }
      const gainOf = (c: number): number => {
        const links = kIn.get(c) ?? 0;
        return links - (RESOLUTION * (k.get(node) ?? 0) * (sumTot.get(c) ?? 0)) / (2 * m);
      };
      let best = old;
      let bestGain = gainOf(old) - 1e-9; // stay put on ties — prevents oscillation
      for (const [c] of kIn) {
        if (c === old) continue;
        const gain = gainOf(c);
        if (gain > bestGain) {
          bestGain = gain;
          best = c;
        }
      }
      if (best !== old) {
        community.set(node, best);
        moved = true;
      }
    }
  }
  return community;
}

// ---- module detection ----

export interface FileCluster {
  /** stable label: longest common directory prefix of members, else first member */
  name: string;
  /** member file paths */
  files: string[];
  /** distinct directories the cluster spans; >1 = structure/folder mismatch candidate */
  dirs: string[];
}

/** undirected weight key for two node ids */
const wkey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Longest common path prefix of all members; anything else falls back to the first member. */
function clusterName(members: string[], prefixOf: (m: string) => string): string {
  const prefixes = members.map(prefixOf);
  if (prefixes.every((p) => p === prefixes[0])) return prefixes[0];
  const first = prefixes[0].split('/');
  let common: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const candidate = first.slice(0, i + 1).join('/');
    if (prefixes.every((p) => p.split('/').slice(0, i + 1).join('/') === candidate)) {
      common = candidate.split('/');
    } else break;
  }
  return common.length > 0 ? common.join('/') + '+…' : members[0];
}

/** file-level namer: cluster named by the common directory of its files */
const byDir = (m: string): string => dirOf(m);
/** contracted-level namer: cluster named by the common prefix of its module labels */
const byName = (m: string): string => m;

/**
 * One round of Louvain over a node set with undirected weights. `expand` maps
 * a node key back to the underlying files it represents (identity at the file
 * level, accumulated module members at deeper levels).
 */
function partitionRound(
  weight: Map<string, number>,
  expand?: Map<string, string[]>,
): FileCluster[] {
  const inGraph = [...new Set([...weight.keys()].flatMap((k) => k.split('\u0000')))].sort();
  if (inGraph.length === 0) return [];
  const community = louvainCommunities(inGraph, weight);
  // deeper levels: members are module labels, not file paths
  const prefixOf = expand ? byName : byDir;

  const groups = new Map<number, string[]>();
  for (const f of inGraph) {
    const c = community.get(f)!;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(f);
  }

  const clusters = [...groups.values()].map((members) => {
    // at the file level members are the files themselves; deeper levels expand
    // module keys back to the files they stand for
    const files = expand ? [...new Set(members.flatMap((m) => expand.get(m) ?? []))] : members;
    const dirs = [...new Set(files.map(dirOf))];
    const name = clusterName(members, prefixOf);
    return { name, files, dirs };
  });
  return clusters.sort((a, b) => b.files.length - a.files.length || (a.name < b.name ? -1 : 1));
}

function dedupeNames(clusters: FileCluster[]): void {
  const used = new Map<string, number>();
  for (const c of clusters) {
    const n = used.get(c.name) ?? 0;
    used.set(c.name, n + 1);
    if (n > 0) c.name = `${c.name}#${n + 1}`;
  }
}

/**
 * Graph-driven module detection: cluster files by their actual dependency
 * relationships (Louvain communities over the strength-weighted file graph),
 * independent of folder layout. Comparing the result with directories is what
 * reveals "missing structure" — a module that spans several folders (folder
 * layout hiding real modules) or a folder split across several modules.
 */
export function fileClusters(edges: ScoredEdge[]): FileCluster[] {
  const dep = edges.filter((e) => DEP_TYPES.has(e.connascenceType));
  const weight = new Map<string, number>();
  for (const e of dep) {
    const a = e.nodeA.filePath;
    const b = e.nodeB.filePath;
    if (a === b) continue;
    weight.set(wkey(a, b), (weight.get(wkey(a, b)) ?? 0) + e.strength);
  }
  const clusters = partitionRound(weight);
  dedupeNames(clusters);
  return clusters;
}

/**
 * Module hierarchy: repeatedly contract the detected modules into supernodes
 * (edge weight = summed strengths) and re-cluster, yielding empirically
 * existing submodules. Level 0 is the finest partition of files; each deeper
 * level groups modules into larger ones until no further split is found.
 */
export function moduleLevels(dep: ScoredEdge[]): FileCluster[][] {
  const depEdges = dep.filter((e) => DEP_TYPES.has(e.connascenceType));
  let weight = new Map<string, number>();
  for (const e of depEdges) {
    const a = e.nodeA.filePath;
    const b = e.nodeB.filePath;
    if (a === b) continue;
    weight.set(wkey(a, b), (weight.get(wkey(a, b)) ?? 0) + e.strength);
  }

  const levels: FileCluster[][] = [];
  let expand: Map<string, string[]> | undefined = undefined;
  let prevCount = Infinity;
  for (let depth = 0; depth < MAX_LEVELS; depth++) {
    const clusters = partitionRound(weight, levels.length === 0 ? undefined : expand);
    dedupeNames(clusters);
    if (clusters.length === 0) break;
    levels.push(clusters);
    // stop when no further coarsening happened: one module, or unchanged count
    if (clusters.length <= 1 || clusters.length >= prevCount) break;
    prevCount = clusters.length;

    // contract: supernodes are the clusters, weights are summed cross-cluster strengths
    const memberOf = new Map<string, string>();
    expand = new Map<string, string[]>();
    for (const c of clusters) {
      for (const f of c.files) memberOf.set(f, c.name);
      expand.set(c.name, c.files);
    }
    weight = new Map<string, number>();
    for (const e of depEdges) {
      const ca = memberOf.get(e.nodeA.filePath);
      const cb = memberOf.get(e.nodeB.filePath);
      if (!ca || !cb || ca === cb) continue;
      weight.set(wkey(ca, cb), (weight.get(wkey(ca, cb)) ?? 0) + e.strength);
    }
    if (weight.size === 0) break;
  }
  return levels;
}

// ---- architecture report over a module partition ----

export interface ClusterCoupling {
  /** module the edge originates from */
  from: string;
  /** module the edge points into */
  to: string;
  /** number of dependency edges in this direction */
  edges: number;
  /** sum of edge strengths — the "architectural connascence" weight */
  weight: number;
  /** worst single strength in this direction */
  worstStrength: number;
}

export interface ArchitectureReport {
  /** detected modules at this level of the hierarchy */
  modules: FileCluster[];
  /** module pairs with coupling in BOTH directions (tangle signal) */
  tangles: { a: string; b: string; forward: ClusterCoupling; backward: ClusterCoupling }[];
  /** directed dependencies between modules, strongest first */
  dependencies: ClusterCoupling[];
  /** dependency cycles between modules, e.g. [['a','b','c']] means a -> b -> c -> a */
  cycles: string[][];
  /** modules spanning multiple directories — the graph sees one module where the
   *  folder layout implies several (or folders don't reflect the real structure) */
  mismatches: FileCluster[];
  /** number of modules and cross-module dependency edges considered */
  clusters: number;
  dependencyEdges: number;
}

function reportForPartition(modules: FileCluster[], dep: ScoredEdge[]): ArchitectureReport {
  const clusterOf = new Map<string, string>();
  for (const mod of modules) {
    for (const f of mod.files) clusterOf.set(f, mod.name);
  }

  const pairKey = (a: string, b: string) => `${a}\u0000${b}`;
  const pairs = new Map<string, ClusterCoupling>();
  let crossEdges = 0;
  for (const e of dep) {
    if (!DEP_TYPES.has(e.connascenceType)) continue;
    const a = clusterOf.get(e.nodeA.filePath);
    const b = clusterOf.get(e.nodeB.filePath);
    if (a === undefined || b === undefined || a === b) continue;
    crossEdges += 1;
    const key = pairKey(a, b);
    let p = pairs.get(key);
    if (!p) {
      p = { from: a, to: b, edges: 0, weight: 0, worstStrength: 0 };
      pairs.set(key, p);
    }
    p.edges += 1;
    p.weight += e.strength;
    p.worstStrength = Math.max(p.worstStrength, e.strength);
  }

  const dependencies = [...pairs.values()].sort(
    (x, y) => y.weight - x.weight || y.edges - x.edges,
  );

  // tangles: module pairs coupled in both directions
  const tangles: ArchitectureReport['tangles'] = [];
  const seen = new Set<string>();
  for (const p of dependencies) {
    const q = pairs.get(pairKey(p.to, p.from));
    if (!q) continue;
    const key = [p.from, p.to].sort().join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    tangles.push({ a: p.from, b: p.to, forward: p, backward: q });
  }

  // cycle detection (DFS) on the module-level dependency graph
  const graph = new Map<string, string[]>();
  for (const p of dependencies) {
    if (!graph.has(p.from)) graph.set(p.from, []);
    graph.get(p.from)!.push(p.to);
  }
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited 1=in-stack 2=done
  const stack: string[] = [];
  const visit = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      const s = state.get(m) ?? 0;
      if (s === 0) visit(m);
      else if (s === 1) {
        const start = stack.indexOf(m);
        cycles.push([...stack.slice(start), m]);
      }
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const mod of modules) {
    if ((state.get(mod.name) ?? 0) === 0) visit(mod.name);
  }
  cycles.sort((a, b) => b.length - a.length);

  // a tangle already reports the both-direction coupling; drop the redundant 2-cycle
  const tangledPairs = new Set(tangles.map((t) => [t.a, t.b].sort().join('\u0000')));
  const realCycles = cycles.filter((c) => c.length > 2 || !tangledPairs.has([c[0], c[1]].sort().join('\u0000')));

  return {
    modules,
    tangles,
    dependencies,
    cycles: realCycles,
    mismatches: modules.filter((m) => m.dirs.length >= MISMATCH_DIRS),
    clusters: modules.length,
    dependencyEdges: crossEdges,
  };
}

/**
 * Architecture report at the finest module level:
 * - detect modules as graph communities (not folders),
 * - aggregate cross-module dependency edges weighted by connascence strength,
 * - detect dependency cycles and bidirectional tangles between modules,
 * - flag modules whose membership spans multiple directories.
 * Pure function on scored edges; language-agnostic (file paths only).
 */
export function architectureReport(edges: ScoredEdge[]): ArchitectureReport {
  const dep = edges.filter((e) => DEP_TYPES.has(e.connascenceType));
  const levels = moduleLevels(dep);
  return reportForPartition(levels[0] ?? [], dep);
}

/**
 * Architecture at every level of the module hierarchy: the finest partition
 * first, then each contracted level of submodules. Submodules must satisfy the
 * same cleanliness properties (no tangles/cycles) as top-level modules.
 */
export function architectureLevels(edges: ScoredEdge[]): ArchitectureReport[] {
  const dep = edges.filter((e) => DEP_TYPES.has(e.connascenceType));
  return moduleLevels(dep).map((modules) => reportForPartition(modules, dep));
}

const COUNT = 5;

/** Evaluate the architecture report (graph-detected modules) against the config. Pure function. */
export function evaluateArchitecture(
  arch: ArchitectureReport,
  config: ConnascenceConfig,
): Violation[] {
  const a = config.architecture;
  if (!a) return [];
  const violations: Violation[] = [];
  if (a.maxTangles !== undefined && arch.tangles.length > a.maxTangles) {
    violations.push({
      kind: 'architecture',
      message: `tangles: ${arch.tangles.length} module pair(s) coupled in both directions exceeds maxTangles ${a.maxTangles}`,
    });
  }
  if (a.maxCycles !== undefined && arch.cycles.length > a.maxCycles) {
    violations.push({
      kind: 'architecture',
      message: `cycles: ${arch.cycles.length} module dependency cycle(s) exceeds maxCycles ${a.maxCycles}`,
    });
  }
  if (a.maxMismatches !== undefined && arch.mismatches.length > a.maxMismatches) {
    violations.push({
      kind: 'architecture',
      message: `mismatches: ${arch.mismatches.length} module(s) span multiple directories, exceeds maxMismatches ${a.maxMismatches}`,
    });
  }
  return violations;
}

/**
 * Layering verdict for one partition: if the module graph is acyclic, partition
 * modules into layers — layer 1 is the foundation (depends on nothing), each
 * higher layer may only depend on lower ones. Returns null when cycles make
 * layering impossible.
 */
export function layering(r: ArchitectureReport): string[][] | null {
  if (r.cycles.length > 0) return null;
  const nameOf = new Set(r.modules.map((m) => m.name));
  const deps = new Map<string, Set<string>>(); // module -> modules it depends on
  for (const m of r.modules) deps.set(m.name, new Set());
  for (const p of r.dependencies) {
    if (nameOf.has(p.from) && nameOf.has(p.to)) deps.get(p.from)!.add(p.to);
  }
  const layers: string[][] = [];
  const layerOf = new Map<string, number>();
  while (layerOf.size < r.modules.length) {
    // next layer: everything whose dependencies are all already layered
    const ready = r.modules
      .filter((m) => !layerOf.has(m.name))
      .filter((m) => [...deps.get(m.name)!].every((d) => layerOf.has(d)))
      .map((m) => m.name);
    if (ready.length === 0) return null; // defensive: should not happen without cycles
    for (const n of ready) layerOf.set(n, layers.length);
    layers.push(ready.sort());
  }
  return layers;
}

/** Human/agent-readable lines for one level's architecture report. */
export function renderArchitecture(r: ArchitectureReport, rel: (p: string) => string): string[] {
  const lines: string[] = [];
  const fmtPair = (p: ClusterCoupling) =>
    `${rel(p.from)} -> ${rel(p.to)}  (${p.edges} edges, weight ${p.weight})`;

  // verdict first: what the report says about the architecture in one line
  const layers = layering(r);
  if (layers === null) {
    lines.push(
      `verdict: NO layering possible — ${r.cycles.length} dependency cycle(s) and ${r.tangles.length} tangle(s) between ${r.clusters} modules must be broken first`,
    );
  } else {
    const structure = r.mismatches.length > 0 ? `, but ${r.mismatches.length} module(s) don't match the folder layout` : '';
    lines.push(`verdict: layered architecture — ${layers.length} layer(s), dependencies point one way only${structure}`);
  }

  lines.push(`modules detected (graph communities): ${r.clusters}`);
  for (const mod of r.modules.slice(0, COUNT)) {
    const span = mod.dirs.length > 1 ? ` — spans ${mod.dirs.length} directories` : '';
    lines.push(`  ${rel(mod.name)}  (${mod.files.length} files${span})`);
  }
  if (r.modules.length > COUNT) lines.push(`  ... ${r.modules.length - COUNT} more`);

  if (layers !== null) {
    // layer 1 is the foundation (depends on nothing) — print top of the stack first
    lines.push(`layering (higher layers depend on lower ones):`);
    for (let i = layers.length - 1; i >= 0; i--) {
      const label = i === 0 ? 'foundation' : `layer ${i + 1}`;
      lines.push(`  ${label}: ${layers[i].map(rel).join(', ')}`);
    }
  }
  if (r.tangles.length > 0) {
    lines.push(`tangles — modules coupled in BOTH directions (each pair is really one module, or needs an interface between them) — ${r.tangles.length}:`);
    for (const t of r.tangles.slice(0, COUNT)) {
      lines.push(`  ${rel(t.a)} <-> ${rel(t.b)}`);
      lines.push(`    -> ${fmtPair(t.forward)}`);
      lines.push(`    <- ${fmtPair(t.backward)}`);
    }
    if (r.tangles.length > COUNT) lines.push(`  ... ${r.tangles.length - COUNT} more`);
  }
  if (r.cycles.length > 0) {
    lines.push(`dependency cycles — no layering can exist while these exist — ${r.cycles.length}:`);
    for (const c of r.cycles.slice(0, COUNT)) {
      lines.push(`  ${c.map(rel).join(' -> ')}`);
    }
    if (r.cycles.length > COUNT) lines.push(`  ... ${r.cycles.length - COUNT} more`);
  } else if (r.tangles.length === 0) {
    lines.push('OK: dependencies between modules are strictly one-way (no tangles, no cycles).');
  }
  if (r.mismatches.length > 0) {
    lines.push(`structure mismatches — the graph sees one module, the folders say several (co-locate the files, or split the module) — ${r.mismatches.length}:`);
    for (const m of r.mismatches.slice(0, COUNT)) {
      lines.push(`  ${rel(m.name)}: ${m.dirs.map(rel).slice(0, 4).join(', ')}${m.dirs.length > 4 ? ', …' : ''}`);
    }
    if (r.mismatches.length > COUNT) lines.push(`  ... ${r.mismatches.length - COUNT} more`);
  }
  const oneWay = r.dependencies.filter((p) => !r.tangles.some(
    (t) => (t.a === p.from && t.b === p.to) || (t.a === p.to && t.b === p.from),
  ));
  const strongest = oneWay.filter((p) => p.weight >= MIN_PAIR_STRENGTH);
  if (strongest.length > 0) {
    lines.push(`strongest one-way dependencies (weight >= ${MIN_PAIR_STRENGTH}) — this is your actual architecture story:`);
    for (const p of strongest.slice(0, COUNT)) {
      lines.push(`  ${fmtPair(p)}`);
    }
    if (strongest.length > COUNT) lines.push(`  ... ${strongest.length - COUNT} more`);
  }
  return lines;
}

/** All hierarchy levels, coarse structure first so the top-level story leads. */
export function renderArchitectureLevels(levels: ArchitectureReport[], rel: (p: string) => string): string[] {
  const lines: string[] = [];
  for (let i = levels.length - 1; i >= 0; i--) {
    const r = levels[i];
    if (i === levels.length - 1 && levels.length > 1) {
      lines.push(`=== top level: ${r.clusters} macro-modules ===`);
    }
    if (i < levels.length - 1 && levels.length > 1) {
      lines.push(`=== submodule level ${i + 1}: structure inside those modules (${r.clusters} modules) — same rules apply ===`);
    }
    lines.push(...renderArchitecture(r, rel));
    lines.push('');
  }
  return lines;
}
