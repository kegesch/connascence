import { IrNode, IrProject } from '../ir.js';

export interface MeaningDetectorOptions {
  /** flag literals repeated at this many distinct call sites or more. Default 5. */
  minCount?: number;
  /** require the repetitions to span this many distinct files. Default 2. */
  minFiles?: number;
  /** skip numeric literals (array indices etc. dominate and are rarely meaningful). Default true. */
  skipNumbers?: boolean;
  /** skip trivial string literals (empty string, single characters like '/' or ':')
   *  whose repetition is rarely actionable. Default true. */
  skipTrivial?: boolean;
  /** optional semantic predicate (supplied via the language adapter): return true when the
   *  literal node is a type-checked member of a union of string literals (e.g. a string
   *  discriminant) — those are enum-like, not magic values, and are skipped. */
  isUnionDiscriminant?: (node: IrNode) => boolean;
}

type ResolvedOptions = Required<Omit<MeaningDetectorOptions, 'isUnionDiscriminant'>> & {
  isUnionDiscriminant?: (node: IrNode) => boolean;
};

function resolveOptions(options: MeaningDetectorOptions): ResolvedOptions {
  return {
    minCount: options.minCount ?? 5,
    minFiles: options.minFiles ?? 2,
    skipNumbers: options.skipNumbers ?? true,
    skipTrivial: options.skipTrivial ?? true,
    isUnionDiscriminant: options.isUnionDiscriminant,
  };
}

/** Returns true when the literal node should not be considered a magic value. */
function isSkippableLiteral(node: IrNode, opts: ResolvedOptions): boolean {
  if (node.kind !== 'literal') return true;
  const value = node.name.replace(/^['"](.*)['"]$/, '$1');
  if (opts.skipNumbers && /^-?\d+(\.\d+)?$/.test(value)) return true;
  // typed union members (e.g. connascenceType: 'meaning') are discriminants,
  // not magic values — extracting them into constants would lose type safety
  if (opts.isUnionDiscriminant?.(node)) return true;
  // trivial literals: extracting '' or '/' into a named constant is noise —
  // there is no meaning to share beyond "a separator / the empty value"
  if (opts.skipTrivial && value.length < 2) return true;
  return false;
}

function groupLiterals(project: IrProject, opts: ResolvedOptions): Map<string, IrNode[]> {
  const byValue = new Map<string, IrNode[]>();
  for (const node of project.nodes) {
    if (isSkippableLiteral(node, opts)) continue;
    const group = byValue.get(node.name) ?? [];
    group.push(node);
    byValue.set(node.name, group);
  }
  return byValue;
}

function meaningEdges(
  byValue: Map<string, IrNode[]>,
  opts: ResolvedOptions,
): IrProject['edges'] {
  const edges: IrProject['edges'] = [];
  for (const [value, group] of byValue) {
    if (group.length < opts.minCount) continue;
    const files = new Set(group.map((n) => n.location.filePath));
    if (files.size < opts.minFiles) continue;
    edges.push(...edgesForGroup(value, group, files.size));
  }
  return edges;
}

function edgesForGroup(
  value: string,
  group: IrNode[],
  fileCount: number,
): IrProject['edges'] {
  const [first, ...rest] = group;
  return rest.map((other) => ({
    nodeA: first.id,
    nodeB: other.id,
    connascenceType: 'meaning' as const,
    evidence: `magic literal ${value} repeated at ${group.length} call sites across ${fileCount} files (candidate — sites must agree on the same meaning; consider a named constant)`,
  }));
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
  const opts = resolveOptions(options);
  return meaningEdges(groupLiterals(project, opts), opts);
}
