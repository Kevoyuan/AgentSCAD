// Reference submission for hinge-45-loose.
//
// Design decisions that the measurements depend on:
//   - the bore cylinder is scaled so its *inscribed* diameter is 6.40 mm, which
//     makes the as-designed diametral clearance 0.40 mm against a 6 mm pin;
//   - the fixed leaf sits below the knuckle (z -3..0) and the moving leaf above
//     it (z 1..4), so no sweep of the moving leaf can reach the fixed leaf;
//   - the pin runs the full knuckle length, so withdrawal along +Z clears it.
//
// Units: mm. Assembly axis: +Z through the origin.
agentscad_part = "all";
hinge_angle = 0;   // pose control: the benchmark re-renders the moving part at this angle
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
  if (agentscad_part == "all" || agentscad_part == "fixed") fixed_leaf();
  if (agentscad_part == "all" || agentscad_part == "moving") rotate([0, 0, hinge_angle]) moving_leaf();
}

generated_part();
