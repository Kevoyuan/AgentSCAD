agentscad_part = "all";
piston_stroke = 0;

piston_d = 10;
bore_d = 10.25;
piston_length = 20;
piston_bottom0 = 10;

barrel_outer_d = 16;
bottom_wall = 5;
barrel_height = 80;

module barrel() {
    difference() {
        cylinder(h = barrel_height, d = barrel_outer_d, $fn = 128);
        translate([0, 0, bottom_wall])
            cylinder(h = barrel_height - bottom_wall + 0.01, d = bore_d, $fn = 128);
    }
}

module piston() {
    translate([0, 0, piston_bottom0 + piston_stroke])
        cylinder(h = piston_length, d = piston_d, $fn = 128);
}

if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
if (agentscad_part == "all" || agentscad_part == "piston") piston();
