import { ScanReport, ScoredEdge } from '../scoring/score.js';
import { Severity, severityOf } from './severity.js';
import { shortPath } from '../paths.js';

export interface Finding {
  kind: string;
  /** canonical evidence describing the whole cluster */
  summary: string;
  /** how many edges were collapsed into this finding */
  edgeCount: number;
  /** distinct (file:line) members involved */
  members: { filePath: string; startLine: number; name: string }[];
  worst: ScoredEdge;
  /** importance class of the worst member edge */
  severity: Severity;
  /** concrete remediation composed at cluster time when the structure allows (position, algorithm, identity) */
  fix?: string;
}

type MemberRef = { filePath: string; startLine: number; name: string };
type EdgeEndpointRef = Pick<ScoredEdge, 'nodeA' | 'nodeB'>;

function memberAt<K extends 'nodeA' | 'nodeB'>(e: EdgeEndpointRef, side: K): MemberRef {
  const n = e[side];
  return { filePath: n.filePath, startLine: n.startLine, name: n.name };
}

const memberOf = (e: EdgeEndpointRef) => memberAt(e, 'nodeB');
const memberA = (e: EdgeEndpointRef) => memberAt(e, 'nodeA');

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

  // position: group by callee signature — all parameters of one function share the same
  // set of call sites, so keying on (callee file + call-site set) yields one finding per callee
  const positionGroups = new Map<string, ScoredEdge[]>();
  for (const e of edges) {
    if (e.connascenceType !== 'position') continue;
    positionGroupEdges(e, positionGroups);
  }

  // name: dedupe repeated identical (ref site -> def) pairs
  const nameGroups = new Map<string, ScoredEdge[]>();
  for (const e of edges) {
    if (e.connascenceType !== 'name') continue;
    const key = `${e.nodeA.filePath}:${e.nodeA.startLine}->${e.nodeB.filePath}:${e.nodeB.startLine}`;
    const group = nameGroups.get(key) ?? [];
    if (!group.includes(e)) group.push(e);
    nameGroups.set(key, group);
  }
  // collapse the name groups to one representative edge per key
  const dedupedNameEdges: ScoredEdge[] = [...nameGroups.values()].map((g) => g[0]);

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
      severity: downgradeIfTestOnly(members, severityOf(group[0])),
      fix: `make ${def.name} (${relShort(def.filePath)}:${def.startLine}) the single source of truth — export it (or pass it explicitly) and have the ${useCount} access site(s) below read/write that one instance`,
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
      severity: severityOf(group[0]),
    });
  }
  for (const group of cloneGroups.values()) {
    for (const e of group) consumed.add(e);
    const members = dedupe(group.flatMap((e) => [memberA(e), memberOf(e)]));
    const pair = members.slice(0, 2).map((m) => `${m.name} (${relShort(m.filePath)}:${m.startLine})`).join(' ≡ ');
    const others = members.length - 2;
    findings.push({
      kind: 'algorithm',
      summary: `duplicated function bodies: ${pair}${others > 0 ? ` (+${others} more)` : ''}`,
      edgeCount: group.length,
      members,
      worst: group[0],
      severity: downgradeIfTestOnly(members, severityOf(group[0])),
      fix: `keep one implementation (start with ${members[0].name}, ${relShort(members[0].filePath)}:${members[0].startLine}), export it, and have ${members.slice(1).map((m) => m.name).join(', ')} import it instead of duplicating the body`,
    });
  }

  for (const group of mergePositionGroups(positionGroups).values()) {
    for (const e of group) consumed.add(e);
    const callSites = dedupe(group.map(memberA));
    const callee = group[0].nodeB;
    const paramNames = dedupe(group.map(memberOf)).map((m) => m.name);
    // with a single parameter there is no position to get wrong — that coupling
    // is name/type, not position; reporting it is noise with bad fix advice.
    if (paramNames.length < 2) continue;
    const params = paramNames.join(', ');
    findings.push({
      kind: 'position',
      summary: `${callee.name}() (${relShort(callee.filePath)}:${callee.startLine}) takes ${paramNames.length} positional params (${params}) across ${callSites.length} call site(s)`,
      edgeCount: group.length,
      members: [...callSites, ...dedupe(group.map(memberOf))],
      worst: group[0],
      severity: downgradeIfTestOnly(callSites, severityOf(group[0])),
      fix: `convert ${callee.name} (${relShort(callee.filePath)}:${callee.startLine}) to accept a single options object ({ ${params} }); update the ${callSites.length} call site(s) listed below`,
    });
  }

  for (const e of dedupedNameEdges) {
    if (consumed.has(e)) continue;
    const ref = e.nodeA;
    const def = e.nodeB;
    findings.push({
      kind: e.connascenceType,
      summary: `${ref.name} is coupled by name: ${relShort(ref.filePath)}:${ref.startLine} <-> ${def.name} (${relShort(def.filePath)}:${def.startLine})`,
      edgeCount: 1,
      members: [memberA(e), memberOf(e)],
      worst: e,
      // name is the weakest connascence (strength 1) and import-by-name is
      // unavoidable — informational, never worth blocking on
      severity: 'low',
      fix: `keep ${ref.name} and ${def.name} in sync: any rename must change both sides plus every reference; if the names only accidentally match, that is fine — no action needed`,
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

function relShort(p: string): string {
  return shortPath(p);
}

const TEST_FILE = /\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$|(^|\/)__tests__\//i;

/** findings whose involved locations are all inside test files are demoted to 'low':
 *  coupling between a test and the code it tests is expected, not a refactor target. */
function downgradeIfTestOnly(members: Finding['members'], severity: Severity): Severity {
  if (severity === 'low') return severity;
  return members.every((m) => TEST_FILE.test(m.filePath.replace(/\\/g, '/'))) ? 'low' : severity;
}

/** two passes: first bucket per param edge by callee file + its own call site, then merge buckets
 *  whose call-site sets are identical (=> same callee signature). */
function positionGroupEdges(e: ScoredEdge, groups: Map<string, ScoredEdge[]>): void {
  const key = `${e.nodeB.filePath}|${e.nodeA.filePath}:${e.nodeA.startLine}`;
  const group = groups.get(key) ?? [];
  group.push(e);
  groups.set(key, group);
}

function mergePositionGroups(groups: Map<string, ScoredEdge[]>): Map<string, ScoredEdge[]> {
  // first bucket per callee file, then merge buckets whose def-site lines are
  // contiguous — contiguous param lines belong to one callee signature, even when
  // different call sites bind different numbers of (trailing/optional) params.
  const byFile = new Map<string, ScoredEdge[][]>();
  for (const group of groups.values()) {
    const calleeFile = group[0].nodeB.filePath;
    const buckets = byFile.get(calleeFile) ?? [];
    buckets.push(group);
    byFile.set(calleeFile, buckets);
  }
  const merged = new Map<string, ScoredEdge[]>();
  for (const [, buckets] of byFile) {
    buckets.sort(
      (a, b) => Math.min(...a.map((e) => e.nodeB.startLine)) - Math.min(...b.map((e) => e.nodeB.startLine)),
    );
    let cur: ScoredEdge[] = [];
    let curMax = -1;
    for (const bucket of buckets) {
      const min = Math.min(...bucket.map((e) => e.nodeB.startLine));
      const max = Math.max(...bucket.map((e) => e.nodeB.startLine));
      if (cur.length > 0 && min - curMax > 2) {
        merged.set(cur[0].nodeB.filePath + ':' + cur[0].nodeB.startLine, cur);
        cur = [];
      }
      cur.push(...bucket);
      curMax = Math.max(curMax, max);
    }
    if (cur.length > 0) merged.set(cur[0].nodeB.filePath + ':' + cur[0].nodeB.startLine, cur);
  }
  return merged;
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
    .sort((a, b) => b.edgeCount - a.edgeCount || b.worstStrength - a.worstStrength);
}
