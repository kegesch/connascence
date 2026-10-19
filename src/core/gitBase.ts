// Git-derived diff base (PLAN.md §M3a baseline).
//
// `diff --base=<ref>` is right when the caller knows the fork point, but a CI
// gate should not have to. When no base is given we compare against the
// merge-base of HEAD and the repository's default branch, so a pull request
// reports the coupling it introduced rather than everything that landed on the
// default branch since the branch was cut.
//
// The merge-base (not the branch tip) is the point: on a feature branch,
// origin/main may have advanced, and diffing against its tip would report the
// other branch's work as removed.

import { execFileSync } from 'node:child_process';

export interface ResolvedBase {
  /** git revision to materialize (a commit SHA, or the explicit user ref) */
  ref: string;
  /** human-readable provenance for logs and the summary line */
  source: string;
}

function git(repoPath: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, { cwd: repoPath, stdio: 'pipe', encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Default-branch candidates, most authoritative first. */
const DEFAULT_BRANCHES = ['origin/main', 'origin/master', 'main', 'master'];

function defaultBranchCandidates(repoPath: string): string[] {
  const candidates: string[] = [];
  const originHead = git(repoPath, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (originHead) candidates.push(originHead.replace(/^refs\/remotes\//, ''));
  for (const branch of DEFAULT_BRANCHES) {
    if (!candidates.includes(branch)) candidates.push(branch);
  }
  return candidates;
}

/**
 * Resolve the ref to diff against. An explicit base is returned untouched (the
 * caller may be diffing arbitrary refs); otherwise this is the merge-base with
 * the first existing default-branch candidate. Returns null when the repository
 * has no default branch to derive from, so the CLI can ask for `--base`.
 */
export function resolveBaseRef(repoPath: string, explicit?: string): ResolvedBase | null {
  if (explicit) return { ref: explicit, source: 'explicit --base' };

  for (const candidate of defaultBranchCandidates(repoPath)) {
    const exists = git(repoPath, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (!exists) continue;
    const mergeBase = git(repoPath, ['merge-base', 'HEAD', candidate]);
    if (mergeBase) return { ref: mergeBase, source: `merge-base with ${candidate}` };
  }
  return null;
}
