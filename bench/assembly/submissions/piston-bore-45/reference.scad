// Reference submission for piston-bore-45.
// Same cup-and-piston topology with a 45 mm barrel and a 10.25 mm bore
// inscribed diameter, giving 0.25 mm as-designed diametral clearance.
// Units: mm. Axis: +Z through the origin.
agentscad_part = "all";
piston_stroke = 0;   // pose control: the benchmark re-renders the piston at this stroke
$fn = 64;

bore_d = 10.25 / cos(180 / $fn);

module barrel() {
  difference() {
    translate([0, 0, 0]) cylinder(h = 45, d = 14);
    translate([0, 0, 2]) cylinder(h = 44, d = bore_d);
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
