# M5 threaded fastener (square profile, M10×1.5)

This rung covers a two-part threaded fastener: a bolt and a nut with a square-profile right-hand 1.5 mm helix. It measures geometric pitch, hand, major/minor diameters and the nut lead/advance over two turns from real meshes. It is **not ISO metric thread metrology**.

## Tasks

### Geometry and lead: `tasks/threaded-fastener-1.5.json`

- selectors `bolt` / `nut`;
- external/internal geometry contract: pitch 1.5, right hand, major/minor diameter windows, thread range;
- motion contract: pitch 1.5, right hand, `minTurns: 2`;
- nine turn angles, 0–720°;
- three evidence layers: `distinct-exported-parts`, `measured-joint-frames`, `rigid-motion`.

The scorer calls `sampleThreadedFastener` and requires only **geometry** and **engagement/lead**. The tool's overall exit/coaxiality status may remain NOT_RUN; it is not scored by this family.

## Exit task

`tasks/threaded-fastener-exit-1.5.json` uses the frozen 12-turn, 90°-step, 0.1 mm-clearance exit contract and 49 turn angles. It scores geometry, engagement/lead and **disassembly-path** (full axial withdrawal). The short-thread adversarial must not pass.

## Result

```
bun run bench:thread:check
SELF-CHECK OK: 2 reference(s) pass, 4 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 3/3**; 2 parts; external/internal geometry PASS; engagement/motion PASS; lead **1.5000 mm/turn**, residual ≈0 |
| `adversarial-plain-bore` | NOT_RUN 1/3; internal plain bore, geometry NOT_RUN |
| `adversarial-spin-only` | FAIL 2/3; nut spins without advancing, motion FAIL |
| `adversarial-wrong-pitch` | FAIL 1/3; pitch 1.25, geometry and motion FAIL |
| `reference` (exit) | **PASS 4/4**; full withdrawal PASS; lead 1.5000 mm/turn |
| `adversarial-short-thread` (exit) | **FAIL 2/4**; geometry PASS, motion NOT_RUN, **disassembly-path FAIL** |

`adversarial-plain-bore` is NOT_RUN rather than a fabricated FAIL/PASS; the self-check still rejects it. The exit reference measures a real full withdrawal; the short thread is rejected by the exit layer.

## Hidden set

The hidden manifest family `thread` has an external development copy `hidden-thread-exit-dev [thread]`: 2 tasks / 2 cases, both references PASS, geometry `layers 3/3` and exit `layers 4/4`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- Square profile, not ISO metric thread; no flank angle, tolerance grade or manufacturing metrology.
- No torque, preload, strength, wear, self-locking, full withdrawal or physical part.
- The geometry task covers nine turn angles; the exit task covers 49 angles and the frozen 12-turn withdrawal. The tool's coaxiality status remains NOT_RUN: the generic cylindrical-feature probe rejects the threaded/hex sections as non-regular polygons, so no coaxiality PASS is claimed. The family claims only measured geometry, motion and exit layers.
- Included in the twelve-family `bench:all` gate and the hidden split. The 88-case gate snapshot predates the exit task; the current thread family has 6 cases and is not in that snapshot.
