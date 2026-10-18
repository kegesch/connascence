import { Node, SourceFile, Symbol as TsSymbol } from 'ts-morph';
import { IrNode, ScopePathSegment, nextId } from '../../core/ir.js';

/** Shared node classification / positioning helpers for the TypeScript adapter. */

export function makeReference(
  node: Node & { getText(): string },
  file: SourceFile,
): { node: IrNode; symbol: TsSymbol | undefined } | undefined {
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

export function isDefinitionNode(
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

export function locationOf(node: Node, file: SourceFile): IrNode['location'] {
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
export function buildScopeChain(node: Node, file: SourceFile): ScopePathSegment[] {
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
  segments.push({ kind: 'package', name: file.getDirectoryPath() });
  return segments;
}
