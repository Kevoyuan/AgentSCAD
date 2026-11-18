// Adversarial: two separate solids that never form a joint.
// They do not interfere at any pose and they separate along the axis, so a
// benchmark that only checked collision would pass this. The fit measurement
// is what has to notice that no bore was ever produced.
agentscad_part = "all";
$fn = 64;

module fixed_leaf() {
  union() {
    translate([-25, -5, -3]) cube([25, 10, 3]);
    translate([0, 0, -3]) cylinder(h = 14.1, d = 6);
  }
}

module moving_leaf() {
  // Translation of the whole moving part away from the declared axis.
  translate([40, 0, 0]) union() {
    difference() {
      translate([0, 0, 1]) cylinder(h = 10, d = 10);
      translate([0, 0, 0.9]) cylinder(h = 10.2, d = 6.40 / cos(180 / $fn));
    }
    translate([4.5, -5, 1]) cube([20.5, 10, 3]);
  }
}

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all" || agentscad_part == "moving") moving_leaf();
}

generated_part();
