import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendLog, writeSessionReport } from '../../plugin/log.ts';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'coupling-sensor-log-'));
}

describe('appendLog', () => {
  it('writes one JSON object per line with a timestamp', async () => {
    const dir = await tempDir();
    await appendLog(dir, { event: 'baseline', edges: 5 });
    await appendLog(dir, { event: 'injected', count: 1 });
    const text = await readFile(path.join(dir, 'sensor-log.jsonl'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.event).toBe('baseline');
    expect(first.edges).toBe(5);
    expect(typeof first.at).toBe('string');
  });

  it('serializes concurrent appends without losing events', async () => {
    const dir = await tempDir();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => appendLog(dir, { event: 'turn', i })),
    );
    const text = await readFile(path.join(dir, 'sensor-log.jsonl'), 'utf8');
    expect(text.trim().split('\n')).toHaveLength(20);
  });
});

describe('writeSessionReport', () => {
  it('writes a report file keyed by the session-id suffix', async () => {
    const dir = await tempDir();
    const file = await writeSessionReport(dir, {
      sessionID: 'ses_abcdefgh1234',
      endedAt: '2026-10-18T00:00:00.000Z',
      summary: { turns: 2, injections: 1 },
      finalEdges: null,
    });
    expect(path.basename(file)).toBe('session-efgh1234.json');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    expect(parsed.summary.injections).toBe(1);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
  });
});
