import { ScanReport } from '../scoring/score.js';
import { clusterFindings, fileHotspots, Finding } from './findings.js';

const TYPE_COLORS: Record<string, string> = {
  name: '#6b7280',
  type: '#0ea5e9',
  meaning: '#f59e0b',
  position: '#8b5cf6',
  algorithm: '#ef4444',
  execution: '#14b8a6',
  timing: '#ec4899',
  value: '#84cc16',
  identity: '#f97316',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bar(count: number, max: number, color: string): string {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return `<div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div><span>${count}</span></div>`;
}

function strengthBadge(s: number): string {
  // 1..9 -> green..red heat
  const hue = 120 - ((s - 1) / 8) * 120;
  return `<span class="badge" style="background:hsl(${hue},70%,45%)">S${s}</span>`;
}

function findingRow(f: Finding, index: number): string {
  const color = TYPE_COLORS[f.kind] ?? '#666';
  const members = f.members
    .slice(0, 8)
    .map(
      (m) =>
        `<li><code>${esc(shortPath(m.filePath))}:${m.startLine}</code> <span class="muted">${esc(m.name)}</span></li>`,
    )
    .join('');
  const more = f.members.length > 8 ? `<li class="muted">… ${f.members.length - 8} more</li>` : '';
  return `<tr class="finding" data-type="${esc(f.kind)}" data-strength="${f.worst.strength}">
    <td class="collapse">▸</td>
    <td>${strengthBadge(f.worst.strength)}</td>
    <td><span class="pill" style="background:${color}">${esc(f.kind)}</span></td>
    <td><div>${esc(f.summary)}</div>
      <ul class="members hidden">${members}${more}</ul></td>
    <td class="num">${f.edgeCount}</td>
    <td class="num">${f.members.length}</td>
  </tr>`;
}

function shortPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^.*\/(src|lib|app)\//, '$1/');
}

/**
 * Self-contained HTML report (inline CSS/JS, no external assets).
 * Shows: summary bars, clustered findings with expandable members,
 * file hotspots, and filter controls by type/strength.
 */
export function renderHtml(report: ScanReport): string {
  const findings = clusterFindings(report.edges);
  const hotspots = fileHotspots(report.edges).slice(0, 25);
  const maxTypeCount = Math.max(...Object.values(report.summary), 1);
  const maxHotspot = Math.max(...hotspots.map((h) => h.edgeCount), 1);
  const types = Object.keys(TYPE_COLORS);

  const summaryBars = types
    .filter((t) => (report.summary[t] ?? 0) > 0)
    .map(
      (t) => `<div class="row" data-type="${t}">
        <span class="pill" style="background:${TYPE_COLORS[t]}">${t}</span>
        ${bar(report.summary[t] ?? 0, maxTypeCount, TYPE_COLORS[t])}
      </div>`,
    )
    .join('');

  const hotspotRows = hotspots
    .map(
      (h) => `<tr>
      <td><code>${esc(shortPath(h.filePath))}</code></td>
      <td style="width:40%">${bar(h.edgeCount, maxHotspot, '#3b82f6')}</td>
      <td class="num">${h.maxDegree}</td>
      <td>${strengthBadge(h.worstStrength)}</td>
    </tr>`,
    )
    .join('');

  const findingRows = findings.map(findingRow).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>connascence report</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 72rem; padding: 0 1rem; line-height: 1.45; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: .3rem; }
  .row { display: flex; align-items: center; gap: .6rem; margin: .25rem 0; }
  .bar { flex: 1; background: #8882; border-radius: 4px; position: relative; height: 1.1rem; display:flex; align-items:center; }
  .fill { height: 100%; border-radius: 4px; min-width: 2px; }
  .bar span { position: absolute; right: .4rem; font-size: .75rem; font-weight: 600; color: #fff; text-shadow: 0 0 3px #0008; }
  .pill { color: #fff; border-radius: 999px; padding: .1rem .55rem; font-size: .72rem; font-weight: 700; text-transform: uppercase; }
  .badge { color: #fff; border-radius: 4px; padding: .05rem .35rem; font-size: .72rem; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  td, th { text-align: left; padding: .3rem .5rem; border-bottom: 1px solid #8883; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  code { font-family: ui-monospace, monospace; font-size: .8rem; background: #8882; padding: 0 .25rem; border-radius: 3px; }
  .muted { opacity: .6; font-size: .8em; }
  .collapse { cursor: pointer; width: 1.2rem; color: #888; user-select: none; }
  .members { margin: .4rem 0 0; padding-left: 1.2rem; }
  .hidden { display: none; }
  tr.finding:hover { background: #8881; }
  .controls { display: flex; gap: .5rem; flex-wrap: wrap; margin: .8rem 0; align-items: center; }
  .controls select, .controls input { padding: .25rem .4rem; }
  .meta { color: #888; font-size: .8rem; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e6e6e6; } }
</style>
</head>
<body>
<h1>Connascence Report</h1>
<p class="meta">${report.edges.length} edges · ${findings.length} clustered findings · generated by connascence scan</p>

<h2>Coupling by type (total edges)</h2>
<div class="chart">${summaryBars}</div>

<h2>Findings (clustered, worst first)</h2>
<div class="controls">
  <label>type <select id="f-type"><option value="">all</option>${types.map((t) => `<option>${t}</option>`).join('')}</select></label>
  <label>min strength <select id="f-strength"><option value="">any</option>${[9,8,7,6,5,4,3,2,1].map((s) => `<option>${s}</option>`).join('')}</select></label>
  <label>search <input id="f-search" placeholder="file or text…"></label>
  <span class="meta" id="f-count"></span>
</div>
<table id="findings">
  <thead><tr><th></th><th>strength</th><th>type</th><th>finding</th><th class="num">edges</th><th class="num">members</th></tr></thead>
  <tbody>${findingRows}</tbody>
</table>

<h2>File hotspots (top ${hotspots.length})</h2>
<table>
  <thead><tr><th>file</th><th>edges</th><th class="num">max degree</th><th>worst strength</th></tr></thead>
  <tbody>${hotspotRows}</tbody>
</table>

<script>
  // expand/collapse member lists
  document.querySelectorAll('tr.finding').forEach(function (tr) {
    tr.querySelector('.collapse').addEventListener('click', function () {
      var ul = tr.querySelector('.members');
      ul.classList.toggle('hidden');
      tr.querySelector('.collapse').textContent = ul.classList.contains('hidden') ? '▸' : '▾';
    });
  });
  // filters
  function applyFilters() {
    var type = document.getElementById('f-type').value;
    var minS = Number(document.getElementById('f-strength').value || 0);
    var q = document.getElementById('f-search').value.toLowerCase();
    var shown = 0;
    document.querySelectorAll('tr.finding').forEach(function (tr) {
      var ok = (!type || tr.dataset.type === type) && (!minS || Number(tr.dataset.strength) >= minS);
      if (ok && q) ok = tr.textContent.toLowerCase().includes(q);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    document.getElementById('f-count').textContent = shown + ' shown';
  }
  ['f-type', 'f-strength', 'f-search'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', applyFilters);
    document.getElementById(id).addEventListener('change', applyFilters);
  });
  applyFilters();
</script>
</body>
</html>`;
}
