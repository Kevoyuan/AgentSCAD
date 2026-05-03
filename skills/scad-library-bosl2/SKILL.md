---
name: scad-library-bosl2
description: This skill should be used when generating OpenSCAD with BOSL2, using rounded solids, chamfers, anchors, attachments, transforms, arrays, masks, gears, screws, or higher-quality parametric geometry.
triggers:
  - use bosl2
  - rounded solids
  - chamfered geometry
  - bosl2 helpers
---

# SCAD Library BOSL2 Skill

Use BOSL2 as the preferred general-purpose OpenSCAD quality library when `include <BOSL2/std.scad>` is listed in the runtime prompt.

## Import

Place this line near the top of `scad_source`, before modules that call BOSL2 helpers:

```openscad
include <BOSL2/std.scad>
```

Do not use BOSL2 unless the runtime prompt lists it as available.

## Best Uses

- Use `cuboid()` instead of raw `cube()` for rounded or chamfered rectangular solids.
- Use `cyl()` instead of raw `cylinder()` when a part needs chamfers, rounding, or cleaner alignment.
- Use BOSL2 transforms and anchors to place features relative to faces instead of hard-coding fragile offsets.
- Use masks/cutters for bevels, chamfers, screw seats, countersinks, and visually readable edges.
- Use BOSL2 path and offset helpers for swept or rounded profiles when the geometry is fundamentally sketch-based.
- Use BOSL2 gears or screws only when the exact helper signature is known; otherwise prefer MCAD for gears and threadlib/threads.scad for threaded connectors.

## Generation Pattern

Keep editable numeric values as top-level assignments before module declarations. Use BOSL2 inside reusable modules:

```openscad
include <BOSL2/std.scad>

/* [Dimensions] */
width = 80;       // min: 20 max: 200 step: 1
depth = 50;       // min: 20 max: 200 step: 1
height = 24;      // min: 8 max: 120 step: 1
corner_radius = 4; // min: 0 max: 16 step: 0.5

module body() {
  cuboid([width, depth, height], rounding=corner_radius, edges="Z", anchor=CENTER);
}

body();
```

## Quality Rules

- Prefer real rounded primitives over `minkowski()` for simple boxes and cylinders.
- Keep radii smaller than half of the smallest adjacent dimension.
- Avoid decorative rounding that weakens retaining lips, snap tabs, screw bosses, or mating surfaces.
- For printable parts, keep wall thickness and clearances explicit as parameters.
- Use `$fn` sparingly; rely on `$fa` and `$fs` for curves when practical.

## Avoid

- Do not copy BOSL2 source into generated SCAD.
- Do not use BOSL2 helpers as hidden parameter stores.
- Do not mix anchor-heavy BOSL2 placement with unrelated hard-coded transforms in the same feature unless the coordinate frame is obvious.
- Do not call obscure BOSL2 functions unless the signature is certain.
