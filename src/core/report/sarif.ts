import { ScoredEdge } from '../scoring/score.js';
import { HEURISTIC_TYPES } from '../diff.js';

const CONNASCENCE_TYPES = ['name', 'type', 'meaning', 'position', 'algorithm', 'execution', 'timing', 'value', 'identity'] as const;

/** SARIF default level by strength: strong coupling is an error, mid is a warning, weak is a note. */
function levelFor(strength: number): 'error' | 'warning' | 'note' {
  if (strength >= 7) return 'error';
  if (strength >= 4) return 'warning';
  return 'note';
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function relUri(repoRoot: string, filePath: string): string {
  const root = toPosix(repoRoot).replace(/\/$/, '') + '/';
  const file = toPosix(filePath);
  return file.startsWith(root) ? file.slice(root.length) : file;
}

/**
 * SARIF 2.1.0 output — the standard for code-quality tooling, ingested by
 * GitHub code scanning, Azure DevOps, ESLint/Sarif viewers, etc.
 * One rule per connascence type; one result per edge.
 */
export function renderSarif(edges: ScoredEdge[], repoRoot: string, toolVersion = '0.1.0'): string {
  const rules = CONNASCENCE_TYPES.map((type) => ({
    id: type,
    shortDescription: { text: `Connascence of ${type}` },
    helpUri: `https://connascence.io/${type}`,
    properties: {
      heuristic: HEURISTIC_TYPES.has(type),
      // connascence.io strength ranking, 1 (weakest) .. 9 (strongest)
      strength: ['name', 'type', 'meaning', 'position', 'algorithm', 'execution', 'timing', 'value', 'identity'].indexOf(type) + 1,
    },
  }));

  const results = edges.map((e) => ({
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
