# Coupling Sensor — Restart Plan

> Fresh start for the connascence tool, rebuilt around one product thesis:
> **a deterministic structural-feedback sensor for AI coding agents.**
> Old repo archived at git tag `archive/pre-restart-2026-10-13`.

## 1. The thesis (and what the evidence says)

AI agents generate code at machine speed and degrade structure silently; tests
verify behavior, not structure. A sensor that measures coupling/structure and
feeds a *diffable, game-resistant* signal back into the agent loop is the
missing piece. Sentrux proved demand (3.3k stars in 8 days) and proved the
death mode (solo sprint + premature monetization). This project takes the
thesis and the packaging, and fixes the engine quality that killed Sentrux's
accuracy.

**Non-goals (learned from Sentrux's death):**
- No monetization infrastructure before retention is proven.
- No TUI/dashboard until the MCP loop is validated.
- No 60-language breadth before 2 languages are excellent.

## 2. Architecture: the quality ladder

Two parsing tiers, **one IR contract**, core never imports from either:

```
tree-sitter syntactic layer   (any language, robust to broken code)
          ↓  emits
         IR   ─────────────── the ONLY contract (src/core/ir.ts)
          ↑  enriches
native semantic layer          (ts-morph for TS; optional, adds resolution)
          ↓
language-agnostic core: graph → detectors → scoring → report/MCP
```

- **Syntactic tier**: tree-sitter grammars + `tags.scm`-style queries → IR
  nodes (functions, classes, variables, calls, references, literals) with
  scope paths, locations, structure hashes, mutability. Works mid-edit,
  works for many languages.
- **Semantic tier**: ts-morph backend (kept from the old repo) *enriches* the
  IR: resolves references instead of name-guessing, fills `resolveType`,
  union membership. Optional per language; findings carry provenance
  (`confidence: 'name-match' | 'type-resolved'`).
- **Rule of layering** (kept verbatim from old AGENTS.md): if core needs a
  language type, extend the IR — never leak.

## 3. What we keep from the old repo

| Asset | Why |
|---|---|
| Layering discipline + IR-as-contract | the whole extensibility story |
| IR shape: `scopePath`, `parentId`, `structureHash`, `mutable`, `initialValue` | each field earns a detector |
| Strength (static table) × locality (scope-ancestor walk) × degree scoring | the genuinely differentiated model; nothing like it in Sentrux-class tools |
| Detectors: **Position, Algorithm (subtree-hash), Name, Identity** | all syntactic or already proven; Identity (mutable module state) is the best heuristic detector — keep as-is |
| Louvain module detection (`louvain.ts`) | strictly better than Sentrux's directory-as-community "modularity" |
| SARIF output, severity, remediation hints | machine + human consumers |
| `diff.ts` baseline diff, `.connascence.yml` gates, exit-code CI gating | the enforcement half of the loop |
| ts-morph backend (adapter, symbol table, structure hashing) | the semantic ceiling |
| Fixture-test discipline (true-positive + true-negative per detector) | non-negotiable quality bar |

## 4. What we take from Sentrux

| Idea | Implementation note |
|---|---|
| **Agent loop as the product**: MCP server (stdio JSON-RPC), `scan` / `session_start` / `session_end` / `health` | copy the tool surface; hand-rolled server is fine (~5 methods) |
| **Session baseline diff**: signal before/after + violation list (new cycles, new god-files, signal drop > threshold) | fix their flaw: persist baseline to disk (`.coupling/baseline.json`), not session memory |
| **One continuous score, geometric mean of root causes** (0–10000 int) | game-resistant: a 0 in any dimension tanks the score; no letter grades (they caused agents to stop at "A") |
| Root-cause metrics: acyclicity (Kosaraju SCC), depth (Lakos levelization), equality (1 − gini of complexity), redundancy (dead + duplicate functions) | replace their modularity (directory-Q) with real Louvain communities |
| Root causes over proxy metrics; assume agents will game proxies | design doc insight — keep |
| What-if simulator (clone graph, move/break-edge, recompute) | cheap, high demo value |
| Evolution metrics via `git2`-style log walk: churn, co-change (temporal) coupling, hotspots, bus factor | temporal coupling pairs beautifully with connascence findings |
| Test-gap heuristic (test files by naming convention + import reach) | optional, late |
| 0-config gate: "accept existing mess as baseline, block *new* decay" | the single biggest adoption unlock |

## 5. What we deliberately discard

- **Type detector (current form)** — `refType === defType` is tautological; it
  re-labels Name edges. Rebuild later around *duplicate structural types* and
  primitive obsession, or drop the type entirely.
- **Value detector** — crude (uppercase-constant same-literal). Demote to
  optional/experimental.
- Heuristic detectors as default output — candidates must be opt-in
  (`--include-heuristics`).
- Sentrux's plugin-checksum stub (never ship unverified dlopen'd grammars),
  name-based call resolution as *findings* (fine for statistics, not for
  accusations), full-graph rebuild on every rescan (persistent cache instead),
  TUI panels, monetization/licensing architecture.

## 6. Detector set (launch)

Syntactic (tree-sitter, any language): Position, Algorithm, Name, Identity,
+ graph metrics (cycles, depth, modularity via Louvain, redundancy, coupling
score = strength × locality aggregation).
Semantic (ts-morph, TS only, enriches confidence): Type-rebuilt (structural
duplication, primitive obsession) — only after MCP loop is validated.

Every heuristic finding ships `evidence` (unchanged rule from old spec).

## 7. Milestones

1. **M1 — IR + TS syntactic adapter** (port symbol table / structure hash;
   tree-sitter mapping to the same IR). Tests: fixtures per detector.
2. **M2 — Core detectors + scoring**: Position, Algorithm, Name, Identity;
   strength × locality × degree; JSON + SARIF output.
3. **M3 — Metrics & gate**: SCC cycles, Lakos depth, Louvain modularity,
   gini equality, redundancy; geometric-mean quality signal; `.yml` config;
   baseline diff; exit-code CI gate.
4. **M4 — MCP server**: scan/health/session_start/session_end/check;
   persistent baseline; run it against real agent sessions for a month —
   **this is the falsifiable experiment** (does the signal change what
   agents ship?).
5. **M5 — Incremental**: persistent content-hash cache (files → IR), graph
   rebuild only over dirty subgraphs.
6. **M6 — Second language** via tree-sitter adapter (Python or Go); prove
   "one adapter, no core changes."
7. **M7** — rebuilt Type detector, what-if, evolution metrics, test gaps.

## 8. Validation gates (per milestone)

- Fixture tests green (TP + TN per detector).
- `scan` on a non-trivial real repo produces findings a senior dev agrees with
  (spot-check ≥ 90% precision on non-heuristic detectors).
- Scan of ~100k LOC TS in < 60s (M3), < 5s incremental (M5).
- M4 exit criteria: ≥ 1 real project, 4 weeks of agent sessions, documented
  cases where the session-diff changed agent behavior. If not → stop or pivot.
