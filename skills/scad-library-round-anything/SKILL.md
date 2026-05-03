---
name: scad-library-round-anything
description: This skill should be used when generating OpenSCAD with Round-Anything, polyRound, polyRoundExtrude, shell2d, rounded sketch profiles, filleted extrusions, beams, tabs, brackets, and consumer-product-style softened parts.
triggers:
  - use round anything
  - polyround
  - rounded sketch
  - filleted extrusion
---

# SCAD Library Round-Anything Skill

Use Round-Anything when the runtime prompt lists `use <Round-Anything/polyround.scad>` or `use <polyround.scad>` and the requested part is naturally built from rounded 2D sketches extruded into 3D.

## Import

Use the exact include/use statement shown by the runtime prompt. Common forms are:

```openscad
use <Round-Anything/polyround.scad>
```

or:

```openscad
use <polyround.scad>
```

## Best Uses

- Use `polyRound()` for rounded polygons instead of manually approximating rounded corners.
- Use `polyRoundExtrude()` for rounded plates, brackets, tabs, bezels, lips, and soft rectangular profiles.
- Use `shell2d()` patterns for open shells and wall outlines when the part is sketch-driven.
- Use rounded profiles for stress relief and visual polish.
- Prefer Round-Anything over `minkowski()` for complex 2D outlines that need controlled corner radii.

## Generation Pattern

Represent profile points as `[x, y, radius]` and keep radii parameterized:

```openscad
use <Round-Anything/polyround.scad>

/* [Profile] */
width = 70;          // min: 20 max: 180 step: 1
depth = 42;          // min: 15 max: 120 step: 1
thickness = 5;       // min: 1.2 max: 20 step: 0.5
corner_radius = 5;   // min: 0 max: 20 step: 0.5

profile = [
  [-width/2, -depth/2, corner_radius],
  [ width/2, -depth/2, corner_radius],
  [ width/2,  depth/2, corner_radius],
  [-width/2,  depth/2, corner_radius],
];

polyRoundExtrude(profile, thickness, corner_radius, corner_radius, fn=32);
```

## Quality Rules

- Keep each radius less than half the adjacent segment length.
- Use smaller radii on tabs, clips, and screw ears than on cosmetic outer corners.
- Prefer a simple rounded profile plus boolean cutouts over many nested hull operations.
- Keep profile arrays readable and derived from top-level parameters.

## Avoid

- Do not use `minkowskiRound` by default; it is slow and fragile for generated models.
- Do not use Round-Anything for pure cylinders or simple cuboids if BOSL2 can express the shape more clearly.
- Do not copy library source into generated SCAD.
