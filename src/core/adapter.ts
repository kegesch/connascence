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
}
