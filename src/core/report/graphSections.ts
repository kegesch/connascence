// Graph-level sections shared by every scan format: Lakos levelization plus
// continuous coupling pressure. Keeping them here prevents the CLI from
// growing one output loop per format.

import type { Levelization } from './levelization.js';
import type { PressureSummary } from '../scoring/score.js';
import { renderLevelization } from './levelizationRender.js';

export function graphSectionLines(
  levelization: Levelization | undefined,
  pressure: PressureSummary | undefined,
  rel: (path: string) => string,
): string[] {
  const lines = renderLevelization(levelization, rel, 5);
  if (pressure) {
    lines.push(
      `coupling pressure: ${pressure.total.toFixed(2)} total, ${pressure.mean.toFixed(3)} mean, ${pressure.max.toFixed(2)} max`,
    );
  }
  return lines;
}
