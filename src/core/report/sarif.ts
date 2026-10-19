import { ScoredEdge } from '../scoring/score.js';
import { CONNASCENCE_TYPES, HEURISTIC_TYPES } from '../scoring/score.js';
import { toPosix } from '../paths.js';
import type { FileCycle } from './cycles.js';

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri: string;
  properties: { heuristic: boolean; strength: number };
}

/** SARIF default level by strength: strong coupling is an error, mid is a warning, weak is a note. */
function levelFor(strength: number): 'error' | 'warning' | 'note' {
  if (strength >= 7) return 'error';
  if (strength >= 4) return 'warning';
  return 'note';
}

function relUri(repoRoot: string, filePath: string): string {
  const root = toPosix(repoRoot).replace(/\/$/, '') + '/';
  const file = toPosix(filePath);
  return file.startsWith(root) ? file.slice(root.length) : file;
}

function connascenceRules(): SarifRule[] {
  return CONNASCENCE_TYPES.map((type) => ({
    id: type,
    shortDescription: { text: `Connascence of ${type}` },
    helpUri: `https://connascence.io/${type}`,
    properties: {
      heuristic: HEURISTIC_TYPES.has(type),
      // connascence.io strength ranking, 1 (weakest) .. 9 (strongest)
      strength: ['name', 'type', 'meaning', 'position', 'algorithm', 'execution', 'timing', 'value', 'identity'].indexOf(type) + 1,
    },
  }));
}

function edgeResults(edges: ScoredEdge[], repoRoot: string) {
  return edges.map((e) => ({
    ruleId: e.connascenceType,
    level: levelFor(e.strength),
    message: {
      text: `${e.evidence} [strength=${e.strength}, locality=${e.locality}, degree=${e.degree}]`,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: relUri(repoRoot, e.nodeA.filePath) },
          region: { startLine: e.nodeA.startLine },
        },
      },
      {
        physicalLocation: {
          artifactLocation: { uri: relUri(repoRoot, e.nodeB.filePath) },
          region: { startLine: e.nodeB.startLine },
        },
      },
    ],
    partialFingerprints: { endpointB: `${relUri(repoRoot, e.nodeB.filePath)}#${e.nodeB.name}` },
  }));
}

function cycleResults(cycles: FileCycle[], repoRoot: string) {
  return cycles.map((c) => ({
    ruleId: 'cycle',
    level: 'error' as const,
    message: {
      text: `resolved dependency cycle across ${c.files.length} files: ${c.files.map((f) => relUri(repoRoot, f)).join(' -> ')}`,
    },
    locations: c.members.map((m) => ({
      physicalLocation: {
        artifactLocation: { uri: relUri(repoRoot, m.filePath) },
        region: { startLine: m.startLine },
      },
    })),
    partialFingerprints: { cycle: c.files.map((f) => relUri(repoRoot, f)).join('|') },
  }));
}

export interface SarifOptions {
  edges: ScoredEdge[];
  repoRoot: string;
  cycles?: FileCycle[];
  toolVersion?: string;
}

/**
 * SARIF 2.1.0 output — the standard for code-quality tooling, ingested by
 * GitHub code scanning, Azure DevOps, ESLint/Sarif viewers, etc.
 * One rule per connascence type plus cycle (SCC); one result per edge/cycle.
 */
export function renderSarif({ edges, repoRoot, cycles = [], toolVersion = '0.1.0' }: SarifOptions): string {
  const rules: SarifRule[] = [
    ...connascenceRules(),
    // not a connascence type: strength 0 keeps the rule shape uniform
    {
      id: 'cycle',
      shortDescription: { text: 'Dependency cycle (SCC)' },
      helpUri: 'https://connascence.io/algorithm',
      properties: { heuristic: false, strength: 0 },
    },
  ];
  const results = [...edgeResults(edges, repoRoot), ...cycleResults(cycles, repoRoot)];

  return JSON.stringify(
    {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'connascence',
              version: toolVersion,
              informationUri: 'https://connascence.io',
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}
