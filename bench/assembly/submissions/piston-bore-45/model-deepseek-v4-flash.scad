piston_stroke = 0;
agentscad_part = "all";

piston_d = 10;
diametral_clearance = 0.25;
piston_r = piston_d / 2;
bore_r = (piston_d + diametral_clearance) / 2;

barrel_outer_r = 8;
barrel_height = 80;
bottom_thickness = 4;
piston_length = 40;
piston_z0 = 6;

$fn = 180;

module barrel() {
    difference() {
        cylinder(h = barrel_height, r = barrel_outer_r, center = false);
        translate([0, 0, bottom_thickness])
            cylinder(h = barrel_height - bottom_thickness + 1, r = bore_r, center = false);
    }
}

module piston() {
    translate([0, 0, piston_z0 + piston_stroke])
        cylinder(h = piston_length, r = piston_r, center = false);
}

if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
if (agentscad_part == "all" || agentscad_part == "piston") piston();
