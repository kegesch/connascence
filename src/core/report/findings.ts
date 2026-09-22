import { ScanReport, ScoredEdge } from '../scoring/score.js';

export interface Finding {
  kind: string;
  /** canonical evidence describing the whole cluster */
  summary: string;
  /** how many edges were collapsed into this finding */
  edgeCount: number;
  /** distinct (file:line) members involved */
  members: { filePath: string; startLine: number; name: string }[];
  worst: ScoredEdge;
}

function memberOf(e: ScoredEdge) {
  return { filePath: e.nodeB.filePath, startLine: e.nodeB.startLine, name: e.nodeB.name };
}

/**
 * Collapse pairwise edges into per-root-cause findings:
 * - meaning: one finding per repeated literal value
 * - algorithm: one finding per clone group (star from a single canonical member)
 * Everything else: one finding per edge.
 * Pure function; makes reports human-reviewable instead of O(n²).
 */
export function clusterFindings(edges: ScoredEdge[]): Finding[] {
  const findings: Finding[] = [];

  // meaning: group by extracted literal value
  const meaningGroups = new Map<string, ScoredEdge[]>();
  for (const e of edges) {
    if (e.connascenceType !== 'meaning') continue;
    // evidence shape: `magic literal <VALUE> repeated at N call sites across M files (...)`
    const value = e.evidence.split(' ')[2] ?? '?';
    const group = meaningGroups.get(value) ?? [];
    group.push(e);
    meaningGroups.set(value, group);
  }

  // algorithm: group by the set of member endpoints (same clone group produces a star/chain)
  const cloneGroups = new Map<string, ScoredEdge[]>();
  for (const e of edges) {
    if (e.connascenceType !== 'algorithm') continue;
    // same clone group = same pair of function names (star/chain from one canonical member)
    const canonical = [e.nodeA.name, e.nodeB.name].sort().join('::');
    const group = cloneGroups.get(canonical) ?? [];
    group.push(e);
    cloneGroups.set(canonical, group);
  }

  // identity: group by the shared mutable variable (def endpoint)
  const identityGroups = new Map<string, ScoredEdge[]>();
  for (const e of edges) {
    if (e.connascenceType !== 'identity') continue;
    const key = `${e.nodeB.filePath}:${e.nodeB.startLine}`;
    const group = identityGroups.get(key) ?? [];
    group.push(e);
    identityGroups.set(key, group);
  }

  const consumed = new Set<ScoredEdge>();
  for (const group of identityGroups.values()) {
    for (const e of group) consumed.add(e);
    // def endpoint (nodeB) + all access sites (nodeA)
    const def = memberOf(group[0]);
    const members = dedupe([def, ...group.map(memberA)]);
    const useCount = members.length - 1;
    findings.push({
      kind: 'identity',
      summary: group[0].evidence.replace(/accessed from .*/, `accessed from ${useCount} site(s) in the module`),
      edgeCount: group.length,
      members,
      worst: group[0],
    });
  }
  for (const [value, group] of meaningGroups) {
    for (const e of group) consumed.add(e);
    const members = dedupe(group.map(memberOf));
    findings.push({
      kind: 'meaning',
      summary: `magic literal ${value} repeated at ${group[0] ? countFromEvidence(group[0].evidence, 5) : '?'} call sites across multiple files`,
      edgeCount: group.length,
      members,
      worst: group[0],
    });
  }
  for (const group of cloneGroups.values()) {
    for (const e of group) consumed.add(e);
    const members = dedupe(group.flatMap((e) => [memberA(e), memberOf(e)]));
    findings.push({
      kind: 'algorithm',
      summary: `clone group of ${members.length} structurally identical function bodies — e.g. ${group[0].evidence}`,
      edgeCount: group.length,
      members,
      worst: group[0],
    });
  }

  for (const e of edges) {
    if (consumed.has(e)) continue;
    findings.push({
      kind: e.connascenceType,
      summary: e.evidence,
      edgeCount: 1,
      members: [memberA(e), memberOf(e)],
      worst: e,
    });
  }

  findings.sort(
    (a, b) =>
      // certainty first: deterministic detectors before heuristic candidates
      Number(a.worst.heuristic) - Number(b.worst.heuristic) ||
      b.worst.strength - a.worst.strength ||
      b.members.length - a.members.length ||
      b.edgeCount - a.edgeCount,
  );
  return findings;
}

function memberA(e: ScoredEdge) {
  return { filePath: e.nodeA.filePath, startLine: e.nodeA.startLine, name: e.nodeA.name };
}

function dedupe(members: Finding['members']): Finding['members'] {
  const seen = new Set<string>();
  return members.filter((m) => {
    const k = `${m.filePath}:${m.startLine}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** evidence shape: `... repeated at <N> call sites ...` — N is at word index 5 */
function countFromEvidence(evidence: string, fallback: number): number {
  const m = /repeated at (\d+) call sites/.exec(evidence);
  return m ? Number(m[1]) : fallback;
}

export interface FileHotspot {
  filePath: string;
  edgeCount: number;
  maxDegree: number;
  worstStrength: number;
}

/** Per-file coupling hotspots across all edges a file participates in. */
export function fileHotspots(edges: ScoredEdge[]): FileHotspot[] {
  const byFile = new Map<string, { edgeCount: number; maxDegree: number; worstStrength: number }>();
  for (const e of edges) {
    for (const [ep, degree] of [
      [e.nodeA, e.degree],
      [e.nodeB, e.degree],
    ] as const) {
      const key = ep.filePath;
      const cur = byFile.get(key) ?? { edgeCount: 0, maxDegree: 0, worstStrength: 0 };
      cur.edgeCount += 1;
      cur.maxDegree = Math.max(cur.maxDegree, degree);
      cur.worstStrength = Math.max(cur.worstStrength, e.strength);
      byFile.set(key, cur);
    }
  }
  return [...byFile.entries()]
    .map(([filePath, s]) => ({ filePath, ...s }))
    .sort((a, b) => b.worstStrength - a.worstStrength || b.edgeCount - a.edgeCount);
}
