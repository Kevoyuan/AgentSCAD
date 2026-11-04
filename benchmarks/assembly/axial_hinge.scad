// Original two-piece test fixture. Units are millimetres.
// The loose axial joint needs external restraint in service; no retention is claimed.
agentscad_part = "all";
hinge_angle = 0;
$fn = 64;

module fixed_leaf() {
  union() {
    translate([-25, -5, -3]) cube([25, 10, 3.1]);
    translate([0, 0, -0.1]) cylinder(h = 12.1, d = 6);
  }
}

module moving_leaf() {
  union() {
    difference() {
      translate([0, 0, 1]) cylinder(h = 10, d = 10);
      translate([0, 0, 0.9]) cylinder(h = 10.2, d = 6.4 / cos(180 / $fn));
    }
    translate([4.5, -5, 1]) cube([20.5, 10, 3]);
  }
}

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all") rotate([0, 0, hinge_angle]) moving_leaf();
  if (agentscad_part == "moving") moving_leaf();
}

generated_part();
