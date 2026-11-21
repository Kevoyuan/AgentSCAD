# L5b V8 shared-pin/packaging carrier with a connected crankshaft (contract v2)

This is the V8 phase/packaging rung: **eight piston-and-rod sets in four 90° phase
groups on two ±45° banks**, one **shared crankpin per phase group with two rods per
pin**, and a **single connected crankshaft**: each pin is joined by webs to short main
journals between the stations, plus end stubs. It is not a complete V8 engine: there is
no cylinder block, bearing shell, counterweight or firing order.

Contract v2 (2026-11-21) made the connected crankshaft a scored requirement. The v1
reference — four separate disc/pin throws with no main shaft — is retained as
`adversarial-disconnected-crank` and must be rejected.

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

## Hidden set

The external development copy `hidden-v8-shared-dev [v8]` predates contract v2 and must
be re-frozen before it is used; until then it does not represent this task. Every hidden
copy remains `independentHiddenEvaluation = NOT_RUN`.

## Boundaries

- **A connected crankshaft is not a complete V8.** The frame is a base plate; there is
  no cylinder block, bearing shell, counterweight, firing order, load, lubrication,
  friction or wear model.
- `part-connectivity` is exact edge connectivity of **the crank part at 0°**. It does not
  prove balance, strength, bearing fit, machining or connectivity under rotation.
- Only five discrete angles, mesh-bound slider centres and 765 discrete collisions are
  covered; continuous motion is not established.
- The published thirteen-family matrix row for v8 predates contract v2; a full gate
  rerun replaces it. The family self-check above is the current v8 result.
- The V8 family self-check is 1 reference / 7 adversarial. A complete V8 machine
  (block, bearings, counterweights) remains open.
