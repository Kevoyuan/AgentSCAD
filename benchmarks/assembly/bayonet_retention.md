Original development fixture for reversible geometric retention
=============================================================

`bayonet_retention.scad` exports `support` and `rotor` independently through
`agentscad_part`; `all` places both at their common reference pose. This is a
hand-authored tool-validation fixture, not an LLM generation benchmark result.

The support has a centred 2.6 × 6.6 mm rectangular opening through a plate at
z=2..3 mm. The rotor has a 6 × 2 mm transverse lug at z=0..1 mm, a 2 mm stem,
and a 6 mm upper handle at z=4..5 mm. At the reference pose, the lug and handle
oppose direct extraction in the two axial directions. Over the designated
−45°..45° operating interval, the lug's X projection is at least
6*cos(45°)=4.243 mm, wider than the opening. At 90°, its 2 × 6 mm projection
fits the nominal opening. Rotate to 90°, then translate +4 mm along Z to
separate; assembly reverses that route.

Run:

```
bun test --timeout 60000 src/lib/tools/__tests__/retention-release.openscad.test.ts
```

The test renders real independent meshes, checks limited connectivity and
selector isolation, samples the operating interval, tests both axial directions
at all 19 operating poses, and samples rotation followed by complete withdrawal
and the reverse assembly route. A direct pull is a negative case. At the 90°
release orientation, an assertion of axial retention must fail while a clear
withdrawal assertion passes; reference-pose retention cannot cover that angle.
The rectangular projection bound independently supports the
geometric obstruction claim in the stated interval. Sampling is not a
continuous collision proof.

The native test also builds an explicit `translationProbes` declaration and
passes the real rendered meshes through `prepareAssembly`, the shared product
verification/export preparation function. Its manifest retains the 38 raw
measurements, downgrades passing verdicts when confirmation is missing, and
propagates the mislabelled release-pose failure into assembly evidence. This
fixture's source does not contain that declaration; the test constructs it.
These experiments are not assertions that the user's complete retention
requirement was measured. In particular, `axial-retention` remains unsupported
as a force/accidental-release requirement in A001.

The test declares removal with two `rigidTrajectory` stages (world Z rotation
by 90°, then world +Z translation by 4 mm) and explicitly requests reverse
traversal for insertion. The deterministic adapter expands these into checked
poses. The correct order clears, while translating before rotating fails in
both assembly and disassembly checks. The generated poses and their hash stay
separate from the original stage declaration. This is a hand-authored test of
the adapter, not evidence of an LLM choosing a correct release route.

There is no detent or mechanical operating-angle limit preventing unintended
rotation to the release orientation. Holding force, contact stress, handle
strength, friction, wear, machine accuracy, material, print orientation and
as-built fit have not been tested. Nominal geometric obstruction cannot satisfy
a 10 N or 20 N holding-force requirement. Do not label this fixture physically
qualified or use it as evidence that the model generator can design this joint.
