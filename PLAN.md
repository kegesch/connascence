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
- No TUI/dashboard until the agent loop is validated.
- No 60-language breadth before 2 languages are excellent.
- No engine rewrite before the archived engine proves the loop matters (M0).

## 2. Measurement model: three axes (first principles)

"Good decomposition" reduces to three independently variable properties, each
attached to a different part of the graph:

| Axis | Property of | Measured by | Score source |
|---|---|---|---|
| **Coupling** | *edges* (between modules) | connascence strength × locality × degree | existing detectors |
| **Cohesion** | *communities* (inside modules) | internal vs. crossing edge mass → Louvain Q | `louvain.ts` |
| **Encapsulation** | *boundaries* (a single module) | functionality ÷ interface width (Ousterhout depth) | new |

Encapsulation is not reducible to the other two: low coupling + high cohesion
can still be fragile if every module is *shallow* — a wide interface leaks
knowledge, and leaked knowledge is future connascence (Ousterhout's argument;
Parnas information hiding, made measurable). The axes police each other:

- Split a deep module into two shallow ones → interface count drops, but
  crossing-edge mass jumps: the **coupling** axis catches it.
- Pad a module with dead code to fake "functionality" → the **redundancy**
  detector catches it.
- Widen an interface because it is genuinely needed → crossing connascence
  strength rises: scored, not merely counted.
- Accumulate instead of splitting: one tangled 2k-line module has no crossing
  edges (coupling: clean), forms one dense community (cohesion: good), and
  maximal internal mass ÷ zero interface (encapsulation: deepest in the
  repo). The examples above police splitting and padding, not accumulation —
  and gini, the only cop, is level-free (a uniformly-complex repo scores
  perfect equality). Countermeasures: inlining-proof `functionality` (below)
  and a level term paired with gini.

Scoring reuses the existing machinery — no new primitives:

- `interfaceWidth(M)`: exported symbols of M actually consumed externally,
  weighted by the connascence *strength* of the crossing edges.
- `functionality(M)`: internal connascence mass / internal edge weight —
  deliberately **not LOC** (padding would make a module look deeper). Open
  constraint from the review: this must be *inlining-proof* — moving existing
  code across M's boundary must not raise `depth(M)`. Raw internal mass
  fails that; counting only behavior *defined* in M (its own call targets,
  not absorbed ones) is the working candidate.
- `depth(M) = functionality(M) ÷ (1 + interfaceWidth(M))`, aggregated per
  Louvain community.

One continuous score = geometric mean over **seven root causes**: acyclicity
(Kosaraju), levelization (Lakos — dependency-chain depth, *not* Ousterhout
depth), encapsulation (Ousterhout), equality (gini), redundancy, cohesion
(Louvain), coupling (connascence aggregate).

Why a geometric mean: its gradient points at the worst axis (d log S / dx is
largest for the smallest x). But agents consume the **vector** — which axis,
which file, which edge — so the scalar is for tracking and the vector is the
product (feedback payload spec, M4). Every baseline stamps `scoreVersion` +
config hash, so the M3b→M7 formula change invalidates baselines loudly, not
silently.

README lineage one-liner: coupling = cost of edges, cohesion = strength of
the interior, encapsulation = economy of the boundary
(Stevens/Myers/Constantine '74, Parnas '72, Ousterhout '18).

## 3. Architecture: the quality ladder

Two parsing tiers, **one IR contract**, core never imports from either:

```
tree-sitter syntactic layer   (any language, robust to broken code)
          ↓  emits
         IR   ─────────────── the ONLY contract (src/core/ir.ts)
          ↑  enriches
native semantic layer          (ts-morph for TS; optional, adds resolution)
          ↓
language-agnostic core: graph → detectors → scoring → report/cli for agent
```

- **Syntactic tier**: tree-sitter grammars + `tags.scm`-style queries → IR
  nodes (functions, classes, variables, calls, references, literals) with
  scope paths, locations, structure hashes, mutability. Works mid-edit,
  works for many languages.
- **Semantic tier**: ts-morph backend (kept from the old repo) emits an
  **annotation map** keyed by IR node id (resolved reference targets,
  `resolveType`, union membership). Core merges annotations onto the IR
  one-way — the semantic tier never writes back into the IR, so there is no
  second source of truth and no alignment layer to build. Optional per
  language; findings carry provenance
  (`confidence: 'name-match' | 'type-resolved'`), and metrics over
  mixed-confidence edges are never compared across languages.
- **Rule of layering** (kept verbatim from old AGENTS.md): if core needs a
  language type, extend the IR — never leak.

## 4. What we keep from the old repo

| Asset | Why |
|---|---|
| Layering discipline + IR-as-contract | the whole extensibility story |
| IR shape: `scopePath`, `parentId`, `structureHash`, `mutable`, `initialValue` | each field earns a detector |
| Strength (static table) × locality (scope-ancestor walk) × degree scoring | the genuinely differentiated model; nothing like it in Sentrux-class tools; the **coupling** axis (§2) |
| Detectors: **Position, Algorithm (subtree-hash), Name, Identity** | all syntactic or already proven; Identity (mutable module state) is the best heuristic detector — keep as-is |
| Louvain module detection (`louvain.ts`) | strictly better than Sentrux's directory-as-community "modularity"; the **cohesion** axis (§2) |
| SARIF output, severity, remediation hints | machine + human consumers |
| `diff.ts` baseline diff *concept*, `.connascence.yml` gates, exit-code CI gating | the enforcement half of the loop — but the diff *keying* is rebuilt: the old `(type, file, name)` key turns every rename/move into a remove+add storm, punishing exactly the refactors we want agents to do; new keying is `structureHash`-based with move detection |
| ts-morph backend (adapter, symbol table, structure hashing) | the semantic ceiling |
| Fixture-test discipline (true-positive + true-negative per detector) | non-negotiable quality bar |

## 5. What we take from Sentrux

| Idea | Implementation note |
|---|---|
| **Agent loop as the product**: cli, opencode hooks via plugin, `scan` / `session_start` / `session_end` / `health` | copy the tool surface; hand-rolled server is fine (~5 methods) |
| **Session baseline diff**: signal before/after + violation list (new cycles, new god-files, signal drop > threshold) | fix their flaw via *git*, not session memory — but not a working-tree file either: `.coupling/baseline.json` is the score's save-state in a directory the optimizing agent controls (forgeable input to our own gate). CI recomputes the baseline from the merge-base |
| **One continuous score, geometric mean of 7 root causes** (0–10000 int) | game-resistant: a 0 in any dimension tanks the score; no letter grades (they caused agents to stop at "A") |
| Root-cause metrics: acyclicity (Kosaraju SCC), levelization (Lakos — dependency-chain depth, *not* Ousterhout depth), equality (1 − gini of complexity), redundancy (dead + duplicate functions) | replace their modularity (directory-Q) with real Louvain communities (**cohesion** axis); encapsulation (Ousterhout) comes from §2 |
| Root causes over proxy metrics; assume agents will game proxies | design doc insight — keep |
| What-if simulator (clone graph, move/break-edge, recompute) | cheap, high demo value |
| Evolution metrics via `git2`-style log walk: churn, co-change (temporal) coupling, hotspots, bus factor | temporal coupling pairs beautifully with connascence findings — and co-change is **promoted from M7 to M3a**: it is the one channel that catches semantic evasion (event buses, DI, string-keyed indirection) that static analysis can never see |
| Test-gap heuristic (test files by naming convention + import reach) | optional, late |
| 0-config gate: "accept existing mess as baseline, block *new* decay" | the single biggest adoption unlock |

## 6. What we deliberately discard

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

## 7. Detector set (launch)

Syntactic (any language — statistics and candidates only): Position,
Algorithm, Name, Identity; graph metrics (levelization via Lakos, cohesion
via Louvain, redundancy, coupling score = strength × locality aggregation).
Name-resolved graphs never produce accusations (§6 discipline, now enforced).
Type-resolved (TS — the only launch *findings* tier): cycles (SCC) — a cycle
accusation over name-matched edges hallucinates through every
`render`/`handle` collision, so cycles require resolved edges and are TS-only
until M6. Consequence stated plainly: until the second language has
resolution, gate-eligible findings are TS-only; other languages get
statistics + the temporal co-change channel. Note the discarded Type
detector also removed one of the two edge sources of the old module graph
(`DEP_TYPES = {name, type}`) — communities/statistics rest on name edges
alone, which is acceptable; accusations are not built on them.
Type-rebuilt (structural duplication, primitive obsession) — only after the
agent loop is validated.

Every heuristic finding ships `evidence` (unchanged rule from old spec).

## 8. Milestones

0. **M0 — Loop validation with the archived engine (before any rewrite)**:
   wire the archived engine (tag `archive/pre-restart-2026-10-13`) into the
   opencode plugin as-is — crude session diff, crude payload — and run 2
   weeks of real agent sessions. Falsifiable: do agents act on the signal?
   Either documented behavior-change cases, or documented *reasons* they
   ignored it (payload too big, wrong top-N, gate too noisy) that become
   requirements for M4's feedback payload. The riskiest assumption gets
   tested first, not last.
1. **M1 — IR + TS adapter (ts-morph first)**: port symbol table / structure
   hash; ts-morph → IR. Tests: fixtures per detector. tree-sitter moves to
   M6 — the breadth enabler does not lead while breadth is a stated
   non-goal, and "robust to mid-edit code" has no consumer in a
   session-granular surface.
2. **M2 — Core detectors + scoring**: Position, Algorithm, Name, Identity;
   strength × locality × degree; JSON + SARIF output.
3. **M3a — Gate skeleton**: SCC cycles (type-resolved, TS-only findings),
   Lakos levelization, temporal co-change channel (git log walk), `.yml`
   config, **hash-keyed baseline diff** (`structureHash` + move detection),
   git-derived baseline, exit-code CI gate. Split from the old M3 because
   that milestone was silently the plan's largest — 5 of 7 root causes have
   no existing code in the archive.
4. **M3b — Full score**: Louvain cohesion, gini equality *plus level term*,
   redundancy, encapsulation v1 (inlining-proof `functionality`), geometric
   mean with `scoreVersion` stamping.
5. **M4 — CLI / opencode plugin**: scan/health/session_start/session_end/check;
   **feedback payload spec as a first-class deliverable** (token budget,
   top-N, cluster dedup, vector output: which axis, which file, which edge);
   advisory in-loop, strict in-CI. Run it against real agent sessions for a
   month — **this is the falsifiable experiment** (does the signal change
   what agents ship?).
6. **M5 — Cheap incremental**: per-file content-hash memo of IR only.
   Louvain/gini/scoring are global regardless; dirty-subgraph machinery is
   deferred until profiling demands it (100k LOC parse is likely seconds).
7. **M6 — Second language** via tree-sitter adapter (Python or Go); prove
   "one adapter, no core changes." The syntactic tier lands here — where a
   second language first exists.
8. **M7** — rebuilt Type detector, what-if, test gaps; strength-weighted
   encapsulation score (bumps `scoreVersion`; baselines re-derive), validated
   against git history (wide interface at T → more crossing connascence at
   T+Δ; weak correlation → cut the metric).

## 9. Validation gates (per milestone)

- Fixture tests green (TP + TN per detector).
- `scan` on a non-trivial real repo produces findings a senior dev agrees with
  (spot-check ≥ 90% precision on non-heuristic detectors). Precision is the
  usability property; **recall is the security property** — the diff gate
  carries a recall target too, because gaming the gate means finding its
  blind spots.
- **Adversary checks** (M0/M4): a red-team agent instructed to game the score
  (inline across boundaries, route coupling through an event bus, edit the
  baseline, rename to dodge the diff) must fail — or the countermeasure
  ships first.
- **Calibration corpus for all axes, not just encapsulation**: senior-dev-
  labeled refactor/decay commits; each axis must move the right direction.
  Cheap, and it converts the score from theory to measurement before M4
  trusts it.
- **Determinism is engineered, not claimed**: sorted traversals (Louvain
  iterates Maps in insertion order; filesystem order is not stable), pinned
  grammar + TS versions, pinned tsconfig discovery; same-input-same-score
  test in CI; `scoreVersion` + config hash stamped into every baseline.
- Scan of ~100k LOC TS in < 60s (M3b), < 5s incremental (M5) — *measure
  first*: if cold parse already fits the budget, M5 stays a memo instead of
  becoming a subgraph engine.
- Encapsulation axis is falsifiable (M7): git history must show wide
  interfaces predicting later growth in crossing connascence; otherwise cut
  the metric — same stop-or-pivot discipline as M0/M4.
- M0 exit criteria: 2 weeks of archived-engine sessions; documented
  behavior-change cases, or documented failure reasons that become payload
  requirements. If the loop cannot be made to matter with the crude engine →
  stop before the rewrite.
- M4 exit criteria: ≥ 1 real project, 4 weeks of agent sessions, documented
  cases where the session-diff changed agent behavior. If not → stop or pivot.

## 10. Architecture review log — 2026-10-18

Challenges raised against this plan; all accepted; folded into §§1–9.

1. **Risk inversion** — the plan repeated Sentrux's mistake: the riskiest
   assumption (agents act on the signal) was validated last, after a full
   engine rewrite. → new M0.
2. **"Scoring reuses existing machinery" was false** — the archive contains
   no SCC/Lakos/gini/redundancy code; 5 of 7 root causes are a new
   subsystem. → M3 split into M3a/M3b.
3. **§6 vs §7 contradiction** — name-resolved graphs banned from
   accusations, yet launch shipped cycle findings on exactly those edges
   (and the discarded Type detector had silently been the second edge source
   of the module graph). → cycles require type-resolved edges; TS-only
   findings until M6 (§7).
4. **Diff punished refactoring** — name/file keying turns rename/move into
   violation storms; a gated agent learns to stop refactoring, inverting the
   thesis. → `structureHash`-keyed diff + move detection (§4, M3a).
5. **Forgeable baseline** — `.coupling/baseline.json` is the score's
   save-state in a directory the optimizing agent controls. → git-derived
   baseline recomputed at the merge-base (§5).
6. **Precision measured, recall ignored** — game-resistance is a recall
   property; an adaptive agent routes coupling through undetectable channels
   (event buses, DI, string-keyed indirection). → temporal co-change
   promoted to M3a; red-team adversary checks added (§9).
7. **Encapsulation rewards the monolith** — maximal internal mass + zero
   interface scores best; gini is level-free; inlining games depth. →
   inlining-proof `functionality`, level term on equality (§2).
8. **Determinism asserted, not engineered** — Map-order iteration,
   filesystem traversal order, grammar/TS-version drift, and the M7 formula
   change would silently invalidate stored baselines. → determinism gates +
   `scoreVersion` stamping (§2, §9).
9. **Breadth machinery first, breadth a non-goal** — tree-sitter led M1
   while "robust to mid-edit code" has no consumer in a session-granular
   surface. → ts-morph-first M1; tree-sitter to M6 (§8).
10. **M5 likely premature optimization** — the expensive parts (Louvain,
    gini, score) are global; dirty subgraphs bound only parsing. → IR memo
    only, machinery deferred until profiling (§8).
11. **Missing deliverables** — a feedback payload spec (what the agent
    actually reads) and calibration of all axes, not just encapsulation. →
    M4 payload spec; calibration corpus in §9.

What survived the challenge: the IR-as-contract layering (now one-way via
annotation maps), the discard list, 0-config baseline gating, falsifiable
M4 exit criteria, fixture discipline, and the geometric-mean-as-gradient
instinct.

## 11. M0 status — 2026-10-19

**Wired and running.** The plugin auto-loads from
`.opencode/plugins/coupling-sensor/index.ts`, spawns the archived engine, and
exposes `coupling.scan` / `coupling.health`. Live data: 1128 edges (name 801,
identity 228, position 58, type 23, meaning 14, value 4), 81 actionable after
the `name` filter. `baseline` and `tool_call` events land in
`.coupling/sensor-log.jsonl`.

**Defects found and fixed while getting it to run:**

1. **Engine spawn re-entered opencode.** `runScan` used `process.execPath`,
   which inside a plugin is the opencode binary. Fixed with `runtimeBinary()`:
   use the current runtime only when it is a real JS runtime, else `node`.
2. **The turn trigger was not the documented event.** The loop listened for
   `session.idle`. Measured against the 2.0.26 stream, neither `session.idle`
   nor `session.status` is delivered to plugins; the stream carries
   `session.step.*`, `session.tool.*`, and `session.execution.*`. The turn
   boundary is `session.step.ended` with `finish === "stop"` — a step that ends
   with `tool-calls` continues the turn. Dispatch moved to `plugin/events.ts`
   (pure, fixture-tested); `session.status`/`session.idle` stay as fallbacks
   for builds that emit them. Deduped on the transition into idle.
3. **A silent branch violated the observability rule.** Events dropped by the
   directory filter produced no log line, making "no idle" and "idle filtered"
   byte-identical. Tracked events dropped this way now log `event_skipped`.

**Open items before M0 exit criteria can be claimed:**

- **Baseline does not survive a plugin reload.** Editing a plugin source file
  reloads the plugin, resets in-memory session state, and re-creates the
  baseline — 15 baseline lines across a handful of sessions in one day. This
  pollutes the experiment: the "session start" baseline moves mid-session. Fix
  before the two-week run (must stay non-agent-writable; compute from git at
  the session's first-seen revision, or persist outside the project).
- **Injection is proven in simulation, not yet live.** The turn branch is now
  observed end-to-end (probe session `ses_eaa62626…`, 2026-10-19):

  ```
  session.step.ended  finish="stop"
  baseline            1128 edges
  turn                newEdges=0, fresh=0, injected=false
  ```

  A real edit that introduces coupling still needs to produce an `injected`
  line; the real-engine simulation (`tests/plugin/loop-sim.test.ts`) covers
  that path with a scratch project.
- Crude `(type, file, name)` diff keying and the forgeable observation log
  remain as planned (M3a). The 69 `event_seen` lines from the measurement
  probe are retained as evidence, not cleaned.

## 12. Next steps

1. **Close M0's wiring** (this week): fix baseline durability across reloads,
   and capture one real `injected` line from an edit that adds coupling.
2. **Run the M0 experiment** (two weeks): archive sessions, then classify each
   signal as acted-on or ignored, with the reason (payload too big, wrong
   top-N, noisy, not applicable). Those reasons are the M4 payload spec input.
3. **Do not start M1 before step 2 concludes** (PLAN.md §8–9): if the loop
   cannot be made to matter with the crude engine, stop.

