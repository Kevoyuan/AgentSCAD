// Adversarial: two genuinely distinct parts, but the moving part has no bore.
// The pin is embedded in solid material, so the fit and the motion must both
// fail even though the part count is right.
agentscad_part = "all";
$fn = 64;

module fixed_leaf() {
  union() {
    translate([-25, -5, -3]) cube([25, 10, 3]);
    translate([0, 0, -3]) cylinder(h = 14.1, d = 6);
  }
}

module moving_leaf() {
  union() {
    translate([0, 0, 1]) cylinder(h = 10, d = 10);
    translate([4.5, -5, 1]) cube([20.5, 10, 3]);
  }
}

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all" || agentscad_part == "moving") moving_leaf();
}

generated_part();
