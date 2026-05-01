// Example: Two-piece pipe clamp with bolt holes
// Part type: pipe_clamp
// Use case: "pipe clamp", "tube clamp", "cable clamp", "hose clamp"
// Pattern: split-ring with bolt flanges

include <agentscad_std.scad>;

pipe_diameter = 25;
clamp_width = 15;
wall_thickness = 3;
bolt_hole_d = 4;
bolt_hole_spacing = 40;

module clamp_half() {
  outer_r = pipe_diameter / 2 + wall_thickness;
  inner_r = pipe_diameter / 2;
  flange_w = 12;

  difference() {
    union() {
      // Main ring half
      cylinder(h = clamp_width, r = outer_r, center = true, $fn = 64);
      // Bolt flanges
      for (x = [-bolt_hole_spacing/2, bolt_hole_spacing/2]) {
        translate([x, outer_r - flange_w/2, 0])
          cube([flange_w, flange_w, clamp_width], center = true);
      }
    }
    // Inner pipe cavity
    cylinder(h = clamp_width + 1, r = inner_r, center = true, $fn = 64);
    // Bolt holes
    for (x = [-bolt_hole_spacing/2, bolt_hole_spacing/2]) {
      translate([x, outer_r, 0])
        cylinder(h = clamp_width + 1, d = bolt_hole_d, center = true, $fn = 32);
    }
  }
}

module generated_part() {
  // Top half
  clamp_half();
  // Bottom half (flipped)
  translate([0, 0, clamp_width + 5])
    mirror([0, 0, 1]) clamp_half();
}

generated_part();
