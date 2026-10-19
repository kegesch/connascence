// Move/rename-stable endpoint identity (PLAN.md §M3a).
//
// The diff used to key edges by (type, file, name), so renaming a function or
// moving a file turned every incident edge into a remove+add pair. Endpoints
// now carry an `identityHash` that survives those edits:
//
//   function/method   structureHash (identifiers abstracted by the walker)
//   parameter         <owner identity>#p<slot>
//   argument          <callee identity>#a<slot>
//   reference         ref@<enclosing definition identity>
//   literal           <enclosing definition identity>#lit:<value>
//
// Everything is derived from the IR + the adapter's reference resolution, so
// this pass stays in the language layer; core only compares the strings.
//
// Ambiguity rule: structureHash abstracts identifiers, so clones hash equally.
// If two definitions share a hash, neither is a reliable identity — using it
// would collapse their edges and hide coupling introduced in the clone. Such
// definitions fall back to the file/name key instead (a rename of a clone is
// rare and costs only a one-off diff). The Algorithm detector still reports
// the duplication from `structureHash`.

import { IrNode, IrProject } from '../../core/ir.js';

type Children = Map<string, IrNode[]>;

function slotOf(siblings: IrNode[] | undefined, node: IrNode, kind: IrNode['kind']): number {
  const list = (siblings ?? []).filter((n) => n.kind === kind);
  list.sort(
    (a, b) => a.location.startLine - b.location.startLine || a.location.startColumn - b.location.startColumn,
  );
  return list.indexOf(node);
}

function childrenByParent(project: IrProject): Children {
  const children: Children = new Map();
  for (const node of project.nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  return children;
}

// Never derive from node ids: ids are scan-order dependent, so they would look
// stable within one scan and change after any edit.

function assignParameter(node: IrNode, byId: Map<string, IrNode>, children: Children): void {
  if (!node.parentId) return;
  const owner = byId.get(node.parentId);
  if (!owner?.identityHash) return;
  node.identityHash = `${owner.identityHash}#p${slotOf(children.get(node.parentId), node, 'parameter')}`;
}

interface IdentityContext {
  byId: Map<string, IrNode>;
  children: Children;
  refIdToDefId: Map<string, string>;
}

function assignArgument(node: IrNode, ctx: IdentityContext): void {
  if (!node.parentId) return;
  const call = ctx.byId.get(node.parentId);
  const defId = call?.parentId ? ctx.refIdToDefId.get(call.parentId) : undefined;
  const def = defId ? ctx.byId.get(defId) : undefined;
  if (!def?.identityHash) return;
  node.identityHash = `${def.identityHash}#a${slotOf(ctx.children.get(node.parentId), node, 'argument')}`;
}

function assignReference(node: IrNode, byId: Map<string, IrNode>): void {
  const owner = node.ownerDefId ? byId.get(node.ownerDefId) : undefined;
  if (owner?.identityHash) node.identityHash = `ref@${owner.identityHash}`;
}

function assignLiteral(node: IrNode, byId: Map<string, IrNode>): void {
  const owner = node.ownerDefId ? byId.get(node.ownerDefId) : undefined;
  const base = owner?.identityHash ?? node.location.filePath;
  node.identityHash = `${base}#lit:${node.name}`;
}

/**
 * Remove identities shared by more than one definition. Keeping them would
 * make a newly added clone-shaped function look like an already-known edge
 * (false negative), which is worse than losing rename stability for clones.
 */
function dropAmbiguousIdentities(project: IrProject): void {
  const groups = new Map<string, IrNode[]>();
  for (const node of project.nodes) {
    if (!node.identityHash) continue;
    const group = groups.get(node.identityHash) ?? [];
    group.push(node);
    groups.set(node.identityHash, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1) for (const node of group) delete node.identityHash;
  }
}

export function assignIdentityHashes(project: IrProject, refIdToDefId: Map<string, string>): void {
  dropAmbiguousIdentities(project);
  const ctx: IdentityContext = {
    byId: new Map(project.nodes.map((n) => [n.id, n])),
    children: childrenByParent(project),
    refIdToDefId,
  };

  for (const node of project.nodes) {
    if (node.identityHash) continue; // function-like defs already carry one
    if (node.kind === 'parameter') assignParameter(node, ctx.byId, ctx.children);
    else if (node.kind === 'argument') assignArgument(node, ctx);
    else if (node.kind === 'reference') assignReference(node, ctx.byId);
    else if (node.kind === 'literal') assignLiteral(node, ctx.byId);
  }
}
