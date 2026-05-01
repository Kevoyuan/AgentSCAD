// Example: Hinge bracket with knuckle and pin holes
// Part type: hinge_bracket
// Use case: "hinge bracket", "door hinge", "pivot bracket", "swivel mount"

include <agentscad_std.scad>;

bracket_width = 30;
bracket_length = 50;
thickness = 4;
knuckle_diameter = 12;
pin_hole_d = 4;
hole_d = 5;
hole_count = 2;

module generated_part() {
  knuckle_r = knuckle_diameter / 2;

  difference() {
    union() {
      // Main plate
      cube([bracket_width, bracket_length, thickness], center = true);
      // Knuckle at one end
      translate([0, bracket_length/2, 0])
        rotate([0, 90, 0])
          cylinder(h = bracket_width, d = knuckle_diameter, center = true, $fn = 32);
    }
    // Pin hole through knuckle
    translate([0, bracket_length/2, 0])
      rotate([0, 90, 0])
        cylinder(h = bracket_width + 1, d = pin_hole_d, center = true, $fn = 32);
    // Mounting holes along plate
    spacing = (bracket_length - 20) / (hole_count - 1);
    for (i = [0:hole_count - 1]) {
      translate([0, -bracket_length/2 + 10 + i * spacing, 0])
        cylinder(h = thickness + 1, d = hole_d, center = true, $fn = 32);
    }
  }
}

generated_part();
