// Git-derived diff base fixtures. Positive cases are the two ways a CI clone
// exposes the default branch (origin/HEAD symref, then the candidate list);
// negatives are the repositories where deriving silently would be wrong, which
// must return null so the CLI asks for an explicit --base.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBaseRef } from '../../src/core/gitBase.ts';

let root: string;
let repo: string;
let origin: string;
let forkPoint: string;
let mainTip: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '.');
  git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

const config = (cwd: string): void => {
  git(cwd, 'config', 'user.email', 't@t');
  git(cwd, 'config', 'user.name', 't');
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'connascence-base-'));
  origin = path.join(root, 'origin.git');
  repo = path.join(root, 'repo');

  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(root, 'init', '--initial-branch=main', repo);
  config(repo);
  writeFileSync(path.join(repo, 'src.ts'), 'export const a = 1;\n');
  forkPoint = commit(repo, 'base');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-u', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', '--auto');

  // the feature branch forks here; main advances afterwards, so a test that
  // returns the branch tip instead of the merge-base will fail
  git(repo, 'checkout', '-b', 'feature');
  writeFileSync(path.join(repo, 'feature.ts'), 'export const b = 2;\n');
  commit(repo, 'feature work');
  git(repo, 'checkout', 'main');
  writeFileSync(path.join(repo, 'main.ts'), 'export const c = 3;\n');
  mainTip = commit(repo, 'main advances');
  git(repo, 'push', 'origin', 'main');
  git(repo, 'checkout', 'feature');
}, 60000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveBaseRef', () => {
  it('returns an explicit --base untouched, without consulting git', () => {
    expect(resolveBaseRef(repo, 'HEAD~1')).toEqual({ ref: 'HEAD~1', source: 'explicit --base' });
    expect(resolveBaseRef(path.join(root, 'not-a-repo'), 'origin/main')).toEqual({
      ref: 'origin/main',
      source: 'explicit --base',
    });
  });

  it('derives the merge-base with the branch behind origin/HEAD', () => {
    expect(resolveBaseRef(repo)).toEqual({
      ref: forkPoint,
      source: 'merge-base with origin/main',
    });
    expect(forkPoint).not.toBe(mainTip);
  });

  it('falls back to the candidate branch when origin/HEAD is absent', () => {
    git(repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    expect(resolveBaseRef(repo)).toEqual({
      ref: forkPoint,
      source: 'merge-base with origin/main',
    });
    git(repo, 'remote', 'set-head', 'origin', '--auto');
  });

  it('returns null when there is no default branch or remote to derive from', () => {
    // a non-standard branch with no remote: comparing against the current
    // branch itself would silently reduce the gate to uncommitted changes
    const lonely = path.join(root, 'lonely');
    git(root, 'init', '--initial-branch=work', lonely);
    config(lonely);
    writeFileSync(path.join(lonely, 'a.ts'), 'export const a = 1;\n');
    commit(lonely, 'only commit');
    expect(resolveBaseRef(lonely)).toBeNull();
  });
});
