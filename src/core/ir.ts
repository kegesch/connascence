// Normalized IR — the only contract between the language-specific layer
// (src/languages/<lang>/) and the language-agnostic core (src/core/).
// Nothing in src/core/ may import language-specific types; if a downstream
// consumer needs more information, extend the IR here.

export type ConnascenceType =
  | 'name'
  | 'type'
  | 'meaning'
  | 'position'
  | 'algorithm'
  | 'execution'
  | 'timing'
  | 'value'
  | 'identity';

export type ScopeKind = 'function' | 'class' | 'module' | 'package';

export interface ScopePathSegment {
  kind: ScopeKind;
  name: string;
}

/** Location of an IR node within a source file. Lines and columns are 1-based. */
export interface SourceLocation {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type IrNodeKind =
  | 'function'
  | 'class'
  | 'method'
  | 'variable'
  | 'parameter'
  | 'property'
  | 'argument'
  | 'reference'
  | 'literal';

export interface IrNode {
  id: string;
  kind: IrNodeKind;
  name: string;
  /** Enclosing scope chain, innermost first, e.g. [function foo, class Bar, module src/a.ts]. */
  scopePath: ScopePathSegment[];
  location: SourceLocation;
}

export interface IrEdge {
  /** id of node A (as it appears in IrProject.nodes) */
  nodeA: string;
  nodeB: string;
  connascenceType: ConnascenceType;
  /** Human-readable explanation of why this coupling was flagged. Required for heuristic detectors. */
  evidence: string;
}

export interface IrProject {
  nodes: IrNode[];
  edges: IrEdge[];
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
