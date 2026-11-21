# M5 threaded fastener (square profile, M10×1.5)

This rung covers a two-part threaded fastener: a bolt and a nut with a square-profile right-hand 1.5 mm helix. It measures geometric pitch, hand, major/minor diameters, the nut lead/advance over two turns and thread-to-body coaxiality from real meshes. It is **not ISO metric thread metrology**.

## Tasks

### Geometry and lead: `tasks/threaded-fastener-1.5.json`

- selectors `bolt` / `nut`;
- external/internal geometry contract: pitch 1.5, right hand, major/minor diameter windows, thread range;
- motion contract: pitch 1.5, right hand, `minTurns: 2`;
- nine turn angles, 0–720°;
- four evidence layers: `distinct-exported-parts`, `measured-joint-frames`, `rigid-motion` and `thread-coaxiality`.

The scorer calls `sampleThreadedFastener` for geometry and engagement/lead, and separately measures coaxiality from the rendered bolt/nut meshes: within a two-pitch band of the threaded section the full helix covers at least one turn, so the lateral bounding-box centre of that band is the thread axis; the body axis comes from the bolt head (or the nut outside the thread band). Each part must stay within **0.05 mm** of its body axis. The tool's own exit/coaxiality verdicts remain outside this family.

## Exit task

`tasks/threaded-fastener-exit-1.5.json` uses the frozen 12-turn, 90°-step, 0.1 mm-clearance exit contract and 49 turn angles. It scores geometry, engagement/lead, **disassembly-path** (full axial withdrawal) and coaxiality. The short-thread adversarial must not pass.

## Result

```
bun run bench:thread:check
SELF-CHECK OK: 2 reference(s) pass, 4 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 4/4**; 2 parts; external/internal geometry PASS; engagement/motion PASS; **coaxiality PASS (0.000/0.000 mm)**; lead **1.5000 mm/turn**, residual ≈0 |
| `adversarial-plain-bore` | NOT_RUN 1/4; internal plain bore, geometry NOT_RUN and coaxiality NOT_RUN |
| `adversarial-spin-only` | FAIL 3/4; nut spins without advancing, motion FAIL; coaxiality PASS |
| `adversarial-wrong-pitch` | FAIL 2/4; pitch 1.25, geometry and motion FAIL; coaxiality PASS |
| `adversarial-eccentric-nut` | FAIL 3/4; **only `thread-coaxiality` FAILS** (nut body shifted 0.4 mm, measured 0.400 mm) |
| `reference` (exit) | **PASS 5/5**; full withdrawal PASS; coaxiality PASS; lead 1.5000 mm/turn |
| `adversarial-short-thread` (exit) | **FAIL 3/5**; geometry and coaxiality PASS, motion NOT_RUN, **disassembly-path FAIL** |
| `adversarial-eccentric-nut` (exit) | FAIL 4/5; **only `thread-coaxiality` FAILS** |

`adversarial-plain-bore` is NOT_RUN rather than a fabricated FAIL/PASS; the self-check still rejects it. The exit reference measures a real full withdrawal; the short thread is rejected by the exit layer.

## Hidden set

The hidden manifest family `thread` has an external development copy `hidden-thread-exit-dev [thread]`: 2 tasks / 2 cases, both references PASS, geometry `layers 3/3` and exit `layers 4/4`, `independentHiddenEvaluation=NOT_RUN`. It is still a development copy, not an independent hidden evaluation.

## Boundaries

- Square profile, not ISO metric thread; no flank angle, tolerance grade or manufacturing metrology.
- No torque, preload, strength, wear, self-locking, full withdrawal or physical part.
- Coaxiality is a sampled lateral bounding-box-centre measurement against the bolt-head/nut-body axis at pose 0; it is not calibrated metrology, a machining tolerance, thread-flank inspection or a functional fit.
- The hidden thread development copy predates this coaxiality layer and must be re-frozen before it represents this rung.
- The geometry task covers nine turn angles; the exit task covers 49 angles and the frozen 12-turn withdrawal. The tool's coaxiality status remains NOT_RUN: the generic cylindrical-feature probe rejects the threaded/hex sections as non-regular polygons, so no coaxiality PASS is claimed. The family claims only measured geometry, motion and exit layers.
- Included in the twelve-family `bench:all` gate and the hidden split. The 88-case gate snapshot predates the exit task; the current thread family has 6 cases and is not in that snapshot.
