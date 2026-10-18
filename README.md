# coupling sensor (connascence)

A deterministic structural-feedback sensor for AI coding agents. Tests verify
behavior, not structure; agents generate code at machine speed and degrade
structure silently. This tool measures **connascence** (coupling, per
[connascence.io](https://connascence.io)) and feeds a diffable, game-resistant
signal back into the agent loop.

Lineage: coupling = cost of edges, cohesion = strength of the interior,
encapsulation = economy of the boundary (Stevens/Myers/Constantine '74, Parnas
'72, Ousterhout '18).

**Status: M0** — per [PLAN.md](PLAN.md), the archived engine
(`archive/pre-restart-2026-10-13`) is used as-is, wired into an opencode
plugin, to answer the riskiest assumption first: *do agents act on the
signal?* No engine rewrite starts before that is answered.

## Repo layout

```
src/          archived engine, as-is (TS adapter -> IR -> detectors -> scoring -> CLI)
plugin/       M0 opencode plugin: session baseline, per-turn session diff, tools
tests/        engine fixture tests + plugin tests (incl. real-engine loop simulation)
.coupling/    (gitignored) observation log + session reports — M0 experiment evidence
PLAN.md       the restart plan: thesis, milestones, validation gates, review log
```

## Engine CLI (unchanged from the archive)

```bash
npm install
npm run build          # tsc -> dist/
npm test               # vitest (engine + plugin)

npm run cli -- scan "src/**/*.ts"                        # fix-first summary
npm run cli -- scan "src/**/*.ts" --format=json          # machine-readable
npm run cli -- scan "src/**/*.ts" --format=sarif         # GitHub code scanning
npm run cli -- diff "src/**/*.ts" --repo=. --base=main --format=agent
# exit code 1 when the change introduces coupling (CI gate)
```

See `.connascence.yml.example` for thresholds, ignores, and heuristic
filtering; `--format=architecture` reports graph-detected modules and
layering verdicts.

## opencode plugin (the M0 loop)

The plugin turns the engine into an in-loop sensor. In a monitored project:

1. **Session baseline** — the first model call triggers a scan; the baseline
   lives in plugin memory, where the optimizing agent cannot edit it.
2. **Per-turn session diff** — after each agent turn the project is rescanned
   and diffed against the baseline. New coupling (heuristic candidates
   excluded by default, `name` edges always) is delivered as a bounded
   advisory message with a concrete fix hint.
3. **Tools** — `coupling_scan` (actionable findings, worst first) and
   `coupling_health` (counts, session delta, hotspots).
4. **Observation log** — every loop branch appends to
   `.coupling/sensor-log.jsonl`; session summaries land in
   `.coupling/session-*.json`. This is the raw material for the M0 exit
   criteria: documented behavior-change cases, or documented reasons the
   signal was ignored (payload too big? wrong top-N? noisy?).

### Install in a project

Point `opencode.json(c)` at this repo (path form; engine must be built —
`npm run build` here first):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "C:/path/to/connscence",
      "options": {
        "globs": ["src/**/*.ts", "src/**/*.tsx"],
        "top": 5,
        "budgetChars": 1500,
        "includeHeuristics": false,
        "inject": true
      }
    }
  ]
}
```

This repo self-hosts the same config (`.opencode/opencode.json`) for
dogfooding. Options: `globs` (scan targets), `top` (max items per payload),
`budgetChars` (hard payload budget), `includeHeuristics` (opt-in heuristic
candidates), `inject` (turn-end advisories on/off), `engineEntry`
(override `dist/cli.js` path), `logDir` (default `.coupling`),
`timeoutMs` (scan timeout).

### Known M0 crudeness (deliberate, scheduled in PLAN.md)

- Diff keys are `(type, file, name)` — renames/moves storm the diff. M3a
  replaces this with `structureHash` keys + move detection.
- The observation log sits in the agent-controlled project dir — it is
  evidence, not enforcement. M3a adds the git-derived CI gate.
- Full rescan per turn — M5 adds memoization after profiling.

## The M0 experiment

Run real agent sessions with the plugin enabled for two weeks. Record, per
session: did the agent act on injected advisories (fix the reported
coupling)? If it ignored them, why? The log + session reports + transcript
review answer this. **Exit criterion** (PLAN.md §9): documented
behavior-change cases, or documented failure reasons that become M4 payload
requirements. If the loop cannot be made to matter with the crude engine →
stop before the rewrite.
