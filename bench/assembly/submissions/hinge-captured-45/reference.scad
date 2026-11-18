// Reference submission for hinge-captured-45.
//
// The pin runs past the knuckle and carries a head above it. The 0.2 mm gap
// between the knuckle top (z = 11) and the head bottom (z = 11.2) is what makes
// the part separable at the assembled pose; pulling 2 mm closes that gap and
// the head blocks the knuckle annulus, so `axial-retention` passes.
//
// This is the trade-off the task states: the part is captured, so it is not
// axially removable and no disassembly-path is required.
agentscad_part = "all";
hinge_angle = 0;   // pose control: the benchmark re-renders the moving part at this angle
$fn = 64;

bore_d = 6.40 / cos(180 / $fn);

module fixed_leaf() {
  union() {
    translate([-25, -5, -3]) cube([25, 10, 3]);
    translate([0, 0, -3]) cylinder(h = 15.2, d = 6);      // pin, top at 12.2
    translate([0, 0, 11.2]) cylinder(h = 1, d = 9);        // retention head, 11.2 .. 12.2
  }
}

module moving_leaf() {
  union() {
    difference() {
      translate([0, 0, 1]) cylinder(h = 10, d = 10);       // knuckle, 1 .. 11
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
