// Reference submission for piston-bore-30.
//
// A piston in a blind cup. Unlike the hinge, the bore part is the stationary
// one: the barrel holds the bore and the piston is the moving shaft.
//
//   barrel: outer d 14, height 30, blind bore d 10.40 starting 2 mm up.
//   piston: d 10, 10 mm long, sitting 1 mm above the bore floor.
//
// The bore cylinder is scaled so its inscribed diameter is exactly 10.40 mm,
// which puts the as-designed diametral clearance at 0.40 mm against a 10 mm
// piston.
// Units: mm. Axis: +Z through the origin.
agentscad_part = "all";
piston_stroke = 0;   // pose control: the benchmark re-renders the piston at this stroke
$fn = 64;

bore_d = 10.40 / cos(180 / $fn);

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
