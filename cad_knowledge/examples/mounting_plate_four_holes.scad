// Example: Mounting plate with four corner holes
// Part type: mounting_plate
// Use case: "rectangular mounting plate with 4 holes", "base plate", "bracket plate"

include <agentscad_std.scad>;

width = 80;
height = 50;
thickness = 6;
hole_d = 5;
margin = 8;
corner_r = 3;

module generated_part() {
  mounting_plate(
    width = width,
    height = height,
    thickness = thickness,
    hole_d = hole_d,
    margin = margin,
    corner_r = corner_r
  );
}

generated_part();
