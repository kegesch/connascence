# AGENTS.md

Instructions for any coding agent working in this repository. Read `PLAN.md`
first for *what and why* (the restart thesis, milestones, review log); this
file is for *how to work here*.

## What this project is

A deterministic structural-feedback sensor for AI coding agents: it measures
connascence (coupling) and feeds a diffable, game-resistant signal back into
the agent loop. Current milestone: **M0** — the archived engine
(`archive/pre-restart-2026-10-13`), restored under `src/`, wired into an
opencode plugin (`plugin/`) to validate that agents act on the signal
**before any engine rewrite**.

## Non-negotiable architecture rule (verbatim from the archive)

The codebase has a strict layering boundary:

```
language-specific layer  →  normalized IR  →  language-agnostic core
```

- Only code under `src/languages/<lang>/` may import `ts.Node`, `ts-morph`
  types, tree-sitter nodes, or any other language-specific AST/API.
- Everything under `src/core/` (detectors, strength/locality/degree scoring,
  CLI, reporting) must operate **only** on the normalized IR types defined in
  `src/core/ir.ts`.
- If a change to `src/core/` requires importing something language-specific,
  stop and flag it — it means the IR is missing a field, and the fix is to
  extend the IR, not to leak a language type into core.

This rule exists so a second language can be added later by writing one
adapter, without touching detectors, scoring, or the CLI. Do not compromise
it for convenience.

## M0 discipline

- `src/` and `tests/` are the **archived engine, as-is**. Allowed changes:
  build/environment fixes and dependency repairs (e.g. the eslint/babel peer
  alignment). No new detectors, no engine features, no scoring changes —
  that work belongs to M1+ and must not start before M0 exits (PLAN.md §8–9:
  if the loop cannot be made to matter with the crude engine, stop).
- New work lives in `plugin/` (loop wiring) and `tests/plugin/`.
- The plugin never re-implements engine behavior: it spawns `dist/cli.js`
  and consumes JSON; fix hints come from the engine's remediation table via
  import, not from a copy.

## Plugin conventions

- Every branch of the loop appends to the observation log
  (`.coupling/sensor-log.jsonl`): baseline, turn, injected, suppressed,
  tool_call, scan_error. If a code path can affect whether the agent sees or
  acts on the signal, it must be observable in that log.
- Payloads are bounded: `top` items, `budgetChars` truncation. Failure modes
  (too big, wrong top-N, noisy) are M0 experiment data, not bugs to hide.
- Per-session state lives in plugin memory only — the optimizing agent must
  not be able to read or edit its own baseline.
- Known-and-accepted crudeness (each is scheduled for replacement in the
  plan): the `(type, file, name)` diff key that punishes renames (M3a), the
  forgeable observation log (M3a CI gate), name-edge-based statistics (M3a).

## Working rules

- Fixture tests: every detector keeps true-positive **and** true-negative
  fixtures; a detector that only has positives does not get merged.
- Size discipline is enforced by eslint (≤300 lines/file, ≤60 lines/function
  in `src/` and `plugin/`). Split before you grow.
- Commands: `npm run build` (tsc), `npm test` (vitest), `npm run lint`,
  `npm run typecheck:plugin`, `npm run cli -- scan <glob...>`.
- Determinism is engineered, not claimed: sorted traversals, no reliance on
  filesystem or Map iteration order in scored output.
