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
| L1 | two-part revolute (hinge, loose/tight) | 1 joint, 2 parts | M3 | in `bench/assembly` |
| L2 | two-part prismatic (piston in a barrel) | 1 joint, 2 parts | M3 | in `bench/assembly` |
| L3 | single-cylinder slider-crank | 4-joint loop, 6 parts | M4 | tool-level verified, not wired into the benchmark |
| L4 | multi-joint with retention | 4 joints, 7 parts / 9 instances | M4 | original fixture exists, A001 PASS (researcher-assisted) |
| L5 | V8 cross-section (two cylinders) → full V8 | 8 kinematic chains | M6 | not started |

**Why a ladder:** failing L5 does not mean L3 does not exist. With rungs, a score can say which layer is stuck even when the top fails.

### 2.3 The layers

Each layer is `PASS | FAIL | SKIP | ERROR | NOT_RUN`. Within a layer the **worst** status wins: a PASS next to a FAIL does not become a PASS.

| Layer | Evidence ids | What to repair when it drops |
|---|---|---|
| `compile` | `compile` | SCAD compilation |
| `parts-identity` | `distinct-exported-parts`, `measured-part-identity` | selectors, parting strategy |
| `topology` | `part-connectivity` | booleans, wall thickness, connectivity |
| `joint-frames` | `measured-joint-frames` | declared axes, coordinate transforms |
| `fit` | `diametral-clearance` | bore/shaft dimensions, tolerance |
| `retention` | `axial-retention`, `unresolved-axial-retention` | retention features, latches |
| `assembly-path` | `assembly-path` | insertion path, clearance |
| `disassembly-path` | `disassembly-path` | removal order |
| `rigid-motion` | `rigid-motion`, `sampled-motion`, `motion-range-deg`, `motion-range-negative-end`, `motion-range-positive-end` | kinematics, collision |
| `source-motion` | `source-motion` | SCAD parameterisation, pose selectors |
| `reconstruction` | `assembly-reconstruction` | export, re-assembly, budget |

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
bun run bench:ladder          # score recorded trial reports (no model, no render, no spend)
bun run bench:ladder --json out.json
bun run bench:assembly        # the geometry benchmark over all submissions
bun run bench:assembly:check  # self-check: references pass, cheats are caught
bun run bench:baseline        # generate submissions from a model and score them
bun test bench/               # layer model and task-format tests
```

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

> This table is built from **product trial records**, which is a different chain from `bench/assembly`. The benchmark can now measure `retention` and `source-motion`, but until the product's judge emits those evidence ids the historical `NOT_RUN` will not disappear. **What moves a metric is wiring, not documentation.**

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
- [ ] **wire both checks into the product's judge**: the benchmark being able to measure is not the same as the trial emitting those ids. Until `judge-assembly` is wired, the historical layer table keeps its `NOT_RUN`s
- [ ] **L3 slider-crank** (1–2 weeks): multi-joint kinematics and a closed loop — the real threshold
- [ ] **hidden split + external model baselines** (1 week): without these it is a self-test tool
- [ ] **L5 two-cylinder cross-section** (2–3 weeks): proves the ladder extends to V8 without rewriting the checks

The self-check is **not a CI gate**, by decision. It needs a real OpenSCAD renderer and renders every submission, so it is run on demand: `bun run bench:assembly:check`.

## 6. Anti-degradation

- **Hidden split**: the public task set is for development, the hidden one for reporting. Publish only failures from the latter, so targeted patching is not possible.
- **Adversarial set**: at least one "right shape, wrong number" and one "everything right but no joint" per family. `bench/assembly` has eight, and that is the cheapest and most effective line of defence.
- **Thresholds never move backwards**: after a measurement, a threshold cannot be relaxed; a new value means a new contract version plus the old regression. This rule is already established in [`ASSEMBLY_EVIDENCE_LOG.md`](../docs/ASSEMBLY_EVIDENCE_LOG.md).
- **Coverage cannot rise by deleting layers**: the denominator is frozen in the task definition, and a task-version change must be recorded.

## 7. What this design does not promise

- It does not promise that V8 can be generated autonomously. The current autonomous gate pass count is 0.
- It does not promise coverage equals product quality. Coverage covers **implemented checks** only; an unimplemented layer is not "passing", it is "not in the denominator".
- It does not promise cross-batch comparability. Task sets, prompts and checks all evolve, so historical numbers can be read for shape, never for level.
