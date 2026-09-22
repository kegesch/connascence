import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../../src/core/report/html.ts';
import type { ScanReport } from '../../../src/core/scoring/score.ts';

const report: ScanReport = {
  summary: { algorithm: 2, identity: 1, name: 10 },
  edges: [
    {
      nodeA: { id: 'a', kind: 'function', name: 'Avatar', filePath: 'src/ui/avatar.tsx', startLine: 6 },
      nodeB: { id: 'b', kind: 'function', name: 'CommandList', filePath: 'src/ui/command.tsx', startLine: 62 },
      connascenceType: 'algorithm',
      strength: 5,
      locality: 4,
      degree: 11,
      evidence: 'structurally identical function bodies: "Avatar" and "CommandList" <script>alert(1)</script>',
    },
  ],
};

describe('renderHtml', () => {
  const html = renderHtml(report);

  it('produces a self-contained document', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).not.toMatch(/https?:\/\//); // no external assets
  });

  it('renders summary, findings, and hotspots sections', () => {
    expect(html).toContain('Coupling by type');
    expect(html).toContain('Findings (clustered, worst first)');
    expect(html).toContain('File hotspots');
    expect(html).toContain('data-type="algorithm"');
    expect(html).toContain('data-type="identity"');
  });

  it('escapes evidence text (XSS-safe)', () => {
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('strength badges expose data-strength for filtering', () => {
    expect(html).toContain('data-strength="5"');
  });
});
