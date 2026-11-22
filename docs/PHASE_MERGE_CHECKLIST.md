# Phase merge checklist

Status as of 2026-11-20, after the compatibility integration reached `main`, the
A07.2 repair-ledger change landed, and the integrated records were restored.

## Integration state

| Item | Value |
|---|---|
| Current branch | `main` |
| Integration commits | `f41529d` (reconcile main with local assembly phase), `ef20056` (integrate verified assembly compatibility layer) |
| Working tree | clean apart from the documented restore/gate change |
| Pre-integration `main` | `6f594fa` (PR #67) |
| Phase branch tip | `5328a22` (`docs: refresh thirteen-family gate`) |

The compatibility layer kept product code from both sides. It did **not** keep
every record file: several conflicts were resolved to the older side, so the
integrated tree lost the phase branch's assembly evidence log entries,
thirteen-family gate record, unreleased changelog entries and bench report
ignore rules. Those records are restored in this change from the integration
parent `5328a22` (the phase evidence log is a verified superset: `main`'s only
post-merge-base log edit, the A10 gear section from `2addffd`, is included), and
the gate is recorded from a fresh run on the integrated tree rather than copied.

## Verification on the integrated tree

| Check | Result |
|---|---|
| Unit suite | **1300 PASS / 3 SKIP / 0 FAIL** (201 files) on the current tree |
| Typecheck | PASS |
| Lint | PASS |
| Repair/route targeted tests | 24 repair tests PASS; full route test file PASS |
| Production build | **PASS** (`bun run build`, Next.js production output) |
| Native OpenSCAD suite (serial) | **68 PASS / 1 SKIP / 0 FAIL** (69 tests, 15 files, 1394.51 s) |
| Thirteen-family gate | **PASS**, 120 cases / 25 reference / 89 adversarial / 6 unscored; 31 PASS / 84 FAIL-or-ERROR / 5 NOT_RUN; layers 404/595; native OpenSCAD 2021.01, no model calls, about 141 family-minutes. Includes the v8 family (20 cases, 93/119 layers: connected-crank carrier, crankcase block with measured main bearings/counterweights/guides, and the independent-throw closed-bore rung with measured bore/head clearance), the thread family (8 cases, 25/35 layers incl. measured coaxiality), the cam rung (5 cases, 10/15 layers incl. a measured contact gap) and the product rows (16 cases, 63/112 layers: contract-driven slider-crank motion plus fitted retained-key disassembly) |

The production build and native suite are recorded after they finish; a green gate
is a public self-check, not independent hidden evaluation, model ability or physical
function.

## What the integration includes

- Thirteen public bench families with self-checks: assembly, gear, slider, l4,
  twin, vtwin, declaration, v8, planetary, planetary3, product, thread, cam.
- The hidden-split harness for all thirteen families (development copies only;
  no independent maintainer exists, so `independentHiddenEvaluation` stays
  `NOT_RUN`).
- Product-path A08 preparation family: identity, topology, reconstruction,
  assembly path, disassembly path, eccentric fit and joint frames.
- A07 measured repair closure with frozen declaration/requirement guards,
  append-only attempt history, and the A07.2 replayable rejected/no-progress
  proposals.
- A06 source-pose evidence, A05 collision witnesses, A04 fit measurements and
  A01/A02 on-demand evidence/snapshots.

## What it does not include

- A complete V8 machine. The `bench/v8` reference (contract v2) now requires one
  connected crankshaft with pins, webs and main journals, but there is no cylinder
  block, bearing shell, counterweight, firing order or lubrication model.
- Full A001 contract-gate pass for a multi-joint source; the confirmed-contract
  regression remains NOT_RUN by design.
- Independent hidden evaluation or fresh external model sampling. Hidden copies
  are development copies (`independent: false`).
- A fresh funded product trial after the judge wiring; the historical layer
  table therefore still shows the old `NOT_RUN` cells.
- Physical function, manufacturing, torque, preload, wear or user acceptance.

## Handoff

- Do not deploy. `vercel.json` keeps `git.deploymentEnabled: false`; only an
  explicit user request may publish.
- Record the final commit hash, test counts, gate verdict and known gaps in the
  handoff when this change lands.
