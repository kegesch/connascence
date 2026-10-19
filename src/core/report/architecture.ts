import { ScoredEdge } from '../scoring/score.js';
import { KEY_SEP } from '../paths.js';
import { ConnascenceConfig, Violation } from '../config.js';
import { stronglyConnected } from './scc.js';
import { levelize, type Levelization } from './levelization.js';
import {
  DEPENDENCY_TYPES,
  MISMATCH_DIRS,
  fileClusters,
  moduleLevels,
  type FileCluster,
} from './modules.js';

export { fileClusters, moduleLevels } from './modules.js';
export type { FileCluster } from './modules.js';

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
    if (!DEPENDENCY_TYPES.has(e.connascenceType)) continue;
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
  const dep = edges.filter((e) => DEPENDENCY_TYPES.has(e.connascenceType));
  const levels = moduleLevels(dep);
  return reportForPartition(levels[0] ?? [], dep);
}

/**
 * Architecture at every level of the module hierarchy: the finest partition
 * first, then each contracted level of submodules. Submodules must satisfy the
 * same cleanliness properties (no tangles/cycles) as top-level modules.
 */
export function architectureLevels(edges: ScoredEdge[]): ArchitectureReport[] {
  const dep = edges.filter((e) => DEPENDENCY_TYPES.has(e.connascenceType));
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
  if (
    a.maxLevelizationDepth !== undefined &&
    arch.levelization.depth > a.maxLevelizationDepth
  ) {
    violations.push({
      kind: 'architecture',
      message: `levelization: depth ${arch.levelization.depth} exceeds maxLevelizationDepth ${a.maxLevelizationDepth}`,
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
