# AGENTS.md

Instructions for any coding agent working in this repository. Read this before making changes. The full design rationale lives in `connascence-tool-spec.md` at the repo root — read that first for *why*, this file is for *how to work here*.

## What this project is

A CLI (`connascence`) that statically measures connascence (coupling) in a codebase, per the taxonomy at connascence.io: Name, Type, Position, Meaning, Algorithm, Execution, Timing, Value, Identity. MVP target language is TypeScript/JavaScript. The tool itself is written in TypeScript.

## Non-negotiable architecture rule

The codebase has a strict layering boundary:

```
language-specific layer  →  normalized IR  →  language-agnostic core
```

- Only code under `src/languages/<lang>/` may import `ts.Node`, `ts-morph` types, tree-sitter nodes, or any other language-specific AST/API.
- Everything under `src/core/` (graph construction, detectors' shared logic, strength/locality/degree scoring, CLI, reporting) must operate **only** on the normalized IR types defined in `src/core/ir.ts` (`Node`, `Edge`).
- If a change to `src/core/` requires importing something language-specific, stop and flag it — it means the IR is missing a field, and the fix is to extend the IR, not to leak a language type into core.

This rule exists so a second language can be added later by writing one adapter, without touching detectors, scoring, or the CLI. Do not compromise it for convenience.

## Repo layout (target)

```
src/
  core/
    ir.ts              # Node, Edge, and all shared types — the only contract between layers
    graph.ts           # builds the connascence graph from IR nodes/edges
    detectors/         # one file per connascence type, pure functions: (graph) -> Edge[]
    scoring/
      strength.ts       # static lookup table per connascence type
      locality.ts       # scope-distance via nearest-common-ancestor walk
      degree.ts          # edge count per node per type
    report/            # JSON / HTML / console renderers
    cli.ts             # command parsing and orchestration
  languages/
    typescript/
      adapter.ts        # implements the semantic adapter interface, backed by ts-morph
      symbolTable.ts     # walks the project, builds definition/reference table
      toIR.ts            # maps ts-morph nodes/symbols into src/core/ir.ts types
tests/
  fixtures/             # small real-world-ish TS projects used as detector test inputs
  core/
  languages/typescript/
connascence-tool-spec.md
AGENTS.md
.connascence.yml.example
```

## Build order — work through in this sequence

Do not skip ahead to semantic detectors before the syntactic ones are solid; each stage's tests should pass before starting the next.

1. IR types (`src/core/ir.ts`) + TypeScript symbol table (`src/languages/typescript/symbolTable.ts`).
2. Detectors: **Position**, then **Algorithm** (subtree-hash clone detection — prefer an existing clone-detection library over a hand-rolled one) — both syntax-only, no semantic adapter needed yet.
3. Detector: **Name** — built directly from the symbol table's reference edges.
4. Scoring: locality (scope-ancestor walk) + degree (edge counting). Strength is a static table, not computed.
5. Minimal CLI: `connascence scan <path>` → JSON output only. Get this running against a real fixture project before adding more detectors.
6. Semantic adapter interface (`resolveType` / `findReferences` / `getScope`) + **Type** detector via the TS Compiler API's `TypeChecker`.
7. **Meaning**, **Value**, **Identity** — heuristic candidate generation; flag candidates rather than asserting certainty (these are expected to have false positives).
8. **Execution**, **Timing** — lowest priority, build last.
9. `.connascence.yml` config + `connascence diff` for CI gating.

## Detector conventions

- Every detector is a pure function: `(project: IRProject) => Edge[]`. No side effects, no I/O.
- Every detector ships with fixture-based tests under `tests/fixtures/` — a small TS file demonstrating the coupling, plus an assertion on the exact edges expected. Don't approve a detector without at least one true-positive and one true-negative fixture.
- A detector that returns instances with confidence below certainty (Meaning, Value, Identity, Execution, Timing) must attach an `evidence` string to each edge explaining why it was flagged — this is required, not optional, since these are exactly the detectors reviewers will need to sanity-check.

## Testing & commands

- Run tests: `npm test`
- Run the CLI against a fixture during development: `npm run cli -- scan tests/fixtures/<name>`
- Every new detector or IR change needs a corresponding test before it's considered done — do not add detector logic without fixtures.

## What "done" looks like for a milestone

A build-order step (above) is complete when:
- its tests pass,
- `connascence scan` runs end-to-end on at least one non-trivial fixture and produces sensible output for the newly added detector,
- no language-specific type has leaked into `src/core/`.

## Style

- TypeScript, strict mode on.
- Prefer explicit, narrow types in the IR over `any`/`unknown` escape hatches — the IR is the one place precision matters most, since every downstream consumer trusts its shape.
- Keep detector files small and single-purpose (one connascence type per file) — do not combine multiple detectors "for efficiency."
