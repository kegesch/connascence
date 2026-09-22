import { IrNode, IrProject } from '../ir.js';

export interface MeaningDetectorOptions {
  /** flag literals repeated at this many distinct call sites or more. Default 5. */
  minCount?: number;
  /** require the repetitions to span this many distinct files. Default 2. */
  minFiles?: number;
  /** skip numeric literals (array indices etc. dominate and are rarely meaningful). Default true. */
  skipNumbers?: boolean;
}

/**
 * Connascence of Meaning: clusters identical literal values used as call
 * arguments across call sites and flags repeated "magic" literals as
 * heuristic candidates. These edges may have false positives — the evidence
 * string is required for reviewer sanity-checking.
 * Pure function on the IR (literal nodes are emitted by the language adapter).
 */
export function detectMeaning(
  project: IrProject,
  options: MeaningDetectorOptions = {},
): IrProject['edges'] {
  const minCount = options.minCount ?? 5;
  const minFiles = options.minFiles ?? 2;
  const skipNumbers = options.skipNumbers ?? true;

  const byValue = new Map<string, IrNode[]>();
  for (const node of project.nodes) {
    if (node.kind !== 'literal') continue;
    if (skipNumbers && /^-?\d+(\.\d+)?$/.test(node.name.replace(/^"(.*)"$/, '$1'))) continue;
    const group = byValue.get(node.name) ?? [];
    group.push(node);
    byValue.set(node.name, group);
  }

  const edges: IrProject['edges'] = [];
  for (const [value, group] of byValue) {
    if (group.length < minCount) continue;
    const files = new Set(group.map((n) => n.location.filePath));
    if (files.size < minFiles) continue;
    const [first, ...rest] = group;
    for (const other of rest) {
      edges.push({
        nodeA: first.id,
        nodeB: other.id,
        connascenceType: 'meaning',
        evidence: `magic literal ${value} repeated at ${group.length} call sites across ${files.size} files (candidate — sites must agree on the same meaning; consider a named constant)`,
      });
    }
  }
  return edges;
}
