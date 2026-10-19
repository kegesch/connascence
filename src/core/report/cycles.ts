// File-level dependency cycles as first-class findings (PLAN.md §7: cycles are
// the launch findings tier, TS-only until a second language has resolution).
//
// The graph is built ONLY from `name` edges the adapter marked `resolved`: the
// TS adapter resolves each reference through its symbol table, so a cycle is a
// real import/reference cycle, not a string collision (`render`/`handle`).
// Unresolved or name-matched edges are ignored — statistics may use them, the
// accusations may not.

import type { ScoredEdge } from '../scoring/score.js';
import { stronglyConnected } from './scc.js';

export interface CycleMember {
  filePath: string;
  startLine: number;
  name: string;
}

export interface FileCycle {
  /** strongly-connected files, sorted (the SCC) */
  files: string[];
  /** one representative location per file, in `files` order */
  members: CycleMember[];
  /** resolved name edges whose ends both live inside the component */
  edges: ScoredEdge[];
  /** strongest internal edge (deterministic tie-break), for severity/evidence */
  worst: ScoredEdge;
}

/** Stable identity of a cycle: its member set, order-independent. */
export function cycleIdentity(files: string[]): string {
  return [...files].sort().join('|');
}

function compareEdges(a: ScoredEdge, b: ScoredEdge): number {
  return (
    (b.pressure ?? 0) - (a.pressure ?? 0) ||
    b.strength - a.strength ||
    b.locality - a.locality ||
    b.degree - a.degree ||
    a.nodeA.filePath.localeCompare(b.nodeA.filePath) ||
    a.nodeA.startLine - b.nodeA.startLine ||
    a.nodeB.filePath.localeCompare(b.nodeB.filePath) ||
    a.nodeB.startLine - b.nodeB.startLine
  );
}

/** Representative member for a file: an endpoint of one of its internal edges. */
function memberOfFile(file: string, edges: ScoredEdge[]): CycleMember {
  for (const e of edges) {
    if (e.nodeA.filePath === file) {
      return { filePath: file, startLine: e.nodeA.startLine, name: e.nodeA.name };
    }
    if (e.nodeB.filePath === file) {
      return { filePath: file, startLine: e.nodeB.startLine, name: e.nodeB.name };
    }
  }
  return { filePath: file, startLine: 1, name: file };
}

/**
 * Kosaraju SCCs over the resolved file-dependency graph. Self-references are
 * ignored (a file using its own definitions is not a structural cycle), and
 * every component of two or more files becomes exactly one cycle — overlapping
 * two- and three-file loops collapse into the same finding instead of being
 * enumerated once per back-edge.
 */
export function findFileCycles(edges: ScoredEdge[]): FileCycle[] {
  const deps = edges.filter((e) => e.connascenceType === 'name' && e.resolved === true);
  const adjacency = new Map<string, Set<string>>();
  for (const e of deps) {
    const from = e.nodeA.filePath;
    const to = e.nodeB.filePath;
    if (from === to) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  }

  const components = stronglyConnected(adjacency).filter((c) => c.length > 1);
  return components
    .map((files) => {
      const inside = new Set(files);
      const internal = deps
        .filter((e) => inside.has(e.nodeA.filePath) && inside.has(e.nodeB.filePath))
        .sort(compareEdges);
      return {
        files,
        members: files.map((f) => memberOfFile(f, internal)),
        edges: internal,
        worst: internal[0],
      };
    })
    .sort((a, b) => b.files.length - a.files.length || a.files[0].localeCompare(b.files[0]));
}
