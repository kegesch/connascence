// Temporal co-change channel (PLAN.md §M3a): the one signal that catches
// semantic evasion — event buses, dependency injection, string-keyed
// indirection — where no static edge exists but files still have to move
// together. It is a candidate channel by construction: history is noisy, so
// it never gates (see gateableEdges).
//
// Pure pair computation is split from the git adapter so the thresholds and
// determinism can be tested without a repository.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { globMatch } from './scan.js';

export interface CommitChange {
  sha: string;
  /** repo-relative, forward-slash paths changed by the commit */
  files: string[];
}

export interface CoChangePair {
  /** repo-relative, forward-slash path (lexicographically first) */
  a: string;
  /** repo-relative, forward-slash path (lexicographically second) */
  b: string;
  /** commits in which both files changed */
  support: number;
  /** support / min(changes(a), changes(b)): confidence the rarer file drags the other */
  ratio: number;
  /** newest commit (short) in which the pair changed together */
  last: string;
}

export interface CoChangeOptions {
  /** scan globs; only changed files matching one of these are considered */
  globs?: string[];
  /** config ignore globs */
  ignore?: string[];
  /** minimum shared commits (default 3) */
  minSupport?: number;
  /** minimum confidence (default 0.5) */
  minRatio?: number;
  /** history depth read from git (default 500 commits) */
  maxCommits?: number;
  /** commits touching more files than this are formatting/mass edits: skip (default 25) */
  maxFilesPerCommit?: number;
}

const COMMIT_MARKER = '__COMMIT__';
const DEFAULTS = {
  minSupport: 3,
  minRatio: 0.5,
  maxCommits: 500,
  maxFilesPerCommit: 25,
};

/**
 * Parse `git log --name-only --pretty=format:__COMMIT__<sha>` output. Blank
 * lines separate commits; commit markers start a new record.
 */
export function parseGitLog(output: string): CommitChange[] {
  const commits: CommitChange[] = [];
  let current: CommitChange | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(COMMIT_MARKER)) {
      current = { sha: line.slice(COMMIT_MARKER.length), files: [] };
      commits.push(current);
    } else if (current) {
      current.files.push(line.replace(/\\/g, '/'));
    }
  }
  return commits;
}

function inScope(file: string, globs: string[], ignore: string[]): boolean {
  if (ignore.some((pattern) => globMatch(pattern, file))) return false;
  return globs.length === 0 || globs.some((pattern) => globMatch(pattern, file));
}

/** Keep only changed files the scan actually covers (and the config ignores exclude). */
export function filterCommits(commits: CommitChange[], globs: string[], ignore: string[] = []): CommitChange[] {
  return commits
    .map((c) => ({ sha: c.sha, files: c.files.filter((f) => inScope(f, globs, ignore)) }))
    .filter((c) => c.files.length > 0);
}

interface PairAccumulator {
  a: string;
  b: string;
  support: number;
  last: string;
}

/**
 * Count unordered file pairs per commit. Deterministic: final ordering is
 * confidence, then support, then path — Map insertion order is never used.
 */
export function coChangePairs(commits: CommitChange[], options: CoChangeOptions = {}): CoChangePair[] {
  const minSupport = options.minSupport ?? DEFAULTS.minSupport;
  const minRatio = options.minRatio ?? DEFAULTS.minRatio;
  const maxFiles = options.maxFilesPerCommit ?? DEFAULTS.maxFilesPerCommit;
  const fileChanges = new Map<string, number>();
  const pairs = new Map<string, PairAccumulator>();

  for (const commit of commits) {
    const files = [...new Set(commit.files)].sort();
    // a mass edit (format/lint/rename) says nothing about design coupling
    if (files.length > maxFiles) continue;
    // solo changes count toward file frequency: they are the evidence that a
    // file often changes *without* its partner (lower confidence)
    for (const file of files) fileChanges.set(file, (fileChanges.get(file) ?? 0) + 1);
    if (files.length < 2) continue;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}\u0000${files[j]}`;
        const existing = pairs.get(key);
        if (existing) existing.support++;
        else pairs.set(key, { a: files[i], b: files[j], support: 1, last: commit.sha });
      }
    }
  }

  return [...pairs.values()]
    .map((p) => ({
      a: p.a,
      b: p.b,
      support: p.support,
      ratio: p.support / Math.min(fileChanges.get(p.a) ?? 1, fileChanges.get(p.b) ?? 1),
      last: p.last,
    }))
    .filter((p) => p.support >= minSupport && p.ratio >= minRatio)
    .sort(
      (x, y) =>
        y.ratio - x.ratio ||
        y.support - x.support ||
        x.a.localeCompare(y.a) ||
        x.b.localeCompare(y.b),
    );
}

/** Read bounded, merge-free history from `repoPath` and compute pairs. */
export function readCoChange(repoPath: string, options: CoChangeOptions = {}): CoChangePair[] {
  const maxCommits = options.maxCommits ?? DEFAULTS.maxCommits;
  const args = [
    'log',
    `--max-count=${maxCommits}`,
    '--no-merges',
    '--name-only',
    `--pretty=format:${COMMIT_MARKER}%H`,
    '--relative',
  ];
  let output: string;
  try {
    output = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return []; // not a git repository / git unavailable: the channel is optional
  }
  // History has paths that no longer exist (renames, deletions). A pair is only
  // actionable for files in the current tree; ghost paths from before a move
  // would otherwise look like active coupling forever.
  const commits = filterCommits(parseGitLog(output), options.globs ?? [], options.ignore ?? [])
    .map((c) => ({ sha: c.sha, files: c.files.filter((f) => existsSync(path.join(repoPath, f))) }))
    .filter((c) => c.files.length > 0);
  return coChangePairs(commits, options);
}
