import path from 'node:path';
import { ScoredEdge } from '../scoring/score.js';
import { toPosix } from '../paths.js';

/** Dependency edge types that are reliable enough to infer module structure from
 *  (import/reference edges — not the heuristic candidates). */
const DEP_TYPES = new Set(['name', 'type']);

export interface DirCohesion {
  /** directory path (posix, as it appears in file paths) */
  dir: string;
  files: number;
  /** dependency edges fully inside the directory */
  internalEdges: number;
  /** dependency edges from outside referencing into the directory */
  externalEdges: number;
  /** distinct other directories that reference into this one */
  externalFanIn: number;
  /** connected components of the intra-directory file graph; >1 means
   *  the directory contains independent groups of files (split candidates) */
  clusters: string[][];
}

function dirOf(filePath: string): string {
  return path.posix.dirname(toPosix(filePath));
}

/**
 * Directory-level cohesion/aggregation over the dependency graph:
 * - how much outside code reaches into a directory (junk-drawer signal)
 * - whether the directory is actually one module or several disconnected ones
 * Pure function on scored edges; language-agnostic (file paths only).
 */
export function dirCohesion(edges: ScoredEdge[]): DirCohesion[] {
  const dep = edges.filter((e) => DEP_TYPES.has(e.connascenceType));

  const filesByDir = new Map<string, Set<string>>();
  const fileDir = new Map<string, string>();
  for (const e of dep) {
    for (const n of [e.nodeA, e.nodeB]) {
      const d = dirOf(n.filePath);
      fileDir.set(n.filePath, d);
      if (!filesByDir.has(d)) filesByDir.set(d, new Set());
      filesByDir.get(d)!.add(n.filePath);
    }
  }

  const result: DirCohesion[] = [];
  for (const [dir, files] of filesByDir) {
    if (files.size < 3) continue; // not a module candidate

    // union-find over intra-directory edges
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = parent.get(x) ?? x;
      while (r !== (parent.get(r) ?? r)) r = parent.get(r) ?? r;
      return r;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };

    let internalEdges = 0;
    const fanIn = new Map<string, number>();
    for (const e of dep) {
      const dirA = fileDir.get(e.nodeA.filePath);
      const dirB = fileDir.get(e.nodeB.filePath);
      if (dirA === dir && dirB === dir) {
        internalEdges++;
        union(e.nodeA.filePath, e.nodeB.filePath);
      } else if (dirB === dir && dirA !== dir) {
        fanIn.set(dirA!, (fanIn.get(dirA!) ?? 0) + 1);
      }
    }

    const clusters = new Map<string, string[]>();
    for (const f of files) {
      const root = find(f);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(f);
    }

    const externalFanIn = fanIn.size;
    const externalEdges = [...fanIn.values()].reduce((a, b) => a + b, 0);
    const comps = [...clusters.values()].sort((a, b) => b.length - a.length);
    const realClusters = comps.filter((c) => c.length >= 2).length;

    // only report directories that actually warrant action
    if (externalFanIn < 3 && realClusters < 2) continue;

    result.push({
      dir,
      files: files.size,
      internalEdges,
      externalEdges,
      externalFanIn,
      clusters: comps,
    });
  }

  return result.sort(
    (a, b) => b.externalFanIn - a.externalFanIn || b.clusters.length - a.clusters.length || b.externalEdges - a.externalEdges,
  );
}

/** Actionable rendering of a cohesion entry (the `fix:` payload). */
export function cohesionFix(c: DirCohesion): string[] {
  const lines: string[] = [];
  if (c.externalFanIn >= 3) {
    lines.push(
      `${c.externalFanIn} other directories reach into ${c.dir} (${c.externalEdges} dependency edges) — treat it as an integration point: freeze its surface or extract the pieces below into dedicated modules`,
    );
  }
  if (c.clusters.length >= 2 && c.clusters.filter((x) => x.length >= 2).length >= 2) {
    const groups = c.clusters
      .slice(0, 3)
      .map((cl) => `[${cl.map((f) => f.split('/').pop()).join(', ')}]`)
      .join(' ');
    lines.push(`${c.dir} contains ${c.clusters.length} disconnected file groups — these never reference each other, so they belong in separate modules: ${groups}`);
  }
  return lines;
}
