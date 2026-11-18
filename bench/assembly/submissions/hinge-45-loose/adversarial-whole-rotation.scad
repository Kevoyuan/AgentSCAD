// Adversarial: the pose control rotates the whole assembly.
// The moving leaf does move, so a centroid- or Hausdorff-only check on the
// moving part would pass; the fixed leaf also moves, which is the tell.
agentscad_part = "all";
hinge_angle = 0;
$fn = 64;

bore_d = 6.40 / cos(180 / $fn);

module fixed_leaf() {
  union() {
    translate([-25, -5, -3]) cube([25, 10, 3]);
    translate([0, 0, -3]) cylinder(h = 14.1, d = 6);
  }
}

module moving_leaf() {
  union() {
    difference() {
      translate([0, 0, 1]) cylinder(h = 10, d = 10);
      translate([0, 0, 0.9]) cylinder(h = 10.2, d = bore_d);
    }
    translate([4.5, -5, 1]) cube([20.5, 10, 3]);
  }
}

module generated_part() {
  rotate([0, 0, hinge_angle]) {
    if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
    if (agentscad_part == "all" || agentscad_part == "moving") moving_leaf();
  }
}

generated_part();
