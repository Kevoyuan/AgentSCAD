This is a retained failure, not an approved example or prompt reference.

The adjacent SCAD is the unchanged output of the authorized original-geometry
DeepSeek repair in `paid-deepseek-assembly-59yfbi`. No third-party CAD source or
library was used. Its comments are model claims, not verified facts.

Observed on the development native OpenSCAD backend:

- Four operation transforms put translation in the homogeneous last row.
- The required translation probes are absent.
- Separate selectors render and the limited identity check passes.
- The flap's exact mesh has a four-incident edge at x=3, z=0, y=-4.5..4.5;
  closed-surface connectivity is unavailable, not certified.
- The default base/flap meshes intersect. An explicitly separate diagnostic
  CSG intersection contains an interior witness at [3.6,6,0] mm; this is more
  than a surface-contact report. The witness was chosen after reading source,
  not blindly. Independent Python edge/winding evidence is in the local
  experiment archive; it does not establish complete solid validity.

`retention-release.openscad.test.ts` renders this unchanged source as a negative
regression. Passing that test means these defects were detected, not that the
candidate passed assembly validation. No assembly, motion, fit or physical
qualification is claimed. Full raw records remain in the ignored experiment
archive and are not a hermetic environment.
