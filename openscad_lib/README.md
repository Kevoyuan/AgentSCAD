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
| `rounded_box(size, r, center)` | `size=[x,y,z]`, `r` (default 1), `center` (default true) | Box with rounded corners on all edges; radius is clamped to half the smallest dimension |
| `cylinder_boss(diameter, height, hole_d, center)` | `diameter`, `height`, `hole_d` (default 0), `center` (default true) | Cylinder with optional center bore |

### Plates

| Module | Parameters | Description |
|---|---|---|
| `mounting_plate(width, height, thickness, hole_d, margin, corner_r, center)` | `width`, `height`, `thickness`, `hole_d` (default 0), `margin` (default 8), `corner_r` (default 3), `center` (default true) | Rectangular plate with 4 corner mounting holes |

### Fasteners & Holes

| Module | Parameters | Description |
|---|---|---|
| `fit_hole(d, h, center, diametral_tolerance)` | `d` (minimum clear diameter), `h` (cutter height), `center` (default true), `diametral_tolerance` (default 0.02 mm) | Compensated round bore cutter, local adaptive resolution ≥24; no automatic height extension |
| `screw_hole(d, h, countersink, csink_d, csink_angle, center)` | `d` (hole diameter), `h` (depth through part), `countersink` (default false), `csink_d` (default `d*2`), `csink_angle` (default 90), `center` (default true) | Nominal depth `h` spans `[-h/2,h/2]`; set `center=false` for `[0,h]`. Cutter extends beyond both ends; optional countersink at the upper face: `csink_d` is its minimum clear opening and `csink_angle` is the included angle in degrees (0 < angle < 180, `csink_d > d`) |
| `bolt_pattern_rect(width, height, hole_d, margin, thickness, center)` | `width`, `height`, `hole_d`, `margin`, `thickness`, `center` (default true) | Four compensated through-hole cutters without children; optional children replace each cutter. With `center=false`, positions are measured from the plate minimum x/y corner and the cutter spans `[0,thickness]` |

### Brackets

| Module | Parameters | Description |
|---|---|---|
| `l_bracket(width, height, depth, thickness, rib_count, center)` | `width` (horizontal base), `height` (vertical face), `depth`, `thickness`, `rib_count` (default 0), `center` (default true) | L-shaped bracket with optional triangular ribs |
| `triangular_rib(width, height, thickness)` | `width`, `height`, `thickness` | Single triangular rib for reinforcing corners |

### Enclosures

| Module | Parameters | Description |
|---|---|---|
| `enclosure_box(width, depth, height, wall, corner_r, center)` | `width` (internal), `depth` (internal), `height` (internal), `wall`, `corner_r` (default 3), `center` (default true) | Electronics enclosure with vertical corner rounding, flat bottom and level rim; `height` is usable cavity height, `wall` is side and bottom thickness, and `corner_r` is the outer XY corner radius |
| `enclosure_lid(width, depth, wall, corner_r, clearance, center)` | `width` (internal), `depth` (internal), `wall`, `corner_r` (default 3), `clearance` (default 0.2), `center` (default true) | Enclosure lid with clearance fit |

### Utility

| Module | Parameters | Description |
|---|---|---|
| `linear_array_x(count, spacing)` | `count`, `spacing` | Linear array along X axis |
| `circular_array(count, radius, start_angle)` | `count`, `radius` (default 10), `start_angle` (default 0) | Circular array around Z axis |

## Engineering Constants

- `_merge_tol = 0.2` — Optional overlap/cutter extension allowance for parameter robustness; coplanar face contact is valid in CGAL
- Default wall/feature width: 1.2 mm (FDM); sheet gauge needs orientation, layer-height and load review
- Minimum feature width for decorative details: 1.6 mm
- Standard clearance for tight fit: 0.2 mm; loose fit: 0.4 mm

## Circular Mating Surfaces

For circular mating bores of every diameter (including below 3 mm), use `fit_hole(d, h, center=true, diametral_tolerance=0.02)` from agentscad_std.scad or equivalent local geometry. It uses at least 24 segments, increases resolution to bound polygon oversize, and compensates `d / cos(180/n)` so the minimum clear diameter equals `d`. Keep a local `$fn`; a coarse global `$fn` must not control fitting surfaces. If the library is unavailable, choose `n = max(24, 4*ceil(180/acos(d/(d+0.02))/4))` and subtract `cylinder(d=d/cos(180/n), h=h, center=true, $fn=n)`. Add any requested manufacturing clearance to `d` separately; polygon compensation is not printer shrinkage compensation. Preserve intentional polygon sockets. H001 counts topology only and does not certify diameter or fit.

`cylinder_boss`, `mounting_plate`, and the straight bore of `screw_hole` use this compensated cutter. The supplied bore diameter now denotes the minimum clear opening. Allow up to 0.02 mm additional vertex-to-vertex diameter from faceting; this is separate from any user-specified fit clearance. Countersink cones remain nominal tapered geometry and are not certified by this straight-bore helper.

Reference: [OpenSCAD manual: undersized holes](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html).

## Cutter Coordinates

Default `center=true` keeps existing centered callers compatible. A plate created with
`cube([40,30,10])` starts at z=0, so subtract:

```scad
translate([20,15,0]) screw_hole(d=5, h=10, center=false);
```

For a four-hole pattern on that same plate:

```scad
bolt_pattern_rect(40,30,hole_d=5,margin=5,thickness=10,center=false);
```

Omitting children now creates cutters. Existing custom-child patterns keep their
positions and supplied geometry. `rounded_box` and `mounting_plate` use the bounding-box
center with `center=true`, or the minimum corner with `center=false`.
