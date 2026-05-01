// Example: Electronics enclosure box with lid
// Part type: electronics_enclosure
// Use case: "project box", "electronics enclosure", "junction box", "case"

include <agentscad_std.scad>;

width = 60;
depth = 40;
height = 25;
wall = 2;
corner_r = 3;
clearance = 0.2;

module generated_part() {
  // Bottom shell
  enclosure_box(
    width = width,
    depth = depth,
    height = height,
    wall = wall,
    corner_r = corner_r
  );

  // Lid (offset for visibility)
  translate([0, depth + 20, 0])
    enclosure_lid(
      width = width,
      depth = depth,
      wall = wall,
      corner_r = corner_r,
      clearance = clearance
    );
}

generated_part();
