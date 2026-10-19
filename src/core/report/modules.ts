// Graph-driven module detection (Louvain over the strength-weighted file
// graph). Kept separate from the architecture report: clustering answers
// "which files form a module?", while the report answers "is that module
// structure clean?". The score's cohesion/encapsulation axes reuse this.

import { ScoredEdge } from '../scoring/score.js';
import { dirOf, KEY_SEP } from '../paths.js';
import { louvainCommunities, wkey } from './louvain.js';

/** Dependency edge types reliable enough to infer module structure from. */
export const DEPENDENCY_TYPES: ReadonlySet<string> = new Set(['name', 'type']);

/** a cluster must span at least this many directories to count as a folder mismatch */
export const MISMATCH_DIRS = 2;

/** maximum hierarchy depth (levels of submodules) to detect */
const MAX_LEVELS = 4;

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
export function dependencyWeight(depEdges: ScoredEdge[]): Map<string, number> {
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
  const dep = edges.filter((e) => DEPENDENCY_TYPES.has(e.connascenceType));
  const clusters = partitionRound(dependencyWeight(dep));
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
  const depEdges = dep.filter((e) => DEPENDENCY_TYPES.has(e.connascenceType));
  const initialWeight = dependencyWeight(depEdges);

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
