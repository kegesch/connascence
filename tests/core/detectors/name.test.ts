import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectName } from '../../../src/core/detectors/name.ts';

const FIXTURE = 'tests/fixtures/name/basic.ts';

function analyze(files: string[], excludeSameFunctionScope?: boolean) {
  const table = buildSymbolTable(files);
  const edges = detectName(table.project, table.refIdToDefId, { excludeSameFunctionScope });
  return { table, edges };
}

describe('detectName', () => {
  it('links cross-scope call-site references to definitions', () => {
    const { edges } = analyze([FIXTURE]);
    const names = edges.map((e) => e.connascenceType);
    expect(names.every((t) => t === 'name')).toBe(true);
    // 'shared' referenced from inside two different functions => at least 2 cross-scope edges
    expect(edges.length).toBeGreaterThanOrEqual(2);
  });

  it('excludes same-function-scope references by default', () => {
    const { table, edges } = analyze([FIXTURE]);
    const byId = new Map(table.project.nodes.map((n) => [n.id, n]));
    const localRefs = edges.filter((e) => byId.get(e.nodeA)?.name === 'local');
    expect(localRefs).toHaveLength(0);
  });

  it('can be told to keep same-scope references', () => {
    const { table, edges } = analyze([FIXTURE], false);
    const byId = new Map(table.project.nodes.map((n) => [n.id, n]));
    const localRefs = edges.filter((e) => byId.get(e.nodeA)?.name === 'local');
    expect(localRefs.length).toBeGreaterThanOrEqual(1);
  });

  it('attaches evidence naming the definition', () => {
    const { edges } = analyze([FIXTURE]);
    for (const e of edges) expect(e.evidence).toMatch(/reference to "/);
  });
});
