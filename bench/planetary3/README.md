# L2.8 three-planet epicyclic gear train (12/12/36 × 3)

This is the multi-planet rung: fixed internal ring, sun input and carrier output, with **three planets spaced 120°** and each planet measured independently. It is a single-carrier/single-ring three-planet demonstration, not a complete gearbox or load-sharing mechanism.

## Task

`tasks/planetary-3x-12-12-36.json`:

- module 2 mm; sun 12, planet 12, internal ring 36, carrier radius 24 mm;
- three planet selectors `planet0/1/2_pose`, offsets 0/120/240°;
- input poses `[0, 120, 240, -120, -240]`;
- six parts: sun, ring, carrier and three planets;
- angle tolerance 0.5°, ratio 0.005, centre distance 0.25 mm.

The scorer renders sun/carrier/three planets at every pose and runs `checkPlanetaryCoupling` independently per planet:

- ring = sun + 2·planet;
- pitch closure, sun/carrier/planet absolute slopes;
- sign reversal and planet centre distance;
- six parts export separately.

## Result

```
bun run bench:planetary3:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 2/2**; 6 parts; all three planets PASS; max planet/carrier residual **0.0000°** |
| `adversarial-carrier-ratio` | FAIL 1/2; carrier 1:1, planet 720°, carrier 360° |
| `adversarial-static` | FAIL 1/2; planet 240°, carrier 120° |
| `adversarial-sun-teeth` | ERROR 0/2; sun 13 teeth breaks ring closure, rejected by the profile gate |

Each planet independently measures 12/12/36 teeth, carrier 0.25 and planet −0.5; the reference's three-planet residual is within 3.1e−6°.

## Hidden set

The hidden manifest family `planetary3` has an external development copy `hidden-planetary3-dev [planetary3]`: 1 task / 1 case, reference PASS, `layers 2/2`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- One carrier, one ring, three planets; no multi-stage gearbox, multiple carriers, load sharing, bearings, tooth contact, backlash, efficiency, load, wear or physical manufacture.
- Straight-sided teeth; pitch radius is a tip/root estimate; five discrete poses.
- Planet markers and centres are measurement features, not proof of identity for arbitrary generated parts.
- Included in the twelve-family `bench:all` gate and the hidden split.
