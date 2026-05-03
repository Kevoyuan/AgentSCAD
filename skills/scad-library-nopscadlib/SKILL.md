---
name: scad-library-nopscadlib
description: This skill should be used when generating OpenSCAD with NopSCADlib, especially electronics enclosures, vitamins, fasteners, boards, fans, connectors, printed assemblies, BOM-aware mechanical parts, and realistic 3D-printer or electronics hardware.
triggers:
  - use nopscadlib
  - electronics vitamins
  - pcb enclosure
  - bom aware parts
---

# SCAD Library NopSCADlib Skill

Use NopSCADlib when `include <NopSCADlib/core.scad>` is listed in the runtime prompt and the requested part benefits from real-world electronics or mechanical components.

## Import

Start with the core include only when available:

```openscad
include <NopSCADlib/core.scad>
```

Add narrower NopSCADlib `vitamins/...` or `printed/...` includes only when the exact module and path are known. Prefer simple printable geometry if uncertain.

## Best Uses

- Use for electronics enclosures, project boxes, PCB holders, fan mounts, Raspberry Pi/Arduino-style board clearances, screw bosses, inserts, spacers, and assembly-aware designs.
- Use NopSCADlib as reference vocabulary for real components: boards, screws, bearings, fans, connectors, switches, cable glands, rails, rods, and panels.
- Prefer generated printable carrier geometry around real components rather than modeling every electronic detail.
- Keep non-printable purchased parts visually useful but clearly separate from the printed part when rendered.

## Generation Pattern

Keep the printable part self-contained and parameterized. Use real component placeholders only when they improve fit reasoning:

```openscad
include <NopSCADlib/core.scad>

/* [Enclosure] */
width = 90;          // min: 40 max: 220 step: 1
depth = 60;          // min: 30 max: 180 step: 1
height = 28;         // min: 12 max: 100 step: 1
wall_thickness = 2;  // min: 1.2 max: 6 step: 0.2
boss_diameter = 8;   // min: 4 max: 16 step: 0.5
screw_diameter = 3;  // min: 2 max: 5 step: 0.1

module printable_enclosure() {
  difference() {
    cube([width, depth, height], center=true);
    translate([0, 0, wall_thickness])
      cube([width - 2*wall_thickness, depth - 2*wall_thickness, height], center=true);
  }
}

printable_enclosure();
```

## Quality Rules

- Model clearances explicitly: board clearance, screw clearance, cable clearance, lid/body fit clearance.
- Keep screw bosses connected to walls or ribs.
- Add ribs, chamfers, and strain relief where loads enter the enclosure.
- Do not let visual component placeholders become required printable geometry unless requested.
- Avoid overfitting to a named board unless exact dimensions are supplied.

## Avoid

- Do not include broad NopSCADlib files speculatively.
- Do not invent module names or type constants.
- Do not copy NopSCADlib source into generated SCAD.
- Do not generate BOM/project automation output inside `scad_source`; keep output focused on renderable OpenSCAD.
