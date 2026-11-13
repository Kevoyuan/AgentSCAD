# AgentSCAD functional assembly — execution backlog

Updated: 2026-11-13. Baseline: `main` after PR #21 (`352baf2`). Scope: [FUNCTIONAL_ASSEMBLY_PLAN.md](./FUNCTIONAL_ASSEMBLY_PLAN.md).
Status describes **verified evidence**, not implementation effort. A passing CI run is not a functional or physical certificate.

## Final acceptance target

A user describes a **function and constraints** in natural language, confirms the requirement contract, and receives complete editable OpenSCAD, independently selectable manufacturing parts, purchased-part specifications, placement/relationship data, installation/removal operations, digital measurements, and a versioned evidence report. For supported mechanisms, measured fits/kinematics satisfy all required assertions; bounded repairs must preserve the original requirements. Physical capability claims additionally require independent manufacturing, measurement, disassembly and function experiments. The final complex example is a manually actuated, manufacturable eight-cylinder V-engine *mechanical demonstrator*, not a running combustion engine.

**Do not declare the overall target complete** while any required layer is NOT_RUN, ERROR or FAIL, or while supported functions have not passed real source-generated and independent validation. The absence of model/hardware experiments is a blocker, not an invitation to count mocks as evidence.

## Current maturity (evidence inventory)

| Milestone | Available in `main` | Critical unresolved exit condition | Assessment |
|---|---|---|---|
| M0 — reproducible baseline | CI, synthetic negative cases, evidence log and exported hashes | Keep regression and tool-version evidence current, independent review | Foundation present |
| M1 — intent/contract | Structured Chinese/English requirement contract; confirmation, revision and source binding | Real model generation/repair must preserve all mandatory requirements across attempts | Partial product proof |
| M2 — part delivery | Per-part ZIP, canonical specification and SHA-256 verifier; independent pose reconstruction; UI layout STL download (#19–#21) | Actual browser flow and independently observed model/instance identity across non-origin, repeated and purchased parts | Partial |
| M3 — hinge digital closure | Sampled collisions, fit fixtures, declared removal checker, guard against unconfirmed PASS | On-demand actual evidence visible in UI; contract-backed fit, failure location, bounded repair; independent geometry replay | Partial |
| M4 — single-cylinder mechanism | Fixture-level sampled linkage, pin/retainer and disassembly evidence | Real source → whole product flow; generic closed-loop and released-part checks, not fixture-only | Partial |
| M5 — threads/gears | Thread mesh measurement, 49-pose sampling, screw path schema and ZIP test | Calibrated bore/axis identity and coaxiality, completed bounded screw removal; **gear/planetary not implemented** | Partial / gear absent |
| M6 — V8 | Spec and hierarchy data structures | Eight linked power chains, proper phase/reference frames, retained fasteners, full digital assembly and motion evidence | Not delivered |
| M7 — physical | Evaluation protocol described | Independently printed/measured/assembled/tested specimens with declared machine/process, load/cycles | NOT_RUN |
| M8 — product generalization | Outcome ledger and sample evaluation tools | Frozen + genuinely hidden task sets, model runs, cost/abandonment accounting, blind review and release thresholds | NOT_RUN |

## Ordered, independently reviewable tasks

Every task is one bounded PR or a small series with negative tests. Each needs **source/spec/artifact version binding**, explicit five-state evidence (`PASS/FAIL/SKIP/ERROR/NOT_RUN`) and a Core CI pass. Do not silently weaken requirements.

| ID | Priority and dependency | Deliverable and acceptance criterion | Present status |
|---|---|---|---|
| A01 | P0 · after M2 | **On-demand measured assembly evidence**. Authenticated, current-hash guarded route runs deterministic part checks; UI shows actual vs contract-gated status, failure operation/other instance, pose index and sample coverage. No model calls or automatic rendering on page load. Tests for unconfirmed/stale, missed paths and refusal to fake PASS | **In progress — current PR** |
| A02 | P0 · after A01 | **Immutable evidence snapshot**. Persist digest-bound checked output and tool version; source/spec/requirements edits invalidate it; old results remain inspectable but never current; report export and API/UI tests | Not started |
| A03 | P1 · A01/A02 | **M2 browser E2E & independent pose observations**. Real Chromium navigation, download ZIP, verify hashes + reconstruct, compare separately rendered pose; repeated non-origin instances and purchased-part gaps; no automated model spending | Not started |
| A04 | P0 · A01 | **M3 contract-backed fit**. Generate fit requirements from confirmed contract and identified bore/shaft, independently measure mesh features; display min/max/uncertainty and negative-offset/decoy test results, conservatively NOT_RUN for unknown feature identity | Not started |
| A05 | P0 · A01/A04 | **M3 joint/pose failure UI**. Actual collision pair and first failure sample surfaced and navigable; coverage/budget and allowed-contact visible. Inconclusive mesh test stays NOT_RUN | Not started |
| A06 | P0 · A04/A05 | **M3 source-pose observations**. Independently render and measure declared hinge poses rather than trusting coordinates or animation; sampled vs continuous claims separated; negative obstruction, wrong axis and changed source tests | Not started |
| A07 | P0 · A06 | **Bounded measured repair loop**. Send measured failures and immutable requirement constraints to LLM repair; recalculate every affected measurement; preserve attempts/aborts/costs; cannot remove a difficult part or narrow required range | Not started |
| A08 | P1 · A07 | **M4 single-cylinder product closure**. Bring existing original keyed slider-crank fixtures through full interactive workflow and nine or more measured poses, retaining pins/guides and disassembly sequence; report limits of discrete sampling | Not started |
| A09 | P1 · A04/A06 | **M5 calibrated threads**. Establish the correct physical feature identity and axis uncertainty with independent negative decoys; check coaxiality and complete screw-out path under bounded geometry budget; fail closed on unknown | Not started |
| A10 | P1 · A06/A09 | **M5 gear and planetary stage**. Original meshing fixtures, measured pitch/axis and relative rotation ratio from actual sampled meshes; planetary carrier reference frame and reversals; contact/strength not inferred | Not started |
| A11 | P2 · A08/A10 | **M6 full V8 digital assembly**. Eight functional piston/conrod chains, crankshaft, bearings, removable casing and connectors; exact part/instance BOM, phase and handedness tests; deterministic staged rendering/cache | Not started |
| A12 | P2 · A11 | **M6 assembly/maintenance evidence**. Tool approach, sampled disassembly order, manufactured-part completeness and independent engine-pose replay across phases; unresolved geometric budgets explicit | Not started |
| A13 | P2 · A06/A08 | **M7 physical validation**. Agree equipment, operator, material, process, measurement tolerance, effort and budget first; document independently printed hinge + one-cylinder experiments, cycling/load/force and failures. No software-only substitute | External experiment required |
| A14 | P1 then P2 · A07/A11 | **M8 evaluation and release**. At least 24 original frozen tasks and 12 independently maintained hidden tasks (if independent maintainer available); bounded paid-model trial only with user-approved ceilings; cost, real failures, blind review, intervals and criteria. Keep L1–L6 results separate | Not started |

## Implementation sequence and release gates

1. **Digital evidence first:** A01 → A02 → A03/A04 → A05 → A06 → A07. Avoid inferring real mechanical success from JSON, generated-code comments, downloaded archives or a pretty viewport.
2. **General mechanisms:** A08 and A09 can proceed after the validated joint core; A10 shares motion checking. Do not claim M5 complete before the gear branch exists.
3. **Complexity and verification:** A11 → A12, and A13 with explicit physical funding and an independent test operator. M8 starts with harness freezing but its final sign-off follows mechanism and physical trials.
4. **Review gate:** each PR needs targeted positive and adversarial tests, TypeScript, lint, Bun unit tests, build, native/WASM checks when applicable, and a clear residual-unknowns table. Merge only after required CI passes.
5. **Deployment policy:** all work is GitHub branches/PR/CI. `vercel.json` keeps `git.deploymentEnabled: false`; never enable or deploy without an explicit separate user request.

## Evidence and status maintenance

- Update the row status **only when the stated exit criterion is verified**. `In progress` and `Not started` are workflow statuses; scientific verdicts remain PASS/FAIL/NOT_RUN/ERROR/SKIP.
- A declared-pose checker reports **sampled** rigid-body geometry only, not swept-volume clearance, real thread engagement, hand/tool clearance, or manufacture.
- Existing generated parts sometimes contain overlapping/same-shell envelopes that yield `UNKNOWN` collision; never promote them to CLEAR or PASS by raising a threshold without calibration.
- The historical 49 sampled screw positions do **not** demonstrate coaxiality, continuous clearance or full M5 completion. Its conservative overall result remains NOT_RUN.
- Model quality, paid-provider success rate and any physical validation are **not established**; keep them blocked until independently executed.
