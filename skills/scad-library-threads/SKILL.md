---
name: scad-library-threads
description: This skill should be used when generating OpenSCAD with threads.scad or threadlib, including metric threads, threaded holes, taps, bolts, nuts, screw connectors, bottle caps, pipe threads, and printable threaded mechanical interfaces.
triggers:
  - use threads.scad
  - use threadlib
  - threaded holes
  - printable threads
---

# SCAD Library Threads Skill

Use thread libraries when the runtime prompt lists `threads.scad` or `threadlib` and the requested design needs working threaded interfaces.

## Imports

For classic `threads.scad`:

```openscad
include <threads.scad>
```

For `threadlib`:

```openscad
use <threadlib/threadlib.scad>
```

Use only the exact library listed as available by the runtime prompt.

## Best Uses

- Use threads for caps, knobs, adapters, pipe fittings, screw-in mounts, and replaceable connectors.
- Use internal thread/tap helpers to subtract threaded holes from printable bodies.
- Use external thread/bolt helpers for male threaded connectors.
- Add non-threaded lead-in chamfers and grip surfaces so parts are printable and usable.

## threads.scad Pattern

Use `metric_thread()` when `threads.scad` is available and metric diameter/pitch are known:

```openscad
include <threads.scad>

/* [Thread] */
thread_diameter = 20; // min: 4 max: 80 step: 0.5
thread_pitch = 2;    // min: 0.5 max: 6 step: 0.1
thread_length = 12;  // min: 3 max: 60 step: 0.5

metric_thread(thread_diameter, thread_pitch, thread_length);
```

## threadlib Pattern

Use `bolt()`, `nut()`, `tap()`, or `thread()` when `threadlib` is available:

```openscad
use <threadlib/threadlib.scad>

/* [Thread] */
turns = 6;         // min: 2 max: 20 step: 1
outer_diameter = 18; // min: 6 max: 60 step: 0.5

module threaded_hole_block() {
  difference() {
    cube([outer_diameter*2, outer_diameter*2, turns*1.5], center=true);
    translate([0, 0, -turns])
      tap("M12", turns=turns);
  }
}

threaded_hole_block();
```

## Quality Rules

- Keep thread diameter, pitch/designator, turns/length, and clearance exposed.
- Extend subtractive taps slightly beyond the body to avoid thin artifacts at entrances.
- Use coarse printable threads for FDM unless the user asks for fine threads.
- Use chamfers/lead-ins and leave tolerance; do not create exact zero-clearance mating parts.
- Avoid tiny functional threads below typical printer capability unless the request explicitly needs them.

## Avoid

- Do not combine multiple thread libraries in one model.
- Do not invent standard designators; if uncertain, expose diameter and pitch or use generic geometry.
- Do not copy thread library source into generated SCAD.
