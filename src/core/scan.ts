import { buildSymbolTable } from '../languages/typescript/symbolTable.js';
import { detectName } from './detectors/name.js';
import { detectPosition } from './detectors/position.js';
import { scoreProject, ScanReport } from './scoring/score.js';

/**
 * Language-agnostic scan pipeline: adapters populate the IR + resolution,
 * detectors and scoring consume only the IR.
 */
export function scan(files: string[]): ScanReport {
  const table = buildSymbolTable(files);
  const project = table.project;
  project.edges = detectName(project, table.refIdToDefId);
  project.edges.push(...detectPosition(project));
  return scoreProject(project);
}
