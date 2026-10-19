// End-to-end M0 loop simulation against the real engine CLI: baseline scan ->
// edit introduces new coupling -> session diff -> advisory payload -> dedupe.
// Skipped when dist/ has not been built (`npm run build` first).
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from '../../plugin/engine.ts';
import { diffAdded } from '../../plugin/diff.ts';
import { isReportable, renderInjection } from '../../plugin/payload.ts';
import { createState, ensureBaseline, freshAdded, markReported } from '../../plugin/sensor.ts';
import { appendLog } from '../../plugin/log.ts';

const ENGINE = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const engineBuilt = existsSync(ENGINE);

const DB_TS = `export function connect(host: string, port: number, user: string, password: string, database: string): string {
  return \`\${host}:\${port}/\${database}\`;
}
`;

const APP_TS = `import { connect } from './db';
export const url = connect('localhost', 5432, 'admin', 'secret', 'appdb');
`;

const APP_TS_EXTENDED = `${APP_TS}
export function format(host: string, port: number, user: string, password: string, name: string): string {
  return \`\${host}:\${port}/\${name}\`;
}
export const url2 = format('h', 1, 'u', 'p', 'n');
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'coupling-sensor-e2e-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'db.ts'), DB_TS, 'utf8');
  await writeFile(path.join(root, 'src', 'app.ts'), APP_TS, 'utf8');
  return root;
}

describe.skipIf(!engineBuilt)('M0 loop simulation (real engine)', () => {
  it('baselines, detects newly introduced coupling, reports it once', async () => {
    const project = await makeProject();
    const scanArgs = { engineEntry: ENGINE, cwd: project, globs: ['src/**/*.ts'], timeoutMs: 120_000 };

    const state = createState();
    const baseline = ensureBaseline(state, await runScan(scanArgs)).baseline;
    expect(baseline.count).toBeGreaterThanOrEqual(5); // connect() positional slots

    await writeFile(path.join(project, 'src', 'app.ts'), APP_TS_EXTENDED, 'utf8');
    const after = await runScan(scanArgs);

    const added = diffAdded(baseline.keys, after.edges);
    const fresh = freshAdded(state, added.filter((e) => isReportable(e, false)));
    expect(fresh.length).toBeGreaterThanOrEqual(5); // format()'s new positional slots

    const text = renderInjection({
      added: fresh,
      edgesBefore: baseline.count,
      edgesAfter: after.edges.length,
      cwd: project,
      opts: { top: 5, budgetChars: 1500 },
    });
    expect(text).toContain('new coupling instance(s)');
    expect(text).toContain('fix: Reduce positional coupling');

    markReported(state, fresh);
    const addedAgain = diffAdded(baseline.keys, after.edges);
    expect(freshAdded(state, addedAgain.filter((e) => isReportable(e, false)))).toHaveLength(0);

    const logDir = path.join(project, '.coupling');
    await appendLog(logDir, { event: 'injected', sessionID: 'ses_sim', count: fresh.length });
    const log = await readFile(path.join(logDir, 'sensor-log.jsonl'), 'utf8');
    expect(JSON.parse(log.trim()).event).toBe('injected');
  }, 300_000);
});
