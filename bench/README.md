# The assembly ladder

This document is not another eval script. It defines a **target a product can evolve against**.

The difference is what happens when the number moves. A scoring benchmark tells you where you are. A target benchmark has to make every score change point at the subsystem that needs work. The first is a number; the second has to be a vector.

---

## 1. Why the current metric cannot drive anything

The trial records used a gate with this semantics:

```ts
const measured = evidence.filter((item) => item.id !== "intent-preserved");
if (measured.some((item) => item.status !== "PASS")) return { passed: false };
```

The code was later refactored away upstream, so this benchmark implements the semantic locally as `deliveryGate()` rather than importing the system it measures. A benchmark that imports the measured side stops working when that side refactors, and then it cannot score its own history.

**All non-intent evidence must PASS.** That is correct for delivery. As the only progress metric it has a fatal consequence:

| Candidate | Non-intent evidence | Gate |
|---|---|---|
| 14/15 PASS, 1 NOT_RUN | one short | **0** |
| 0/15 PASS, render fails | all short | **0** |

Same score. The summary read "measured-core still 0" for several rounds while real progress was invisible.

**Measured** over the recorded batches (`.agentscad/experiments/paid-deepseek-assembly-*/report.json`, 35 batches / 35 task attempts with evidence):

- attempts with `measuredCorePassed === true`: **0**
- closest candidate: `aVlhoH / guided-gated-hinge-v1`, **14 non-intent evidence PASS / 1 NOT_RUN** (`unresolved-axial-retention`)
- coverage after folding into layers: 1.000, 0.875, 0.625, 0.625, 0.556, 0.500, 0.444 …

> Boundary: these 35 attempts span multiple task sets, and prompts, parsers and checks changed between them. They are **not a comparable series**. They are used here only to show that a binary metric discards ordering information, and support no conclusion about success rates.

**The product has produced a 14/15 candidate and the metric said 0.** A metric reading 0 forever is not strict; it carries no information.

---

## 2. Design

### 2.1 Two numbers, not one

| Number | Definition | What it guards |
|---|---|---|
| **gate** | every required layer PASS | correctness. Failing it means the artifact cannot ship |
| **coverage** | passed layers / observed layers | progress. This is the number that moves |

The gate keeps its meaning. `NOT_RUN` never enters the numerator: the denominator counts observed layers, and unobserved layers are listed separately.

### 2.2 The task ladder

Aligned with the milestones in [`FUNCTIONAL_ASSEMBLY_PLAN.md`](../docs/FUNCTIONAL_ASSEMBLY_PLAN.md), not a parallel taxonomy:

| Rung | Task | Mechanism | Milestone | Status |
|---|---|---|---|---|
| L1 | two-part revolute (hinge, loose/tight) | 1 joint, 2 parts | M3 | in `bench/assembly`: 6 tasks |
| L2 | two-part prismatic (piston in a barrel) | 1 joint, 2 parts | M3 | in `bench/assembly`: 6 tasks |
| L3 | single-cylinder slider-crank | 4-joint loop, 4-6 parts | M4 | in `bench/slider`: 3 tasks, reference + 14 adversarial |
| L4 | multi-joint with retention | 4 joints, 7 parts / 9 instances | M4 | in `bench/l4`: declaration-bound, reference + 4 adversarial |
| L4p | product-path slider-crank closure (contract-driven) | task 2: 4 parts, 3 revolute fits + joint frames, sampled rigid motion and source poses; task 3: 5 parts, three revolute fits + joint frames, declared removal and insertion orders | M4 | in `bench/product`; retained-key disassembly now measured, interactive nine-pose workflow and user acceptance still open |
| L4.5 | inline twin / 90° V-twin cross-section | 2 cylinders, one crank | M5 | in `bench/twin` and `bench/vtwin` |
| L5a | planetary stage | fixed ring, sun/planet/carrier | M5 | in `bench/planetary` and `bench/planetary3` |
| L5b | V8 phase/packaging carrier with a connected crankshaft | 8 kinematic chains, 18 instances, pins/webs/main journals | M6 | in `bench/v8` task 1 (contract v2): reference + 7 adversarial; the v1 disconnected-disc reference is kept as a rejected adversary |
| L5c-1 | crankcase block with main bearings, cylinder guides and counterweights | 18 instances plus a connected block frame with two bearing webs, a top rail, thin guide channels on head rails, measured bearing fit, counterweight sectors and slider-to-guide gaps | M6 | in `bench/v8` task 2 (contract v5): reference PASS 7/7 with 0.989–1.019 mm bearing clearance at 0° offset, 17/10.5 mm counterweight extents and a 0.35 mm guide gap on 80 sampled rays; base-plate, oversized-bore, split-crank, no-counterweight, no-guide and tight-guide adversaries rejected |
| L5c | complete V8 machine | 8 chains plus cylinder bores/heads, counterweights, firing order | M6 | **open**: no cylinder bores/heads, counterweights, firing order or lubrication exist |

**Why a ladder:** failing L5 does not mean L3 does not exist. With rungs, a score can say which layer is stuck even when the top fails.

### 2.3 The layers

Each layer is `PASS | FAIL | SKIP | ERROR | NOT_RUN`. Within a layer the **worst** status wins: a PASS next to a FAIL does not become a PASS.

| Layer | Evidence ids | What to repair when it drops |
|---|---|---|
| `compile` | `compile` | SCAD compilation |
| `parts-identity` | `distinct-exported-parts`, `measured-part-identity` | selectors, parting strategy |
| `topology` | `part-connectivity`, `frame-connectivity` | booleans, wall thickness, connectivity |
| `joint-frames` | `measured-joint-frames` | declared axes, coordinate transforms |
| `fit` | `diametral-clearance`, `bearing-fit`, `guide-clearance`, `thread-coaxiality` | bore/shaft dimensions, tolerance, guide gap, threaded coaxiality |
| `balance` | `counterweight-balance` | crank counterweights and throw phase |
| `retention` | `axial-retention`, `unresolved-axial-retention` | retention features, latches |
| `assembly-path` | `assembly-path` | insertion path, clearance |
| `disassembly-path` | `disassembly-path` | removal order |
| `rigid-motion` | `rigid-motion`, `sampled-motion`, `motion-range-deg`, `motion-range-negative-end`, `motion-range-positive-end` | kinematics, collision |
| `source-motion` | `source-motion` | SCAD parameterisation, pose selectors |
| `reconstruction` | `assembly-reconstruction` | export, re-assembly, budget |

`sampled-motion` reports the independently measured **rigid** samples only. `source-motion`
is a separate assertion about what the OpenSCAD source does between those samples; a
declaration with no source-driven pose protocol must not demote its own measured rigid
sample to `NOT_RUN`.

**Layers are not a mirror of the storage taxonomy.** The product keeps twelve storage layers; a layer exists here only if it has a **repair target no other layer shares**. Three evidence ids are deliberately unmapped: `intent-preserved` (the product states it has no independent audit), `declared-connection-type` and `declared-translation-probes` (declaration preconditions — when they fail, everything downstream is `NOT_RUN` anyway), and `repair-preservation` (it belongs to the repair axis, not to the geometry being scored). Unmapped ids are reported, never dropped.

### 2.4 Gap kind: "cannot measure" is not "cannot build"

This table matters more than the coverage number. A layer can drop for two completely different reasons, and conflating them sends a roadmap after the wrong thing.

| Diagnosis | Test | What to do |
|---|---|---|
| `healthy` | pass rate ≥ 75% | leave it |
| `capability-gap` | FAIL dominates | work on generation |
| `measurement-gap` | `NOT_RUN` outweighs PASS+FAIL | add the check |
| `undetermined` | `ERROR` outweighs PASS+FAIL | **read the finding text** |
| `unobserved` | no evidence at all | wire the check |

`ERROR` is deliberately not folded into either side. The same `diametral-clearance: ERROR` can mean "the bore could not be measured: 1015 rays missed the solid" (a capability gap) or "the reconstruction budget ran out" (a tool gap), and the status alone does not say which. Guessing puts the wrong item on the roadmap.

### 2.5 Two axes

The product is not a one-shot generator; it is a `generate → verify → repair` loop. Measuring only one-shot generation rewards the base model. Measuring repair rewards the harness.

| Axis | What it measures | Source |
|---|---|---|
| **A: one-shot** | the coverage of the first attempt | first-attempt layers |
| **B: evidence-driven repair** | given the failing layers and measured numbers, how many rounds, what cost, how many layers gained | `attempts`, `calls`, coverage delta per round |

The key number on axis B is not "did it eventually pass" but **coverage gained per unit of spend**. The trial records already carry `calls` and cost, so this column can be computed today.

A better harness should hold axis A and steepen axis B.

---

## 3. Why "V8 all PASS" cannot be the only target

Three reasons, all measured:

1. **It is 0 or 1, and it is currently a long 0.** 35 attempts, 0 passes. A metric that always reads 0 cannot distinguish two changes.
2. **It hides progress that already happened.** The best candidate is 14/15; the metric reports 0.
3. **It does not say where to go.** "V8 failed" points nowhere; "joint-frames 28.6%, assembly-path 11.5%" points clearly.

V8 is still the **destination**. It cannot be the **scale**.

---

## 4. What runs today

```bash
bun run bench:all             # the 13-family native gate; writes bench/matrix.json
bun run bench:ladder          # score recorded trial reports (no model, no render, no spend)
bun run bench:ladder --json out.json
bun run bench:assembly        # the geometry benchmark over all submissions
bun run bench:assembly:check  # self-check: references pass, cheats are caught
bun run bench:baseline        # generate submissions from a model and score them
bun test bench/               # layer model and task-format tests
```

Individual families also run and self-check on their own, for example
`bun run bench:slider:check`, `bun run bench:l4:check`, `bun run bench:v8:check`,
`bun run bench:product:check`, `bun run bench:thread:check` and `bun run bench:cam:check`.
`bun run bench:all` runs every family's `--self-check` and writes one aggregate
matrix; it is a real native-render gate, because each family runner rewrites its
report before the matrix reads it.

A **zero-cost rejudge** replays retained product-trial sources through the current
judge without any model call and prints the bench layer model over that sample:

```bash
bun scripts/eval/rejudge-assembly-trial.ts .agentscad/experiments/<trial-dir>
bun bench/rejudge-diff.ts --before <trial-dir>/report.json --after .agentscad/experiments/rejudged-assembly-*/report.json
```

The rejudge output binds the frozen evaluator source hashes; the diff prints which
evidence ids the current judge added, removed or changed for the same candidate, with
the layer model applied to both sides. Both are new measurements of old candidate
sources. It is not a new model trial, not a comparable series with the
recorded history, and it does not rewrite the paid-trial layer table above; that table
only moves after a new funded run.

External hidden sets are frozen and run separately: `bun run bench:hidden:freeze`
copies a task/submission set into an external directory, hashes it and records a
manifest; `bun run bench:hidden` scores it from that external directory. A
development copy of each family exists, but no copy has an independent maintainer,
so `independentHiddenEvaluation` stays `NOT_RUN`, not `PASS`.

### The thirteen-family gate

The public self-check gate re-runs every family on the same native OpenSCAD backend.
The matrix below is a real run on the integrated `main` tree (commit `6e54984` plus the
documentation restoration that records it), native OpenSCAD 2021.01, **no model calls**.
Family self-check time was about **184 minutes** on this machine during a
heavily loaded run; wall time is not a performance claim.

```
family       self-check cases  refs  adv   unscored  pass  fail  not-run  layers
assembly     OK         20     6     8     6         12    8     0        104/120
gear         OK         6      1     5     0         1     4     1        7/12
slider       OK         17     3     14    0         3     14    0        51/77
l4           OK         5      1     4     0         1     4     0        14/25
twin         OK         6      1     5     0         1     5     0        11/24
vtwin        OK         5      1     4     0         1     4     0        11/20
declaration  OK         4      1     3     0         1     3     0        7/20
v8           OK         15     2     13    0         2     12    1        67/89
planetary    OK         4      1     3     0         1     3     0        4/8
planetary3   OK         4      1     3     0         1     3     0        4/8
product      OK         16     3     13    0         3     12    1        63/112
thread       OK         8      2     6     0         2     5     1        25/35
cam          OK         4      1     3     0         1     3     0        5/8
```

`overall: PASS`; **114 cases** — 24 reference, 84 adversarial, 6 unscored; 30 PASS /
80 FAIL-or-ERROR / 4 NOT_RUN; **373/558** observed layer entries. The six assembly
`unscored` rows are recorded model replays, not new model samples. The gear and thread
`NOT_RUN` rows are adversarial cases rejected by their self-checks; they are not
promoted. `layers` is the sum of observed layers across cases, not a pass rate.

This is a public self-check gate, not independent hidden evaluation, model ability,
physical function or user acceptance. The thread row includes the coaxiality rung
(8 cases / 25-of-35 layers); family detail is in
[`bench/thread/README.md`](./thread/README.md). The v8 row includes contract v5 (the
guide-channel rung: 15 cases / 67-of-89 layers); family detail is in
[`bench/v8/README.md`](./v8/README.md). The product row
includes task 2 and task 3 (16 cases / 63-of-112 layers); family detail is in
[`bench/product/README.md`](./product/README.md). A complete V8 machine, full A001
contract pass, an independent hidden set and a fresh funded product trial remain open.

### The layer table over recorded history

```
layer             pass  fail  error not_run absent pass rate  gap kind        repair target
compile           0     1     0     0       29     0.0%       capability      SCAD compilation
parts-identity    26    3     0     1       0      86.7%      healthy         Selectors and parting strategy
topology          16    5     0     6       3      59.3%      capability      Boolean ops, wall thickness, connectivity
joint-frames      8     0     20    0       2      28.6%      inspect ERROR   Declared axes and coordinate transforms
fit               8     0     20    2       0      26.7%      inspect ERROR   Bore/shaft dimensions and tolerance
retention         0     3     0     23      4      0.0%       missing check   Retention features and latches
assembly-path     3     19    1     3       4      11.5%      capability      Insertion path and clearance
disassembly-path  3     22    3     1       1      10.3%      capability      Removal order
rigid-motion      1     23    1     5       0      3.3%       capability      Kinematics and collision
source-motion     0     3     0     16      11     0.0%      missing check   SCAD parameterisation and pose selectors
reconstruction    8     2     5     13      2      28.6%      missing check   Export, re-assembly and budget
```

What this says is not "the model is bad":

- **`parts-identity` at 86.7% is essentially solved.** More work there is wasted.
- **`rigid-motion` 3.3%, `assembly-path` 11.5%, `disassembly-path` 10.3% are real capability gaps**, and they sit late in the ladder — that is where the current effort belongs.
- **`retention` and `source-motion` are 0% but overwhelmingly `NOT_RUN`.** The model is not failing them; nothing measures them. Talking about model capability on those layers is a category error.
- **`joint-frames` / `fit` show 20 `ERROR` each and need the finding text** before they can be classified, so they are marked "inspect" rather than guessed.

Best real candidate: `guided-gated-hinge-v1`, **8/9 layers**, gate not passed (the only gap is `retention: NOT_RUN`). That is the progress the "measured-core = 0" line hid.

> This table is built from **product trial records**, which is a different chain from `bench/assembly`. `scripts/eval/judge-assembly.ts` now emits `source-motion` and `axial-retention` (and the unresolved-requirement ids) through the trial attribution gate, but every batch in this table was recorded **before** that wiring, so its `NOT_RUN` cells are historical facts, not current gaps. Wiring does not rewrite history: the table moves only when a fresh funded trial produces new records, and no such trial has been run. **What moves a metric is wiring plus a measured run; documentation alone moves neither.**

### The first real baseline

`bun run bench:baseline` generates, extracts, writes and scores directly against an OpenAI-compatible endpoint — **not through the product's `model-router`**, because a model comparison should not inherit the product's routing or prompt.

6 tasks × 1 attempt, **0.391 CNY total** (run 3 in the table below; the two earlier runs cost 0.564 and 0.399 CNY):

| Task | Status | Coverage | Measured clearance |
|---|---|---|---|
| `hinge-45-loose` | PASS | 6/6 | 0.392–0.407 |
| `hinge-60-wide` | PASS | 6/6 | 0.492–0.507 |
| `hinge-90-tight` | PASS | 6/6 | 0.247–0.253 |
| `hinge-captured-45` | PASS | 6/6 | 0.397–0.403 |
| `piston-bore-30` | PASS | 6/6 | 0.387–0.412 |
| `piston-bore-45` | PASS | 6/6 | 0.247–0.253 |

**6/6, every one inside its declared clearance band, and the 2 mm retention pull blocked.** That is a *saturated* result and it should be read as one.

Saturation is not the same as "the tasks are easy". One sample at temperature 0 says nothing about the distribution, and the two earlier runs of the same model on the same tasks scored 4/6 and 5/6. What 6/6 does say is narrower and more useful: **this task set no longer produces a gradient for this model.** A benchmark whose best row is a clean sweep has stopped telling you where to work.

The consequence is not "add more hinge cases". It is that the next increment has to be a harder rung — L3, the slider-crank with a closed loop — because more variants of a solved rung only add rows.

Three runs were needed to get here, and the earlier two are kept rather than overwritten, because each one invalidated the last for a different reason:

| Run | Task prompts | Output contract | Passed | Spend |
|---|---|---|---|---|
| 1 | Chinese | Chinese | 4/6 | 0.564 CNY |
| 2 | Chinese | English | 5/6 | 0.399 CNY |
| 3 | English | English | **6/6** | 0.391 CNY |

Run 2's single failure was `piston-bore-45`: the fit landed in band (0.248–0.252 mm) but the piston interfered during its stroke and on withdrawal — a geometry defect, not a measurement artifact. It is the row that shows the checks can tell "a piston was drawn" from "the requested piston was drawn".

One sample per row at temperature 0: **this is not a language comparison** and must not be quoted as evidence that English prompts work better. The reason run 3 is the recorded one is that it matches the task text and the prompt template that ship in this repository. The other two rows exist so the difference stays visible instead of being quietly replaced.

One earlier failure was a harness limit rather than a model failure: the first pass used `--max-tokens 8192`, three tasks were cut off at **exactly 8192** output tokens, and that surfaced as "no code block found". Raising the cap to 32768 produced real geometry. Counting truncation as a capability failure would have put a tool problem on the model's record.

## 5. Order of work

- [x] **layer scorer**: `bench/layers.ts` + `bench/ladder-report.ts`, over recorded batches
- [x] **layer counting in `bench/assembly`**: every case reports `cover 6/6`, sharing one `scoreEvidence`
- [x] **`retention` and `source-motion` observers**: the capture pull in `hinge-captured-45`, and pose re-rendering across all tasks
- [x] **first model baseline**: DeepSeek v4 flash, 6 tasks, 6/6 — saturated, so the next rung is L3
- [x] **wire both checks into the product's judge**: `scripts/eval/judge-assembly.ts` now emits `source-motion` and `axial-retention` (with unresolved-requirement ids) under the explicit trial-attribution gate, and reports rigid sampling as `sampled-motion` separately from source verification. A zero-cost rejudge of the retained `aVlhoH` candidate reports `retention` PASS, measured joint frames PASS and **9/10 layers** with rigid motion PASS; only `source-motion` stays NOT_RUN because the declaration carries no source pose protocol. The historical layer table is unchanged because those batches predate the wiring and are not a comparable series; moving it needs a fresh funded trial, not a documentation edit
- [x] **L3 slider-crank**: `bench/slider` has 3 tasks (plain, keyed, guided), 4-6 parts and a closed four-joint loop
- [x] **hidden split harness**: 13 family dispatchers, external freeze/run and manifest hashing. Development copies only; **independent hidden evaluation is still `NOT_RUN`** because no independent maintainer exists
- [x] **L5 cross-section rungs**: inline twin, 90° V-twin, planetary / three-planet and the 18-instance V8 shared-pin packaging carrier
- [ ] **connected-crankshaft V8**: a 2026-11-19 layout with webs at ±13 mm still collided with 2-5 rods at the sampled angles. The current `bench/v8` reference has disconnected crank discs and says so
- [ ] **external model baselines on the 13-family set**: needs an explicitly approved paid-model ceiling; the recorded baseline is the 6-task assembly set only

The self-check is **not a CI gate**, by decision. It needs a real OpenSCAD renderer and renders every submission, so it is run on demand: `bun run bench:assembly:check`, or `bun run bench:all` for all thirteen families.

## 6. Anti-degradation

- **Hidden split**: the public task set is for development, the hidden one for reporting. Publish only failures from the latter, so targeted patching is not possible.
- **Adversarial set**: at least one "right shape, wrong number" and one "everything right but no joint" per family. `bench/assembly` has eight, and that is the cheapest and most effective line of defence.
- **Thresholds never move backwards**: after a measurement, a threshold cannot be relaxed; a new value means a new contract version plus the old regression. This rule is already established in [`ASSEMBLY_EVIDENCE_LOG.md`](../docs/ASSEMBLY_EVIDENCE_LOG.md).
- **Coverage cannot rise by deleting layers**: the denominator is frozen in the task definition, and a task-version change must be recorded.

## 7. What this design does not promise

- It does not promise that V8 can be generated autonomously. The current autonomous gate pass count is 0.
- It does not promise coverage equals product quality. Coverage covers **implemented checks** only; an unimplemented layer is not "passing", it is "not in the denominator".
- It does not promise cross-batch comparability. Task sets, prompts and checks all evolve, so historical numbers can be read for shape, never for level.
