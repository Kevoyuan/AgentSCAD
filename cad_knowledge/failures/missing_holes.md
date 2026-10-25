# Missing or Undersized Holes

## Symptoms

H001 reports fewer topological handles than the required through-hole minimum. Separately, a hole can exist and pass H001 but still be too small for its mating part. H001 does not measure diameter, position, clearance or blind-hole depth.

## Causes and Repairs

1. **Wrong coordinates or subtraction parent.** Verify that the evaluated cutter intersects the intended body. Counting cylinder calls is insufficient: loops, modules and conditional branches change the actual geometry.
2. **Insufficient depth.** Check that a through-cutter spans both surfaces. A flush cut is valid; extension is a useful allowance for parameter changes, not a mathematical requirement.
3. **Faceting undersize.** For an even-sided inscribed cylinder, minimum clear diameter is `d*cos(180/n)`. A nominal 6 mm hole with `$fn=6` clears only about 5.196 mm. Increasing resolution and compensating the cutter are fit measures, not missing-hole repairs.

## Circular Mating Holes

Use `fit_hole(d, h, center=true, diametral_tolerance=0.02)` from agentscad_std.scad. It selects at least 24 segments for all diameters, increases resolution as needed, and uses `d/cos(180/n)` so the minimum clear opening is `d`. Its vertex-to-vertex oversize is bounded by the supplied diametral tolerance. Set resolution locally so a coarse global `$fn` cannot degrade the bore. Keep deliberate hexagonal sockets polygonal.

Add requested printer/fit clearance to `d` separately. Polygon compensation does not predict shrinkage or printed fit. Verify rendered hole dimensions or perform a fit test when required; manifold and H001 PASS alone are insufficient.

Reference: [OpenSCAD manual: undersized holes](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html).
