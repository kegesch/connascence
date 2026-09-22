# connascence

A CLI that statically measures **connascence** (coupling, per [connascence.io](https://connascence.io)) in a TypeScript/JavaScript codebase: it detects coupling between code entities, classifies it by type, and scores each instance on **strength**, **locality**, and **degree** to produce a ranked, actionable report.

Architecture is language-agnostic: language-specific code lives only under `src/languages/` and populates a normalized IR (`src/core/ir.ts`); detectors, scoring, and the CLI (`src/core/`) never import language-specific types. See `AGENTS.md` and `connascence-tool-spec.md` for design rationale.

## Install / build

```bash
npm install
npm run build          # tsc -> dist/
npm test               # vitest
```

## Usage

```
npm run cli -- scan <path-glob...> [options]
npm run cli -- explain <path-glob...> -- <file>:<line>
npm run cli -- diff <path-glob...> --repo=<repo> --base=<gitref> [--head=<gitref>] [options]
```

(`npm run cli` rebuilds and runs `dist/core/cli.js`; pass args after `--`.)

### `scan` options

| Option | Meaning |
|---|---|
| `--format=summary` | (default) type totals + top edges |
| `--format=findings` | clustered findings (clone groups, meaning clusters, shared mutable vars) + file hotspot table |
| `--format=json` | full machine-readable JSON on stdout |
| `--format=html` | self-contained interactive HTML report (summary bars, filterable findings, hotspots) |
| `--format=agent` | (diff only) compact one-line-per-finding feedback for AI agents / harnesses |
| `--out=<file>` | write JSON or HTML to file in UTF-8 instead of stdout |
| `--type=<t,t>` | only these connascence types (`name,type,meaning,position,algorithm,value,identity`) |
| `--min-strength=<1-9>` | only edges at/above this strength (1 = name … 9 = identity) |
| `--min-degree=<n>` | only edges whose node degree ≥ n |
| `--file=<pattern>` | only edges touching paths containing this substring |
| `--top=<n>` | limit listed items (default 20, 0 = all) |
| `--config=<file>` | config file (default `.connascence.yml` if present) |

Exit code is `1` when the config's thresholds or gate are violated — usable as a CI check.

### `diff` — coupling introduced by a change

Compares the coupling graph between two git refs (both refs are scanned via `git archive` into temp dirs; `--head` omitted = current working tree). Exits `1` if any coupling was added — the post-edit quality gate for agent harnesses:

```bash
npm run cli -- diff "src/**/*.ts" "src/**/*.tsx" --repo=. --base=HEAD --format=agent
# WARNING: 2 new coupling instance(s) introduced:
# - [position strength=4 locality=3] src/foo.ts:1 (0) <-> src/foo.ts:1 (id): argument slot 0 bound positionally...
```

`--format=agent` emits deterministic, prompt-friendly one-liners (evidence truncated, heuristic types marked `[heuristic - review only]`). Use `--format=json` for the full added/removed edge lists. Non-heuristic findings make the command exit non-zero; pair with `heuristicFindings: exclude` in config to gate only on certain coupling.

### Examples

```bash
# overview of a repo
npm run cli -- scan "../other-repo/src/**/*.ts" "../other-repo/src/**/*.tsx" --format=summary

# interactive visual report
npm run cli -- scan "src/**/*.ts" --format=html --out=report.html

# highest-signal output: clustered findings + hotspots
npm run cli -- scan "src/**/*.ts" --format=findings --top=25

# only cross-module clone coupling at degree >= 10
npm run cli -- scan "src/**/*.ts" "--type=algorithm" "--min-degree=10"

# everything touching one line of code
npm run cli -- explain "src/**/*.ts" -- src/foo.ts:42
```

### Detector coverage

| Type | Detected | Strategy |
|---|---|---|
| Name | yes | symbol-table reference→definition edges (same-scope refs excluded) |
| Type | yes | TypeChecker: value flows hard-coupled to a shared non-primitive type |
| Meaning | heuristic | repeated magic literals as call arguments (numbers skipped) |
| Position | yes | args bound positionally into >3-param signatures |
| Algorithm | yes | normalized subtree-hash clone detection |
| Value | heuristic | named constants sharing a literal value across files |
| Identity | heuristic | mutable module-level variables accessed cross-scope |
| Execution / Timing | not yet | lowest priority per spec |

Heuristic detectors always attach an `evidence` string — treat those findings as candidates to review, not certainties.

## Config (`.connascence.yml`)

See `.connascence.yml.example`. Three sections:

```yaml
thresholds:          # fail when a type's total count exceeds the value
  algorithm: 500
ignore:              # file globs excluded from the scan
  - "**/*.test.ts"
gate:                # fail when any edge meets both bounds
  minStrength: 7
  minLocality: 4     # 4 = cross-module
heuristicFindings: include   # or 'exclude' to drop meaning/value/identity everywhere
```

## Scoring

- **Strength** — static table per connascence.io ranking: name(1) < type(2) < meaning(3) < position(4) < algorithm(5) < execution(6) < timing(7) < value(8) < identity(9)
- **Locality** — nearest-common-ancestor scope walk: 1 = same function, 2 = same class, 3 = same module, 4+ = cross-module
- **Degree** — per-node edge count per type (hub detection)

## Adding a language

Write one adapter under `src/languages/<lang>/` that populates the IR (`IrNode`/`IrEdge`) and implements `SemanticAdapter` (`resolveType`). No changes to detectors, scoring, config, CLI, or reports.

## Keeping this README up to date

When you change CLI surface, config shape, detectors, or scoring, update this file in the same change (see AGENTS.md).
