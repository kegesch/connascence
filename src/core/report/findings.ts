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

type EdgeGroups = Map<string, ScoredEdge[]>;

/** group edges of one connascence type by the given key function */
function groupBy(edges: ScoredEdge[], type: string, keyOf: (e: ScoredEdge) => string, dedupe = false): EdgeGroups {
  const groups: EdgeGroups = new Map();
  for (const e of edges) {
    if (e.connascenceType !== type) continue;
    const key = keyOf(e);
    const group = groups.get(key) ?? [];
    if (dedupe && group.includes(e)) continue;
    group.push(e);
    groups.set(key, group);
  }
  return groups;
}

function meaningGroupsOf(edges: ScoredEdge[]): EdgeGroups {
  return groupBy(edges, 'meaning', (e) => {
    // evidence shape: `magic literal <VALUE> repeated at N call sites across M files (...)`
    return e.evidence.split(' ')[2] ?? '?';
  });
}

function cloneGroupsOf(edges: ScoredEdge[]): EdgeGroups {
  // same clone group = same pair of function names (star/chain from one canonical member)
  return groupBy(edges, 'algorithm', (e) => [e.nodeA.name, e.nodeB.name].sort().join('::'));
}

function identityGroupsOf(edges: ScoredEdge[]): EdgeGroups {
  // group by the shared mutable variable (def endpoint)
  return groupBy(edges, 'identity', (e) => `${e.nodeB.filePath}:${e.nodeB.startLine}`);
}

function nameGroupsOf(edges: ScoredEdge[]): EdgeGroups {
  // dedupe repeated identical (ref site -> def) pairs
  return groupBy(
    edges,
    'name',
    (e) => `${e.nodeA.filePath}:${e.nodeA.startLine}->${e.nodeB.filePath}:${e.nodeB.startLine}`,
    true,
  );
}

function positionGroupsOf(edges: ScoredEdge[]): EdgeGroups {
  // group by callee signature — all parameters of one function share the same
  // set of call sites, so keying on (callee file + call-site set) yields one finding per callee
  const buckets = groupBy(edges, 'position', (e) => `${e.nodeB.filePath}|${e.nodeA.filePath}:${e.nodeA.startLine}`);
  return mergePositionGroups(buckets);
}

function identityFinding(group: ScoredEdge[]): Finding {
  // def endpoint (nodeB) + all access sites (nodeA)
  const def = memberOf(group[0]);
  const members = dedupe([def, ...group.map(memberA)]);
  const useCount = members.length - 1;
  return {
    kind: 'identity',
    summary: group[0].evidence.replace(/accessed from .*/, `accessed from ${useCount} site(s) in the module`),
    edgeCount: group.length,
    members,
    worst: group[0],
    severity: downgradeIfTestOnly(members, severityOf(group[0])),
    fix: `make ${def.name} (${relShort(def.filePath)}:${def.startLine}) the single source of truth — export it (or pass it explicitly) and have the ${useCount} access site(s) below read/write that one instance`,
  };
}

function meaningFinding(value: string, group: ScoredEdge[]): Finding {
  return {
    kind: 'meaning',
    summary: `magic literal ${value} repeated at ${group[0] ? countFromEvidence(group[0].evidence, 5) : '?'} call sites across multiple files`,
    edgeCount: group.length,
    members: dedupe(group.map(memberOf)),
    worst: group[0],
    severity: severityOf(group[0]),
  };
}

function cloneFinding(group: ScoredEdge[]): Finding {
  const members = dedupe(group.flatMap((e) => [memberA(e), memberOf(e)]));
  const pair = members.slice(0, 2).map((m) => `${m.name} (${relShort(m.filePath)}:${m.startLine})`).join(' ≡ ');
  const others = members.length - 2;
  return {
    kind: 'algorithm',
    summary: `duplicated function bodies: ${pair}${others > 0 ? ` (+${others} more)` : ''}`,
    edgeCount: group.length,
    members,
    worst: group[0],
    severity: downgradeIfTestOnly(members, severityOf(group[0])),
    fix: `keep one implementation (start with ${members[0].name}, ${relShort(members[0].filePath)}:${members[0].startLine}), export it, and have ${members.slice(1).map((m) => m.name).join(', ')} import it instead of duplicating the body`,
  };
}

function positionFinding(group: ScoredEdge[]): Finding | undefined {
  const callSites = dedupe(group.map(memberA));
  const callee = group[0].nodeB;
  const paramNames = dedupe(group.map(memberOf)).map((m) => m.name);
  // with a single parameter there is no position to get wrong — that coupling
  // is name/type, not position; reporting it is noise with bad fix advice.
  if (paramNames.length < 2) return undefined;
  const params = paramNames.join(', ');
  return {
    kind: 'position',
    summary: `${callee.name}() (${relShort(callee.filePath)}:${callee.startLine}) takes ${paramNames.length} positional params (${params}) across ${callSites.length} call site(s)`,
    edgeCount: group.length,
    members: [...callSites, ...dedupe(group.map(memberOf))],
    worst: group[0],
    severity: downgradeIfTestOnly(callSites, severityOf(group[0])),
    fix: `convert ${callee.name} (${relShort(callee.filePath)}:${callee.startLine}) to accept a single options object ({ ${params} }); update the ${callSites.length} call site(s) listed below`,
  };
}

function nameFinding(e: ScoredEdge): Finding {
  const ref = e.nodeA;
  const def = e.nodeB;
  return {
    kind: e.connascenceType,
    summary: `${ref.name} is coupled by name: ${relShort(ref.filePath)}:${ref.startLine} <-> ${def.name} (${relShort(def.filePath)}:${def.startLine})`,
    edgeCount: 1,
    members: [memberA(e), memberOf(e)],
    worst: e,
    // name is the weakest connascence (strength 1) and import-by-name is
    // unavoidable — informational, never worth blocking on
    severity: 'low',
    fix: `keep ${ref.name} and ${def.name} in sync: any rename must change both sides plus every reference; if the names only accidentally match, that is fine — no action needed`,
  };
}

function consumeAll(consumed: Set<ScoredEdge>, groups: EdgeGroups): void {
  for (const group of groups.values()) {
    for (const e of group) consumed.add(e);
  }
}

/**
 * Collapse pairwise edges into per-root-cause findings:
 * - meaning: one finding per repeated literal value
 * - algorithm: one finding per clone group (star from a single canonical member)
 * Everything else: one finding per edge.
 * Pure function; makes reports human-reviewable instead of O(n²).
 */
export function clusterFindings(edges: ScoredEdge[]): Finding[] {
  const meaningGroups = meaningGroupsOf(edges);
  const cloneGroups = cloneGroupsOf(edges);
  const identityGroups = identityGroupsOf(edges);
  const positionGroups = positionGroupsOf(edges);
  const nameGroups = nameGroupsOf(edges);
  // collapse the name groups to one representative edge per key
  const dedupedNameEdges: ScoredEdge[] = [...nameGroups.values()].map((g) => g[0]);

  const consumed = new Set<ScoredEdge>();
  consumeAll(consumed, identityGroups);
  consumeAll(consumed, meaningGroups);
  consumeAll(consumed, cloneGroups);
  consumeAll(consumed, positionGroups);

  const findings: Finding[] = [];
  for (const group of identityGroups.values()) findings.push(identityFinding(group));
  for (const [value, group] of meaningGroups) findings.push(meaningFinding(value, group));
  for (const group of cloneGroups.values()) findings.push(cloneFinding(group));
  for (const group of positionGroups.values()) {
    const f = positionFinding(group);
    if (f) findings.push(f);
  }
  for (const e of dedupedNameEdges) {
    if (consumed.has(e)) continue;
    findings.push(nameFinding(e));
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
