// Adversarial: the piston is 0.05 mm per side too large for the bore.
// A cup and a piston, correctly separated and freely sliding, with the wrong
// fit: only the clearance check should decide this.
agentscad_part = "all";
piston_stroke = 0;   // pose control: the benchmark re-renders the piston at this stroke
$fn = 64;

bore_d = 10.10 / cos(180 / $fn);

module barrel() {
  difference() {
    translate([0, 0, 0]) cylinder(h = 30, d = 14);
    translate([0, 0, 2]) cylinder(h = 29, d = bore_d);
  }
}

module piston() {
  translate([0, 0, 3 + piston_stroke]) cylinder(h = 10, d = 10);
}

module generated_part() {
  if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
  if (agentscad_part == "all" || agentscad_part == "piston") piston();
}

generated_part();
