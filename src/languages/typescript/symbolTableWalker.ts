import { Node } from 'ts-morph';
import { IrNode, nextId } from '../../core/ir.js';
import { subtreeHash } from './structureHash.js';
import { buildScopeChain, isDefinitionNode, locationOf, makeReference } from './symbolTableUtils.js';

/**
 * The single-file AST walk that emits IR nodes. Split out of symbolTable.ts
 * to keep both files small; this module owns the mutable walk state.
 */
export interface WalkState {
  nodes: IrNode[];
  refIdToSymbol: Map<string, import('ts-morph').Symbol>;
  defIdToSymbol: Map<string, import('ts-morph').Symbol>;
  symbolToDefId: Map<import('ts-morph').Symbol, string>;
  defIdByTsNode: Map<Node, string>;
  callIdByTsNode: Map<Node, string>;
  handledIdentifiers: Set<Node>;
}

export function newWalkState(): WalkState {
  return {
    nodes: [],
    refIdToSymbol: new Map(),
    defIdToSymbol: new Map(),
    symbolToDefId: new Map(),
    defIdByTsNode: new Map(),
    callIdByTsNode: new Map(),
    handledIdentifiers: new Set(),
  };
}

/** Call sites: a call node parented to its callee reference, argument nodes parented to the call. */
function handleCallLike(node: Node, file: import('ts-morph').SourceFile, state: WalkState): boolean {
  if (!Node.isCallExpression(node) && !Node.isNewExpression(node)) return false;
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
      state.handledIdentifiers.add(callee);
      state.nodes.push(calleeRef.node);
      if (calleeRef.symbol) state.refIdToSymbol.set(calleeRef.node.id, calleeRef.symbol);
      callNode.parentId = calleeRef.node.id;
    }
  }
  state.nodes.push(callNode);
  state.callIdByTsNode.set(node, callNode.id);
  node.getArguments().forEach((arg, index) => {
    state.nodes.push({
      id: nextId('arg'),
      kind: 'argument',
      name: String(index),
      scopePath,
      location: locationOf(arg, file),
      parentId: callNode.id,
    });
  });
  return true;
}

/** the function-like node whose body a structural clone hash is computed over */
function fnLikeFor(node: Node): Node | undefined {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) return node;
  if (
    Node.isVariableDeclaration(node) &&
    node.getInitializer() &&
    Node.isArrowFunction(node.getInitializer()!)
  ) {
    return node.getInitializer()!;
  }
  return undefined;
}

/** True for AST nodes that introduce their own parameter list. */
function isFunctionLike(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  );
}

/**
 * The IR definition that owns a parameter. Resolve the *nearest* function-like
 * AST ancestor rather than the nearest emitted definition: a callback's
 * parameters must not be attributed to the enclosing function, or a narrow
 * function with a wide callback looks wide and Position fires false positives.
 * Callbacks we do not model (bare arrow/function expressions) return undefined.
 */
function parameterOwner(node: Node, state: WalkState): string | undefined {
  let fn: Node | undefined = node.getParent();
  while (fn && !isFunctionLike(fn)) fn = fn.getParent();
  if (!fn) return undefined;
  const direct = state.defIdByTsNode.get(fn);
  if (direct) return direct;
  const parent = fn.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return state.defIdByTsNode.get(parent);
  return undefined;
}

function handleDefinition(node: Node, file: import('ts-morph').SourceFile, state: WalkState): boolean {
  if (!isDefinitionNode(node)) return false;
  const nameNode = node.getNameNode();
  if (!nameNode) return true;
  const defNode: IrNode = {
    id: nextId('def'),
    kind: definitionKind(node),
    name: nameNode.getText(),
    scopePath: buildScopeChain(node, file),
    location: locationOf(node, file),
  };
  state.nodes.push(defNode);
  state.defIdByTsNode.set(node, defNode.id);

  // structural clone hash for function-like definitions
  const fnLike = fnLikeFor(node);
  if (fnLike) defNode.structureHash = subtreeHash(fnLike);
  applyVariableInfo(node, defNode);
  if (Node.isParameterDeclaration(node)) {
    // link the parameter to the function-like definition that owns it; callback
    // parameters (unmodelled arrows) must not leak onto the enclosing function
    defNode.parentId = parameterOwner(node, state);
  }
  const symbol = nameNode.getSymbol();
  if (symbol) {
    state.defIdToSymbol.set(defNode.id, symbol);
    state.symbolToDefId.set(symbol, defNode.id);
  }
  return true;
}

/** mutability + literal initial value for variable declarations (seed of Value/Identity detectors) */
function applyVariableInfo(node: Node, defNode: IrNode): void {
  if (!Node.isVariableDeclaration(node)) return;
  const kind = node.getVariableStatement()?.getDeclarationList().getDeclarationKind();
  defNode.mutable = kind !== 'const';
  const init = node.getInitializer();
  if (init && (Node.isStringLiteral(init) || Node.isNumericLiteral(init))) {
    defNode.initialValue = init.getText();
  }
}

/** Literal call arguments: seed of the Meaning (magic literal) detector. */
function handleLiteral(node: Node, file: import('ts-morph').SourceFile, state: WalkState): boolean {
  if (!Node.isStringLiteral(node) && !Node.isNumericLiteral(node)) return false;
  let ancestor: Node | undefined = node.getParent();
  while (ancestor && !Node.isCallExpression(ancestor) && !Node.isNewExpression(ancestor)) {
    ancestor = ancestor.getParent();
  }
  const callId = ancestor ? state.callIdByTsNode.get(ancestor) : undefined;
  if (callId) {
    state.nodes.push({
      id: nextId('lit'),
      kind: 'literal',
      name: node.getText(),
      scopePath: buildScopeChain(node, file),
      location: locationOf(node, file),
      parentId: callId,
    });
  }
  return true;
}

function handleIdentifier(node: Node, file: import('ts-morph').SourceFile, state: WalkState): boolean {
  if (!Node.isIdentifier(node) || state.handledIdentifiers.has(node)) return false;
  const parent = node.getParent();
  if (parent && isDefinitionNode(parent) && parent.getNameNode() === node) {
    return true; // definition site, handled above
  }
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
    return true; // member access name; handled if we extend the IR later
  }
  const ref = makeReference(node, file);
  if (ref) {
    state.handledIdentifiers.add(node);
    state.nodes.push(ref.node);
    if (ref.symbol) state.refIdToSymbol.set(ref.node.id, ref.symbol);
  }
  return true;
}

/** One visitor over every descendant node; returns true when the node was handled. */
export function visitNode(node: Node, file: import('ts-morph').SourceFile, state: WalkState): void {
  if (
    handleCallLike(node, file, state) ||
    handleDefinition(node, file, state) ||
    handleLiteral(node, file, state) ||
    handleIdentifier(node, file, state)
  ) {
    return;
  }
}

function definitionKind(node: Node): IrNode['kind'] {
  if (Node.isParameterDeclaration(node)) return 'parameter';
  if (Node.isMethodDeclaration(node)) return 'method';
  if (Node.isClassDeclaration(node)) return 'class';
  if (Node.isFunctionDeclaration(node)) return 'function';
  return 'variable';
}
