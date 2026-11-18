agentscad_part = "all";
piston_stroke = 0;

$fn = 128;

module barrel() {
    difference() {
        cylinder(h = 52, r = 8, center = false);
        translate([0, 0, 2])
            cylinder(h = 51, r = 5.2, center = false);
    }
}

module piston() {
    translate([0, 0, 22 + piston_stroke])
        cylinder(h = 20, r = 5, center = false);
}

if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
if (agentscad_part == "all" || agentscad_part == "piston") piston();
