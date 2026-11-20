# L5b V8 shared-pin/packaging carrier (4 shared pins, 8 cylinders)

This is the V8 phase/packaging rung: **eight piston-and-rod sets in four 90° phase groups on two ±45° banks**, one **shared crankpin per phase group with two rods per pin**. The crank part is four separate discs/pins with **no main shaft**; the frame is only a base plate, with no block, bearings or firing order. It is not a complete crankshaft V8, but it is closer to a V8 shared-pin layout than independent pins per cylinder.

## Task

`tasks/v8-phase-8.json`:

- crank radius 8 mm, rod length 28 mm, half-angle 45°;
- four stations y = −30 / −10 / 10 / 30 with phases 0 / 90 / 180 / 270;
- two banks at y = station ± 3;
- four shared crankpins, two rods per pin; eight rods, eight sliders and 18 instances (frame, crank, 8 rods, 8 sliders);
- five input angles 0/90/180/270/360°;
- slider-centre tolerance 0.1 mm.

The scorer re-renders all 18 instances:

- compares eight slider centres with the shared closure formula for the four phase groups;
- runs 153 instance-mesh pairs per angle, **765 BVH collision checks** in total;
- canonical triangle hashes confirm the 18 instances export separately;
- the source is re-executed per angle; a static or wrong-phase source cannot pass.

## Result

```
bun run bench:v8:check
SELF-CHECK OK: 1 reference(s) pass, 6 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 4/4**; 18 instances; all 765 collision checks separate; position error **0.0000 mm** |
| `adversarial-phase` | FAIL 2/4; all phase groups forced to 0°, error 11.3137 mm |
| `adversarial-static` | FAIL 2/4; does not move with angle, error 11.3137 mm |
| `adversarial-crank-radius` | FAIL 2/4; crank 9 mm, error 0.8625 mm, collisions still separate |
| `adversarial-collision` | FAIL 1/4; right slider moved to the left bank, error 6.0000 mm and collision failure |
| `adversarial-main-shaft` | **FAIL 3/4; position/contour/source PASS, only `sampled-motion` FAIL**; a continuous main shaft intersects the rods |
| `adversarial-connected-crank` | **FAIL 3/4; position/contour/source PASS, only `sampled-motion` FAIL**; webs plus segmented main journals still intersect all eight rods |

At 0° the eight sliders form phase groups 0/90/180/270; the two banks in a group share axial position, have opposite x, and are separated by station ±3 in y.

## Hidden set

The hidden manifest family `v8` has an external development copy `hidden-v8-shared-dev [v8]`: 1 task / 1 case, reference PASS, `layers 4/4`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- **Four shared crankpins, but the crank part is four disconnected discs/pins with no main shaft**; this is not a complete crankshaft V8 and must not be called a manufacturable crankshaft. `adversarial-main-shaft` and `adversarial-connected-crank` show that both a continuous main shaft and a webs-plus-segmented-main candidate are rejected by rod collisions; a future connected crank must actually clear the sweep of all eight rods.
- **The frame is only a base plate**; no block, tubes, bearings or crankcase, and frame connectivity is not scored.
- Only five discrete angles, mesh-bound slider positions and 765 discrete collisions are covered; no continuous motion, load, lubrication, friction, wear, firing/valve timing or physical function.
- The V8 family self-check is 1 reference / 6 adversarial; the twelve-family `bench:all` gate includes this seven-case V8 row. A complete shared-crankshaft V8 remains open.
