import { Project, SourceFile, Node, Symbol as TsSymbol } from 'ts-morph';
import { IrNode, IrProject, ScopePathSegment, nextId } from '../../core/ir';

/**
 * Walks a TypeScript project and builds a table of definitions and references,
 * mapped into the normalized IR. This is the seed of the Name detector.
 */

export interface SymbolTable {
  project: IrProject;
  /** map from IR reference-node id to the ts-morph symbol it resolves to */
  refIdToSymbol: Map<string, TsSymbol>;
}

export function buildSymbolTable(filePathOrGlobs: string[]): SymbolTable {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  project.addSourceFilesAtPaths(filePathOrGlobs);

  const nodes: IrNode[] = [];
  const edges: IrProject['edges'] = [];
  const refIdToSymbol = new Map<string, TsSymbol>();

  for (const file of project.getSourceFiles()) {
    file.forEachDescendant((node) => {
      if (isDefinitionNode(node)) {
        const nameNode = node.getNameNode();
        if (!nameNode) return;
        nodes.push({
          id: nextId('def'),
          kind: definitionKind(node),
          name: nameNode.getText(),
          scopePath: buildScopeChain(node, file),
          location: locationOf(nameNode, file),
        });
        return;
      }

      if (Node.isIdentifier(node)) {
        const parent = node.getParent();
        if (parent && isDefinitionNode(parent) && parent.getNameNode()?.getText() === node.getText()) {
          return; // definition site, handled above
        }
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
          return; // member access name; handled if we extend the IR later
        }
        const symbol = node.getSymbol();
        if (symbol) {
          const irNode: IrNode = {
            id: nextId('ref'),
            kind: 'reference',
            name: node.getText(),
            scopePath: buildScopeChain(node, file),
            location: locationOf(node, file),
          };
          nodes.push(irNode);
          refIdToSymbol.set(irNode.id, symbol);
        }
      }
    });
  }

  return { project: { nodes, edges }, refIdToSymbol };
}

function isDefinitionNode(
  node: Node,
): node is { getNameNode(): Node | undefined; getStartLineNumber(): number; getEndLineNumber(): number } & Node {
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
          ? current.getName()
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
