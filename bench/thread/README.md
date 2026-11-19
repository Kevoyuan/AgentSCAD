# M5 threaded fastener (square profile, M10×1.5)

This rung covers a two-part threaded fastener: a bolt and a nut with a square-profile right-hand 1.5 mm helix. It measures geometric pitch, hand, major/minor diameters and the nut lead/advance over two turns from real meshes. It is **not ISO metric thread metrology**.

## Task

`tasks/threaded-fastener-1.5.json`:

- selectors `bolt` / `nut`;
- external/internal geometry contract: pitch 1.5, right hand, major/minor diameter windows, thread range;
- motion contract: pitch 1.5, right hand, `minTurns: 2`;
- nine turn angles, 0–720°;
- three evidence layers: `distinct-exported-parts`, `measured-joint-frames`, `rigid-motion`.

The scorer calls `sampleThreadedFastener` and requires only **geometry** and **engagement/lead**. The tool's overall exit/coaxiality status may remain NOT_RUN; it is not scored by this family.

## Result

```
bun run bench:thread:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 3/3**; 2 parts; external/internal geometry PASS; engagement/motion PASS; lead **1.5000 mm/turn**, residual ≈0 |
| `adversarial-plain-bore` | NOT_RUN 1/3; internal plain bore, geometry NOT_RUN |
| `adversarial-spin-only` | FAIL 2/3; nut spins without advancing, motion FAIL |
| `adversarial-wrong-pitch` | FAIL 1/3; pitch 1.25, geometry and motion FAIL |

`adversarial-plain-bore` is NOT_RUN rather than a fabricated FAIL/PASS; the self-check still rejects it.

## Hidden set

The hidden manifest family `thread` has an external development copy `hidden-thread-dev [thread]`: 1 task / 1 case, reference PASS, `layers 3/3`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- Square profile, not ISO metric thread; no flank angle, tolerance grade or manufacturing metrology.
- No torque, preload, strength, wear, self-locking, full withdrawal or physical part.
- Only nine turn angles are covered. The tool's exit/coaxiality status may remain NOT_RUN; the family claims only the listed geometry and motion layers.
- Included in the twelve-family `bench:all` gate and the hidden split.
