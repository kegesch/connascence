import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScanBackend } from './scan.js';
import { ConnascenceConfig } from './config.js';
import { EdgeEndpoint, ScoredEdge, ScanReport } from './scoring/score.js';
import { toPosix } from './paths.js';

export interface DiffOptions {
  /** scan pipeline to run at each ref (injected by the composition root) */
  scanFn: (files: string[], config: { ignore?: string[] }, backend: ScanBackend) => ScanReport;
  /** language backend to scan with (injected by the composition root) */
  backend: ScanBackend;
  /** path to the git repository working tree */
  repoPath: string;
  /** base git ref to compare against */
  base: string;
  /** head git ref; omit to scan the current working tree */
  head?: string;
  /** scan globs, relative to the repository root */
  globs: string[];
  config?: ConnascenceConfig;
}

export interface DiffResult {
  added: ScoredEdge[];
  removed: ScoredEdge[];
  baseSummary: ScanReport['summary'];
  headSummary: ScanReport['summary'];
}

/** Materialize a git ref into a temp dir via `git archive`; returns null for the working tree. */
function materializeRef(repoPath: string, ref: string): string | null {
  if (ref === 'working') return null;
  execFileSync('git', ['rev-parse', '--verify', ref], { cwd: repoPath, stdio: 'pipe' });
  const dir = mkdtempSync(path.join(tmpdir(), 'connascence-diff-'));
  const tar = path.join(dir, '__archive.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', tar, ref], { cwd: repoPath, stdio: 'pipe' });
  execFileSync('tar', ['-xf', tar, '-C', dir], { stdio: 'pipe' });
  rmSync(tar, { force: true });
  return dir;
}

/** Repo-relative, forward-slash path so the same file in two checkouts keys identically. */
function relOf(root: string, filePath: string): string {
  const norm = toPosix(filePath);
  const rootPosix = toPosix(root).replace(/\/$/, '') + '/';
  return norm.startsWith(rootPosix) ? norm.slice(rootPosix.length) : norm;
}

/**
 * Endpoint key: the adapter's move/rename-stable identity when available,
 * otherwise the old repo-relative file + name fallback (module-level nodes and
 * anything the adapter could not identify). Including the kind keeps a
 * definition and a reference with the same identity hash apart.
 */
function endpointKey(root: string, n: EdgeEndpoint): string {
  if (n.identityHash) return `i:${n.kind}:${n.identityHash}`;
  return `p:${relOf(root, n.filePath)}:${n.name}`;
}

/**
 * Edges are keyed by (type, endpoint identity) so line shifts, renames and
 * file moves still match; the file/name fallback covers unidentifiable nodes.
 * Two structurally identical functions share an identity, so their edges
 * collapse into one key (see src/languages/typescript/identity.ts).
 */
function edgeKey(root: string, e: ScoredEdge): string {
  return [e.connascenceType, endpointKey(root, e.nodeA), endpointKey(root, e.nodeB)].join('|');
}
export function diffScan(opts: DiffOptions): DiffResult {
  const repo = path.resolve(opts.repoPath);
  const { base, head = 'working', globs, config = {}, backend, scanFn } = opts;

  const scanAt = (ref: string): { report: ScanReport; root: string } => {
    const dir = materializeRef(repo, ref);
    const root = dir ?? repo;
    // globs may be relative to the CLI's CWD (e.g. "../repo/src/**/*.ts") or to the
    // repo itself ("src/**/*.ts"). Disambiguate using the non-wildcard prefix: if the
    // CWD-resolved prefix lands inside the repo, treat the glob as CWD-relative.
    const globPaths = globs.map((g) => {
      const wildcardIdx = g.search(/[*?]/);
      const head = wildcardIdx >= 0 ? g.slice(0, wildcardIdx) : g;
      const cwdResolved = path.resolve(head);
      const isCwdRelative = cwdResolved.startsWith(repo + path.sep) || cwdResolved === repo;
      const repoRelative = isCwdRelative
        ? path.relative(repo, path.resolve(g))
        : g;
      return path.posix.join(toPosix(root), toPosix(repoRelative));
    });
    return { report: scanFn(globPaths, config, backend), root };
  };

  const baseScan = scanAt(base);
  const headScan = scanAt(head);

  const baseKeys = new Set(baseScan.report.edges.map((e) => edgeKey(baseScan.root, e)));
  const headKeys = new Set(headScan.report.edges.map((e) => edgeKey(headScan.root, e)));

  const added = headScan.report.edges.filter((e) => !baseKeys.has(edgeKey(headScan.root, e)));
  const removed = baseScan.report.edges.filter((e) => !headKeys.has(edgeKey(baseScan.root, e)));

  if (baseScan.root !== repo) rmSync(baseScan.root, { recursive: true, force: true });
  if (headScan.root !== repo && headScan.root !== baseScan.root) rmSync(headScan.root, { recursive: true, force: true });

  return {
    added,
    removed,
    baseSummary: baseScan.report.summary,
    headSummary: headScan.report.summary,
  };
}
