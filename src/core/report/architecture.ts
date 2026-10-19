import { ScoredEdge } from '../scoring/score.js';
import { dirOf, KEY_SEP } from '../paths.js';
import { ConnascenceConfig, Violation } from '../config.js';
import { louvainCommunities, wkey } from './louvain.js';
import { stronglyConnected } from './scc.js';
import { levelize, type Levelization } from './levelization.js';

/** Dependency edge types reliable enough to infer module structure from. */
const DEP_TYPES = new Set(['name', 'type']);

/** a cluster must span at least this many directories to count as a folder mismatch */
const MISMATCH_DIRS = 2;

// ---- module detection ----

export interface FileCluster {
  /** stable label: longest common directory prefix of members, else first member */
  name: string;
  /** member file paths */
  files: string[];
  /** distinct directories the cluster spans; >1 = structure/folder mismatch candidate */
  dirs: string[];
}

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

/** undirected strength-weighted file graph from dependency edges */
function buildWeight(depEdges: ScoredEdge[]): Map<string, number> {
  const weight = new Map<string, number>();
  for (const e of depEdges) {
    const a = e.nodeA.filePath;
    const b = e.nodeB.filePath;
    if (a === b) continue;
    weight.set(wkey(a, b), (weight.get(wkey(a, b)) ?? 0) + e.strength);
  }
  return weight;
}

/**
 * One round of Louvain over a node set with undirected weights. `expand` maps
 * a node key back to the underlying files it represents (identity at the file
 * level, accumulated module members at deeper levels).
 */
function partitionRound(
  weight: Map<string, number>,
  expand?: Map<string, string[]>,
): FileCluster[] {
  const inGraph = [...new Set([...weight.keys()].flatMap((k) => k.split(KEY_SEP)))].sort();
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
  const clusters = partitionRound(buildWeight(dep));
  dedupeNames(clusters);
  return clusters;
}

/** Contract clusters into supernodes: summed cross-cluster strengths over the dep edges. */
function contractWeight(
  clusters: FileCluster[],
  depEdges: ScoredEdge[],
): { weight: Map<string, number>; expand: Map<string, string[]> } {
  const memberOf = new Map<string, string>();
  const expand = new Map<string, string[]>();
  for (const c of clusters) {
    for (const f of c.files) memberOf.set(f, c.name);
    expand.set(c.name, c.files);
  }
  const weight = new Map<string, number>();
  for (const e of depEdges) {
    const ca = memberOf.get(e.nodeA.filePath);
    const cb = memberOf.get(e.nodeB.filePath);
    if (!ca || !cb || ca === cb) continue;
    weight.set(wkey(ca, cb), (weight.get(wkey(ca, cb)) ?? 0) + e.strength);
  }
  return { weight, expand };
}

/**
 * Module hierarchy: repeatedly contract the detected modules into supernodes
 * (edge weight = summed strengths) and re-cluster, yielding empirically
 * existing submodules. Level 0 is the finest partition of files; each deeper
 * level groups modules into larger ones until no further split is found.
 */
export function moduleLevels(dep: ScoredEdge[]): FileCluster[][] {
  const depEdges = dep.filter((e) => DEP_TYPES.has(e.connascenceType));
  const initialWeight = buildWeight(depEdges);

  const levels: FileCluster[][] = [];
  let weight = initialWeight;
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

    ({ weight, expand } = contractWeight(clusters, depEdges));
    if (weight.size === 0) break;
  }
  return levels;
}

/** maximum hierarchy depth (levels of submodules) to detect */
const MAX_LEVELS = 4;

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
  /** Lakos dependency-chain depth over the module graph (cycles collapsed) */
  levelization: Levelization;
}

/** Directed module-to-module couplings from cross-module dependency edges. */
function pairCouplings(
  modules: FileCluster[],
  dep: ScoredEdge[],
): { pairs: Map<string, ClusterCoupling>; crossEdges: number } {
  const clusterOf = new Map<string, string>();
  for (const mod of modules) {
    for (const f of mod.files) clusterOf.set(f, mod.name);
  }

  const pairKey = (a: string, b: string) => `${a}${KEY_SEP}${b}`;
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
  return { pairs, crossEdges };
}

/** module pairs coupled in both directions (tangle signal) */
function findTangles(dependencies: ClusterCoupling[]): ArchitectureReport['tangles'] {
  const pairKey = (a: string, b: string) => `${a}${KEY_SEP}${b}`;
  const byKey = new Map(dependencies.map((p) => [pairKey(p.from, p.to), p]));
  const tangles: ArchitectureReport['tangles'] = [];
  const seen = new Set<string>();
  for (const p of dependencies) {
    const q = byKey.get(pairKey(p.to, p.from));
    if (!q) continue;
    const key = [p.from, p.to].sort().join(KEY_SEP);
    if (seen.has(key)) continue;
    seen.add(key);
    tangles.push({ a: p.from, b: p.to, forward: p, backward: q });
  }
  return tangles;
}

/**
 * Kosaraju SCCs on the module-level dependency graph: one component = one
 * cycle, so overlapping loops are not enumerated once per back-edge. Two-module
 * components are tangles and are reported in `tangles` (the bidirectional pair
 * is the actionable signal); closing the component (a -> ... -> a) keeps the
 * rendered shape readable.
 */
function findCycles(modules: FileCluster[], dependencies: ClusterCoupling[]): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const mod of modules) graph.set(mod.name, new Set());
  for (const p of dependencies) graph.get(p.from)?.add(p.to);
  return stronglyConnected(graph)
    .filter((c) => c.length > 2)
    .map((c) => [...c, c[0]])
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/** Lakos levels for the module dependency graph. */
function moduleLevelization(
  modules: FileCluster[],
  dependencies: ClusterCoupling[],
): Levelization {
  const graph = new Map<string, Set<string>>();
  for (const mod of modules) graph.set(mod.name, new Set());
  for (const p of dependencies) {
    if (p.from !== p.to) graph.get(p.from)?.add(p.to);
  }
  return levelize(graph);
}

function reportForPartition(modules: FileCluster[], dep: ScoredEdge[]): ArchitectureReport {
  const { pairs, crossEdges } = pairCouplings(modules, dep);
  const dependencies = [...pairs.values()].sort(
    (x, y) => y.weight - x.weight || y.edges - x.edges,
  );

  const tangles = findTangles(dependencies);
  const cycles = findCycles(modules, dependencies);

  return {
    modules,
    tangles,
    dependencies,
    cycles,
    mismatches: modules.filter((m) => m.dirs.length >= MISMATCH_DIRS),
    clusters: modules.length,
    dependencyEdges: crossEdges,
    levelization: moduleLevelization(modules, dependencies),
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
  if (r.cycles.length > 0 || r.tangles.length > 0) return null;
  const byLevel = new Map<number, string[]>();
  for (const entry of r.levelization.entries) {
    if (!byLevel.has(entry.level)) byLevel.set(entry.level, []);
    byLevel.get(entry.level)!.push(entry.name);
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, names]) => names.sort());
}


