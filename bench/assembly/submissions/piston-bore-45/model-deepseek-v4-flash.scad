agentscad_part = "all";
piston_stroke = 0;

piston_d = 10;
diam_clearance = 0.25;
bore_d = piston_d + diam_clearance;

barrel_wall = 3;
barrel_bottom_t = 4;
barrel_inner_height = 60;
barrel_outer_d = bore_d + 2 * barrel_wall;
barrel_outer_h = barrel_bottom_t + barrel_inner_height;

piston_length = 24;
piston_base_z = barrel_bottom_t + 1;

module barrel() {
    difference() {
        cylinder(h = barrel_outer_h, d = barrel_outer_d, center = false, $fn = 128);
        translate([0, 0, barrel_bottom_t])
            cylinder(h = barrel_inner_height + 1, d = bore_d, center = false, $fn = 128);
    }
}

module piston() {
    translate([0, 0, piston_base_z + piston_stroke])
        cylinder(h = piston_length, d = piston_d, center = false, $fn = 128);
}

if (agentscad_part == "all" || agentscad_part == "barrel") barrel();
if (agentscad_part == "all" || agentscad_part == "piston") piston();
