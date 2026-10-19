import { ArchitectureReport, ClusterCoupling, layering } from './architecture.js';
import { renderLevelization } from './levelizationRender.js';

const COUNT = 5;

/** Minimum aggregate strength for a cross-cluster pair to be reported. */
const MIN_PAIR_STRENGTH = 6;

const fmtPair = (p: ClusterCoupling, rel: (p: string) => string) =>
  `${rel(p.from)} -> ${rel(p.to)}  (${p.edges} edges, weight ${p.weight})`;

function renderVerdict(r: ArchitectureReport): string[] {
  const layers = layering(r);
  if (layers === null) {
    return [
      `verdict: NO layering possible — ${r.cycles.length} dependency cycle(s) and ${r.tangles.length} tangle(s) between ${r.clusters} modules must be broken first`,
    ];
  }
  const structure = r.mismatches.length > 0 ? `, but ${r.mismatches.length} module(s) don't match the folder layout` : '';
  return [`verdict: layered architecture — ${layers.length} layer(s), dependencies point one way only${structure}`];
}

function renderModules(r: ArchitectureReport, rel: (p: string) => string): string[] {
  const lines = [`modules detected (graph communities): ${r.clusters}`];
  for (const mod of r.modules.slice(0, COUNT)) {
    const span = mod.dirs.length > 1 ? ` — spans ${mod.dirs.length} directories` : '';
    lines.push(`  ${rel(mod.name)}  (${mod.files.length} files${span})`);
  }
  if (r.modules.length > COUNT) lines.push(`  ... ${r.modules.length - COUNT} more`);
  return lines;
}

function renderLayering(r: ArchitectureReport, rel: (p: string) => string): string[] {
  const layers = layering(r);
  if (layers === null) return [];
  // layer 1 is the foundation (depends on nothing) — print top of the stack first
  const lines = [`layering (higher layers depend on lower ones):`];
  for (let i = layers.length - 1; i >= 0; i--) {
    const label = i === 0 ? 'foundation' : `layer ${i + 1}`;
    lines.push(`  ${label}: ${layers[i].map(rel).join(', ')}`);
  }
  return lines;
}

function renderTangles(r: ArchitectureReport, rel: (p: string) => string): string[] {
  if (r.tangles.length === 0) return [];
  const lines = [
    `tangles — modules coupled in BOTH directions (each pair is really one module, or needs an interface between them) — ${r.tangles.length}:`,
  ];
  for (const t of r.tangles.slice(0, COUNT)) {
    lines.push(`  ${rel(t.a)} <-> ${rel(t.b)}`);
    lines.push(`    -> ${fmtPair(t.forward, rel)}`);
    lines.push(`    <- ${fmtPair(t.backward, rel)}`);
  }
  if (r.tangles.length > COUNT) lines.push(`  ... ${r.tangles.length - COUNT} more`);
  return lines;
}

function renderCycles(r: ArchitectureReport, rel: (p: string) => string): string[] {
  if (r.cycles.length > 0) {
    const lines = [
      `dependency cycles — no layering can exist while these exist — ${r.cycles.length}:`,
    ];
    for (const c of r.cycles.slice(0, COUNT)) {
      lines.push(`  ${c.map(rel).join(' -> ')}`);
    }
    if (r.cycles.length > COUNT) lines.push(`  ... ${r.cycles.length - COUNT} more`);
    return lines;
  }
  if (r.tangles.length === 0) {
    return ['OK: dependencies between modules are strictly one-way (no tangles, no cycles).'];
  }
  return [];
}

function renderMismatches(r: ArchitectureReport, rel: (p: string) => string): string[] {
  if (r.mismatches.length === 0) return [];
  const lines = [
    `structure mismatches — the graph sees one module, the folders say several (co-locate the files, or split the module) — ${r.mismatches.length}:`,
  ];
  for (const m of r.mismatches.slice(0, COUNT)) {
    lines.push(`  ${rel(m.name)}: ${m.dirs.map(rel).slice(0, 4).join(', ')}${m.dirs.length > 4 ? ', …' : ''}`);
  }
  if (r.mismatches.length > COUNT) lines.push(`  ... ${r.mismatches.length - COUNT} more`);
  return lines;
}

function renderStrongestDeps(r: ArchitectureReport, rel: (p: string) => string): string[] {
  const oneWay = r.dependencies.filter((p) => !r.tangles.some(
    (t) => (t.a === p.from && t.b === p.to) || (t.a === p.to && t.b === p.from),
  ));
  const strongest = oneWay.filter((p) => p.weight >= MIN_PAIR_STRENGTH);
  if (strongest.length === 0) return [];
  const lines = [
    `strongest one-way dependencies (weight >= ${MIN_PAIR_STRENGTH}) — this is your actual architecture story:`,
  ];
  for (const p of strongest.slice(0, COUNT)) {
    lines.push(`  ${fmtPair(p, rel)}`);
  }
  if (strongest.length > COUNT) lines.push(`  ... ${strongest.length - COUNT} more`);
  return lines;
}

/** Human/agent-readable lines for one level's architecture report. */
export function renderArchitecture(r: ArchitectureReport, rel: (p: string) => string): string[] {
  const sections = [
    renderVerdict(r),
    renderModules(r, rel),
    renderLayering(r, rel),
    renderLevelization(r.levelization, rel, COUNT),
    renderTangles(r, rel),
    renderCycles(r, rel),
    renderMismatches(r, rel),
    renderStrongestDeps(r, rel),
  ];
  return sections.flat();
}

/** All hierarchy levels, coarse structure first so the top-level story leads. */
export function renderArchitectureLevels(levels: ArchitectureReport[], rel: (p: string) => string): string[] {
  const lines: string[] = [];
  for (let i = levels.length - 1; i >= 0; i--) {
    const r = levels[i];
    if (i === levels.length - 1 && levels.length > 1) {
      lines.push(`=== top level: ${r.clusters} macro-modules ===`);
    }
    if (i < levels.length - 1 && levels.length > 1) {
      lines.push(`=== submodule level ${i + 1}: structure inside those modules (${r.clusters} modules) — same rules apply ===`);
    }
    lines.push(...renderArchitecture(r, rel));
    lines.push('');
  }
  return lines;
}
