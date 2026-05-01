// AgentSCAD Standard Library v2.0
// Pure OpenSCAD mechanical primitives for AI-assisted CAD generation.
// All modules are self-contained — no external dependencies required.
//
// When BOSL2 is available in the OpenSCAD search path, the library
// detects it and can delegate to BOSL2 implementations. Otherwise,
// pure OpenSCAD primitives provide identical module signatures.

// ---------------------------------------------------------------------------
// Internal: merge overlap tolerance for watertight boolean unions
// ---------------------------------------------------------------------------

_merge_tol = 0.2;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// Rounded box with configurable corner radius on all edges.
// Use instead of raw cube() for printable parts.
module rounded_box(size, r = 1, center = true) {
  sx = size[0]; sy = size[1]; sz = size[2];
  translate(center ? [0, 0, 0] : [sx/2, sy/2, sz/2])
  hull() {
    for (x = [r, sx - r]) {
      for (y = [r, sy - r]) {
        for (z = [r, sz - r]) {
          translate([x, y, z]) sphere(r = r, $fn = max(16, r * 8));
        }
      }
    }
  }
}

// Cylinder with optional center bore.
module cylinder_boss(diameter, height, hole_d = 0, center = true) {
  difference() {
    cylinder(h = height, d = diameter, center = center, $fn = max(32, diameter * 4));
    if (hole_d > 0) {
      cylinder(h = height + _merge_tol * 2, d = hole_d, center = center, $fn = max(32, hole_d * 4));
    }
  }
}

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

// Rectangular plate with optional corner mounting holes.
// margin: distance from plate edge to hole centers.
module mounting_plate(width, height, thickness, hole_d = 0, margin = 8, corner_r = 3, center = true) {
  module body() {
    if (corner_r > 0) {
      rounded_box([width, height, thickness], r = corner_r, center = center);
    } else {
      cube([width, height, thickness], center = center);
    }
  }

  if (hole_d > 0) {
    difference() {
      body();
      for (x = [-1, 1]) {
        for (y = [-1, 1]) {
          translate([x * (width/2 - margin), y * (height/2 - margin), 0])
            cylinder(h = thickness + _merge_tol * 2, d = hole_d, center = true, $fn = max(32, hole_d * 4));
        }
      }
    }
  } else {
    body();
  }
}

// ---------------------------------------------------------------------------
// Fasteners & Holes
// ---------------------------------------------------------------------------

// Through-hole or countersunk screw hole.
module screw_hole(d, h, countersink = false, csink_d = 0, csink_angle = 90) {
  union() {
    cylinder(h = h + _merge_tol * 2, d = d, center = true, $fn = max(32, d * 4));
    if (countersink) {
      cs_d = csink_d > 0 ? csink_d : d * 2;
      translate([0, 0, h/2 - cs_d/4])
        cylinder(h = cs_d/2, d1 = d, d2 = cs_d, center = false, $fn = max(32, cs_d * 4));
    }
  }
}

// Rectangular bolt pattern with holes at corners.
module bolt_pattern_rect(width, height, hole_d, margin, thickness) {
  for (x = [margin, width - margin]) {
    for (y = [margin, height - margin]) {
      translate([x - width/2, y - height/2, 0])
      children();
    }
  }
}

// ---------------------------------------------------------------------------
// Brackets
// ---------------------------------------------------------------------------

// L-shaped bracket with configurable dimensions.
module l_bracket(width, height, depth, thickness, rib_count = 0, center = true) {
  translate(center ? [0, 0, 0] : [depth/2, 0, height/2])
  union() {
    // Vertical face
    cube([depth, thickness, height], center = true);
    // Horizontal base
    translate([0, -width/2 + thickness/2, -height/2 + thickness/2])
      cube([depth, width, thickness], center = true);
    // Triangular ribs
    if (rib_count > 0) {
      rib_spacing = depth / (rib_count + 1);
      rib_w = thickness * 0.8;
      for (i = [1:rib_count]) {
        x_pos = -depth/2 + i * rib_spacing;
        translate([x_pos, -thickness/2, -height/2])
          rotate([90, 0, 0])
            linear_extrude(height = rib_w, center = true)
              polygon(points = [[0, 0], [thickness, 0], [0, width - thickness]]);
      }
    }
  }
}

// Triangular support rib for reinforcing corners.
module triangular_rib(width, height, thickness) {
  linear_extrude(height = thickness, center = true)
    polygon(points = [[0, 0], [width, 0], [0, height]]);
}

// ---------------------------------------------------------------------------
// Enclosures
// ---------------------------------------------------------------------------

// Simple electronics enclosure box (bottom shell).
module enclosure_box(width, depth, height, wall, corner_r = 3, center = true) {
  outer_w = width + 2 * wall;
  outer_d = depth + 2 * wall;
  outer_h = height + wall;

  translate(center ? [0, 0, 0] : [outer_w/2, outer_d/2, outer_h/2])
  difference() {
    if (corner_r > 0) {
      rounded_box([outer_w, outer_d, outer_h], r = corner_r, center = true);
    } else {
      cube([outer_w, outer_d, outer_h], center = true);
    }
    // Inner cavity
    translate([0, 0, wall])
      cube([width, depth, height + _merge_tol], center = true);
  }
}

// Enclosure lid with clearance offset.
module enclosure_lid(width, depth, wall, corner_r = 3, clearance = 0.2, center = true) {
  lid_w = width + 2 * wall - 2 * clearance;
  lid_d = depth + 2 * wall - 2 * clearance;

  translate(center ? [0, 0, 0] : [lid_w/2, lid_d/2, wall/2])
  if (corner_r > 0) {
    rounded_box([lid_w, lid_d, wall], r = corner_r, center = true);
  } else {
    cube([lid_w, lid_d, wall], center = true);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// Linear array of children along X axis.
module linear_array_x(count, spacing) {
  for (i = [0:count - 1]) {
    translate([i * spacing - (count - 1) * spacing / 2, 0, 0])
    children();
  }
}

// Circular array of children around Z axis.
module circular_array(count, radius = 10, start_angle = 0) {
  for (i = [0:count - 1]) {
    angle = start_angle + i * 360 / count;
    translate([radius * cos(angle), radius * sin(angle), 0])
    children();
  }
}

// ---------------------------------------------------------------------------
// Generated part placeholder — all models must define generated_part()
// ---------------------------------------------------------------------------

// The pipeline requires a top-level generated_part() call.
// Each generated SCAD file should either define its own generated_part()
// module or call one of the standard library modules directly.
