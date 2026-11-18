# assembly-bench — a small benchmark for functional assembly generation

A **narrow but complete** benchmark: given one natural-language request, can a model produce two-part geometry that actually assembles, turns and comes apart?

Every question it asks is machine-decidable:

1. do the two selectors really export two different solids?
2. does the bore/shaft diametral clearance land inside the specified window?
3. does the moving part avoid the fixed part anywhere in the declared sweep?
4. can the moving part be withdrawn along the axis?

No human labelling, no vision model, no Chamfer distance. Every verdict comes from a deterministic geometry measurement.

## Why this shape

Existing CAD generation benchmarks (DeepCAD / ABC / Fusion 360 Gallery / Text2CAD) almost all score **static geometry**: reconstruction error, sequence similarity, Chamfer distance. None of them asks "does this thing collide when it moves" or "is the clearance really 0.4 mm".

The repository already contains a real geometry verifier (`src/lib/assembly/`, `src/lib/geometry/`). This benchmark is that verifier with the product coupling removed and a model-agnostic submission interface on top.

## Two design rules

**The task owns the geometry contract; the submission owns geometry only.**
A model never declares its own joint, clearance band or motion range, so it cannot widen the acceptance window into whatever it happened to draw. The task JSON decides everything; the model's output is one `.scad` file.

**Evidence is graded, and `NOT_RUN` is never a pass.**
Every verdict is tagged `PASS | FAIL | SKIP | ERROR | NOT_RUN`. A render failure is `ERROR`, not `FAIL` — there was no candidate to measure. Anything not measured stays `NOT_RUN` and fails the gate.

## Running it

```bash
bun run bench:assembly            # full matrix, writes report.json
bun run bench:assembly:check      # self-check: references must pass, cheats must be caught
bun run bench:baseline            # generate submissions from a model, then score them
bun run bench:assembly --task hinge-45-loose --submission reference --verbose
```

Requires a local `openscad`, or set `AGENTSCAD_OPENSCAD_BACKEND=wasm` to use the checksum-pinned WASM runtime.

## Submission format

One directory per task, one `.scad` file per submission:

```
submissions/<task-id>/<submission>.scad
```

The filename states the expected outcome, and that is what the self-check reads:

| Filename | Expected | Meaning |
|---|---|---|
| `reference.scad` | must PASS | the reference solution, proving the task is solvable |
| `adversarial-*.scad` | must not PASS | a cheat, proving the checks have teeth |
| `model-*.scad` | no expectation | a recorded model attempt (`unscored`) |

A submission selects parts with the `agentscad_part` variable. The harness renders it twice, with `-D agentscad_part=fixed` and `-D agentscad_part=moving`, and both results must live in **the same assembly coordinate system**.

```scad
agentscad_part = "all";
$fn = 64;

module fixed_leaf() { /* fixed part with the pin */ }
module moving_leaf() { /* moving part with the bore */ }

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all" || agentscad_part == "moving") moving_leaf();
}
generated_part();
```

`-D` overrides in-file assignments, so declaring `"all"` at the top is a safe default.

## Task format

See [`tasks/hinge-45-loose.json`](tasks/hinge-45-loose.json). A task declares:

- `parts[]` — part ids and their selectors
- `joint` — joint type, axis origin, axis direction, which part carries the bore, which part moves
- `requirements[]` — the frozen acceptance contract (`equals` / `range` / `atLeast`)
- `motion` — an angle range for a revolute joint, or a stroke for a prismatic one, plus the sample count
- `disassembly` — withdrawal distance and sample count
- `pose` (optional) — the SCAD variable the submission must honour, the values to re-render at, and the tolerance
- `retention` (optional) — the pull distance that must be **blocked**

Two joint types are covered. The fit is measured by the benchmark itself with `measureCylindricalFeature`, not by the product's fit check, because that check is revolute-only and borrowing it would narrow the benchmark and bind it to a module the product keeps refactoring.

## Current task set

| Task | Family | Clearance band (mm) | Motion |
|---|---|---|---|
| `hinge-45-loose` | revolute | 0.35 – 0.45 | ±45° |
| `hinge-90-tight` | revolute | 0.20 – 0.30 | ±90° |
| `hinge-60-wide` | revolute | 0.40 – 0.55 | ±60° |
| `piston-bore-30` | prismatic | 0.35 – 0.45 | 30 mm stroke |
| `piston-bore-45` | prismatic | 0.20 – 0.30 | 45 mm stroke |
| `hinge-captured-45` | revolute + axial retention | 0.35 – 0.45 | ±45°, 2 mm pull blocked |

The two families are the two basic joints of a V8. Within a family only the tolerance and the travel change — these tasks measure **whether the specified tolerance is hit**, not "can a hinge shape be drawn".

What separates the families is not a parameter but a **semantic**: in a hinge the bore-carrying part is the one that turns (`borePartId == movingPartId`), in a piston it is the one that stays put (`borePartId != movingPartId`). `joint.movingPartId` exists so one scorer can cover both without assuming "the one with the hole is the one that moves".

## Current results

```
task              submission                    status  cover   parts  clearance      motion  disasm
hinge-45-loose    adversarial-floating          ERROR   4/6     PASS   —              PASS    PASS
hinge-45-loose    adversarial-fused-bore        ERROR   2/6     PASS   —              FAIL    FAIL
hinge-45-loose    adversarial-solid-blob        ERROR   1/6     FAIL   -8.284-8.284   FAIL    FAIL
hinge-45-loose    adversarial-static-pose       FAIL    5/6     PASS   0.400-0.415    PASS    PASS
hinge-45-loose    adversarial-tight-bore        FAIL    5/6     PASS   0.050-0.065    PASS    PASS
hinge-45-loose    adversarial-whole-rotation    FAIL    5/6     PASS   0.400-0.415    PASS    PASS
hinge-45-loose    model-deepseek-v4-flash       PASS    6/6     PASS   0.392-0.407    PASS    PASS
hinge-45-loose    reference                     PASS    6/6     PASS   0.400-0.415    PASS    PASS
hinge-60-wide     model-deepseek-v4-flash       PASS    6/6     PASS   0.448-0.452    PASS    PASS
hinge-60-wide     reference                     PASS    6/6     PASS   0.450-0.465    PASS    PASS
hinge-90-tight    model-deepseek-v4-flash       PASS    6/6     PASS   0.242-0.257    PASS    PASS
hinge-90-tight    reference                     PASS    6/6     PASS   0.250-0.265    PASS    PASS
hinge-captured-45 adversarial-no-cap            FAIL    5/6     PASS   0.400-0.415    PASS    —
hinge-captured-45 model-deepseek-v4-flash       PASS    6/6     PASS   0.397-0.403    PASS    —
hinge-captured-45 reference                     PASS    6/6     PASS   0.400-0.415    PASS    —
piston-bore-30    adversarial-tight-bore        FAIL    5/6     PASS   0.100-0.124    PASS    PASS
piston-bore-30    model-deepseek-v4-flash       PASS    6/6     PASS   0.387-0.412    PASS    PASS
piston-bore-30    reference                     PASS    6/6     PASS   0.400-0.425    PASS    PASS
piston-bore-45    model-deepseek-v4-flash       FAIL    4/6     PASS   0.248-0.252    FAIL    FAIL
piston-bore-45    reference                     PASS    6/6     PASS   0.250-0.274    PASS    PASS
```

Measured clearance matches the analytic value (6.40 mm inscribed bore − 6.00 mm circumscribed pin = 0.400 mm; 10.40 − 10.00 = 0.400 mm), so the measurement chain has no systematic bias.

`model-*` submissions are **the artefacts being scored**: the self-check neither rewards nor punishes them (`expectedOutcome` returns `unscored`). They are produced by `bun run bench:baseline`; see [bench/README.md](../README.md).

### What the adversarial set proves

Each cheat targets exactly one check:

| Submission | What it exploits | Result |
|---|---|---|
| `adversarial-solid-blob` | one solid wearing two selectors | `distinct-exported-parts` FAIL |
| `adversarial-fused-bore` | a bore-shaped part with no bore | fit ERROR + motion FAIL |
| `adversarial-tight-bore` | perfectly correct shape, clearance off by 0.35 mm | only `diametral-clearance` FAIL |
| `adversarial-floating` | two solids that never touch | fit ERROR |
| `adversarial-static-pose` | declares a pose parameter and ignores it | `source-motion` FAIL |
| `adversarial-whole-rotation` | the pose acts on the whole assembly | `source-motion` FAIL |
| `adversarial-no-cap` | no pin head, so the leaf slides straight off | `axial-retention` FAIL |
| piston `adversarial-tight-bore` | the same clearance failure on the prismatic family | only `diametral-clearance` FAIL |

**`adversarial-floating` is the most important row.** Part count, motion and disassembly all PASS, because the two solids genuinely do not interfere and genuinely do separate — they simply never form a joint. Only the fit measurement stops it. The lesson: **no single check is sufficient, and deleting the fit check would make this benchmark decorative.**

`adversarial-tight-bore` matters for a different reason: it shows the checks can tell "a hinge was drawn" from "the requested hinge was drawn".

## Coverage is not case count

These are routinely conflated, but the cost curves are completely different:

| What you add | Marginal cost | What you get |
|---|---|---|
| another case in a family (new tolerance/travel) | one JSON + one SCAD, ~10 minutes | degrees of freedom, no coverage |
| another family (prismatic) | one joint type + one motion sampler | real coverage |
| a closed-loop mechanism (slider-crank) | multi-joint kinematics + loop closure | V8-class mechanisms |
| a free-form part (impeller, housing) | an entirely new check: surface similarity, wall thickness, flow path | a different evaluation axis |

So "100 cases" and "100 capabilities" are not the same thing. This benchmark has 6 cases and 2 capabilities, and what makes it worth anything is the checks, not the row count.

## Layer coverage

Besides `status` (the delivery gate), every case reports `cover`:

```
task              submission                status  cover   parts  clearance      motion  disasm
hinge-45-loose    adversarial-floating      ERROR   4/6     PASS   —              PASS    PASS
hinge-45-loose    reference                 PASS    6/6     PASS   0.400-0.415    PASS    PASS
```

`status` answers "can this case be delivered"; `cover` answers "of the layers we can see, how many passed". `adversarial-floating` is the case where the two separate: 4 of 6 layers pass, but the layer it fails is exactly where it cheats, so the gate still fails.

The denominator is **the number of layers this case produced evidence for**. Unobserved layers are listed in `report.json` under `layers.coverage.unobserved` and enter neither numerator nor denominator. The full layer list, the gap diagnosis and the cross-batch report are in [`bench/README.md`](../README.md).

## Two checks that are easy to build as shells

Both of these layers sat at `NOT_RUN` for a long time in the trial history, and each one had a trap.

### `source-motion`: does the source itself move?

The original motion check rotated the mesh **in the evaluator**, which proves only that the geometry does not collide — not that the model's source is parameterised. `source-motion` re-renders the submitted SCAD through the task's pose parameter (`hinge_angle` / `piston_stroke`) and compares.

The first version used a centroid comparison and was useless: weight a hinge's moving leaf by vertex count and it is mostly knuckle, so its centroid sits near the axis and a 45° rotation moves it by 0.42 mm — smaller than the tolerance. It now uses a **bidirectional Hausdorff distance**: transform the reference pose's point set by the expected rigid motion and measure the worst nearest-neighbour deviation. A rigid part gives ~1e-6 mm; a static source gives ~10 mm.

Two guards against a vacuous pass:

- if the declared poses cannot move the part further than the tolerance, the result is `NOT_RUN`, not a pass — otherwise "a moving source" and "a static source" measure identically.
- the grounded part's geometry must be unchanged between the first and last pose, otherwise the pose is acting on the whole assembly. `adversarial-whole-rotation` is exactly that case.

### `axial-retention`: blocked counts as pass

The semantic is **the pull is blocked**, not "the part can be pulled". The measurement confirms the parts are separate at the assembled pose, then translates 2 mm along the axis; interference means the retention feature is doing its job.

There is a structural trade-off the task has to state: **retention and withdrawability are mutually exclusive.** That is why `hinge-captured-45` has no `disassembly-path` requirement, and why the schema refuses a task that declares both — such a task could never be satisfied.

`adversarial-no-cap` is the reason this check exists: correct part count, correct fit, correct motion, a source that poses itself, and no pin head. Without this layer, "the leaf can be pulled straight off" would score as a success.

## Known boundaries (do not overclaim)

- **The samples are a grid.** Poses between samples are not covered; `motion.steps` and `disassembly.steps` define the coverage.
- **This is not a physical-realism proof**: no print tolerance, material, load or fatigue.
- **`disassembly-path` proves only that translation along the axis does not interfere.** It does not prove a valid assembly sequence exists (that needs the heavier `rigid-pose-path` sequence solver).
- **One joint, two parts per task.** A real V8 is eight piston/rod groups, several shafts and closed kinematic chains — that needs multi-joint kinematics, not more parameters.
- **`source-motion` verifies rigid consistency under the pose parameter only.** It does not verify the parameter covers the full travel, and it does not verify the motion is *mechanism* motion rather than every part having its own hardcoded angle — the latter needs multi-joint constraints.
- **`axial-retention` tests one pull distance.** It does not test pull-out force, fatigue, or a latch's release path.
- **A prismatic joint's stroke and withdrawal share a direction**: the piston's stroke and its extraction are both along +Z, so the two checks are not independent in direction.
- **No hidden split**: tasks and reference solutions are both in the repository. Becoming a publishable benchmark requires an unpublished split and external baselines.
- **Coupled to product geometry code**: `score.ts` imports `src/lib/geometry/*` and `src/lib/assembly/*` primitives. A real public release needs the verifier extracted into a standalone package.
- **`adversarial-*` covers one task per family.** The other tasks currently have a reference only.

## What is still missing to be a real benchmark

1. Grow the task set from 6 to 100+, and have **people who have not read the checks** write the reference solutions (otherwise the checks get tuned against the references).
2. Carve out a hidden split and publish only the scorer and the submission format.
3. Run 6–8 models with multiple samples and publish the table. One model is a baseline row, not a comparison.
4. Extract `src/lib/assembly/` into a standalone package and cut the dependency on product internals.
5. Grow the adversarial set to 20+ and publish it — a benchmark that can be gamed is worse for your credibility than no benchmark.

## Files

| File | Responsibility |
|---|---|
| [`bench.ts`](bench.ts) | task format, validation, loading, status aggregation |
| [`score.ts`](score.ts) | render → fit → motion sampling → disassembly sampling → verdicts |
| [`run.ts`](run.ts) | CLI, matrix output, `--self-check` |
| `tasks/*.json` | the frozen task set |
| `submissions/*/*.scad` | reference solutions, cheats and model artefacts |
| `report.json` | generated evidence record (gitignored) |

Every case in `report.json` carries `provenance` (OpenSCAD version, backend, platform, runtime), `sourceSha256`, a per-check `reason` and `unknowns`. Those fields exist for the same reason as the comments in the code: a score whose method is unknown is not a score.
