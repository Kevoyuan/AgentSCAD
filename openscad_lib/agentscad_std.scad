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
  rr = max(0.01, min(r, min(sx, min(sy, sz)) / 2));
  translate(center ? [-sx/2, -sy/2, -sz/2] : [0, 0, 0])
  hull() {
    for (x = [rr, sx - rr]) {
      for (y = [rr, sy - rr]) {
        for (z = [rr, sz - rr]) {
          // Keep nominal extents despite the sphere's faceted extrema.
          translate([x, y, z]) resize([2*rr, 2*rr, 2*rr])
            sphere(r = rr, $fn = max(16, rr * 8));
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
      translate([0, 0, center ? 0 : -_merge_tol])
        fit_hole(h = height + _merge_tol * 2, d = hole_d, center = center);
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
      rounded_box([width, height, thickness], r = corner_r, center = true);
    } else {
      cube([width, height, thickness], center = true);
    }
  }

  translate(center ? [0, 0, 0] : [width/2, height/2, thickness/2])
  if (hole_d > 0) {
    difference() {
      body();
      for (x = [-1, 1]) {
        for (y = [-1, 1]) {
          translate([x * (width/2 - margin), y * (height/2 - margin), 0])
            fit_hole(h = thickness + _merge_tol * 2, d = hole_d);
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

// A round mating hole uses d as its minimum clear diameter (across facets).
// Limit polygon oversize to diametral_tolerance, separately from fit clearance.
// Multiples of four keep opposite facets symmetric. Local $fn overrides coarse
// global preview settings; deliberate polygon sockets should use cylinder().
// OpenSCAD acos/cos use degrees. A JS port must convert radians explicitly.
function fit_hole_segments(d, diametral_tolerance = 0.02) =
  assert(d > 0 && diametral_tolerance > 0, "Hole diameter and tolerance must be positive")
  max(24, 4 * ceil(180 / acos(d / (d + diametral_tolerance)) / 4));

module fit_hole(d, h, center = true, diametral_tolerance = 0.02) {
  n = fit_hole_segments(d, diametral_tolerance);
  cylinder(h = h, d = d / cos(180 / n), center = center, $fn = n);
}

// Through-hole or countersunk screw hole. Nominal z interval is [-h/2,h/2]
// by default, or [0,h] with center=false. Extend both ends by _merge_tol.
module screw_hole(d, h, countersink = false, csink_d = 0, csink_angle = 90, center = true) {
  translate([0, 0, center ? 0 : h/2])
  union() {
    fit_hole(d = d, h = h + _merge_tol * 2);
    if (countersink) {
      cs_d = csink_d > 0 ? csink_d : d * 2;
      translate([0, 0, h/2 - cs_d/4])
        cylinder(h = cs_d/2, d1 = d, d2 = cs_d, center = false, $fn = max(32, cs_d * 4));
    }
  }
}

// Four through-cutters by default; supplied children replace each cutter.
// center=false anchors x/y to the plate's minimum corner and nominal z to 0.
module bolt_pattern_rect(width, height, hole_d, margin, thickness, center = true) {
  for (x = [margin, width - margin]) {
    for (y = [margin, height - margin]) {
      translate([x - (center ? width/2 : 0), y - (center ? height/2 : 0), 0])
        if ($children > 0) {
          children();
        } else {
          screw_hole(d = hole_d, h = thickness, center = center);
        }
    }
  }
}

// ---------------------------------------------------------------------------
// Brackets
// ---------------------------------------------------------------------------

// L-shaped bracket with configurable dimensions.
module l_bracket(width, height, depth, thickness, rib_count = 0, center = true) {
  translate(center ? [0, 0, 0] : [depth/2, width-thickness/2, height/2])
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
  outer_r = min(max(0, corner_r), min(width, depth) / 2);
  inner_r = max(0, outer_r - wall);

  // Round only vertical corners. Rounding the top/bottom edges before a
  // cavity cut can lower the rim and consume the requested usable height.
  module profile(w, d, r) {
    if (r > 0) {
      offset(r = r, $fn = 64)
        square([w - 2*r, d - 2*r], center = true);
    } else {
      square([w, d], center = true);
    }
  }

  translate(center ? [0, 0, 0] : [outer_w/2, outer_d/2, outer_h/2])
  difference() {
    linear_extrude(height = outer_h, center = true)
      profile(outer_w, outer_d, outer_r);
    // Inner cavity
    translate([0, 0, -outer_h/2 + wall])
      linear_extrude(height = height + _merge_tol)
        profile(width, depth, inner_r);
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
