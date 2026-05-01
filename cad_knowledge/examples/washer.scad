// Example: Simple washer / spacer
// Part type: washer
// Use case: "washer", "spacer", "shim", "flat ring"

include <agentscad_std.scad>;

outer_diameter = 20;
inner_diameter = 8;
thickness = 2;

module generated_part() {
  difference() {
    cylinder(h = thickness, d = outer_diameter, center = true, $fn = 64);
    cylinder(h = thickness + 1, d = inner_diameter, center = true, $fn = 64);
  }
}

generated_part();
