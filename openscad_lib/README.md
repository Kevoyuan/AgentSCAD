# AgentSCAD Standard Library

Reference for LLM prompt injection. This document describes every module available in `agentscad_std.scad`.

## How the LLM should use this library

```scad
include <agentscad_std.scad>;

// Define parameters as top-level assignments
width = 80;
height = 50;
thickness = 6;
hole_d = 5;
margin = 8;
corner_r = 3;

// Use library modules
module generated_part() {
  mounting_plate(
    width = width,
    height = height,
    thickness = thickness,
    hole_d = hole_d,
    margin = margin,
    corner_r = corner_r
  );
}

generated_part();
```

Prefer library modules over raw `cube()`/`cylinder()`/`difference()` chains. They produce more reliable, printable geometry.

## Module Reference

### Primitives

| Module | Parameters | Description |
|---|---|---|
| `rounded_box(size, r, center)` | `size=[x,y,z]`, `r` (default 1), `center` (default true) | Box with rounded corners on all edges |
| `cylinder_boss(diameter, height, hole_d, center)` | `diameter`, `height`, `hole_d` (default 0), `center` (default true) | Cylinder with optional center bore |

### Plates

| Module | Parameters | Description |
|---|---|---|
| `mounting_plate(width, height, thickness, hole_d, margin, corner_r, center)` | `width`, `height`, `thickness`, `hole_d` (default 0), `margin` (default 8), `corner_r` (default 3), `center` (default true) | Rectangular plate with 4 corner mounting holes |

### Fasteners & Holes

| Module | Parameters | Description |
|---|---|---|
| `screw_hole(d, h, countersink, csink_d, csink_angle)` | `d` (hole diameter), `h` (depth through part), `countersink` (default false), `csink_d` (default `d*2`), `csink_angle` (default 90) | Through-hole with optional countersink |
| `bolt_pattern_rect(width, height, hole_d, margin, thickness)` | `width`, `height`, `hole_d`, `margin`, `thickness` | 4-hole rectangular bolt pattern; attach hole geometry as children |

### Brackets

| Module | Parameters | Description |
|---|---|---|
| `l_bracket(width, height, depth, thickness, rib_count, center)` | `width` (horizontal base), `height` (vertical face), `depth`, `thickness`, `rib_count` (default 0), `center` (default true) | L-shaped bracket with optional triangular ribs |
| `triangular_rib(width, height, thickness)` | `width`, `height`, `thickness` | Single triangular rib for reinforcing corners |

### Enclosures

| Module | Parameters | Description |
|---|---|---|
| `enclosure_box(width, depth, height, wall, corner_r, center)` | `width` (internal), `depth` (internal), `height` (internal), `wall`, `corner_r` (default 3), `center` (default true) | Electronics enclosure bottom shell |
| `enclosure_lid(width, depth, wall, corner_r, clearance, center)` | `width` (internal), `depth` (internal), `wall`, `corner_r` (default 3), `clearance` (default 0.2), `center` (default true) | Enclosure lid with clearance fit |

### Utility

| Module | Parameters | Description |
|---|---|---|
| `linear_array_x(count, spacing)` | `count`, `spacing` | Linear array along X axis |
| `circular_array(count, radius, start_angle)` | `count`, `radius` (default 10), `start_angle` (default 0) | Circular array around Z axis |

## Engineering Constants

- `_merge_tol = 0.2` — Overlap tolerance for watertight boolean unions
- Minimum printable wall thickness: 1.2 mm (FDM)
- Minimum feature width for decorative details: 1.6 mm
- Standard clearance for tight fit: 0.2 mm; loose fit: 0.4 mm
