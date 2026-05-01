// Example: L-shaped bracket with triangular support ribs
// Part type: l_bracket
// Use case: "wall bracket", "shelf bracket", "L bracket with ribs"

include <agentscad_std.scad>;

width = 60;       // horizontal base width
height = 80;      // vertical face height
depth = 40;       // bracket depth
thickness = 4;    // uniform wall thickness
rib_count = 2;    // number of triangular support ribs
hole_d = 5;       // mounting hole diameter
hole_margin = 8;  // hole distance from edges

module generated_part() {
  l_bracket(
    width = width,
    height = height,
    depth = depth,
    thickness = thickness,
    rib_count = rib_count
  );
}

generated_part();
