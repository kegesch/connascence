import { createHash, Hash } from 'node:crypto';
import { Node } from 'ts-morph';

/**
 * Structural subtree hash: kind name of each node plus child hashes.
 * Identifiers and literals are abstracted to their kind only, so two
 * functions with the same shape (different names/literals) hash equally.
 */
export function subtreeHash(node: Node): string {
  const sha = createHash('sha1');
  digestNode(sha, node);
  return sha.digest('hex');
}

function digestNode(sha: Hash, node: Node): void {
  sha.update(node.getKindName());
  // leaf nodes: identifiers/literals contribute only their kind (abstracted)
  if (node.getChildCount() === 0) return;
  if (Node.isIdentifier(node) || Node.isStringLiteral(node) || Node.isNumericLiteral(node)) return;
  node.forEachChild((child) => digestNode(sha, child));
}
