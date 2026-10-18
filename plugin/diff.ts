// Crude session diff (M0). Edge keying deliberately mirrors the engine's
// diff.ts key — (type, file, name) pairs — whose rename/move blindness is a
// known flaw the plan schedules for replacement in M3a (structureHash keys +
// move detection). Recording behavior against this key is part of the M0
// experiment: if refactors storm the diff, that is M3a requirement evidence.

import { EngineEdge } from './engine.js';

const toPosix = (p: string): string => p.replace(/\\/g, '/');

export function edgeKey(e: Pick<EngineEdge, 'connascenceType' | 'nodeA' | 'nodeB'>): string {
  return [
    e.connascenceType,
    toPosix(e.nodeA.filePath),
    e.nodeA.name,
    toPosix(e.nodeB.filePath),
    e.nodeB.name,
  ].join('|');
}

export interface EdgeDiff {
  added: EngineEdge[];
  removed: EngineEdge[];
}

export function diffEdges(before: EngineEdge[], after: EngineEdge[]): EdgeDiff {
  const beforeKeys = new Set(before.map(edgeKey));
  const afterKeys = new Set(after.map(edgeKey));
  return {
    added: after.filter((e) => !beforeKeys.has(edgeKey(e))),
    removed: before.filter((e) => !afterKeys.has(edgeKey(e))),
  };
}
