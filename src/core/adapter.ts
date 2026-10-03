/**
 * Semantic adapter interface — the contract language backends implement so
 * semantic detectors can run without importing language-specific types.
 * A new language means implementing this interface; core never changes.
 */
export interface SemanticAdapter {
  /**
   * Resolve the type of the value a node refers to, as a language-agnostic
   * type name (e.g. "User", "number"). Returns undefined when unknown.
   */
  resolveType(nodeId: string): string | undefined;

  /**
   * True when the literal at the given location is a member of a union of
   * string literals (e.g. a type-checked discriminant like 'read' against
   * type FileMode = 'read' | 'write'). Such literals are enum-like, not
   * magic values, so heuristic detectors should skip them.
   */
  isStringUnionMember(filePath: string, startLine: number, startColumn?: number): boolean;
}
