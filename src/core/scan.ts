import { detectName } from './detectors/name.js';
import { detectPosition } from './detectors/position.js';
import { detectAlgorithm } from './detectors/algorithm.js';
import { detectMeaning } from './detectors/meaning.js';
import { detectIdentity } from './detectors/identity.js';
import { detectValue } from './detectors/value.js';
import { scoreProject, ScanReport } from './scoring/score.js';
import { findFileCycles } from './report/cycles.js';
import { fileLevelization } from './report/levelization.js';
import { globMatch } from './paths.js';
import { IrProject } from './ir.js';
import { SemanticAdapter } from './adapter.js';

/** Drop IR nodes belonging to ignored files (edges referencing them fall away in detectors). */
export function applyIgnores(project: IrProject, ignore: string[] | undefined): void {
  if (!ignore || ignore.length === 0) return;
  project.nodes = project.nodes.filter(
    (n) => !ignore.some((pattern) => globMatch(pattern, n.location.filePath)),
  );
}

/** Everything the scan pipeline needs from a language backend, in IR terms. */
export interface ScanContext {
  project: IrProject;
  /** reference-node id -> definition-node id (internal declarations) */
  refIdToDefId: Map<string, string>;
  adapter: SemanticAdapter;
}

/**
 * Language backend contract: the composition root (CLI) injects the concrete
 * implementation; core never imports from src/languages/.
 */
export interface ScanBackend {
  build(files: string[]): ScanContext;
}

/**
 * Scan pipeline: the injected language backend populates the IR + resolution,
 * and all detectors/scoring consume only the IR (type checks go through
 * SemanticAdapter).
 */
export function scan(
  files: string[],
  config: { ignore?: string[] } = {},
  backend: ScanBackend,
): ScanReport {
  const { project, refIdToDefId, adapter } = backend.build(files);
  applyIgnores(project, config.ignore);
  project.edges = detectName(project, refIdToDefId);
  project.edges.push(...detectPosition(project));
  project.edges.push(...detectAlgorithm(project));
  // Type (current form) is deliberately not part of the default pipeline:
  // PLAN.md §6 — it re-labels name edges via refType === defType and is
  // tautological. It is rebuilt in M7 (duplicate structural types / primitive
  // obsession) or dropped; the module and its fixtures stay for that rebuild.
  project.edges.push(...detectMeaning(project, {
    isUnionDiscriminant: (node) =>
      adapter.isStringUnionMember(
        node.location.filePath,
        node.location.startLine,
        node.location.startColumn,
      ),
  }));
  project.edges.push(...detectIdentity(project));
  project.edges.push(...detectValue(project));
  const report = scoreProject(project);
  // graph-level analyses are computed after scoring: they need resolved edges
  report.cycles = findFileCycles(report.edges);
  report.levelization = fileLevelization(report.edges);
  return report;
}
