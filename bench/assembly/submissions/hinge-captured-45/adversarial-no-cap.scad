// Adversarial: a hinge with no retention feature at all.
// It passes parts, fit, motion and source-motion; only `axial-retention` fails,
// because pulling 2 mm simply slides the knuckle up the pin and the two solids
// stay separated. This is the case that makes the retention layer worth having:
// without it, "the leaf can be pulled off" would score as a success.
agentscad_part = "all";
hinge_angle = 0;
$fn = 64;

bore_d = 6.40 / cos(180 / $fn);

module fixed_leaf() {
  union() {
    translate([-25, -5, -3]) cube([25, 10, 3]);
    translate([0, 0, -3]) cylinder(h = 14.1, d = 6);       // pin ends at 11.1, no head
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
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all" || agentscad_part == "moving") rotate([0, 0, hinge_angle]) moving_leaf();
}

generated_part();
