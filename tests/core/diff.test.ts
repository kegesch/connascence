import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { diffScan } from '../../src/core/diff.ts';

let repo: string;
let ref1: string;
let ref2: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'connascence-difftest-'));
  git('init');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
  mkdirSync(path.join(repo, 'src'), { recursive: true });

  // commit 1: clean code
  writeFileSync(
    path.join(repo, 'src', 'a.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
  );
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'clean');
  ref1 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  // commit 2: introduces a wide signature + call site (position connascence)
  writeFileSync(
    path.join(repo, 'src', 'b.ts'),
    'export function connect(h: string, p: number, u: string, pw: string, db: string): string {\n  return h + p + u + pw + db;\n}\n',
  );
  writeFileSync(
    path.join(repo, 'src', 'c.ts'),
    'import { connect } from "./b";\nexport const cfg = connect("x", 1, "y", "z", "w");\n',
  );
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add coupling');
  ref2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('diffScan', () => {
  it('reports coupling introduced between two refs', () => {
    const result = diffScan({ repoPath: repo, base: ref1, head: ref2, globs: ['src/**/*.ts'] });
    const positionAdded = result.added.filter((e) => e.connascenceType === 'position');
    expect(positionAdded.length).toBeGreaterThanOrEqual(5); // 5 args into 5-param connect()
    expect(result.headSummary.position).toBeGreaterThan(0);
    expect(result.baseSummary.position ?? 0).toBe(0);
  }, 60000);

  it('reports reverse direction as removed', () => {
    const result = diffScan({ repoPath: repo, base: ref2, head: ref1, globs: ['src/**/*.ts'] });
    expect(result.removed.some((e) => e.connascenceType === 'position')).toBe(true);
    expect(result.added.filter((e) => e.connascenceType === 'position')).toHaveLength(0);
  }, 60000);

  it('heuristicFindings=exclude drops heuristic edges', () => {
    const result = diffScan({
      repoPath: repo,
      base: ref1,
      head: ref2,
      globs: ['src/**/*.ts'],
      config: { heuristicFindings: 'exclude' },
    });
    expect(result.added.every((e) => !['meaning', 'value', 'identity'].includes(e.connascenceType))).toBe(true);
  }, 60000);
});
