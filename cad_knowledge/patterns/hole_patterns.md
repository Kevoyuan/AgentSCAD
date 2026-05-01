# Hole Patterns

## Standard Corner Hole Pattern

Four holes at the corners of a rectangular plate. Most common mounting pattern.

```
margin = 8;  // distance from plate edge to hole center
hole_d = 5;  // hole diameter

for (x = [-1, 1]) {
  for (y = [-1, 1]) {
    translate([x * (width/2 - margin), y * (height/2 - margin), 0])
      cylinder(h = thickness + 1, d = hole_d, center = true);
  }
}
```

## Linear Hole Pattern

Evenly spaced holes along a line. Used for vents, adjustment slots, or multi-position mounting.

```
count = 4;
spacing = 15;

for (i = [0:count - 1]) {
  translate([i * spacing - (count - 1) * spacing / 2, 0, 0])
    cylinder(h = thickness + 1, d = hole_d, center = true);
}
```

## Circular Bolt Pattern

Holes arranged around a circle. Used for flanges, covers, and rotary mounts.

```
bolt_count = 6;
bolt_circle_radius = 25;

for (i = [0:bolt_count - 1]) {
  angle = i * 360 / bolt_count;
  translate([bolt_circle_radius * cos(angle), bolt_circle_radius * sin(angle), 0])
    cylinder(h = thickness + 1, d = hole_d, center = true);
}
```

## Countersunk Hole Pattern

For flush-mount screws. Add countersink to corner holes.

```
module countersunk_hole(d, h, csink_d) {
  cylinder(h = h + 1, d = d, center = true);
  translate([0, 0, h/2 - csink_d/4])
    cylinder(h = csink_d/2, d1 = d, d2 = csink_d, center = false);
}
```

## Design Rules

- Minimum hole diameter for FDM: 2 mm (smaller holes close up)
- Minimum edge distance from hole to plate edge: 2x hole diameter
- For threaded holes in plastic: undersize by 0.2-0.4 mm for self-tapping screws
- Through-holes should extend past the surface by at least 0.5 mm for clean subtraction
