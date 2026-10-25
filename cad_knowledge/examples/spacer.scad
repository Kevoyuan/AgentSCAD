// Example: Simple spacer / standoff
// Part type: spacer
// Use case: "spacer", "standoff", "cylindrical spacer", "PCB standoff"

include <agentscad_std.scad>;

outer_diameter = 10;
inner_diameter = 4;
height = 15;

module generated_part() {
  difference() {
    cylinder(h = height, d = outer_diameter, center = true, $fn = 64);
    fit_hole(h = height + 1, d = inner_diameter);
  }
}

generated_part();
