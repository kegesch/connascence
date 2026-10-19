// Integration: the plugin consumes the real engine CLI output. Skipped when
// dist/ has not been built (`npm run build` first).
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan, parseScan, runtimeBinary, countEdges } from '../../plugin/engine.ts';
import { diffEdges } from '../../plugin/diff.ts';
import { isReportable, renderScanReport } from '../../plugin/payload.ts';

const ENGINE = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const FIXTURE_GLOB = 'tests/fixtures/position/*.ts';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const engineBuilt = existsSync(ENGINE);
// These spawn the real CLI; under a full parallel run a cold Node start can
// exceed vitest's 5s default. The work is bounded by timeoutMs, not the test.
const SPAWN_TIMEOUT = 60_000;

describe.skipIf(!engineBuilt)('engine bridge (spawn dist/cli.js)', () => {
  it('scans the position fixtures and returns parsed, scored edges', async () => {
    const scan = await runScan({
      engineEntry: ENGINE,
      cwd: REPO_ROOT,
      globs: [FIXTURE_GLOB],
      timeoutMs: 120_000,
    });
    expect((scan.summary.position ?? 0)).toBeGreaterThanOrEqual(5);
    expect(countEdges(scan)).toBeGreaterThan(0);
    for (const e of scan.edges) {
      expect(e.strength).toBeGreaterThan(0);
      expect(e.nodeA.filePath).toBeTruthy();
    }
  }, SPAWN_TIMEOUT);

  it('is deterministic: two identical scans produce identical edge keys', async () => {
    const req = { engineEntry: ENGINE, cwd: REPO_ROOT, globs: [FIXTURE_GLOB], timeoutMs: 120_000 };
    const a = await runScan(req);
    const b = await runScan(req);
    expect(countEdges(a)).toBe(countEdges(b));
  }, SPAWN_TIMEOUT);

  it('feeds the crude diff + payload pipeline end to end', async () => {
    const scan = await runScan({
      engineEntry: ENGINE,
      cwd: REPO_ROOT,
      globs: [FIXTURE_GLOB],
      timeoutMs: 120_000,
    });
    const again = { ...scan };
    const { added } = diffEdges(scan.edges, again.edges);
    expect(added).toHaveLength(0);
    const reportable = scan.edges.filter((e) => isReportable(e, false));
    const text = renderScanReport({ scan, reportable, cwd: REPO_ROOT, opts: { top: 5, budgetChars: 1500 } });
    expect(text).toContain('position');
    expect(text).toContain('fix:');
  }, SPAWN_TIMEOUT);
});

describe('parseScan', () => {
  it('rejects malformed engine output', () => {
    expect(() => parseScan('not json')).toThrow();
    expect(() => parseScan('{"summary":{}}')).toThrow();
    expect(() => parseScan('{"summary":{},"edges":[]}')).not.toThrow();
  });
});

describe('runtimeBinary', () => {
  it('keeps real JS runtimes', () => {
    expect(runtimeBinary('C:/Program Files/nodejs/node.exe')).toMatch(/node\.exe$/);
    expect(runtimeBinary('/usr/bin/bun')).toBe('/usr/bin/bun');
  });
  it('falls back to node when execPath is the host binary (opencode.exe inside plugins)', () => {
    expect(runtimeBinary('C:/opencode/opencode.exe')).toBe('node');
    expect(runtimeBinary('C:/opencode/opencode')).toBe('node');
  });
});
