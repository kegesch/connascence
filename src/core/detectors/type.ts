import { IrProject } from '../ir.js';
import { SemanticAdapter } from '../adapter.js';

const PRIMITIVES = new Set([
  'number', 'string', 'boolean', 'any', 'unknown', 'void', 'never', 'null', 'undefined', 'symbol', 'bigint', 'object',
]);

export interface TypeDetectorOptions {
  /** skip references whose type is a primitive — coupling to a primitive type is weak. Default true. */
  skipPrimitives?: boolean;
  /** only flag value flows across module boundaries. Default true. */
  crossModuleOnly?: boolean;
}

function isPrimitive(typeName: string): boolean {
  const base = typeName.split('<')[0].replace(/import\(".*?"\)\./, '').trim();
  if (PRIMITIVES.has(base)) return true;
  const parts = typeName.split(/\s*\|\s*/);
  return parts.length > 1 && parts.every((t) => PRIMITIVES.has(t));
}

/** Function-typed flows are already covered by name/algorithm coupling; skip them. */
function isFunctionType(typeName: string): boolean {
  return typeName.startsWith('(') || typeName.includes('=>') || /^typeof\s/.test(typeName);
}

type ResolvedTypeOptions = Required<TypeDetectorOptions>;

function resolveOptions(options: TypeDetectorOptions): ResolvedTypeOptions {
  return {
    skipPrimitives: options.skipPrimitives ?? true,
    crossModuleOnly: options.crossModuleOnly ?? true,
  };
}

function isCrossModule(
  edge: IrProject['edges'][number],
  byId: Map<string, IrProject['nodes'][number]>,
): boolean {
  const a = byId.get(edge.nodeA);
  const b = byId.get(edge.nodeB);
  return !!a && !!b && a.location.filePath !== b.location.filePath;
}

/** True when a name edge should not produce a type edge. */
function shouldSkipEdge(
  edge: IrProject['edges'][number],
  byId: Map<string, IrProject['nodes'][number]>,
  adapter: SemanticAdapter,
  opts: ResolvedTypeOptions,
): boolean {
  if (edge.connascenceType !== 'name') return true;
  if (opts.crossModuleOnly && !isCrossModule(edge, byId)) return true;
  const refType = adapter.resolveType(edge.nodeA);
  const defType = adapter.resolveType(edge.nodeB);
  if (!refType || !defType || refType !== defType) return true;
  if (opts.skipPrimitives && (isPrimitive(refType) || isFunctionType(refType))) return true;
  return false;
}

/**
 * Connascence of Type: for each name edge (a value flow between a reference and
 * its definition), resolve the type at both ends; when the flow hard-couples
 * both ends to a concrete non-primitive type, flag it.
 * Uses only the SemanticAdapter interface — no language types.
 */
export function detectType(
  project: IrProject,
  adapter: SemanticAdapter,
  options: TypeDetectorOptions = {},
): IrProject['edges'] {
  const opts = resolveOptions(options);
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  const edges: IrProject['edges'] = [];

  for (const edge of project.edges) {
    if (shouldSkipEdge(edge, byId, adapter, opts)) continue;
    const refType = adapter.resolveType(edge.nodeA);
    const def = byId.get(edge.nodeB);
    edges.push({
      nodeA: edge.nodeA,
      nodeB: edge.nodeB,
      connascenceType: 'type',
      evidence: `value flow hard-couples both ends to type "${refType}" (${def?.name} at ${def?.location.filePath}:${def?.location.startLine})`,
    });
  }
  return edges;
}
