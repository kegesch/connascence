// Temporal co-change fixtures. Two rules matter: history is noisy (so the
// channel is a candidate and never gates) and thresholds must be deterministic
// — mass edits are skipped, and ordering never depends on Map insertion.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  coChangePairs,
  filterCommits,
  parseGitLog,
  readCoChange,
  type CommitChange,
} from '../../src/core/cochange.ts';

function commits(...filesPerCommit: string[][]): CommitChange[] {
  return filesPerCommit.map((files, i) => ({ sha: `sha${i}`, files }));
}

describe('parseGitLog', () => {
  it('splits marker-delimited records and ignores blank lines', () => {
    const log = '__COMMIT__abc\nsrc/a.ts\nsrc/b.ts\n\n__COMMIT__def\nsrc/a.ts\n';
    expect(parseGitLog(log)).toEqual([
      { sha: 'abc', files: ['src/a.ts', 'src/b.ts'] },
      { sha: 'def', files: ['src/a.ts'] },
    ]);
  });

  it('normalizes windows separators', () => {
    expect(parseGitLog('__COMMIT__abc\nsrc\\a.ts\n')).toEqual([
      { sha: 'abc', files: ['src/a.ts'] },
    ]);
  });
});

describe('coChangePairs', () => {
  it('counts shared commits and reports confidence against the rarer file', () => {
    const pairs = coChangePairs(
      commits(
        ['src/a.ts', 'src/b.ts'],
        ['src/a.ts', 'src/b.ts'],
        ['src/a.ts', 'src/b.ts'],
        ['src/a.ts'],
        ['src/b.ts'],
      ),
      { minSupport: 2 },
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'src/a.ts', b: 'src/b.ts', support: 3, ratio: 0.75 });
    // commits are passed newest-first, so the first shared commit is the newest
    expect(pairs[0].last).toBe('sha0');
  });

  it('filters below the support threshold', () => {
    expect(coChangePairs(commits(['src/a.ts', 'src/b.ts']), { minSupport: 3 })).toEqual([]);
  });

  it('filters low-confidence pairs', () => {
    // each file changes alone often, so only 3 of their 8 changes coincide
    const history = commits(
      ['src/a.ts', 'src/b.ts'],
      ['src/a.ts', 'src/b.ts'],
      ['src/a.ts', 'src/b.ts'],
      ...Array.from({ length: 5 }, () => ['src/a.ts']),
      ...Array.from({ length: 5 }, () => ['src/b.ts']),
    );
    expect(coChangePairs(history, { minSupport: 2, minRatio: 0.5 })).toEqual([]);
    expect(coChangePairs(history, { minSupport: 2, minRatio: 0.3 })).toHaveLength(1);
  });

  it('skips mass edits that say nothing about design coupling', () => {
    const mass = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    expect(coChangePairs(commits(mass), { minSupport: 1, maxFilesPerCommit: 25 })).toEqual([]);
  });

  it('is deterministic for equal confidence and support', () => {
    const pairs = coChangePairs(
      commits(['src/b.ts', 'src/c.ts'], ['src/a.ts', 'src/b.ts']),
      { minSupport: 1 },
    );
    expect(pairs.map((p) => `${p.a}|${p.b}`)).toEqual(['src/a.ts|src/b.ts', 'src/b.ts|src/c.ts']);
  });
});

describe('filterCommits', () => {
  it('keeps only scanned files and applies ignore globs', () => {
    const filtered = filterCommits(
      [{ sha: 'x', files: ['src/a.ts', 'tests/a.test.ts', 'docs/readme.md', 'src/generated.ts'] }],
      ['src/**/*.ts'],
      ['src/generated.ts'],
    );
    expect(filtered).toEqual([{ sha: 'x', files: ['src/a.ts'] }]);
  });
});

describe('readCoChange (git adapter)', () => {
  let repo: string;
  let newest: string;

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'connascence-cochange-'));
    const git = (...args: string[]) => {
      execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    };
    const commit = (message: string): string => {
      git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message);
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    };
    git('init');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 1;\n');
    git('add', '.');
    commit('one');
    for (const n of [1, 2]) {
      writeFileSync(path.join(repo, 'src', 'a.ts'), `export const a = ${n};\n`);
      writeFileSync(path.join(repo, 'src', 'b.ts'), `export const b = ${n};\n`);
      git('add', '.');
      newest = commit(`pair ${n}`);
    }
  }, 60000);

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('finds a repeatedly co-changed pair in a real repository', () => {
    const pairs = readCoChange(repo, { globs: ['src/**/*.ts'], minSupport: 2 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'src/a.ts', b: 'src/b.ts', support: 2, ratio: 1 });
    expect(pairs[0].last).toBe(newest);
  }, 60000);

  it('drops history paths that no longer exist after a rename', () => {
    const ghost = mkdtempSync(path.join(tmpdir(), 'connascence-ghost-'));
    const run = (...args: string[]) => execFileSync('git', args, { cwd: ghost, stdio: 'pipe' });
    const commit = (message: string) => {
      run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message);
    };
    try {
      run('init');
      mkdirSync(path.join(ghost, 'src'), { recursive: true });
      for (const n of [1, 2]) {
        writeFileSync(path.join(ghost, 'src', 'a.ts'), `export const a = ${n};\n`);
        writeFileSync(path.join(ghost, 'src', 'old.ts'), `export const old = ${n};\n`);
        run('add', '.');
        commit(`pair ${n}`);
      }
      run('mv', 'src/old.ts', 'src/new.ts');
      commit('rename');
      const pairs = readCoChange(ghost, { globs: ['src/**/*.ts'], minSupport: 2 });
      expect(pairs.every((p) => p.a !== 'src/old.ts' && p.b !== 'src/old.ts')).toBe(true);
    } finally {
      rmSync(ghost, { recursive: true, force: true });
    }
  }, 60000);

  it('honours ignore globs and returns nothing outside a repository', () => {
    expect(readCoChange(repo, { globs: ['src/**/*.ts'], ignore: ['src/b.ts'], minSupport: 2 })).toEqual([]);
    expect(readCoChange(repo, { globs: ['nothing/**/*.ts'], minSupport: 1 })).toEqual([]);
    const outside = mkdtempSync(path.join(tmpdir(), 'connascence-nogit-'));
    try {
      expect(readCoChange(outside, { globs: ['src/**/*.ts'] })).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }, 60000);
});
