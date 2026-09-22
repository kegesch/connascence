# Connascence CLI — Build Spec

## Goal

A CLI tool that statically measures **connascence** (per [connascence.io](https://connascence.io)) in a codebase: it detects coupling between code entities, classifies it by type (Name, Type, Meaning, Position, Algorithm, Execution, Timing, Value, Identity), and scores each instance on Strength, Locality, and Degree to produce a ranked, actionable report.

Primary target language for the MVP: **TypeScript / JavaScript**. Architecture must be language-agnostic from day one so additional languages can be added later without touching the core graph/scoring logic.

## Implementation language

Write the CLI itself in **TypeScript**, distributed as an npm package (`npx connascence`).

## Core architecture

```
source files
   │
   ▼
tree-sitter  (universal syntax layer — all languages, same query API)
   │
   ├─► syntactic detectors (operate directly on the CST)
   │      - Connascence of Position
   │      - Connascence of Algorithm (AST-clone / subtree-hash similarity)
   │
   └─► semantic adapter interface  (per-language plugin)
          resolveType(node) / findReferences(symbol) / getScope(node)
          ├─ TypeScript backend: TS Compiler API / ts-morph
          ├─ (future) stack-graphs backend — cheap in-process name resolution,
          │            no full toolchain required, grammars exist for Python/TS/JS
          └─ (future) generic LSP client backend — richest info (real type-checking),
                       works for any language with a decent language server
   │
   ▼
Normalized IR   — this is the critical abstraction:
   Node  { id, kind, name, scopePath, location }
   Edge  { nodeA, nodeB, connascenceType, evidence }
   │
   ▼
Property computation (language-agnostic, works purely on the IR/graph)
   - Strength  → static lookup table per connascence type (fixed ranking,
                 static types weaker than dynamic types per connascence.io)
   - Locality  → scope-distance between two nodes' enclosing scopes
                 (walk to nearest common ancestor: function < class < module < package)
   - Degree    → edge count per node, per connascence type (graph degree)
   │
   ▼
Scoring / thresholds / CLI output (JSON → HTML/console renderer)
```

**Hard rule for the agent building this:** nothing downstream of the IR (graph construction, scoring, CLI, reporting) may import a `ts.Node`, tree-sitter `Node`, or any language-specific type. Every language adapter's only job is to populate the IR. This is what makes the tool extensible later — a new language means writing one adapter, not touching the graph or scoring code.

## Connascence type → detection strategy

| Type | Strategy | Needs semantic info? |
|---|---|---|
| Name | Reference/definition edges from symbol resolution | Yes (cheap — resolver only) |
| Position | Flag positional-param signatures beyond N params; edge arg-slot ↔ param-slot across call sites | No — pure syntax |
| Algorithm | Normalize + hash AST subtrees (structural clone detection); flag near-duplicate subtrees above similarity threshold | No — pure syntax |
| Type | Compare resolved types at both ends of a value flow | Yes (real type checker) |
| Meaning | Cluster literal values by (value, surrounding context) across call sites; flag repeated magic literals not backed by a named constant | Heuristic; candidate for LLM-assisted confirmation pass |
| Value | Data-flow / def-use tracking of values that must co-vary without a shared abstraction | Yes (data-flow) |
| Identity | Reference/pointer-identity comparisons + alias analysis (singletons, shared mutable state) | Yes (alias analysis) |
| Execution | Call graph + simple state/protocol inference (e.g. guard patterns like "must call init() before use()") | Yes (call graph) |
| Timing | Concurrency-specific analysis (happens-before on threads/async tasks) | Yes — hardest, lowest priority |

Build order: **Position → Algorithm → Name → Type → Meaning/Value/Identity → Execution → Timing.** The first two need no semantic layer at all; add the semantic adapter only when Name/Type are tackled.

## CLI surface (target shape)

```
connascence scan ./src --lang=typescript --min-strength=algorithm --format=json
connascence diff <ref-a> <ref-b>          # coupling introduced between two commits/branches
connascence explain <file>:<line>         # show all edges touching this node, with strength/locality/degree
connascence report --html out/report.html
```

Config file: `.connascence.yml` — per-type thresholds and ignore rules, so it can gate CI (e.g. fail on new Algorithm-strength connascence with degree > 3 and cross-module locality).

## MVP build steps (in order)

1. **Narrow slice**: TypeScript only, `ts-morph` over a small multi-file project. Detectors: Name + Position only.
2. **Symbol table layer**: walk the project with `ts-morph`, build a table of every definition + every reference site (this becomes the Name detector almost for free, and the seed of the IR).
3. **First two detectors** as pure, independently-testable functions returning `(nodeA, nodeB, type, evidence)`.
4. **Locality + Degree** computed purely from the IR graph (scope-ancestor walk; edge counting). Strength is a static lookup table — no computation.
5. **Minimal CLI**: `connascence scan <path>` → JSON output. Run against a real codebase immediately to find noisy detectors.
6. **Expand types incrementally**: Type (via TS Compiler API's `TypeChecker`) → Algorithm (subtree-hash clone detection, reuse an existing library rather than writing one) → Meaning/Value/Identity (heuristic candidate generation + optional LLM confirmation pass on flagged pairs) → Execution → Timing.
7. **CI integration**: `.connascence.yml` thresholds + `connascence diff` for PR gating.

## Language-agnostic extension path (post-MVP)

- Introduce the semantic adapter interface (`resolveType` / `findReferences` / `getScope`) explicitly, even while only the TS backend exists — this is what keeps step 6 from becoming a rewrite.
- To add a second language: either
  - back the adapter with **stack-graphs** (declarative name-binding rules on tree-sitter grammars — cheap, in-process, grammars already exist for Python/TS/JS; note the original GitHub repo is community-maintained, not officially supported), or
  - back it with a **generic LSP client** talking to that language's existing language server (pyright, rust-analyzer, gopls, etc.) for full type-checked resolution.
- Either way, the adapter's only contract is: populate the same IR. The graph, scoring, and CLI code must not change.
