# Product-path preparation families

These families call the real product preparation path, not a tool-level renderer.
Task 1 (`guided-product-8-28`) exercises a static six-part guided/retained
declaration. Task 2 (`product-slider-crank-360`) exercises the **contract-driven**
multi-joint path: `prepareContractAssembly` derives the requirement contract from the
task request, recognizes the declared slider-crank, derives three revolute fits and
their joint frames, and measures sampled rigid motion plus source-driven poses.

## Task 1 — P-A08 static guided/retained (six parts)

`tasks/guided-product-8-28.json` scores seven layers the product-preparation path can
measure without a confirmed requirement contract:

- `distinct-exported-parts`, `part-connectivity`, `assembly-reconstruction`,
  `assembly-path` (reverse of declared removal), `disassembly-path`,
  `diametral-clearance` (one eccentric revolute fit, 0.1–0.6 mm), and
  `measured-joint-frames` for that same eccentric fit.

Fit and joint frames cover only the eccentric revolute. Main-shaft and wrist stations
are not valid cylindrical probes in this fixture and remain NOT_RUN. Motion, source
motion and physical function are outside this task.

## Task 2 — contract-driven slider-crank (four parts, A08 measurement half)

`tasks/product-slider-crank-360.json` carries the natural-language request it was
derived from:

> Build a single-cylinder slider-crank: crank radius 8 mm, rod length 28 mm, diametral
> clearance 0.1 to 0.6 mm, full 360 degree rotation.

The scorer derives the contract with `deriveRequirementContract` and passes it as a
**bench trial-attribution gate** (`PRODUCT_BENCH_TRIAL_GATE_REASON`): the derived
contract selects what is measured, but it is not user confirmation, acceptance or a
product requirement contract. `prepareContractAssembly` then derives the
slider-crank kinematics and the three revolute fits from the confirmed declaration.

Scored layers:

- `distinct-exported-parts` (4), `part-connectivity`, `assembly-reconstruction`;
- `diametral-clearance` and `measured-joint-frames` for the three revolute fits
  (`crank_axis`, `crank_pin`, `wrist`);
- `rigid-motion` from the sampled rigid-pose evidence;
- `source-motion` from the independent source-driven pose verification.

The fixture declares no assembly/disassembly operations, so those layers stay
unobserved instead of being faked. The source-driven pose verification has a fixed
wall-clock budget; a loaded host can return an honest NOT_RUN, which is not a pass.

## Task 3 — retained-key disassembly (five parts, A08 retention/disassembly half)

`tasks/product-keyed-slider-crank-disassembly.json` uses the original keyed fixture:
five parts (frame, crank, rod, slider, eccentric eccentric retention key), six
connections and a declared removal order in which the key must come out before the
slider. The submission declaration in `reference.scad` adds the four mirrored insertion
operations, so the product path measures **both** the declared removal order and the
declared insertion order on rendered part meshes.

The declaration adds the bore stations of the three revolute joints (main shaft, crank
pin, wrist), so the product path also measures **three diametral fits and their joint
frames** against the same 0.1–0.6 mm band. The fixture declares no source pose parameter,
so rigid motion and source motion stay unobserved instead of being faked; they are not
listed as required.

## Task 4 — nine-pose source verification (four parts, A08 pose-coverage half)

`tasks/product-slider-crank-nine-pose.json` runs the same contract-derived
single-cylinder slider-crank through the product preparation path and **additionally**
renders and verifies **nine listed source poses** with the production slider-crank
source protocol:

- angles `0, 40, 80, 120, 160, 200, 240, 280, 320` degrees inside the declared full
  360-degree range;
- each listed pose must reconstruct the complete assembly at that input and pass
  complete bidirectional surface correspondence against the independently derived
  expectation; a pose with no independent surface-change witness stays NOT_RUN;
- the wall-clock budget is 300 s for the nine poses; a loaded host can still return an
  honest NOT_RUN.

The evenly spaced 0/45/.../360 set was rejected during development: poses near 135–225°
are symmetric under the fixture's crank geometry, so the strict surface-change witness
could not certify motion and the whole run stayed NOT_RUN. The shipped 40° grid avoids
those ambiguous angles; this is a property of the fixture, not a general protocol fix.

Result:

| Submission | Result |
|---|---|
| `reference` | **PASS 5/5**: connectivity, reconstruction, rigid motion, nine-pose source verification all PASS |
| `adversarial-static` | FAIL 4/5; the source ignores the angle, so `source-motion` and `source-motion-nine` FAIL |
| `adversarial-crank-radius` | FAIL 2/5; reconstruction is NOT_RUN, rigid motion and both source layers FAIL |

## Result

```
bun run bench:product:check
SELF-CHECK OK: 2 reference(s) pass, 9 adversarial submission(s) rejected.
```

Task 1 (unchanged by task 2):

| Submission | Result |
|---|---|
| `guided-product-8-28/reference` | PASS 7/7; 6 parts; topology/reconstruction/assembly/disassembly PASS; eccentric fit 0.395–0.405 mm PASS; joint frames PASS |
| five adversarial submissions | rejected 3/7–5/7 on identity, reconstruction, removal order, fit or joint frames |

Task 2:

| Submission | Result |
|---|---|
| `product-slider-crank-360/reference` | **PASS 7/7**; 4 parts; 3 revolute fits PASS; joint frames PASS; reconstruction PASS; **rigid-motion PASS**; **source-motion PASS** |
| `adversarial-static` | FAIL 6/7; every measured layer passes except **`source-motion` FAIL** — the rigid transforms come from the declaration, so only independent source re-rendering catches a static source |
| `adversarial-crank-radius` | FAIL 3/7; `rigid-motion` FAIL, `source-motion` FAIL, `measured-joint-frames` FAIL (crank-pin frame), reconstruction NOT_RUN |
| `adversarial-wrist-frame` | FAIL 4/7; `measured-joint-frames` FAIL, motion and source motion NOT_RUN rather than promoted |
| `adversarial-declaration-missing` | ERROR 0/7; blocked before any layer because the embedded declaration is absent |

The static adversarial is the reason `source-motion` is scored separately from
`rigid-motion`: declared transforms can be consistent while the source does not move.

Task 3:

| Submission | Result |
|---|---|
| `product-keyed-slider-crank-disassembly/reference` | **PASS 7/7**: 5 parts; connectivity PASS; reconstruction PASS; three revolute fits PASS (measured clearance 0.395–0.405 mm inside the 0.1–0.6 mm band) and their joint frames PASS; **assembly-path PASS**; **disassembly-path PASS** |
| `adversarial-wrong-order` | FAIL 5/7; removing the slider before the eccentric key **fails `disassembly-path`** while identity, topology, reconstruction, fits and joint frames still pass |
| `adversarial-missing-insertions` | NOT_RUN 6/7; the declared removals pass but `assembly-path` is NOT_RUN, so it is not promoted to a pass |
| `adversarial-key-declaration-removed` | ERROR 0/7; the declaration no longer matches the rendered parts and is blocked before measurement |
| `adversarial-declaration-missing` | ERROR 0/7; blocked before any layer |

## Hidden set

The external development copy for the product family predates tasks 2 and 3 and must be
re-frozen before it is used. Every hidden copy remains
`independentHiddenEvaluation = NOT_RUN`.

## Boundaries

- The derived contract in the bench is a **measurement-attribution gate**, not user
  confirmation, user acceptance or a product requirement contract.
- Only the declared protocol poses and sampled rigid motion are covered; this is not
  continuous motion, contact tolerance, load, lubrication, friction, wear or physical
  function.
- Task 2 has no declared assembly or removal operations, so its assembly/disassembly
  order is unobserved; task 3 covers three revolute fits and joint frames plus the
  declared removal and insertion orders of a retained-key mechanism, but only at the
  sampled rigid poses. Task 4 covers nine listed source poses inside the declared range,
  but those are nine samples, not continuous motion. It is not continuous motion, tool
  access, tolerance or physical function, and there is still no interactive nine-plus-pose
  product workflow or user acceptance. A08 remains partial.
- The fixture is an original researcher-authored demonstration part; a source PASS is
  not evidence that autonomous generation produces this mechanism.
- No model calls, no deployment and no physical claim.
