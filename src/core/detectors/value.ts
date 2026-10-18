import { IrNode, IrProject } from '../ir.js';

export interface ValueDetectorOptions {
  /** require the co-varying constants to live in this many distinct files. Default 2. */
  minFiles?: number;
}

function isConstantName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * Connascence of Value (heuristic): flags named constants holding the same
 * literal value in different modules — if the value changes in one place it
 * must change in the other, yet no shared abstraction ties them together.
 * Candidates only; evidence is required for reviewer sanity-checks.
 */
export function detectValue(
  project: IrProject,
  options: ValueDetectorOptions = {},
): IrProject['edges'] {
  const minFiles = options.minFiles ?? 2;

  const byInitialValue = new Map<string, IrNode[]>();
  for (const node of project.nodes) {
    if (node.kind !== 'variable' || node.mutable || !node.initialValue) continue;
    if (!isConstantName(node.name)) continue;
    const group = byInitialValue.get(node.initialValue) ?? [];
    group.push(node);
    byInitialValue.set(node.initialValue, group);
  }

  const edges: IrProject['edges'] = [];
  for (const [value, group] of byInitialValue) {
    if (group.length < 2) continue;
    const files = new Set(group.map((n) => n.location.filePath));
    if (files.size < minFiles) continue;
    const [first, ...rest] = group;
    for (const other of rest) {
      edges.push({
        nodeA: first.id,
        nodeB: other.id,
        connascenceType: 'value',
        evidence: `constants "${first.name}" (${first.location.filePath}:${first.location.startLine}) and "${other.name}" (${other.location.filePath}:${other.location.startLine}) share literal value ${value} across ${files.size} files — must co-vary without a shared constant (candidate)`,
      });
    }
  }
  return edges;
}
