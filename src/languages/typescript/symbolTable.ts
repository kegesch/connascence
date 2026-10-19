import { Project, Symbol as TsSymbol } from 'ts-morph';
import { IrProject } from '../../core/ir.js';
import { newWalkState, visitNode } from './symbolTableWalker.js';
import { assignIdentityHashes } from './identity.js';

/**
 * Walks a TypeScript project and builds a table of definitions and references,
 * mapped into the normalized IR. This is the seed of the Name and Position detectors.
 */

export interface SymbolTable {
  project: IrProject;
  /** the underlying ts-morph project, for semantic adapters (never used by core) */
  tsProject: Project;
  /** map from IR reference-node id to the ts-morph symbol it resolves to */
  refIdToSymbol: Map<string, TsSymbol>;
  /** map from IR definition-node id to the ts-morph symbol it declares */
  defIdToSymbol: Map<string, TsSymbol>;
  /** map from reference-node id to the definition-node id it resolves to (internal declarations only) */
  refIdToDefId: Map<string, string>;
}

export function buildSymbolTable(filePathOrGlobs: string[]): SymbolTable {
  const tsProject = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  tsProject.addSourceFilesAtPaths(filePathOrGlobs);

  const state = walkProject(tsProject);
  const refIdToDefId = resolveReferences(state.refIdToSymbol, state.symbolToDefId);
  const project: IrProject = { nodes: state.nodes, edges: [] };
  assignIdentityHashes(project, refIdToDefId);

  return {
    project,
    tsProject,
    refIdToSymbol: state.refIdToSymbol,
    defIdToSymbol: state.defIdToSymbol,
    refIdToDefId,
  };
}

function walkProject(tsProject: Project) {
  const state = newWalkState();
  for (const file of tsProject.getSourceFiles()) {
    file.forEachDescendant((node) => visitNode(node, file, state));
  }
  return state;
}

/** Resolve internal references to definitions via the shared ts-morph symbols. */
function resolveReferences(
  refIdToSymbol: Map<string, TsSymbol>,
  symbolToDefId: Map<TsSymbol, string>,
): Map<string, string> {
  const refIdToDefId = new Map<string, string>();
  for (const [refId, symbol] of refIdToSymbol) {
    const aliased = symbol.getAliasedSymbol() ?? symbol;
    const defId = symbolToDefId.get(aliased) ?? symbolToDefId.get(symbol);
    if (defId) refIdToDefId.set(refId, defId);
  }
  return refIdToDefId;
}
