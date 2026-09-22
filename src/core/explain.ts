import { ScanReport, ScoredEdge } from './scoring/score.js';

/** Parse "<path>:<line>" arguments like src/foo.ts:42 (path may itself contain colons on Windows). */
function parseFileLine(arg: string): { filePath: string; line: number } | undefined {
  const match = /^(.*):(\d+)$/.exec(arg);
  if (!match) return undefined;
  const line = Number(match[2]);
  if (!Number.isInteger(line) || line <= 0) return undefined;
  return { filePath: match[1], line };
}

/** All scored edges touching the node(s) at <file>:<line>. */
export function explain(report: ScanReport, fileLine: string): ScoredEdge[] {
  const target = parseFileLine(fileLine);
  if (!target) throw new Error(`invalid file:line argument: ${fileLine}`);
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const filePath = norm(target.filePath);
  // accept either the node path ending with the given path, or the given absolute path ending with the node path
  const matchesPath = (nodePath: string) => {
    const p = norm(nodePath);
    return p.endsWith(filePath) || filePath.endsWith(p);
  };
  return report.edges.filter(
    (e) =>
      (matchesPath(e.nodeA.filePath) && e.nodeA.startLine === target.line) ||
      (matchesPath(e.nodeB.filePath) && e.nodeB.startLine === target.line),
  );
}
