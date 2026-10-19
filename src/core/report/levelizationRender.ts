// One renderer for both levelization scopes: file graph (scan summary/JSON
// companion) and module graph (architecture report). The metric is a depth, so
// the report leads with the maximum level and lists the deepest components.

import type { Levelization } from './levelization.js';

export function renderLevelization(
  levelization: Levelization | undefined,
  rel: (name: string) => string,
  top: number,
): string[] {
  if (!levelization || levelization.depth === 0) return [];
  const listed =
    top > 0 ? levelization.entries.slice(0, top) : levelization.entries;
  const suffix = levelization.entries.length > listed.length ? ', …' : '';
  return [
    `levelization (Lakos dependency-chain depth): depth ${levelization.depth} over ${levelization.components} component(s)${levelization.cyclic ? ' (cycles collapsed)' : ''}`,
    `  deepest: ${listed.map((entry) => `${rel(entry.name)} (${entry.level})`).join(', ')}${suffix}`,
  ];
}
