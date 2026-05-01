// Example: Gear-like knurled knob
// Part type: gear_like_knob
// Use case: "knob", "thumb wheel", "adjustment knob", "dial"

include <agentscad_std.scad>;

knob_diameter = 30;
knob_height = 15;
teeth_count = 20;
bore_diameter = 6;
bore_depth = 20;

module generated_part() {
  tooth_depth = 2;
  base_r = knob_diameter / 2;
  tooth_r = base_r - tooth_depth;

  difference() {
    union() {
      // Main cylinder
      cylinder(h = knob_height, d = knob_diameter, center = true, $fn = 64);
      // Teeth
      for (i = [0:teeth_count - 1]) {
        angle = i * 360 / teeth_count;
        rotate([0, 0, angle])
          translate([base_r - tooth_depth/2, 0, 0])
            cube([tooth_depth, 2, knob_height], center = true);
      }
    }
    // Central bore
    cylinder(h = bore_depth, d = bore_diameter, center = true, $fn = 32);
  }
}

generated_part();
