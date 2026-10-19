// Graph-level sections shared by every scan format: Lakos levelization plus
// continuous coupling pressure. Keeping them here prevents the CLI from
// growing one output loop per format.

import type { Levelization } from './levelization.js';
import type { PressureSummary } from '../scoring/score.js';
import type { QualityScore } from '../scoring/quality.js';
import { renderLevelization } from './levelizationRender.js';

export interface GraphSectionOptions {
  levelization?: Levelization;
  pressure?: PressureSummary;
  quality?: QualityScore;
  rel: (path: string) => string;
}

export function graphSectionLines({
  levelization,
  pressure,
  quality,
  rel,
}: GraphSectionOptions): string[] {
  const lines = renderLevelization(levelization, rel, 5);
  if (pressure) {
    lines.push(
      `coupling pressure: ${pressure.total.toFixed(2)} total, ${pressure.mean.toFixed(3)} mean, ${pressure.max.toFixed(2)} max`,
    );
  }
  if (quality) {
    lines.push(`quality score: ${quality.score}/10000 (v${quality.scoreVersion})`);
    lines.push(
      `  ${quality.components.map((c) => `${c.key} ${c.value.toFixed(2)}`).join(' · ')}`,
    );
  }
  return lines;
}
