# L2.75 epicyclic/planetary gear train (12/12/36)

This is the planetary rung of the gear family: a fixed internal ring, sun input and carrier output, with one measured planet. It reuses the product `measureGearProfile`, `measureGearMarkerAngle` and `checkPlanetaryCoupling`, but calls no model and no product route.

## Task

`tasks/planetary-12-12-36.json`:

- module 2 mm; sun 12, planet 12, internal ring 36 teeth;
- carrier radius 24 mm;
- input poses `[0, 120, 240, -120, -240]`, covering both signs;
- angle tolerance 0.5°, ratio tolerance 0.005, centre-distance tolerance 0.25 mm;
- four selectors: `sun_pose`, `planet_pose`, `ring`, `carrier_pose`.

The scorer makes real renders:

1. the internal ring profile (centre, tooth count, pitch estimate);
2. sun/planet/carrier at each pose, with phase from radial markers;
3. `checkPlanetaryCoupling` checks `ring = sun + 2·planet`, pitch closure, sun/carrier/planet absolute slopes, sign reversal and centre distance;
4. the four parts export separately.

## Result

```
bun run bench:planetary:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 2/2**; 4 parts; carrier/planet residual **0.000°**; measured sun slope 1, carrier 0.25, planet absolute −0.5 |
| `adversarial-carrier-ratio` | FAIL 1/2; carrier 1:1, carrier residual 360°, planet 720° |
| `adversarial-static` | FAIL 1/2; markers do not move with input, residual 120°/240° |
| `adversarial-sun-teeth` | ERROR 0/2; sun 13 teeth breaks `ring = sun + 2·planet`, rejected by the profile gate |

`adversarial-sun-teeth` is a structural gate: it rejects after measuring tooth counts; it does not fabricate a PASS.

## Hidden set

The hidden manifest family `planetary` has an external development copy `hidden-planetary-dev [planetary]`: 1 task / 1 case, reference PASS, `layers 2/2`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- One planet only; no multi-planet load sharing, tooth contact, backlash, efficiency, load, wear or physical manufacture.
- Straight-sided full-depth teeth; pitch radius is a tip/root estimate, not involute metrology.
- Five input poses only; markers and bores are measurement features, not proof of identity for arbitrary generated parts.
- Included in the twelve-family `bench:all` gate and the hidden split; the current gate result is in the main README.
