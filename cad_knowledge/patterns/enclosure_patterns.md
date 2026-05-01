# Enclosure Design Patterns

## Basic Box Enclosure

Bottom shell + separate lid. Most common electronics enclosure.

```
enclosure_box(width, depth, height, wall, corner_r);
enclosure_lid(width, depth, wall, corner_r, clearance);
```

## Snap-Fit Enclosure

Add snap-fit tabs to the lid for tool-free assembly. Tabs should be:
- 6-8 mm wide
- 1.5-2 mm thick
- Include a small ramp/lead-in
- Have 0.2 mm interference fit

## PCB Mount Enclosure

Add standoffs in the bottom shell for PCB mounting:
- Standoff diameter: 5-6 mm
- Inner hole: 2.5-3 mm (for M2.5/M3 screws)
- Height: 5-8 mm above floor
- Position at PCB corners

## Ventilated Enclosure

Add vent slots or holes. Slot pattern:
- Slot width: 2-3 mm
- Slot length: 10-20 mm
- Slot spacing: 3-5 mm
- Keep slots away from corners (≥ 10 mm)

## Design Rules

- Internal dimensions are the usable space; wall thickness adds to exterior
- Minimum wall thickness for enclosures: 1.2 mm (FDM), prefer 2.0 mm
- Lid clearance: 0.2 mm for tight fit, 0.4 mm for loose fit
- Corner radius ≥ 2 mm for printability and aesthetics
- All internal features must be printable without supports where possible
