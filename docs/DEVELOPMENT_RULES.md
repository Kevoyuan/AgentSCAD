# AgentSCAD Development Rules

Status: active
Last updated: 2026-11-20
Audience: maintainers and coding agents working in this repository

This document records the rules that keep AgentSCAD's geometry evidence, branches, and
benchmark results trustworthy. It is normative for day-to-day development. A change that
violates these rules needs an explicit, documented exception in the same change.

Use `MUST`, `MUST NOT`, `SHOULD`, and `MAY` in the normal RFC sense.

## 1. Source of truth

- `main` is the integration branch. `main` MUST stay buildable and testable.
- Never merge a branch with failing required checks into `main`, even when the failures
  look environmental. Diagnose first; merge later.
- Do not rewrite public history or force-push `main`.
- Do not deploy as a side effect of development. Deployment requires an explicit request.
- The assembly evidence log, execution backlog, phase merge checklist, and benchmark
  matrix are records, not decoration. Update the relevant record with the same change
  that changes the claim.

Relevant records:

- [`ASSEMBLY_EVIDENCE_LOG.md`](./ASSEMBLY_EVIDENCE_LOG.md)
- [`ASSEMBLY_EXECUTION_BACKLOG.md`](./ASSEMBLY_EXECUTION_BACKLOG.md)
- [`PHASE_MERGE_CHECKLIST.md`](./PHASE_MERGE_CHECKLIST.md)
- [`BENCHMARK.md`](./BENCHMARK.md)

## 2. Branches and merges

- Start feature work from current `main`.
- Keep each branch focused on one deliverable plus its tests and evidence.
- Use a separate worktree for a long merge or compatibility layer. Never experiment on the
  primary checkout while resolving a merge.
- A large divergence MUST be integrated through a compatibility layer, not by discarding
  either side:
  1. Create an integration branch from `main`.
  2. Merge the other branch without committing conflict markers or `-X ours`-style
     wholesale choices.
  3. Restore both sides' modules and public fields deliberately.
  4. Run the full required gate on the integrated tree.
  5. Merge the verified integration tree into `main` with `--no-ff`.
- Do not keep a mergeable change on an unmerged branch after it has been verified.
- Do not delete a branch that has unique unmerged commits until those commits have an
  archive tag or an explicit decision to discard them.
- Merged, superseded branches SHOULD be archived with a tag and then deleted. Keep the
  branch list readable.
- Never leave temporary worktrees behind. Back up untracked user files before removing a
  worktree, and report the backup path.

### Required merge gate

Run every command on the final candidate tree, in this order, unless the change is
provably unable to affect that layer:

```bash
bun run typecheck
bun run test
bun run test:openscad        # serial, --max-concurrency=1
bun run bench:all            # 13-family gate
bun run build
```

Rules for the gate:

- `test:openscad` MUST run serially. Native OpenSCAD tests share CPU and the A001
  reconstruction budget; parallel runs produce load-flaky timeouts.
- A timeout under load is not a product failure, but it is not a pass either. Rerun the
  isolated test, explain the flake, and rerun the full layer.
- Do not raise timeouts merely to hide a performance regression. Raise them only when the
  measured workload legitimately exceeds the old bound.
- Do not weaken, delete, or skip a failing test to make the gate green. Fix the behavior or
  correct the test's stated scope.
- Use reports from the exact commit being merged. A green run from an earlier tree is stale
  evidence.
- Record the commit hash and report path in the handoff or merge commit.

## 3. Evidence semantics

Evidence statuses are `PASS`, `FAIL`, `SKIP`, `ERROR`, and `NOT_RUN`.

- `NOT_RUN` is not a pass. It MUST remain visible and MUST never be promoted to `PASS` by
  assumption, by a previous run, or by a model's opinion.
- `FAIL` requires a measured or witnessed contradiction. A budget exhaustion or an
  unobserved region is `NOT_RUN`, not `FAIL`.
- `SKIP` is only for a check that does not apply to the selected case. It is not a pass.
- Every result carries its scope. A sampled result covers the sampled inputs only; it does
  not prove continuous motion, physical function, tolerances, print behavior, or user
  acceptance.
- Measured geometry, source-driven poses, rigid-pose collision samples, fit, connectivity,
  assembly paths, manufacturing measurements, and physical function are separate evidence
  layers. Do not collapse them into one aggregate PASS.
- Changing evidence semantics requires bumping the relevant checker/evidence version and
  treating old snapshots as historical, not current.
- A repair proposal does not become a delivered or accepted design without the normal
  apply/rebuild path.

### Source-pose classification

Source-driven verification MUST keep these cases distinct:

| Observation | Result |
|---|---|
| Strict correspondence or bounded surface coverage | `PASS` |
| Same surface, different tessellation, coverage proven | `PASS` |
| Same surface, coverage not proven | `NOT_RUN` |
| Source does not respond to its input; expected change is unobservable | `NOT_RUN` |
| Fully static source where the protocol requires motion | `FAIL` |
| Witnessed surface/geometry difference at the expected pose | `FAIL` |
| Render, protocol, or budget failure | `ERROR` or `NOT_RUN` |

Do not use a surface-distance witness to turn every inconclusive comparison into `FAIL`.
The witness proves a difference only when it completes within budget. Keep static,
unobservable, retessellated, and truly changed geometry separate.

## 4. Benchmark and self-evolution rules

- The benchmark ladder is the 13 family gates: assembly, gear, slider, l4, twin, vtwin,
  declaration, v8, planetary, planetary3, product, thread, cam.
- A new family or new capability needs:
  - at least one reference that must pass;
  - adversarial submissions that must be rejected;
  - a self-check that proves both directions;
  - the hidden split updated without tuning reference geometry to the hidden cases.
- Never improve a score by removing an adversary, relaxing a rejection, or marking an
  unexecuted layer as scored.
- Record maximum errors, coverage counts, and known gaps alongside PASS/FAIL.
- Treat researcher-authored fixtures as tool/feasibility evidence, not evidence that
  autonomous generation or physical function works.

## 5. Implementation rules

- Keep the harness thin and the skills fat: CAD reasoning, repair strategy, validation
  interpretation, and manufacturing judgment belong in `skills/`; deterministic rendering,
  measurement, persistence, and API glue belong in TypeScript.
- Prefer artifact-first CAD: generate or repair complete OpenSCAD, then parse parameters
  from the persisted source. Hidden JSON-only geometry is not a source of truth.
- Preserve public contracts unless a migration updates the UI and tests together: SSE
  framing, state strings, artifact paths, parameter schema, validation status fields, and
  model routing order.
- When merging two implementations, preserve both sides' public fields and behavior
  explicitly. Do not silently drop a field because one side's typecheck passed.
- Render and measure real geometry; do not substitute name-based guesses, centroids, or
  nearest-distance checks for surface, topology, or collision evidence.
- Do not copy third-party CAD application or library source without a license review.
- Keep `AGENTSCAD_TEMPLATE_FALLBACK` demo-only. A failed model call must not silently become
  a template generation.
- All new logs, prompts, benchmark labels, commit messages, and code comments are English.
  User-facing product copy follows the product's localization, not this rule.
- Commits are small, scoped, and describe the behavior change. Merge commits record what
  was integrated.
- Update the evidence log when a measured claim changes. Update the backlog when a task
  moves between open, partial, and done.

## 6. Agent execution rules

Use the host's orchestration tools rather than ad-hoc agent fan-out:

- A task with two or more independently deliverable pieces, or a "first A, then B"
  dependency, MUST start with `superagent_start(mode="planned")`.
- Continue an existing run with `superagent_followup`; read progress from
  `superagent_status`. Do not start a second run for the same goal.
- Do not use the built-in `subagent` tool to hand-orchestrate a multi-step goal; that path
  has no plan or merged report.
- A single action does not need a run.
- For long-term goals, schedules, cross-run memory, templates, audit, or live steering, call
  `superagent_help` first and use the returned tools.
- When a matching gstack skill exists (for example `/review`, `/qa`, `/ship`,
  `/gstack-upgrade`), load and follow it instead of improvising the workflow.
- Report completion with evidence from the final tree. If a step is blocked, state the
  concrete blocker and what was attempted; do not claim partial work is merged.

## 7. Cleanup and handoff

Before handing off:

- `git status` is clean, or every dirty file is named and explained.
- Temporary worktrees are removed.
- Superseded branches are archived and deleted.
- The final `main` commit hash, test counts, benchmark verdict, and any known gaps are
  written down.
- No secrets, provider keys, tokens, or local environment dumps are committed.
- No deployment or push is implied by a local merge.

## 8. Rule changes

This document is part of the repository. A rule change is a normal reviewed change:

1. Explain the failure mode the rule prevents.
2. Update this document in the same commit as the workflow or test change.
3. Keep the rules enforceable by a command, a test, or a reviewable diff where possible.

If a rule cannot be enforced automatically, say so and name the manual check.
