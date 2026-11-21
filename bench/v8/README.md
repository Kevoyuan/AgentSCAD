# L5b/L5c-1 V8 packaging carrier: connected crankshaft, crankcase block/bearings and counterweights

This is the V8 phase/packaging rung: **eight piston-and-rod sets in four 90° phase
groups on two ±45° banks**, one **shared crankpin per phase group with two rods per
pin**, and a **single connected crankshaft**: each pin is joined by webs to short main
journals between the stations, plus end stubs. It is not a complete V8 engine: there is
no cylinder block, bearing shell, counterweight or firing order.

Contract v2 (2026-11-21) made the connected crankshaft a scored requirement. The v1
reference — four separate disc/pin throws with no main shaft — is retained as
`adversarial-disconnected-crank` and must be rejected. Contract v3 added a second task
with a crankcase block and two measured main bearings; contract v4 adds measured
counterweights on the crank web planes. The base carrier keeps its base-plate frame and
no counterweights.

## Task

`tasks/v8-phase-8.json`:

- crank radius 8 mm, rod length 28 mm, half-angle 45°;
- four stations y = −30 / −10 / 10 / 30 with phases 0 / 90 / 180 / 270;
- two banks at y = station ± 3; rods at station ± 5;
- four shared crankpins, two rods per pin; eight rods, eight sliders and 18 instances
  (frame, crank, 8 rods, 8 sliders);
- five input angles 0/90/180/270/360°;
- slider-centre tolerance 0.1 mm;
- requirements: `distinct-exported-parts` (18), `part-connectivity` (true),
  `measured-joint-frames`, `sampled-motion`, `source-motion`.

The scorer re-renders all 18 instances at every angle and:

- compares eight slider centres with the shared closure formula for the four phase groups;
- runs 153 instance-mesh pairs per angle, **765 BVH collision checks** in total;
- confirms the 18 instances export separately with canonical triangle hashes;
- re-executes the source per angle; a static or wrong-phase source cannot pass;
- checks the rendered crank part with **exact STL edge connectivity plus a separating-slab
  test** at 0° and requires one closed edge-connected surface.

## Task 2 — crankcase block with two measured main bearings (contract v3)

`tasks/v8-block-bearings-8.json` keeps the same mechanism contract and adds a crankcase
block to the frame: a base plate, **two main-bearing webs at y = −20 / +20** with journal
bores, and a continuous top rail tying them together. The webs sit at the y planes where
the rotating crank has only the main journal (between the paired web planes), stay inside
|x| ≤ 3 so the slider/rod sweeps are not touched, and connect to the base plate through
their lower halves.

Scored layers:

- `distinct-exported-parts` (18), `part-connectivity` (connected crankshaft),
  `frame-connectivity` (the block is one connected casting), `measured-joint-frames`,
  `sampled-motion`, `source-motion`;
- **`bearing-fit`**: the shared cylindrical-feature measurement binds the rendered block
  bore to the crankshaft journals at both declared stations and requires the whole
  sampled clearance interval inside **0.4–1.6 mm** and the measured axis offset at most
  **0.3 mm**;
- **`counterweight-balance`** (contract v4): on each throw-side web plane (station + 8
  mm), crank material on the pin side must stay inside **11 mm** while material in the
  sector opposite the throw (35° half-angle) must reach at least **12 mm**. The reference
  reaches 17 mm opposite and 10.5 mm on the pin side; this is a geometric
  presence/phase check, not a mass moment or balance-factor calculation.

The measured clearance on the reference is **0.989–1.019 mm** with a 0° axis offset.
The band is a demonstrator tolerance, not a calibrated manufacturing tolerance, bearing
load rating, lubrication or wear model.

## Result

```
bun run bench:v8:check
SELF-CHECK OK: 1 reference(s) pass, 7 adversarial submission(s) rejected.
```

```
task        submission                    status  cover  inst  frames  connect  collide  source  err
v8-phase-8  reference                     PASS    5/5    18    PASS    PASS     PASS     PASS    0.0000
v8-phase-8  adversarial-disconnected-crank FAIL   4/5    18    PASS    FAIL     PASS     PASS    0.0000
v8-phase-8  adversarial-main-shaft        FAIL    4/5    18    PASS    PASS     FAIL     PASS    0.0000
v8-phase-8  adversarial-connected-crank   FAIL    4/5    18    PASS    PASS     FAIL     PASS    0.0000
v8-phase-8  adversarial-phase             FAIL    2/5    18    FAIL    FAIL     PASS     FAIL    11.3137
v8-phase-8  adversarial-static            FAIL    2/5    18    FAIL    FAIL     PASS     FAIL    11.3137
v8-phase-8  adversarial-crank-radius      FAIL    2/5    18    FAIL    FAIL     PASS     FAIL    0.8625
v8-phase-8  adversarial-collision         FAIL    1/5    18    FAIL    FAIL     FAIL     FAIL    6.0000
```

- The connected reference passes all five layers: 18 separately exportable instances,
  765 sampled collision checks separated, 0.0000 mm slider-centre error, one closed
  edge-connected crank surface.
- `adversarial-disconnected-crank` isolates the new requirement: motion, phase and
  source still pass, only `part-connectivity` fails because four disc/pin solids are
  separated by empty slabs.
- `adversarial-main-shaft` (a continuous main shaft) and `adversarial-connected-crank`
  (misoriented webs plus segmented journals) are connected yet still collide with the
  rod sweep, so connectivity cannot substitute for the motion check.
- No candidate is promoted beyond these sampled angles.

Block/bearing task:

| Submission | Result |
|---|---|
| `v8-block-bearings-8/reference` | **PASS 7/7**: 18 instances; connected crank PASS; block PASS; **bearing fit PASS at 0.989–1.019 mm with 0° axis offset**; **counterweight balance PASS** (17 mm opposite / 10.5 mm pin-side on every web plane); 765 sampled collisions separated; source motion PASS |
| `adversarial-baseplate` | ERROR 6/7: the base-plate frame has no bearing bore, so **only `bearing-fit` is ERROR** while every other layer, including the counterweights, passes |
| `adversarial-bearing-clearance` | FAIL 6/7: oversized bores give a clearance outside the band, so **only `bearing-fit` FAILS** |
| `adversarial-disconnected-crank` | FAIL 6/7: the split crankshaft fails **only `part-connectivity`**; bearing fit and counterweights still pass |
| `adversarial-no-counterweight` | FAIL 6/7: removing the lobes makes the opposite-sector extent 2.5 mm, so **only `counterweight-balance` FAILS** |

## Hidden set

The external development copy `hidden-v8-shared-dev [v8]` predates contracts v2–v4 and
must be re-frozen before it is used; until then it does not represent any task. Every
hidden copy remains `independentHiddenEvaluation = NOT_RUN`.

## Boundaries

- **A connected crankshaft plus a two-bearing crankcase is not a complete V8.** There
  are no cylinder bores/heads, counterweights, firing order, load, lubrication, friction
  or wear model, and the bearing fit is a sampled cylindrical clearance rather than a
  calibrated manufacturing or load rating.
- `part-connectivity` / `frame-connectivity` are exact edge connectivity of the crank
  and block parts **at 0°**. They do not prove balance, strength, machining or
  connectivity under rotation.
- `bearing-fit` measures two sampled stations only; it is not continuous rotation,
  bearing clearance over temperature/load, surface finish or press-fit behavior.
- `counterweight-balance` measures material extents on four web planes at one pose; it is
  not a mass moment, balance factor, stress, fatigue or vibration analysis, and it does
  not prove the part is manufacturable.
- Only five discrete angles, mesh-bound slider centres and 765 discrete collisions are
  covered; continuous motion is not established.
- The published thirteen-family matrix row for v8 predates contract v2; a full gate
  rerun replaces it. The family self-check above is the current v8 result.
- The V8 family self-check is 1 reference / 7 adversarial. A complete V8 machine
  (block, bearings, counterweights) remains open.
