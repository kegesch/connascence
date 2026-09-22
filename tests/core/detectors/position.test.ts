import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';
import { detectName } from '../../../src/core/detectors/name.ts';
import { detectPosition } from '../../../src/core/detectors/position.ts';
import type { IrNode } from '../../../src/core/ir.ts';

const FIXTURES = ['tests/fixtures/position/positive.ts', 'tests/fixtures/position/negative.ts'];

function analyze(files: string[]) {
  const table = buildSymbolTable(files);
  const project = table.project;
  project.edges = detectName(project, table.refIdToDefId);
  return { table, project };
}

describe('detectName', () => {
  it('links call-site references to definitions', () => {
    const { project } = analyze(FIXTURES);
    const connectCalls = project.edges.filter((e) => e.connascenceType === 'name');
    expect(connectCalls.length).toBeGreaterThanOrEqual(3); // connect, add, greet calls
  });
});

describe('detectPosition', () => {
  const { project } = analyze(FIXTURES);
  project.edges.push(...detectPosition(project));

  const byId = new Map<string, IrNode>(project.nodes.map((n) => [n.id, n]));

  it('flags arguments of wide signatures with evidence', () => {
    const posEdges = project.edges.filter((e) => e.connascenceType === 'position');
    expect(posEdges).toHaveLength(5); // 5 args into connect()
    for (const e of posEdges) {
      expect(e.evidence).toContain('argument slot');
      const param = byId.get(e.nodeB);
      expect(param?.kind).toBe('parameter');
    }
    // covers host..database slots in order
    const slots = posEdges.map((e) => byId.get(e.nodeA)!.name).sort();
    expect(slots).toEqual(['0', '1', '2', '3', '4']);
  });

  it('does not flag narrow signatures', () => {
    const addId = project.nodes.find((n) => n.kind === 'function' && n.name === 'add')!.id;
    const addEdges = project.edges.filter(
      (e) => e.connascenceType === 'position' && (e.nodeA === addId || e.nodeB === addId),
    );
    expect(addEdges).toHaveLength(0);
  });

  it('handles a file with no wide signatures cleanly', () => {
    const { project: neg } = analyze(['tests/fixtures/position/negative.ts']);
    const edges = detectPosition(neg);
    expect(edges).toHaveLength(0);
  });
});
