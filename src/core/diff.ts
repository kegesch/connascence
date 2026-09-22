import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan } from './scan.js';
import { ConnascenceConfig } from './config.js';
import { ScoredEdge, ScanReport } from './scoring/score.js';

export const HEURISTIC_TYPES = new Set(['meaning', 'value', 'identity']);

export interface DiffOptions {
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

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Repo-relative, forward-slash path so the same file in two checkouts keys identically. */
function relOf(root: string, filePath: string): string {
  const norm = toPosix(filePath);
  const rootPosix = toPosix(root).replace(/\/$/, '') + '/';
  return norm.startsWith(rootPosix) ? norm.slice(rootPosix.length) : norm;
}

function edgeKey(root: string, e: ScoredEdge): string {
  return [
    e.connascenceType,
    relOf(root, e.nodeA.filePath),
    e.nodeA.name,
    relOf(root, e.nodeB.filePath),
    e.nodeB.name,
  ].join('|');
}

/**
 * Scan the project at two refs and diff the coupling graphs.
 * Edges are keyed by (type, endpoint file/name) so small line shifts still match.
 */
export function diffScan(opts: DiffOptions): DiffResult {
  const repo = path.resolve(opts.repoPath);
  const { base, head = 'working', globs, config = {} } = opts;

  const scanAt = (ref: string): { report: ScanReport; root: string } => {
    const dir = materializeRef(repo, ref);
    const root = dir ?? repo;
    // user globs are relative to the CLI's CWD; remap them to be relative to the
    // scan root (repo working tree or extracted archive dir)
    const globPaths = globs.map((g) => path.posix.join(toPosix(root), toPosix(path.relative(repo, path.resolve(g)))));
    return { report: scan(globPaths, config), root };
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
