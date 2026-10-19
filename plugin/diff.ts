// Session diff keying (M3a). Endpoints contributed by the engine carry a
// move/rename-stable identityHash (function structure hash, owner+slot for
// parameters/arguments, enclosing definition for references/literals), so a
// rename or file move no longer turns every incident edge into an add. Nodes
// the adapter cannot identify fall back to the old (type, file, name) key.
//
// Known limitation: structurally identical functions share an identity, so
// edges between clones collapse into one key (documented in PLAN.md).

import { EngineEdge } from './engine.js';

const toPosix = (p: string): string => p.replace(/\\/g, '/');

type Endpoint = Pick<EngineEdge, 'nodeA' | 'nodeB'>['nodeA'];

function endpointKey(n: Endpoint): string {
  if (n.identityHash) return `i:${n.kind}:${n.identityHash}`;
  return `p:${toPosix(n.filePath)}:${n.name}`;
}

export function edgeKey(e: Pick<EngineEdge, 'connascenceType' | 'nodeA' | 'nodeB'>): string {
  return [e.connascenceType, endpointKey(e.nodeA), endpointKey(e.nodeB)].join('|');
}

export interface EdgeDiff {
  added: EngineEdge[];
  removed: EngineEdge[];
}

/** Added edges given only baseline keys (a persisted baseline drops full edges). */
export function diffAdded(beforeKeys: Iterable<string>, after: EngineEdge[]): EngineEdge[] {
  const keys = beforeKeys instanceof Set ? beforeKeys : new Set(beforeKeys);
  return after.filter((e) => !keys.has(edgeKey(e)));
}

export function diffEdges(before: EngineEdge[], after: EngineEdge[]): EdgeDiff {
  const beforeKeys = new Set(before.map(edgeKey));
  const afterKeys = new Set(after.map(edgeKey));
  return {
    added: after.filter((e) => !beforeKeys.has(edgeKey(e))),
    removed: before.filter((e) => !afterKeys.has(edgeKey(e))),
  };
}
