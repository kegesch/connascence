import { buildSymbolTable } from '../languages/typescript/symbolTable.js';
import { TypeScriptAdapter } from '../languages/typescript/adapter.js';
import { detectName } from './detectors/name.js';
import { detectPosition } from './detectors/position.js';
import { detectAlgorithm } from './detectors/algorithm.js';
import { detectType } from './detectors/type.js';
import { detectMeaning } from './detectors/meaning.js';
import { scoreProject, ScanReport } from './scoring/score.js';

/**
 * Scan pipeline: the language adapter populates the IR + resolution, and all
 * detectors/scoring consume only the IR (type checks go through SemanticAdapter).
 * NOTE: scan() currently hard-codes the TypeScript backend; the glob source
 * decides the language once a second adapter exists.
 */
export function scan(files: string[]): ScanReport {
  const table = buildSymbolTable(files);
  const project = table.project;
  const adapter = new TypeScriptAdapter(table);
  project.edges = detectName(project, table.refIdToDefId);
  project.edges.push(...detectPosition(project));
  project.edges.push(...detectAlgorithm(project));
  project.edges.push(...detectType(project, adapter));
  project.edges.push(...detectMeaning(project));
  return scoreProject(project);
}
