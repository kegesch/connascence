// Seven-axis quality score (M3b.2): one geometric mean over the structural
// root causes, plus the vector an agent needs to act on the worst axis.
//
// Every axis is normalized to 0..1. A zero in acyclicity (or any axis) tanks
// the scalar, which is intentional: the score is a tracking signal, not a
// grade. `scoreVersion` + config hash let stored baselines reject a formula or
// configuration change instead of silently comparing unlike numbers.

import type { ScanReport, ScoredEdge } from './score.js';
import { pressureOf } from './pressure.js';
import { KEY_SEP } from '../paths.js';
import { DEPENDENCY_TYPES, dependencyWeight, fileClusters } from '../report/modules.js';

export const SCORE_VERSION = 1;

export type ScoreAxisKey =
  | 'acyclicity'
  | 'levelization'
  | 'encapsulation'
  | 'equality'
  | 'redundancy'
  | 'cohesion'
  | 'coupling';

export interface ScoreAxis {
  key: ScoreAxisKey;
  /** normalized 0..1; 1 = healthy */
  value: number;
  detail: string;
}

export interface QualityScore {
  scoreVersion: number;
  /** stable hash of the effective config (baseline invalidation) */
  configHash: string;
  /** 0..10000 integer; geometric mean of the seven axis values */
  score: number;
  components: ScoreAxis[];
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Gini coefficient of non-negative values; 0 = equal, 1 = concentrated. */
export function gini(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((sum, v) => sum + v, 0);
  if (n <= 1 || total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (2 * (i + 1) - n - 1) * xs[i];
  return clamp01(weighted / (n * total));
}

function acyclicity(report: ScanReport): ScoreAxis {
  const cycles = report.cycles ?? [];
  return {
    key: 'acyclicity',
    value: cycles.length === 0 ? 1 : 0,
    detail:
      cycles.length === 0
        ? 'no resolved dependency cycles'
        : `${cycles.length} dependency cycle(s): ${cycles.map((c) => c.files.length).join(',')} file(s)`,
  };
}

function levelization(report: ScanReport): ScoreAxis {
  const l = report.levelization;
  if (!l || l.components <= 1) {
    return { key: 'levelization', value: 1, detail: 'no dependency chain (or one component)' };
  }
  const value = clamp01(1 - (l.depth - 1) / (l.components - 1));
  return {
    key: 'levelization',
    value: round4(value),
    detail: `depth ${l.depth} over ${l.components} component(s)`,
  };
}

/** Definition counts per file; falls back to distinct scored endpoints. */
function complexityValues(report: ScanReport): number[] {
  const stats = report.stats;
  if (stats) return stats.files.map((file) => stats.definitionsByFile[file] ?? 0);
  const byFile = new Map<string, Set<string>>();
  for (const edge of report.edges) {
    for (const endpoint of [edge.nodeA, edge.nodeB]) {
      if (!/^(function|method|class)$/.test(endpoint.kind)) continue;
      if (!byFile.has(endpoint.filePath)) byFile.set(endpoint.filePath, new Set());
      byFile.get(endpoint.filePath)!.add(endpoint.id);
    }
  }
  return [...byFile.values()].map((ids) => ids.size);
}

function equality(report: ScanReport): ScoreAxis {
  const values = complexityValues(report);
  const c = gini(values);
  const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  // Gini is level-free: a uniformly huge repo would otherwise score perfectly.
  const level = 1 / (1 + mean / 10);
  return {
    key: 'equality',
    value: round4((1 - c) * level),
    detail: `1-gini ${round4(1 - c).toFixed(3)} x level ${round4(level).toFixed(3)} (mean ${round4(mean)} defs/file)`,
  };
}

function redundancy(report: ScanReport): ScoreAxis {
  const stats = report.stats;
  if (!stats || stats.hashableDefinitions === 0) {
    return { key: 'redundancy', value: 1, detail: 'no structural hashes to compare' };
  }
  const ratio = stats.duplicateDefinitions / stats.hashableDefinitions;
  return {
    key: 'redundancy',
    value: round4(1 - ratio),
    detail: `${stats.duplicateDefinitions} duplicate / ${stats.hashableDefinitions} hashable definitions`,
  };
}

/** Weighted modularity Q of the Louvain partition. */
function modularity(weight: Map<string, number>, communityOf: Map<string, string>): number {
  let total = 0;
  const degree = new Map<string, number>();
  const internal = new Map<string, number>();
  for (const [key, w] of weight) {
    const [a, b] = key.split(KEY_SEP);
    total += w;
    degree.set(a, (degree.get(a) ?? 0) + w);
    degree.set(b, (degree.get(b) ?? 0) + w);
    const ca = communityOf.get(a);
    if (ca !== undefined && ca === communityOf.get(b)) {
      internal.set(ca, (internal.get(ca) ?? 0) + w);
    }
  }
  if (total === 0) return 0;
  const degreeByCommunity = new Map<string, number>();
  for (const [node, d] of degree) {
    const c = communityOf.get(node);
    if (c !== undefined) degreeByCommunity.set(c, (degreeByCommunity.get(c) ?? 0) + d);
  }
  let q = 0;
  for (const [community, d] of degreeByCommunity) {
    q += (internal.get(community) ?? 0) / total - (d / (2 * total)) ** 2;
  }
  return q;
}

function cohesion(report: ScanReport): ScoreAxis {
  const dep = report.edges.filter((e) => DEPENDENCY_TYPES.has(e.connascenceType));
  const weight = dependencyWeight(dep);
  if (weight.size === 0) {
    return { key: 'cohesion', value: 1, detail: 'no dependency edges to partition' };
  }
  const clusters = fileClusters(report.edges);
  const communityOf = new Map<string, string>();
  for (const cluster of clusters) {
    for (const file of cluster.files) communityOf.set(file, cluster.name);
  }
  // Cohesion is the share of dependency mass that stays inside its Louvain
  // community. One dense community scores 1 (the plan explicitly treats that
  // as cohesive); the coupling/encapsulation/equality axes catch accumulation.
  let internal = 0;
  let total = 0;
  for (const [key, w] of weight) {
    const [a, b] = key.split(KEY_SEP);
    total += w;
    if (communityOf.get(a) !== undefined && communityOf.get(a) === communityOf.get(b)) {
      internal += w;
    }
  }
  const value = total > 0 ? internal / total : 1;
  const q = clamp01(modularity(weight, communityOf));
  return {
    key: 'cohesion',
    value: round4(value),
    detail: `internal mass ${round4(value).toFixed(3)} (Louvain Q=${q.toFixed(3)} over ${clusters.length} community(ies))`,
  };
}

export interface ModuleDepth {
  name: string;
  /** 0..1 normalized Ousterhout depth */
  value: number;
}

/**
 * Ousterhout depth v1: private behavior used inside the module, divided by one
 * plus the strength of its exported interface. Public/absorbed targets are not
 * counted as private functionality, and inlining a helper removes an internal
 * target instead of raising depth.
 */
export function moduleDepth(clusterFiles: string[], dep: ScoredEdge[]): ModuleDepth {
  const inside = new Set(clusterFiles);
  const internalTargets = new Set<string>();
  const interfaceWidth = new Map<string, number>();
  for (const edge of dep) {
    const aIn = inside.has(edge.nodeA.filePath);
    const bIn = inside.has(edge.nodeB.filePath);
    if (aIn && bIn && edge.nodeA.filePath !== edge.nodeB.filePath) {
      internalTargets.add(edge.nodeB.id);
    }
    if (!aIn && bIn) {
      interfaceWidth.set(edge.nodeB.id, Math.max(interfaceWidth.get(edge.nodeB.id) ?? 0, edge.strength));
    }
  }
  for (const target of interfaceWidth.keys()) internalTargets.delete(target);
  const functionality = internalTargets.size;
  const width = [...interfaceWidth.values()].reduce((sum, s) => sum + s, 0);
  const depth = functionality / (1 + width);
  return { name: clusterFiles[0] ?? '?', value: depth / (1 + depth) };
}

function encapsulation(report: ScanReport): ScoreAxis {
  const clusters = fileClusters(report.edges);
  if (clusters.length === 0) {
    return { key: 'encapsulation', value: 1, detail: 'no modules to evaluate' };
  }
  const dep = report.edges.filter((e) => DEPENDENCY_TYPES.has(e.connascenceType));
  const depths = clusters.map((cluster) => moduleDepth(cluster.files, dep));
  const value = depths.reduce((sum, d) => sum + d.value, 0) / depths.length;
  const deepest = [...depths].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))[0];
  return {
    key: 'encapsulation',
    value: round4(value),
    detail: `mean depth ${round4(value).toFixed(3)} over ${depths.length} module(s); deepest ${deepest.name}`,
  };
}

function coupling(report: ScanReport): ScoreAxis {
  const pressures = report.edges
    .map((edge) => edge.pressure ?? pressureOf(edge))
    .sort((a, b) => b - a);
  if (pressures.length === 0) {
    return { key: 'coupling', value: 1, detail: 'no coupling edges' };
  }
  // Top decile: adding weak name imports cannot dilute away a few severe edges.
  const k = Math.max(1, Math.ceil(pressures.length * 0.1));
  const worst = pressures.slice(0, k).reduce((sum, p) => sum + p, 0) / k;
  return {
    key: 'coupling',
    value: round4(1 - worst),
    detail: `worst-decile pressure ${round4(worst).toFixed(3)} over ${pressures.length} edge(s)`,
  };
}

/** Compute the seven-axis score. Pure and deterministic for a given report. */
export function qualityScore(report: ScanReport, configHash: string): QualityScore {
  const components = [
    acyclicity(report),
    levelization(report),
    encapsulation(report),
    equality(report),
    redundancy(report),
    cohesion(report),
    coupling(report),
  ];
  const product = components.reduce((p, c) => p * Math.max(0, c.value), 1);
  const score = Math.round(10000 * Math.pow(product, 1 / components.length));
  return { scoreVersion: SCORE_VERSION, configHash, score, components };
}
