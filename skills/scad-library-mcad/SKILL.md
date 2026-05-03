---
name: scad-library-mcad
description: This skill should be used when generating OpenSCAD with MCAD, especially involute gears, bevel gears, motors, servos, regular shapes, nuts, bolts, and established mechanical primitives bundled with OpenSCAD.
triggers:
  - use mcad
  - involute gear
  - bevel gear
  - mcad helpers
---

# SCAD Library MCAD Skill

Use MCAD when the runtime prompt lists MCAD and the requested part needs established mechanical primitives, especially gears.

## Imports

Use the narrowest MCAD file needed:

```openscad
use <MCAD/involute_gears.scad>
```

Use `include <MCAD/units.scad>` only when constants from the file are required. Prefer `use` for module-only imports because it avoids top-level demonstration geometry.

## Best Uses

- Use `gear()` from `MCAD/involute_gears.scad` for spur gears when exact involute tooth geometry matters.
- Use `bevel_gear()` or `bevel_gear_pair()` for bevel gears when the request explicitly asks for them.
- Use MCAD motor/servo helpers only when exact module names and signatures are known.
- Use MCAD regular shapes when they simplify geometry without reducing editability.

## Generation Pattern

Expose gear controls as top-level parameters and call MCAD inside a wrapper module:

```openscad
use <MCAD/involute_gears.scad>

/* [Gear] */
teeth = 24;            // min: 8 max: 160 step: 1
circular_pitch = 220;  // min: 80 max: 600 step: 5
pressure_angle = 20;   // min: 14.5 max: 25 step: 0.5
gear_thickness = 8;    // min: 2 max: 40 step: 0.5
bore_diameter = 5;     // min: 1 max: 40 step: 0.5

module printable_gear() {
  gear(
    number_of_teeth=teeth,
    circular_pitch=circular_pitch,
    pressure_angle=pressure_angle,
    bore_diameter=bore_diameter,
    gear_thickness=gear_thickness,
    rim_thickness=gear_thickness,
    hub_thickness=gear_thickness,
    flat=true
  );
}

printable_gear();
```

## Quality Rules

- For gears, expose teeth count, pitch, pressure angle, bore diameter, and thickness.
- Keep pressure angle default at 20 degrees unless specified.
- Add bore and hub features intentionally; do not leave a solid gear when an axle hole is likely needed.
- Prefer MCAD gear modules over hand-drawn rectangular tooth approximations.

## Avoid

- Do not use broad `include` statements when `use` is sufficient.
- Do not invent MCAD module names.
- Do not copy MCAD source into generated SCAD.
