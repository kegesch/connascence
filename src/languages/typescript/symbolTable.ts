import { Project, SourceFile, Node, Symbol as TsSymbol } from 'ts-morph';
import { IrNode, IrProject, ScopePathSegment, nextId } from '../../core/ir.js';

/**
 * Walks a TypeScript project and builds a table of definitions and references,
 * mapped into the normalized IR. This is the seed of the Name and Position detectors.
 */

export interface SymbolTable {
  project: IrProject;
  /** map from IR reference-node id to the ts-morph symbol it resolves to */
  refIdToSymbol: Map<string, TsSymbol>;
  /** map from IR definition-node id to the ts-morph symbol it declares */
  defIdToSymbol: Map<string, TsSymbol>;
  /** map from reference-node id to the definition-node id it resolves to (internal declarations only) */
  refIdToDefId: Map<string, string>;
}

export function buildSymbolTable(filePathOrGlobs: string[]): SymbolTable {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  project.addSourceFilesAtPaths(filePathOrGlobs);

  const nodes: IrNode[] = [];
  const refIdToSymbol = new Map<string, TsSymbol>();
  const defIdToSymbol = new Map<string, TsSymbol>();
  const symbolToDefId = new Map<TsSymbol, string>();
  const defIdByTsNode = new Map<Node, string>();
  const handledIdentifiers = new Set<Node>();

  for (const file of project.getSourceFiles()) {
    file.forEachDescendant((node) => {
      // Call sites: a call node parented to its callee reference, argument nodes parented to the call.
      if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
        const scopePath = buildScopeChain(node, file);
        const callNode: IrNode = {
          id: nextId('call'),
          kind: 'call',
          name: node.getExpression().getText(),
          scopePath,
          location: locationOf(node, file),
        };
        const callee = node.getExpression();
        if (Node.isIdentifier(callee)) {
          const calleeRef = makeReference(callee, file);
          if (calleeRef) {
            handledIdentifiers.add(callee);
            nodes.push(calleeRef.node);
            if (calleeRef.symbol) refIdToSymbol.set(calleeRef.node.id, calleeRef.symbol);
            callNode.parentId = calleeRef.node.id;
          }
        }
        nodes.push(callNode);
        node.getArguments().forEach((arg, index) => {
          nodes.push({
            id: nextId('arg'),
            kind: 'argument',
            name: String(index),
            scopePath,
            location: locationOf(arg, file),
            parentId: callNode.id,
          });
        });
        return;
      }

      if (isDefinitionNode(node)) {
        const nameNode = node.getNameNode();
        if (!nameNode) return;
        const defNode: IrNode = {
          id: nextId('def'),
          kind: definitionKind(node),
          name: nameNode.getText(),
          scopePath: buildScopeChain(node, file),
          location: locationOf(nameNode, file),
        };
        nodes.push(defNode);
        defIdByTsNode.set(node, defNode.id);
        if (Node.isParameterDeclaration(node)) {
          // link the parameter to its enclosing function/method definition
          let ancestor: Node | undefined = node.getParent();
          while (ancestor) {
            const ownerId = defIdByTsNode.get(ancestor);
            if (ownerId) {
              defNode.parentId = ownerId;
              break;
            }
            ancestor = ancestor.getParent();
          }
        }
        const symbol = nameNode.getSymbol();
        if (symbol) {
          defIdToSymbol.set(defNode.id, symbol);
          symbolToDefId.set(symbol, defNode.id);
        }
        return;
      }

      if (Node.isIdentifier(node) && !handledIdentifiers.has(node)) {
        const parent = node.getParent();
        if (parent && isDefinitionNode(parent) && parent.getNameNode() === node) {
          return; // definition site, handled above
        }
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
          return; // member access name; handled if we extend the IR later
        }
        const ref = makeReference(node, file);
        if (ref) {
          handledIdentifiers.add(node);
          nodes.push(ref.node);
          if (ref.symbol) refIdToSymbol.set(ref.node.id, ref.symbol);
        }
      }
    });
  }

  // Resolve internal references to definitions.
  const refIdToDefId = new Map<string, string>();
  for (const [refId, symbol] of refIdToSymbol) {
    const defId = symbolToDefId.get(symbol.getAliasedSymbol() ?? symbol) ?? symbolToDefId.get(symbol);
    if (defId) refIdToDefId.set(refId, defId);
  }

  return {
    project: { nodes, edges: [] },
    refIdToSymbol,
    defIdToSymbol,
    refIdToDefId,
  };
}

function makeReference(node: Node & { getText(): string }, file: SourceFile): { node: IrNode; symbol: TsSymbol | undefined } | undefined {
  const symbol = node.getSymbol();
  return {
    node: {
      id: nextId('ref'),
      kind: 'reference',
      name: node.getText(),
      scopePath: buildScopeChain(node, file),
      location: locationOf(node, file),
    },
    symbol,
  };
}

function isDefinitionNode(
  node: Node,
): node is { getNameNode(): Node | undefined } & Node {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isClassDeclaration(node) ||
    Node.isVariableDeclaration(node) ||
    Node.isParameterDeclaration(node)
  );
}

function definitionKind(node: Node): IrNode['kind'] {
  if (Node.isParameterDeclaration(node)) return 'parameter';
  if (Node.isMethodDeclaration(node)) return 'method';
  if (Node.isClassDeclaration(node)) return 'class';
  if (Node.isFunctionDeclaration(node)) return 'function';
  return 'variable';
}

function locationOf(node: Node, file: SourceFile): IrNode['location'] {
  const start = file.getLineAndColumnAtPos(node.getStart());
  const end = file.getLineAndColumnAtPos(node.getEnd());
  return {
    filePath: file.getFilePath(),
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

/** Enclosing scope chain, innermost first, ending with the module segment. */
function buildScopeChain(node: Node, file: SourceFile): ScopePathSegment[] {
  const segments: ScopePathSegment[] = [];
  let current: Node | undefined = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isMethodDeclaration(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current)
    ) {
      const name =
        (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)) && current.getName()
          ? current.getName()!
          : '<anonymous>';
      segments.push({ kind: 'function', name });
    } else if (Node.isClassDeclaration(current) || Node.isClassExpression(current)) {
      segments.push({ kind: 'class', name: current.getName() ?? '<anonymous>' });
    }
    current = current.getParent();
  }
  segments.push({ kind: 'module', name: file.getFilePath() });
  return segments;
}
