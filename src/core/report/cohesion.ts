import path from 'node:path';
import { ScoredEdge } from '../scoring/score.js';
import { toPosix } from '../paths.js';

/** Dependency edge types that are reliable enough to infer module structure from
 *  (import/reference edges — not the heuristic candidates). */
const DEP_TYPES = new Set(['name', 'type']);

/** how many common external dependencies/consumers two files need to be
 *  considered "same concern" for the split suggestion. */
const SHARED_NEIGHBORS = 2;

function intersect(a: Set<string> | undefined, b: Set<string> | undefined): number {
  if (!a || !b) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

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

    // union-find over intra-directory edges plus affinity: two files in the same
    // directory belong together if they reference each other OR depend on the same
    // external targets / are consumed by the same external files (shared fan-out /
    // fan-in). Files with only accidental adjacency end up in different clusters.
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
    // per-file dependency targets (file-level), split into inside/outside the dir
    const depsOut = new Map<string, Set<string>>(); // file -> external files it depends on
    const consumers = new Map<string, Set<string>>(); // file -> external files depending on it
    for (const e of dep) {
      const fa = e.nodeA.filePath;
      const fb = e.nodeB.filePath;
      const dirA = fileDir.get(fa);
      const dirB = fileDir.get(fb);
      if (dirA === dir && dirB === dir) {
        internalEdges++;
        union(fa, fb);
      } else if (dirB === dir && dirA !== dir) {
        fanIn.set(dirA!, (fanIn.get(dirA!) ?? 0) + 1);
        if (!consumers.has(fb)) consumers.set(fb, new Set());
        consumers.get(fb)!.add(fa);
      } else if (dirA === dir && dirB !== dir) {
        if (!depsOut.has(fa)) depsOut.set(fa, new Set());
        depsOut.get(fa)!.add(fb);
      }
    }

    // affinity pass: >= SHARED_NEIGHBORS common external targets or consumers
    const fileList = [...files];
    for (let i = 0; i < fileList.length; i++) {
      for (let j = i + 1; j < fileList.length; j++) {
        const a = fileList[i];
        const b = fileList[j];
        if (find(a) === find(b)) continue;
        const sharedOut = intersect(depsOut.get(a), depsOut.get(b));
        const sharedIn = intersect(consumers.get(a), consumers.get(b));
        if (sharedOut + sharedIn >= SHARED_NEIGHBORS) union(a, b);
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
    lines.push(`${c.dir} contains ${c.clusters.length} independent file groups (separate dependencies and consumers) — extract each into its own module: ${groups}`);
  }
  return lines;
}

// ---- file-level splits ----

export interface FileSplit {
  file: string;
  /** connected function groups that never interact: extraction candidates */
  groups: { name: string; startLine: number }[][];
}

const MIN_FUNCTIONS = 6; // below this a file is too small to bother splitting
const MIN_GROUPS = 2; // need at least two real groups to suggest a split

/**
 * "Split this file" suggestions: reconstruct a function-level call graph from
 * the reference edges (caller = innermost function scope of the reference site,
 * callee = referenced definition), then cluster functions that call each other
 * or share common callees. Independent clusters are separate concerns
 * co-located in one file. Pure function on scored edges.
 */
export function fileSplits(edges: ScoredEdge[]): FileSplit[] {
  const dep = edges.filter((e) => DEP_TYPES.has(e.connascenceType));

  const isDef = (e: ScoredEdge['nodeB']) => ['function', 'method', 'variable'].includes(e.kind);

  // definitions per file
  type Fn = { id: string; name: string; startLine: number; file: string };
  const defs = new Map<string, Fn>();
  for (const e of dep) {
    if (!isDef(e.nodeB)) continue;
    defs.set(e.nodeB.id, {
      id: e.nodeB.id,
      name: e.nodeB.name,
      startLine: e.nodeB.startLine,
      file: e.nodeB.filePath,
    });
  }

  // caller identity: file + innermost function scope name (IR scopePath)
  const callerId = (n: ScoredEdge['nodeA']): string | undefined => {
    if (!n.ownerName) return undefined;
    return `${n.filePath}::${n.ownerName}`;
  };

  const byFile = new Map<string, Fn[]>();
  for (const f of defs.values()) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }

  const splits: FileSplit[] = [];
  for (const [file, list] of byFile) {
    if (list.length < MIN_FUNCTIONS) continue;
    const idsInFile = new Set(list.map((f) => f.id));

    // caller key -> the def node representing this function (match by name in file)
    const callerToDef = new Map<string, Fn>();
    for (const f of list) callerToDef.set(`${file}::${f.name}`, f);

    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = parent.get(x) ?? x;
      while (r !== (parent.get(r) ?? r)) r = parent.get(r) ?? r;
      return r;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));

    const callees = new Map<string, Set<string>>();
    for (const e of dep) {
      const caller = callerId(e.nodeA);
      const def = defs.get(e.nodeB.id);
      if (!caller || !def) continue;
      const callerDef = callerToDef.get(caller);
      if (!callerDef || callerDef.id === def.id) continue;
      if (!callees.has(callerDef.id)) callees.set(callerDef.id, new Set());
      callees.get(callerDef.id)!.add(def.id);
      // direct call within the same file unites the two functions
      if (idsInFile.has(def.id)) union(callerDef.id, def.id);
    }

    // affinity: functions sharing >=2 callees belong to one concern
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].id;
        const b = list[j].id;
        if (find(a) === find(b)) continue;
        if (intersect(callees.get(a), callees.get(b)) >= SHARED_NEIGHBORS) union(a, b);
      }
    }

    const groups = new Map<string, Fn[]>();
    for (const f of list) {
      const root = find(f.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(f);
    }
    const real = [...groups.values()]
      .filter((g) => g.length >= 2)
      .map((g) => g.sort((x, y) => x.startLine - y.startLine).map(({ name, startLine }) => ({ name, startLine })))
      .sort((a, b) => b.length - a.length);
    if (real.length >= MIN_GROUPS) splits.push({ file, groups: real });
  }

  return splits.sort((a, b) => b.groups.length - a.groups.length);
}
