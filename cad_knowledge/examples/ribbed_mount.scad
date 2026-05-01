// Example: Ribbed mounting bracket for heavy loads
// Part type: ribbed_mount
// Use case: "reinforced bracket", "heavy duty mount", "ribbed bracket"

include <agentscad_std.scad>;

base_width = 60;
base_depth = 30;
base_thickness = 6;
upright_height = 80;
upright_thickness = 6;
rib_count = 3;
rib_thickness = 4;
hole_d = 5;
hole_margin = 8;

module generated_part() {
  merge_tol = 0.2;

  union() {
    // Base plate
    translate([0, 0, -base_thickness/2])
      cube([base_width, base_depth, base_thickness], center = true);

    // Upright face
    translate([0, -base_depth/2 + upright_thickness/2, upright_height/2 - base_thickness/2])
      cube([base_width, upright_thickness, upright_height + merge_tol], center = true);

    // Triangular ribs
    rib_spacing = base_width / (rib_count + 1);
    for (i = [1:rib_count]) {
      x_pos = -base_width/2 + i * rib_spacing;
      translate([x_pos, base_depth/2 - upright_thickness, -base_thickness/2])
      rotate([90, 0, 0])
        linear_extrude(height = rib_thickness, center = true)
          polygon(points = [
            [0, 0],
            [upright_height * 0.7, 0],
            [0, base_depth - upright_thickness]
          ]);
    }
  }
}

generated_part();
